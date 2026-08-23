"""
Backfill SIMULATED telemetry for the current billing cycle.

    python -m tools.backfill_demo_cycle --help
    python -m tools.backfill_demo_cycle --dry-run      # show the profile, POST nothing
    python -m tools.backfill_demo_cycle                # ingest via POST /telemetry

WHAT THIS IS, PLAINLY
=====================
This generates SIMULATED household consumption. It is demo scaffolding, not a
measurement. Nothing it produces is evidence about model accuracy: the accuracy
figures for the forecaster come from purged walk-forward validation on the public
UCI household power consumption dataset (see ml/training/train_model.py) and are
completely independent of anything here.

The reason it exists is mundane: the mock ESP32 has only ever run for a few days,
so the live database holds 3 of 22 elapsed days in the current cycle. At 14%
coverage the API correctly refuses to forecast, which is the right behaviour but
leaves nothing to demonstrate. This fills the cycle so the dashboard, the budget
planner and the forecaster have a coherent month to work with.

Every row is written with is_backfilled=true, so simulated readings are
distinguishable from live ones in the database and in the API response
(DeviceLiveOut.reading_is_backfilled) — a viewer is never shown replayed data
dressed up as a live measurement.

HOW THE PROFILE IS BUILT
========================
It is NOT tuned to flatter the model. The shape is chosen from how an Egyptian
apartment actually behaves in August and then left alone:

  * a constant base load (fridge, router, standby) that never stops;
  * an air-conditioning load that follows time of day, peaking mid-afternoon
    through late evening and nearly vanishing before dawn;
  * a Friday/Saturday uplift, because that is the Egyptian weekend and people are
    home using the AC;
  * day-to-day noise from a seeded RNG so the series is not artificially smooth
    and the run is reproducible.

Readings are hourly. power_w is the mean power over the hour and energy_wh_delta
is that hour's energy, so the two agree by construction
(energy_wh_delta = power_w x 1 hour).

TOP-UP, NOT OVERWRITE
=====================
Days that already hold real mock readings are topped up to the target daily total
rather than duplicated: the generator subtracts whatever the database already has
for that day and distributes only the remainder. Without this, days the mock
device partly covered would end up as a mixture of a partial real day and a full
synthetic day, and the daily series would have visible steps that are an artefact
of the tooling rather than of consumption. Existing rows are never modified or
deleted.
"""

import argparse
import math
import random
import sys
from datetime import datetime, timedelta, timezone

import requests
from sqlalchemy import text

from app.core.billing_time import (
    BILLING_TIMEZONE, BILLING_TIMEZONE_NAME, now_local, cycle_start,
)
from app.core.database import SessionLocal

BASE = "http://127.0.0.1:8000/api/v1"
DEFAULT_DEVICE = "esp32_meter_01"

# Egypt's weekend, with Monday=0 (matches ml/features.py EGYPT_WEEKEND_DAYS).
EGYPT_WEEKEND_DAYS = {4, 5}

NOMINAL_VOLTAGE_V = 223.0
POWER_FACTOR = 0.95


def hourly_shape(hour: int) -> float:
    """
    Relative AC/discretionary load by hour of day, 0..1.

    A raised cosine peaking at 16:00 and bottoming at 04:00 — the shape of a hot
    day, where the AC works hardest through the afternoon and evening and the
    house is coolest just before dawn.
    """
    return 0.5 * (1.0 - math.cos(2.0 * math.pi * (hour - 4) / 24.0))


def build_daily_targets(start_date, n_days, mean_daily_kwh, rng):
    """Target kWh for each day of the cycle, with weekend uplift and noise."""
    targets = []
    for i in range(n_days):
        d = start_date + timedelta(days=i)
        weekend = d.weekday() in EGYPT_WEEKEND_DAYS
        factor = 1.18 if weekend else 1.0
        factor *= rng.gauss(1.0, 0.11)          # day-to-day variability
        targets.append(max(1.0, mean_daily_kwh * factor))
    return targets


def hour_weights():
    """Normalised hourly weights: constant base load plus time-of-day AC load."""
    base = 0.30                                  # share that is always-on
    shape = [hourly_shape(h) for h in range(24)]
    total_shape = sum(shape)
    return [
        base / 24.0 + (1.0 - base) * (s / total_shape)
        for s in shape
    ]


def existing_kwh_by_local_day(external_id, start_date, end_date):
    """Energy already recorded per local day, so days can be topped up not doubled."""
    db = SessionLocal()
    try:
        rows = db.execute(
            text("""
                SELECT (ts AT TIME ZONE :tz)::date AS local_day,
                       SUM(energy_wh_delta) / 1000.0 AS kwh
                FROM telemetry_raw
                WHERE device_id = (SELECT device_id FROM devices WHERE external_id = :ext)
                  AND (ts AT TIME ZONE :tz)::date BETWEEN :start AND :end
                GROUP BY 1
            """),
            {"tz": BILLING_TIMEZONE_NAME, "ext": external_id,
             "start": start_date, "end": end_date},
        ).all()
        return {r.local_day: float(r.kwh or 0.0) for r in rows}
    finally:
        db.close()


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--device", default=DEFAULT_DEVICE, help="external device id")
    p.add_argument("--mean-daily-kwh", type=float, default=17.0,
                   help="mean target consumption per day (default 17.0)")
    p.add_argument("--seed", type=int, default=20260822, help="RNG seed (reproducible)")
    p.add_argument("--dry-run", action="store_true",
                   help="print the generated profile without POSTing anything")
    args = p.parse_args()

    now = now_local()
    start_date = cycle_start(now.date())
    today = now.date()
    n_days = (today - start_date).days + 1

    rng = random.Random(args.seed)
    targets = build_daily_targets(start_date, n_days, args.mean_daily_kwh, rng)
    weights = hour_weights()

    existing = existing_kwh_by_local_day(args.device, start_date, today)

    print(f"[*] Cycle {start_date} .. {today}  ({n_days} elapsed days)")
    print(f"[*] Device {args.device}, mean target {args.mean_daily_kwh} kWh/day, seed {args.seed}")
    print(f"[*] SIMULATED data, written with is_backfilled=true. Not a measurement.")
    print()

    readings = []
    print(f"    {'day':<12} {'target':>8} {'existing':>9} {'to add':>8}  {'hours':>5}")
    full_day_weight = sum(weights)
    for i in range(n_days):
        d = start_date + timedelta(days=i)

        # Only the hours that have actually elapsed on the final (partial) day.
        max_hour = now.hour if d == today else 23
        day_weights = weights[: max_hour + 1]
        weight_sum = sum(day_weights)

        # Today's target is scaled to the fraction of the daily load shape that
        # has actually elapsed, not the whole day's total. Without this the full
        # day's energy gets crammed into the hours so far — at 04:00 that would
        # mean several kW sustained overnight, which would wreck both the
        # rolling average and the cumulative total the forecaster reads.
        target = targets[i] * (weight_sum / full_day_weight if d == today else 1.0)

        have = existing.get(d, 0.0)
        remainder = target - have

        if remainder <= 0.05 or weight_sum <= 0:
            # Already at or above target — leave the day alone rather than
            # inventing negative consumption to force the number down.
            print(f"    {d.isoformat():<12} {target:>8.2f} {have:>9.2f} {'skip':>8}  {0:>5}")
            continue

        for h in range(max_hour + 1):
            kwh_h = remainder * (day_weights[h] / weight_sum)
            wh = kwh_h * 1000.0
            power_w = wh  # one hour, so Wh == mean W
            local_dt = datetime(d.year, d.month, d.day, h, 0, 0, tzinfo=BILLING_TIMEZONE)
            readings.append({
                "device_id": args.device,
                "timestamp": local_dt.astimezone(timezone.utc).isoformat(),
                "voltage_rms": round(rng.gauss(NOMINAL_VOLTAGE_V, 1.8), 2),
                "current_rms": round(power_w / (NOMINAL_VOLTAGE_V * POWER_FACTOR), 3),
                "power_w": round(power_w, 2),
                "energy_wh_delta": round(wh, 3),
                "power_factor": round(min(1.0, rng.gauss(POWER_FACTOR, 0.02)), 3),
                "is_backfilled": True,
            })

        print(f"    {d.isoformat():<12} {target:>8.2f} {have:>9.2f} {remainder:>8.2f}  {max_hour + 1:>5}")

    print()
    print(f"[*] {len(readings)} hourly readings generated, "
          f"{sum(r['energy_wh_delta'] for r in readings) / 1000.0:.1f} kWh total to add")

    if args.dry_run:
        print("[*] --dry-run: nothing sent.")
        return 0

    print(f"[*] POSTing to {BASE}/telemetry ...")
    session = requests.Session()
    stored = duplicates = failed = 0
    for r in readings:
        try:
            resp = session.post(f"{BASE}/telemetry", json=r, timeout=10)
        except requests.RequestException as e:
            print(f"[!] request failed: {e}")
            failed += 1
            continue
        if resp.status_code != 202:
            print(f"[!] {resp.status_code} for {r['timestamp']}: {resp.text[:200]}")
            failed += 1
        elif resp.json().get("stored"):
            stored += 1
        else:
            duplicates += 1

    print()
    print(f"[*] stored {stored}, duplicates ignored {duplicates}, failed {failed}")
    if failed:
        print("[FAIL] some readings were rejected — see the errors above.")
        return 1
    print("[OK] Backfill complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
