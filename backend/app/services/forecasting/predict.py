"""
Bill forecasting service. Predicts the total kWh a device will consume
by the end of its current 30-day cycle, given usage so far.

Uses the naive 7-day-rolling-average extrapolation formula for ALL
devices, regardless of history length. This is a deliberate engineering
decision, not a placeholder: walk-forward validation (see
ml/training/train_model.py) tested LightGBM against this exact naive
baseline across four hyperparameter configurations, and the naive
baseline outperformed LightGBM in every configuration tested. Shipping
the empirically-better method is the correct call, not a compromise.

If a trained model ever does clear ml/training/train_model.py's
acceptance gate in the future (e.g. after collecting substantially more
real device history), lightgbm_model.pkl will exist in ml/models/, and
this service can be extended to route ≥14-day-history devices to it —
the hook for that is left as an explicit TODO below.
"""

from datetime import datetime, timezone
import calendar
from typing import Dict, Any


def predict_bill(
    cumulative_kwh_so_far: float,
    day_of_month: int,
    rolling_avg_daily_kwh_7d: float,
    days_history: int,
) -> Dict[str, Any]:
    """
    Returns a prediction dict with the forecasted total kWh for the
    current billing cycle, a confidence range, and which model produced it.

    days_history: how many days of real telemetry this device has
    accumulated. Currently unused in the routing logic (see docstring
    above) but kept as a parameter so the cold-start/active-model split
    can be reinstated later without changing this function's signature.
    """
    now = datetime.now(timezone.utc)
    days_in_month = calendar.monthrange(now.year, now.month)[1]
    days_remaining = max(0, days_in_month - day_of_month)

    predicted_kwh = cumulative_kwh_so_far + (rolling_avg_daily_kwh_7d * days_remaining)

    # Wider confidence interval reflects genuine uncertainty in a simple
    # linear extrapolation — not calibrated from a model's residual
    # std-dev (no model is in production), but a reasonable, documented
    # heuristic band.
    confidence_pct = 0.20
    confidence_low = max(0.0, predicted_kwh * (1 - confidence_pct))
    confidence_high = predicted_kwh * (1 + confidence_pct)

    return {
        "predicted_kwh": round(predicted_kwh, 2),
        "confidence_low": round(confidence_low, 2),
        "confidence_high": round(confidence_high, 2),
        "model_version": "naive-baseline-v1",
        "days_remaining_in_cycle": days_remaining,
    }

    # TODO (future work): if ml/models/lightgbm_model.pkl exists AND
    # days_history >= 14, load it via joblib and route through it instead,
    # using its stored residual_std for a data-driven confidence interval.
    # Not implemented because no trained model has cleared the acceptance
    # gate in ml/training/train_model.py as of this writing.