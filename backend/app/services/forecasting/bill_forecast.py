"""
Bill forecast assembly and persistence.

WHY THIS MODULE EXISTS
======================
Producing a bill forecast takes three steps: read this cycle's daily kWh out of
telemetry_raw, run the forecaster, then convert kWh to EGP through the tariff
engine. That sequence was living inside the GET /predictions/{device_id} route
handler, which was fine while the route was the only caller.

It stopped being fine the moment a second caller appeared — the snapshot job that
writes forecasts to bills_predicted. Reimplementing the sequence there would mean
the logged forecast could quietly drift from the served one, and a prediction log
that disagrees with what the user was shown is worse than no log at all.

This project has already been bitten twice by exactly that pattern: the ingest
timestamp bug and the online/offline flapping bug were both one quantity computed
independently in two places. So the sequence lives here once, and both the route
and the job call it.

WHAT IS PERSISTED, AND WHY IT IS A LOG
======================================
bills_predicted is append-only: one row per snapshot, never overwritten. See the
BillPredicted model docstring for the reasoning — briefly, keeping the history is
what makes it possible to measure this household's real forecast accuracy after a
cycle closes, instead of relying only on the public-dataset validation.

Snapshots are written by a job, NOT by the GET route. Two reasons:

  * the dashboard polls the prediction endpoint, so writing on read would insert a
    row every few seconds and bury the useful daily signal in noise;
  * a GET that mutates state is a trap for anything that retries or prefetches.

WHAT IS NOT PERSISTED
=====================
Only the fields the table actually has. The forecast payload also carries
data_quality, the fallback reason, the naive comparison and the tariff position;
those are diagnostic and are not logged, so the log is not a full audit record of
why a given number was produced. `model_version` does record WHICH method produced
it ("naive-baseline-v1" on a guard refusal), so a fallback can never appear in the
log as though a model had made it.
"""

from datetime import timedelta
from uuid import UUID

from sqlalchemy import text

from app.core.billing_time import (
    BILLING_TIMEZONE_NAME,
    cycle_end,
    cycle_length_days,
    cycle_start,
    now_local,
)
from app.services.forecasting.predict import predict_bill
from app.services.tariff_engine.calculator import calculate_bill, get_tariff_summary

DAILY_KWH_SQL = """
SELECT (ts AT TIME ZONE :tz)::date AS local_day,
       SUM(energy_wh_delta) / 1000.0 AS kwh
FROM telemetry_raw
WHERE device_id = :device_id
  AND (ts AT TIME ZONE :tz)::date >= :cycle_start
  AND (ts AT TIME ZONE :tz)::date <= :today
GROUP BY 1
ORDER BY 1
"""


def daily_kwh_this_cycle(db, device_id, cycle_start_date, today):
    """
    This cycle's kWh per LOCAL day, as a dense list with one entry per elapsed day.

    energy_wh_delta is a per-reading DELTA, not a cumulative counter, so summing it
    over a day gives that day's energy directly and survives an ESP32 counter reset.

    Days with no telemetry are 0.0 so that list positions line up with calendar
    days. They are NOT interpolated — inventing consumption for a day the meter was
    offline would make the forecast look better-founded than it is. The count of
    such days is reported in the forecast's data_quality block, and the forecaster
    refuses the model below 80% coverage.
    """
    rows = db.execute(
        text(DAILY_KWH_SQL),
        {
            "device_id": str(device_id),
            "tz": BILLING_TIMEZONE_NAME,
            "cycle_start": cycle_start_date,
            "today": today,
        },
    ).all()
    by_day = {r.local_day: float(r.kwh or 0.0) for r in rows}

    days_elapsed = (today - cycle_start_date).days + 1
    return [by_day.get(cycle_start_date + timedelta(days=i), 0.0) for i in range(days_elapsed)]


def build_forecast(db, device_id):
    """
    The full bill-forecast payload for one device: the exact dict the API returns.

    Pure read. Call persist_forecast separately to log it.
    """
    now = now_local()
    today = now.date()
    cycle_start_date = cycle_start(today)
    cycle_days = cycle_length_days(today)

    daily_kwh_observed = daily_kwh_this_cycle(db, device_id, cycle_start_date, today)
    days_with_readings = sum(1 for d in daily_kwh_observed if d > 0)

    forecast = predict_bill(
        cycle_start_date=cycle_start_date,
        daily_kwh_observed=daily_kwh_observed,
        cycle_length_days=cycle_days,
        days_with_readings=days_with_readings,
    )

    # kWh -> EGP through the canonical progressive tariff engine. The confidence
    # bounds are converted the same way, so the money band reflects the tariff's
    # bracket steps rather than being a flat percentage of the central figure.
    forecast["predicted_bill_egp"] = calculate_bill(forecast["predicted_kwh"])
    forecast["confidence_bill_low_egp"] = calculate_bill(forecast["confidence_low"])
    forecast["confidence_bill_high_egp"] = calculate_bill(forecast["confidence_high"])

    kwh_so_far = round(sum(daily_kwh_observed), 4)
    forecast["kwh_so_far"] = kwh_so_far
    forecast["bill_so_far_egp"] = calculate_bill(kwh_so_far)
    forecast["tariff_position"] = get_tariff_summary(forecast["predicted_kwh"])

    return forecast


# One snapshot per device per local day. bills_predicted has no unique constraint
# (it is a log, and the useful key is an expression over generated_at in local
# time, which Postgres cannot index because AT TIME ZONE with a named zone is
# STABLE rather than IMMUTABLE). So the guard is a WHERE NOT EXISTS instead.
#
# That makes it safe against repeated runs, not against two writers racing in the
# same instant. Acceptable here because a single scheduled job does the writing;
# if that ever changes, the fix is an explicit snapshot_date column with a real
# unique index on (device_id, billing_period_start, snapshot_date).
INSERT_SQL = """
INSERT INTO bills_predicted (
    device_id, billing_period_start, billing_period_end,
    predicted_kwh, predicted_bill_egp,
    confidence_low, confidence_high, model_version
)
SELECT
    CAST(:device_id AS uuid), CAST(:period_start AS date), CAST(:period_end AS date),
    :predicted_kwh, :predicted_bill_egp,
    :confidence_low, :confidence_high, :model_version
WHERE :force OR NOT EXISTS (
    SELECT 1 FROM bills_predicted
    WHERE device_id = CAST(:device_id AS uuid)
      AND billing_period_start = CAST(:period_start AS date)
      AND (generated_at AT TIME ZONE :tz)::date = (now() AT TIME ZONE :tz)::date
)
RETURNING prediction_id, generated_at
"""


def persist_forecast(db, device_id, forecast=None, force=False):
    """
    Log a forecast snapshot to bills_predicted.

    Returns the inserted row as a dict, or None if a snapshot for this device and
    billing period already exists for today's LOCAL date (and force is False).

    confidence_low / confidence_high are stored in kWh, matching predicted_kwh.
    The EGP band is recoverable from them via the tariff engine, so nothing is
    lost; storing EGP instead would lose the kWh.
    """
    if forecast is None:
        forecast = build_forecast(db, device_id)

    today = now_local().date()
    row = db.execute(
        text(INSERT_SQL),
        {
            "device_id": str(device_id),
            "period_start": cycle_start(today),
            "period_end": cycle_end(today),
            "predicted_kwh": float(forecast["predicted_kwh"]),
            "predicted_bill_egp": float(forecast["predicted_bill_egp"]),
            "confidence_low": float(forecast["confidence_low"]),
            "confidence_high": float(forecast["confidence_high"]),
            # Records the method that actually produced the number: the model
            # version, or "naive-baseline-v1" when a serving guard refused the
            # model. A fallback is never logged as a model prediction.
            "model_version": forecast["model_version"],
            "tz": BILLING_TIMEZONE_NAME,
            "force": force,
        },
    ).mappings().first()

    db.commit()
    if row is None:
        return None
    return {
        "prediction_id": str(row["prediction_id"]),
        "generated_at": row["generated_at"],
        "predicted_kwh": float(forecast["predicted_kwh"]),
        "predicted_bill_egp": float(forecast["predicted_bill_egp"]),
        "model_version": forecast["model_version"],
        "prediction_method": forecast["prediction_method"],
    }
