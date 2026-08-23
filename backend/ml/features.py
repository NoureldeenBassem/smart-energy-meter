"""
Canonical feature definitions for month-end kWh forecasting.

SINGLE SOURCE OF TRUTH. Both sides of the system import from here:

    ml/training/prepare_public_dataset.py   builds training rows
    app/services/forecasting/predict.py     builds one live row at request time

If these two ever computed features differently the model would be served inputs
that do not match what it was trained on -- train/serve skew, which degrades
predictions silently and would make the reported accuracy a lie. Hence one
function, called by both.

-----------------------------------------------------------------------------
THE BASELINE AND WHAT THE MODEL ACTUALLY PREDICTS
-----------------------------------------------------------------------------
    naive = cumulative_kwh_so_far + rolling_avg_daily_kwh_7d * days_remaining

The model does NOT predict the total, and does not predict the raw residual
either. It predicts the baseline's PER-DAY RATE ERROR:

    residual   = target - naive
               = days_remaining * (actual_avg_remaining - rolling_avg_7d)
    rate_error = residual / days_remaining

    final      = naive + alpha * days_remaining * model.predict(features)

Why the rate form:
  * The raw residual is non-stationary -- its magnitude grows with
    days_remaining (measured: 15.9 kWh at 1 day out, 55.4 kWh at 15). A single
    model cannot fit a target whose scale depends on a feature.
  * The baseline is EXACT on the last day of a cycle (MAE 0.00, nothing left to
    forecast). The rate form multiplies the correction by days_remaining, so it
    provably vanishes there. A raw-residual model destroyed that, posting MAE
    10.43 where the baseline scored 0.00.
"""

from datetime import date, timedelta
from typing import Sequence

CYCLE_LENGTH_DAYS = 30

# Egypt's weekend is Friday/Saturday, not Saturday/Sunday. The public training
# data is French, but weekend BEHAVIOUR is what the feature captures and the
# deployment target is Egypt. Monday=0 ... Friday=4, Saturday=5, Sunday=6.
EGYPT_WEEKEND_DAYS = {4, 5}

ROLLING_WINDOW_DAYS = 7

# Canonical feature order. The model artifact stores this list too, and
# predict.py asserts against it, so a mismatch fails loudly instead of silently.
FEATURE_COLUMNS = [
    # level / baseline
    "naive_prediction",
    "cumulative_kwh_so_far",
    "rolling_avg_daily_kwh_7d",
    "avg_daily_kwh_so_far",
    # position in cycle
    "day_of_month",
    "days_remaining",
    # calendar
    "day_of_week",
    "is_weekend",
    "month",
    "weekend_days_remaining",
    # explicit DIFFERENCES -- trees cannot form these from the operands above,
    # and the rate error being predicted is itself a difference of two rates.
    "reversion_gap",
    "weekend_mismatch",
    "weekend_frac_remaining",
]

TARGET_COLUMN = "target_total_kwh"
NAIVE_COLUMN = "naive_prediction"
RATE_ERROR_COLUMN = "rate_error"


def naive_baseline(cumulative_kwh: float, rolling_avg_7d: float, days_remaining: int) -> float:
    """
    The baseline the model must beat: assume each remaining day consumes the
    recent 7-day average. Defined once so feature generation, evaluation and
    live prediction can never disagree about what "naive" means.
    """
    return cumulative_kwh + (rolling_avg_7d * days_remaining)


def _is_weekend(d: date) -> bool:
    return d.weekday() in EGYPT_WEEKEND_DAYS


def build_features(
    cycle_start_date: date,
    daily_kwh_observed: Sequence[float],
    cycle_length_days: int = CYCLE_LENGTH_DAYS,
) -> dict:
    """
    Builds one feature row from cycle-to-date consumption only.

    cycle_start_date     first day of the billing cycle
    daily_kwh_observed   one kWh total per elapsed day, day 1 first, ending with
                         the observation day. len() == day_of_month.

    Uses NO future consumption. The only forward-looking inputs are calendar
    facts (which of the remaining dates are weekends), which are knowable today.

    Raises ValueError rather than guessing if the input cannot support a
    meaningful forecast -- a fabricated feature row would produce a confident
    number with nothing behind it.
    """
    day_of_month = len(daily_kwh_observed)

    if day_of_month < 3:
        raise ValueError(
            f"Need at least 3 days of consumption to forecast; got {day_of_month}. "
            "A 7-day average over 1-2 days is degenerate."
        )
    if day_of_month > cycle_length_days:
        raise ValueError(
            f"Observed {day_of_month} days but the cycle is {cycle_length_days} days long."
        )

    observation_date = cycle_start_date + timedelta(days=day_of_month - 1)
    days_remaining = cycle_length_days - day_of_month

    cumulative_kwh_so_far = float(sum(daily_kwh_observed))
    avg_daily_kwh_so_far = cumulative_kwh_so_far / day_of_month

    window = min(ROLLING_WINDOW_DAYS, day_of_month)
    rolling_avg_daily_kwh_7d = float(sum(daily_kwh_observed[-window:])) / window

    remaining_dates = [
        cycle_start_date + timedelta(days=day_of_month + k) for k in range(days_remaining)
    ]
    weekend_days_remaining = sum(1 for d in remaining_dates if _is_weekend(d))

    # Weekend fraction of the trailing window, clamped to the SAME days the
    # rolling average covers -- otherwise it would describe calendar days from
    # before the cycle began, which the baseline never saw.
    trailing_dates = [observation_date - timedelta(days=k) for k in range(window)]
    weekend_frac_last7 = sum(1 for d in trailing_dates if _is_weekend(d)) / window

    weekend_frac_remaining = (
        weekend_days_remaining / days_remaining if days_remaining > 0 else 0.0
    )

    naive_prediction = naive_baseline(
        cumulative_kwh_so_far, rolling_avg_daily_kwh_7d, days_remaining
    )

    return {
        "observation_date": observation_date,
        "naive_prediction": naive_prediction,
        "cumulative_kwh_so_far": cumulative_kwh_so_far,
        "rolling_avg_daily_kwh_7d": rolling_avg_daily_kwh_7d,
        "avg_daily_kwh_so_far": avg_daily_kwh_so_far,
        "day_of_month": day_of_month,
        "days_remaining": days_remaining,
        "day_of_week": observation_date.weekday(),
        "is_weekend": 1 if _is_weekend(observation_date) else 0,
        "month": observation_date.month,
        "weekend_days_remaining": weekend_days_remaining,
        # The 7-day average running hot relative to the cycle-to-date level
        # implies reversion downward, i.e. the baseline over-projects.
        "reversion_gap": rolling_avg_daily_kwh_7d - avg_daily_kwh_so_far,
        # The baseline projects the trailing week's weekday/weekend mix onto the
        # remaining days. Where the mixes differ, it is wrong by the
        # weekday-vs-weekend consumption delta.
        "weekend_mismatch": weekend_frac_remaining - weekend_frac_last7,
        "weekend_frac_remaining": weekend_frac_remaining,
    }


def apply_prediction(naive_prediction: float, predicted_rate_error: float,
                     days_remaining: int, alpha: float) -> float:
    """
    Turns a predicted per-day rate error into a month-end kWh forecast.

    Defined here so training, evaluation and serving apply the identical recipe.
    Clamped at 0: a negative total kWh is physically impossible.
    """
    corrected = naive_prediction + alpha * predicted_rate_error * days_remaining
    return max(0.0, float(corrected))
