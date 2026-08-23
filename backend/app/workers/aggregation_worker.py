"""
Aggregation worker: rolls telemetry_raw up into telemetry_hourly and telemetry_daily.

    python -m app.workers.aggregation_worker                 # run forever, 60s interval
    python -m app.workers.aggregation_worker --once          # single pass, then exit
    python -m app.workers.aggregation_worker --once --all    # rebuild every bucket
    python -m app.workers.aggregation_worker --once --days 14
    python -m app.workers.aggregation_worker --once --dry-run

WHY ROLL UP AT ALL
==================
telemetry_raw holds one row per reading — roughly 17k rows per device per day at a
5-second publish interval. Charting a month from that means scanning half a million
rows on every page load. The rollups answer the same questions in 24 rows a day.
GET /telemetry/daily/{device_id} reads telemetry_daily, so this job is what makes
that endpoint return anything at all.

IDEMPOTENT BY DESIGN
====================
Every write is an upsert keyed on (device_id, bucket_start) and each bucket is
recomputed from raw rather than incremented. Running this twice, or every 60
seconds forever, produces exactly the same table — it never double-counts. That
matters because the job has to be re-runnable: readings arrive late.

DAY BOUNDARIES ARE LOCAL, NOT UTC   (this was a real bug, now fixed)
===================================================================
Daily buckets are grouped by (ts AT TIME ZONE 'Africa/Cairo')::date, via
app/core/billing_time.py so there is one definition of "which day" shared with the
bill forecaster and the live dashboard gauge.

The previous version grouped by (bucket_start AT TIME ZONE 'UTC')::date. Cairo is
UTC+3 in summer, so local midnight is 21:00 UTC the day before: every day's first
three hours were filed under the previous day. This was not hypothetical — the
2026-08-21 daily row in the database included the 2026-08-21 21:00+00 hour bucket,
which is 00:00 on 2026-08-22 in Cairo. A bill is a local-calendar document, so a
daily series that disagrees with the forecaster by three hours a day is wrong for
the one purpose the table exists to serve.

DAILY IS COMPUTED FROM RAW, NOT FROM HOURLY   (also a fix)
==========================================================
The previous version derived daily from telemetry_hourly using AVG(avg_power_w),
which averages hourly averages without weighting them. An hour containing 6
readings (device came online mid-hour) counted exactly as much as an hour
containing 720. Grouping raw readings directly by local day removes that
distortion and removes the two-stage dependency at the same time.

WHAT avg_power_w MEANS
======================
avg_power_w is AVG(power_w) over the raw readings in the bucket — the mean of the
instantaneous power samples. The SAME definition is used at both hourly and daily
grain, and it matches what GET /telemetry/hourly/{device_id} computes from raw, so
there is only one definition of the quantity in the codebase.

Being a plain sample mean, it is sampling-weighted: an hour with only one
backfilled reading contributes that one value. total_energy_kwh is the
authoritative energy figure and is unaffected by sampling rate, so anything
billing-related reads that, never avg_power_w.

peak_power_w is MAX(power_w) over raw readings, which is genuinely an
instantaneous quantity.

WHY THE WINDOW IS SNAPPED TO WHOLE LOCAL DAYS
=============================================
A trailing window keeps the periodic pass cheap, but filtering raw rows by a bare
timestamp cutoff would slice a bucket in half and recompute it from only the rows
inside the window — silently undercounting that bucket. So the cutoff is a local
DATE: every day (and therefore every hour, since Cairo's offset is a whole number
of hours) that falls in scope is recomputed from all of its rows.

A device that buffers through a Wi-Fi outage flushes readings with their ORIGINAL
timestamps (see services/telemetry/ingest.py), so late rows land in buckets that
were already aggregated. Recomputing a trailing window corrects those
automatically; --all exists for a full rebuild when a gap is older than the window.
"""

import argparse
import sys
import time
from datetime import datetime, timezone

from sqlalchemy import text

from app.core.billing_time import BILLING_TIMEZONE_NAME
from app.core.database import SessionLocal

ROLLUP_INTERVAL_SECONDS = 60

# Trailing window recomputed on each pass. Three days comfortably covers a device
# that was offline overnight; --all handles anything older.
DEFAULT_LOOKBACK_DAYS = 3

# A local day far enough back to mean "all of history". Used instead of NULL
# because a NULL comparison would exclude every row rather than include them.
BEGINNING_OF_TIME = "0001-01-01"


# Hour buckets stay keyed on date_trunc('hour', ts) in UTC. Cairo's offset is a
# whole number of hours, so UTC and local hour boundaries fall on the same
# instants — this keeps the bucket_start values of already-stored rows byte-for-byte
# stable while the daily grouping below is corrected.
HOURLY_SQL = """
INSERT INTO telemetry_hourly (device_id, bucket_start, total_energy_kwh, avg_power_w, peak_power_w)
SELECT
    device_id,
    date_trunc('hour', ts) AS bucket_start,
    ROUND((SUM(energy_wh_delta) / 1000.0)::numeric, 4) AS total_energy_kwh,
    ROUND(AVG(power_w)::numeric, 2) AS avg_power_w,
    ROUND(MAX(power_w)::numeric, 2) AS peak_power_w
FROM telemetry_raw
WHERE (ts AT TIME ZONE :tz)::date >= CAST(:since_day AS date)
  AND (:device_uuid IS NULL OR device_id = CAST(:device_uuid AS uuid))
GROUP BY device_id, date_trunc('hour', ts)
ON CONFLICT (device_id, bucket_start) DO UPDATE SET
    total_energy_kwh = EXCLUDED.total_energy_kwh,
    avg_power_w      = EXCLUDED.avg_power_w,
    peak_power_w     = EXCLUDED.peak_power_w
"""

DAILY_SQL = """
INSERT INTO telemetry_daily (device_id, bucket_start, total_energy_kwh, avg_power_w, peak_power_w)
SELECT
    device_id,
    (ts AT TIME ZONE :tz)::date AS bucket_start,
    ROUND((SUM(energy_wh_delta) / 1000.0)::numeric, 4) AS total_energy_kwh,
    ROUND(AVG(power_w)::numeric, 2) AS avg_power_w,
    ROUND(MAX(power_w)::numeric, 2) AS peak_power_w
FROM telemetry_raw
WHERE (ts AT TIME ZONE :tz)::date >= CAST(:since_day AS date)
  AND (:device_uuid IS NULL OR device_id = CAST(:device_uuid AS uuid))
GROUP BY device_id, (ts AT TIME ZONE :tz)::date
ON CONFLICT (device_id, bucket_start) DO UPDATE SET
    total_energy_kwh = EXCLUDED.total_energy_kwh,
    avg_power_w      = EXCLUDED.avg_power_w,
    peak_power_w     = EXCLUDED.peak_power_w
"""

DRY_RUN_SQL = """
SELECT
    COUNT(*) AS raw_rows,
    COUNT(DISTINCT date_trunc('hour', ts)) AS hourly_buckets,
    COUNT(DISTINCT (ts AT TIME ZONE :tz)::date) AS daily_buckets
FROM telemetry_raw
WHERE (ts AT TIME ZONE :tz)::date >= CAST(:since_day AS date)
  AND (:device_uuid IS NULL OR device_id = CAST(:device_uuid AS uuid))
"""


def lookback_start_day(db, days):
    """
    The earliest LOCAL day to recompute: `days` days back from today in Cairo.

    Resolved in Postgres so the worker's notion of "today" comes from the same
    clock and timezone database as the SQL that does the grouping.
    """
    return db.execute(
        text("""
            SELECT ((now() AT TIME ZONE :tz)::date - make_interval(days => :d))::date
        """),
        {"tz": BILLING_TIMEZONE_NAME, "d": days},
    ).scalar()


def run_hourly_rollup(db, since_day, device_uuid=None):
    """Recompute 1-hour buckets for every local day at or after since_day."""
    return db.execute(
        text(HOURLY_SQL),
        {"tz": BILLING_TIMEZONE_NAME, "since_day": str(since_day), "device_uuid": device_uuid},
    ).rowcount


def run_daily_rollup(db, since_day, device_uuid=None):
    """Recompute local-day buckets for every local day at or after since_day."""
    return db.execute(
        text(DAILY_SQL),
        {"tz": BILLING_TIMEZONE_NAME, "since_day": str(since_day), "device_uuid": device_uuid},
    ).rowcount


def run_once(since_day=None, device_uuid=None, dry_run=False, quiet=False):
    """
    One aggregation pass. since_day=None rebuilds all of history.

    Returns (hourly_rows, daily_rows), or (0, 0) on a dry run or an error. Errors
    are caught and reported rather than raised, because this also runs inside
    run_forever() where one bad pass must not kill the process.
    """
    since_day = BEGINNING_OF_TIME if since_day is None else since_day
    db = SessionLocal()
    try:
        params = {
            "tz": BILLING_TIMEZONE_NAME,
            "since_day": str(since_day),
            "device_uuid": device_uuid,
        }

        if dry_run:
            c = db.execute(text(DRY_RUN_SQL), params).mappings().first()
            print(f"[*] --dry-run: {c['raw_rows']} raw rows -> "
                  f"{c['hourly_buckets']} hourly and {c['daily_buckets']} daily bucket(s). "
                  f"Nothing written.")
            return 0, 0

        hourly = run_hourly_rollup(db, since_day, device_uuid)
        daily = run_daily_rollup(db, since_day, device_uuid)
        db.commit()

        if not quiet:
            ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
            print(f"[{ts} UTC] [OK] rollup: {hourly} hourly, {daily} daily bucket(s) "
                  f"(local days >= {since_day})")
        return hourly, daily

    except Exception as e:
        db.rollback()
        print(f"[!] Rollup error: {e}")
        return 0, 0
    finally:
        db.close()


def run_forever(days=DEFAULT_LOOKBACK_DAYS, device_uuid=None):
    print(f"[*] Aggregation worker starting "
          f"(interval {ROLLUP_INTERVAL_SECONDS}s, {days}-day trailing window, "
          f"day boundaries in {BILLING_TIMEZONE_NAME})...")
    while True:
        # Recomputed each pass so the window follows the clock across midnight
        # instead of being frozen at process start.
        db = SessionLocal()
        try:
            since_day = lookback_start_day(db, days)
        except Exception as e:
            print(f"[!] Could not resolve lookback window: {e}")
            since_day = None
        finally:
            db.close()

        run_once(since_day=since_day, device_uuid=device_uuid)
        time.sleep(ROLLUP_INTERVAL_SECONDS)


def resolve_device_uuid(db, external_id):
    row = db.execute(
        text("SELECT device_id FROM devices WHERE external_id = :ext"),
        {"ext": external_id},
    ).mappings().first()
    if not row:
        raise LookupError(f"device '{external_id}' is not registered")
    return str(row["device_id"])


def main():
    p = argparse.ArgumentParser(description="Roll telemetry_raw into hourly/daily buckets.")
    p.add_argument("--once", action="store_true",
                   help="single pass then exit (default: loop every "
                        f"{ROLLUP_INTERVAL_SECONDS}s)")
    window = p.add_mutually_exclusive_group()
    window.add_argument("--days", type=int, default=DEFAULT_LOOKBACK_DAYS,
                        help=f"trailing window in local days (default {DEFAULT_LOOKBACK_DAYS})")
    window.add_argument("--all", action="store_true",
                        help="rebuild every bucket in history")
    p.add_argument("--device", help="limit to one external device id (default: all devices)")
    p.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    args = p.parse_args()

    db = SessionLocal()
    try:
        device_uuid = resolve_device_uuid(db, args.device) if args.device else None
        since_day = None if args.all else lookback_start_day(db, args.days)
    except LookupError as e:
        print(f"[!] {e}")
        return 1
    finally:
        db.close()

    scope = "ALL history" if args.all else f"local days >= {since_day}"
    target = f"device {args.device}" if args.device else "all devices"
    print(f"[*] Aggregating {scope}, {target}")

    if args.once or args.dry_run:
        run_once(since_day=since_day, device_uuid=device_uuid, dry_run=args.dry_run)
        return 0

    if args.all:
        print("[*] Rebuilding all history once before entering the periodic loop.")
        run_once(since_day=None, device_uuid=device_uuid)

    run_forever(days=args.days, device_uuid=device_uuid)
    return 0


if __name__ == "__main__":
    sys.exit(main())
