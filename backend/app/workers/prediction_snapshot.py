"""
Prediction snapshot job: logs each device's current bill forecast to bills_predicted.

    python -m app.workers.prediction_snapshot                 # all devices, once
    python -m app.workers.prediction_snapshot --device esp32_meter_01
    python -m app.workers.prediction_snapshot --force         # snapshot again today
    python -m app.workers.prediction_snapshot --dry-run       # show, write nothing

Intended to run once a day (Task Scheduler / cron). One snapshot per device per
local day: re-running is a no-op unless --force is given, so a scheduler that
fires twice does not pollute the log.

WHY SNAPSHOT AT ALL
===================
It builds the audit trail that lets this project's accuracy claim be checked on
real data. The validation figures in SUBMISSION_STATUS.md come from the public UCI
dataset, which is honest but is a European proxy. Logging what was predicted on
day 5, day 12, day 20 of a live cycle means that once the cycle closes and the
actual kWh is known, the error can be measured on this household directly.

Nothing here fabricates that comparison — it only records the predictions as they
were made, so the comparison becomes possible later. No accuracy number in the
submission comes from this table.

WHY IT IS A JOB AND NOT PART OF THE GET ROUTE
=============================================
The dashboard polls GET /predictions/{device_id}. Writing a snapshot on read would
insert a row every few seconds, and a GET with a side effect misbehaves under any
retry or prefetch. See app/services/forecasting/bill_forecast.py.

The forecast itself is built by that same shared module, so a logged snapshot is
by construction the same number the API served.
"""

import argparse
import sys

from sqlalchemy import text

from app.core.billing_time import cycle_end, cycle_start, today_local
from app.core.database import SessionLocal
from app.services.forecasting.bill_forecast import build_forecast, persist_forecast


def devices_to_snapshot(db, external_id=None):
    """
    Devices to snapshot: every registered device, or one named device.

    Devices with no telemetry at all are included deliberately. The forecaster
    returns a naive fallback with an explicit reason for them rather than raising,
    and logging that is more honest than silently skipping the device — the log
    then shows that a forecast was attempted and why it could not use the model.
    """
    if external_id:
        rows = db.execute(
            text("SELECT device_id, external_id FROM devices WHERE external_id = :ext"),
            {"ext": external_id},
        ).mappings().all()
        if not rows:
            raise LookupError(f"device '{external_id}' is not registered")
        return rows

    return db.execute(
        text("SELECT device_id, external_id FROM devices ORDER BY external_id")
    ).mappings().all()


def run(external_id=None, force=False, dry_run=False):
    db = SessionLocal()
    written = skipped = failed = 0
    try:
        devices = devices_to_snapshot(db, external_id)
        today = today_local()
        print(f"[*] Billing period {cycle_start(today)} .. {cycle_end(today)}  "
              f"(snapshot date {today})")
        print(f"[*] {len(devices)} device(s)")
        print()

        for d in devices:
            label = d["external_id"]
            try:
                forecast = build_forecast(db, d["device_id"])
            except Exception as e:
                print(f"[!] {label}: forecast failed — {e}")
                failed += 1
                continue

            method = forecast["prediction_method"]
            detail = (f"{forecast['predicted_kwh']:.2f} kWh -> "
                      f"{forecast['predicted_bill_egp']:.2f} EGP  "
                      f"[{forecast['confidence_low']:.2f}-{forecast['confidence_high']:.2f} kWh]  "
                      f"{forecast['model_version']} ({method})")

            if dry_run:
                print(f"[dry-run] {label}: {detail}")
                continue

            result = persist_forecast(db, d["device_id"], forecast=forecast, force=force)
            if result is None:
                print(f"[skip] {label}: already snapshotted today. {detail}")
                skipped += 1
            else:
                print(f"[OK]   {label}: {detail}")
                print(f"         prediction_id {result['prediction_id']}")
                written += 1

            if forecast["prediction_method"] != "model":
                print(f"         NOTE: naive fallback — {forecast['fallback_reason']}")

        print()
        if dry_run:
            print("[*] --dry-run: nothing written.")
        else:
            print(f"[*] {written} written, {skipped} already present, {failed} failed")
        return 1 if failed else 0

    except LookupError as e:
        print(f"[!] {e}")
        return 1
    finally:
        db.close()


def main():
    p = argparse.ArgumentParser(description="Log current bill forecasts to bills_predicted.")
    p.add_argument("--device", help="limit to one external device id (default: all)")
    p.add_argument("--force", action="store_true",
                   help="write a snapshot even if one already exists for today")
    p.add_argument("--dry-run", action="store_true", help="show forecasts, write nothing")
    args = p.parse_args()
    return run(external_id=args.device, force=args.force, dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
