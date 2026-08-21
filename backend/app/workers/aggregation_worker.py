"""
Aggregation worker: periodically rolls up telemetry_raw into
telemetry_hourly and telemetry_daily.

Uses INSERT ... ON CONFLICT DO UPDATE (upsert) so it's safe to re-run
repeatedly on overlapping time windows — re-aggregating the current
(still-filling) hour just updates that row in place rather than creating
duplicates or erroring.

Run as a standalone long-running process, separate from the API server
and the ingestion worker:
    python -m app.workers.aggregation_worker
"""

import time
from datetime import datetime, timezone
from sqlalchemy import text

from app.core.database import SessionLocal

ROLLUP_INTERVAL_SECONDS = 60


def run_hourly_rollup(db) -> None:
    """
    Aggregates telemetry_raw into 1-hour buckets. Recomputes every hour
    bucket that has raw data (including the current, still-filling hour) —
    the ON CONFLICT clause makes this idempotent.
    """
    db.execute(text("""
        INSERT INTO telemetry_hourly (device_id, bucket_start, total_energy_kwh, avg_power_w, peak_power_w)
        SELECT
            device_id,
            date_trunc('hour', ts) AS bucket_start,
            ROUND((SUM(energy_wh_delta) / 1000.0)::numeric, 4) AS total_energy_kwh,
            ROUND(AVG(power_w)::numeric, 2) AS avg_power_w,
            ROUND(MAX(power_w)::numeric, 2) AS peak_power_w
        FROM telemetry_raw
        GROUP BY device_id, date_trunc('hour', ts)
        ON CONFLICT (device_id, bucket_start) DO UPDATE SET
            total_energy_kwh = EXCLUDED.total_energy_kwh,
            avg_power_w = EXCLUDED.avg_power_w,
            peak_power_w = EXCLUDED.peak_power_w
    """))


def run_daily_rollup(db) -> None:
    """
    Aggregates telemetry_hourly into calendar-day buckets. Runs after
    the hourly rollup so it always reflects the latest hourly data.
    """
    db.execute(text("""
        INSERT INTO telemetry_daily (device_id, bucket_start, total_energy_kwh, avg_power_w, peak_power_w)
        SELECT
            device_id,
            (bucket_start AT TIME ZONE 'UTC')::date AS bucket_start,
            ROUND(SUM(total_energy_kwh)::numeric, 4) AS total_energy_kwh,
            ROUND(AVG(avg_power_w)::numeric, 2) AS avg_power_w,
            ROUND(MAX(peak_power_w)::numeric, 2) AS peak_power_w
        FROM telemetry_hourly
        GROUP BY device_id, (bucket_start AT TIME ZONE 'UTC')::date
        ON CONFLICT (device_id, bucket_start) DO UPDATE SET
            total_energy_kwh = EXCLUDED.total_energy_kwh,
            avg_power_w = EXCLUDED.avg_power_w,
            peak_power_w = EXCLUDED.peak_power_w
    """))


def run_once() -> None:
    db = SessionLocal()
    try:
        run_hourly_rollup(db)
        run_daily_rollup(db)
        db.commit()
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
        print(f"[{ts} UTC] [✓] Hourly + daily rollup completed")
    except Exception as e:
        db.rollback()
        print(f"[!] Rollup error: {e}")
    finally:
        db.close()


def run_forever() -> None:
    print(f"[*] Aggregation worker starting (interval: {ROLLUP_INTERVAL_SECONDS}s)...")
    while True:
        run_once()
        time.sleep(ROLLUP_INTERVAL_SECONDS)


if __name__ == "__main__":
    run_forever()