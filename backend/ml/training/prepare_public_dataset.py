"""
Prepares the UCI Individual Household Electric Power Consumption dataset for
month-end bill forecasting.

Pipeline:
    minute-level readings -> daily kWh totals -> 30-day billing cycles
    -> one feature row per cycle-day (from --first-day to day 30 of each cycle)

Run from backend/:
    python -m ml.training.prepare_public_dataset                    # stride 5 (sliding)
    python -m ml.training.prepare_public_dataset --stride 30        # disjoint cycles
    python -m ml.training.prepare_public_dataset --stride 30 --out ml/data/rows_disjoint.csv
    python -m ml.training.prepare_public_dataset --first-day 3      # full operating range

Input:  ml/data/household_power_consumption.txt
Output: ml/data/training_rows.csv  (or --out)

-----------------------------------------------------------------------------
TWO CORRECTNESS PROPERTIES THIS SCRIPT GUARANTEES
-----------------------------------------------------------------------------

1. Cycles are CALENDAR-CONTIGUOUS and built only from COMPLETE days.

   The raw dataset has genuine gaps: 9 days with no readings at all and 27
   days with partial coverage (out of 1442 calendar days). An earlier version
   of this script dropped incomplete days and then sliced windows by ROW
   POSITION, which silently produced "30-day cycles" that actually spanned
   more than 30 calendar days whenever they straddled a gap — corrupting both
   `days_remaining` and the target total.

   Fix: find maximal runs of consecutive complete calendar days first, then
   slice 30-day windows strictly inside a single run. A cycle therefore always
   covers exactly 30 real, consecutive, fully-observed days.

2. Every row carries the dates needed to PURGE leakage at validation time.

   `cycle_start_date` and `cycle_end_date` let train_model.py restrict each
   fold's training set to cycles that ended before the test cycle began. With
   overlapping windows (stride < 30) this is what makes validation honest:
   without it, a test cycle shares up to 25 days with cycles used for
   training, including days that determine its own target.

   NOTE: overlap *within* the training set is fine — it is resampling of the
   same history. Only train->test overlap is leakage, and purging removes it.

-----------------------------------------------------------------------------
FEATURES
-----------------------------------------------------------------------------
Feature construction lives in ml/features.py, NOT here. That module is imported
by this script and by app/services/forecasting/predict.py, so training rows and
live prediction rows are built by literally the same function — the only way to
be sure the reported accuracy describes what the API actually serves.

Requested and implemented:
    cumulative_kwh_so_far, day_of_month, days_remaining,
    rolling_avg_daily_kwh_7d, is_weekend

Additionally engineered (all computable at prediction time from the calendar
and past consumption only — no future information). See ml/features.py for the
per-feature rationale.

Deliberately NOT included: hour_of_day. The target is a 30-day daily-total
kWh figure, so a single hour-of-day value is not defined for a training row.
Including a fabricated one would be noise dressed up as a feature.
"""

import os
import argparse
import pandas as pd

from ml.features import CYCLE_LENGTH_DAYS, build_features

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
RAW_FILE = os.path.join(DATA_DIR, "household_power_consumption.txt")
DEFAULT_OUTPUT = os.path.join(DATA_DIR, "training_rows.csv")

FIRST_FORECAST_DAY = 3           # default: the product's real operating range
MIN_MINUTES_FOR_COMPLETE_DAY = 1400   # of 1440; tolerates a few dropped minutes


def load_and_clean_raw_data() -> pd.DataFrame:
    """Loads the raw UCI file, parses timestamps, drops rows with missing power."""
    print("[*] Loading raw dataset (~2M rows, takes a moment)...")

    df = pd.read_csv(
        RAW_FILE,
        sep=";",
        na_values=["?"],
        low_memory=False,
        usecols=["Date", "Time", "Global_active_power"],
    )

    df["timestamp"] = pd.to_datetime(
        df["Date"] + " " + df["Time"], format="%d/%m/%Y %H:%M:%S"
    )

    before = len(df)
    df = df.dropna(subset=["Global_active_power"])
    dropped = before - len(df)
    print(f"[*] Dropped {dropped} rows with missing readings ({dropped / before * 100:.2f}%)")

    df["Global_active_power"] = df["Global_active_power"].astype(float)
    return df[["timestamp", "Global_active_power"]]


def aggregate_to_daily_kwh(df: pd.DataFrame) -> pd.DataFrame:
    """
    Converts minute-level kW readings into daily kWh totals.

    Each reading is average active power in kW over one minute, so summing
    (kW / 60) over a day's minutes yields that day's kWh. Also counts how many
    minutes each day actually has, so partially-observed days can be excluded
    rather than silently under-reporting energy.
    """
    print("[*] Aggregating minute readings into daily kWh totals...")

    daily = df.set_index("timestamp")["Global_active_power"].resample("D").agg(
        daily_kwh=lambda x: x.sum() / 60.0,
        minutes_observed="count",
    )
    daily = daily.reset_index().rename(columns={"timestamp": "date"})

    complete = daily["minutes_observed"] >= MIN_MINUTES_FOR_COMPLETE_DAY
    print(f"[*] {len(daily)} calendar days; {int(complete.sum())} complete, "
          f"{int((~complete).sum())} incomplete/empty (excluded)")

    daily["is_complete"] = complete
    return daily


def find_contiguous_complete_runs(daily: pd.DataFrame) -> list:
    """
    Returns a list of DataFrames, each a maximal run of consecutive calendar
    days that are all complete. Windows are only ever sliced inside one run,
    so no cycle can straddle a data gap.
    """
    daily = daily.sort_values("date").reset_index(drop=True)

    runs = []
    current = []
    prev_date = None

    for row in daily.itertuples(index=False):
        if not row.is_complete:
            if current:
                runs.append(current)
                current = []
            prev_date = None
            continue

        # A gap in the calendar also breaks the run, even between complete days.
        if prev_date is not None and (row.date - prev_date).days != 1:
            if current:
                runs.append(current)
                current = []

        current.append({"date": row.date, "daily_kwh": row.daily_kwh})
        prev_date = row.date

    if current:
        runs.append(current)

    run_frames = [pd.DataFrame(r) for r in runs if len(r) >= CYCLE_LENGTH_DAYS]
    lengths = sorted((len(r) for r in run_frames), reverse=True)
    print(f"[*] Found {len(run_frames)} contiguous complete runs of >= {CYCLE_LENGTH_DAYS} days "
          f"(longest: {lengths[:5]})")
    return run_frames


def build_training_rows(run_frames: list, stride_days: int,
                        first_forecast_day: int = FIRST_FORECAST_DAY) -> pd.DataFrame:
    """
    Slices each contiguous run into 30-day cycles (stepping by stride_days) and
    emits one feature row per cycle-day from first_forecast_day to day 30.

    stride_days=30 -> fully disjoint cycles.
    stride_days<30 -> overlapping cycles; train_model.py purges by date so the
                      overlap never crosses the train/test boundary.

    first_forecast_day controls how early in a cycle a forecast is attempted.
    Day 1 is degenerate (the "7-day average" is a single day), so 3 is the
    earliest sensible value. The product shows a projected bill as soon as a few
    days of data exist, so the full range is the honest operating range; day 15+
    is the harder subset where the baseline is already strong.
    """
    print(f"[*] Building {CYCLE_LENGTH_DAYS}-day cycles (stride={stride_days} days, "
          f"forecasting from day {first_forecast_day})...")

    rows = []
    cycle_idx = 0

    for run in run_frames:
        run = run.reset_index(drop=True)
        start = 0

        while start + CYCLE_LENGTH_DAYS <= len(run):
            cycle = run.iloc[start:start + CYCLE_LENGTH_DAYS].reset_index(drop=True)

            target_total_kwh = cycle["daily_kwh"].sum()
            cycle_start_date = cycle["date"].iloc[0]
            cycle_end_date = cycle["date"].iloc[-1]

            # Sanity: the window must span exactly 30 consecutive calendar days.
            span = (cycle_end_date - cycle_start_date).days + 1
            assert span == CYCLE_LENGTH_DAYS, f"cycle spans {span} days, expected {CYCLE_LENGTH_DAYS}"

            for day_of_month in range(first_forecast_day, CYCLE_LENGTH_DAYS + 1):
                # Features come from ml/features.py -- the SAME function the live
                # prediction path calls. This is what rules out train/serve skew.
                observed = cycle["daily_kwh"].iloc[:day_of_month].tolist()
                feats = build_features(
                    cycle_start_date=cycle_start_date.date(),
                    daily_kwh_observed=observed,
                    cycle_length_days=CYCLE_LENGTH_DAYS,
                )

                row = {
                    "cycle_idx": cycle_idx,
                    "cycle_start_date": cycle_start_date,
                    "cycle_end_date": cycle_end_date,
                }
                row.update(feats)
                row["target_total_kwh"] = round(target_total_kwh, 4)

                # The label the model is fitted on: the baseline's per-day rate
                # error. Undefined on the final day (nothing remains to forecast),
                # where the baseline is exact by construction.
                dr = feats["days_remaining"]
                row["rate_error"] = (
                    (target_total_kwh - feats["naive_prediction"]) / dr if dr > 0 else 0.0
                )

                rows.append(row)

            cycle_idx += 1
            start += stride_days

    result = pd.DataFrame(rows)
    print(f"[*] Generated {len(result)} rows across {cycle_idx} cycles")
    if cycle_idx:
        print(f"[*] Target kWh — mean {result['target_total_kwh'].mean():.1f}, "
              f"min {result['target_total_kwh'].min():.1f}, "
              f"max {result['target_total_kwh'].max():.1f}")
    return result


def main():
    parser = argparse.ArgumentParser(description="Prepare UCI dataset for bill forecasting")
    parser.add_argument("--stride", type=int, default=5,
                        help="days to step between cycle windows (30 = fully disjoint)")
    parser.add_argument("--out", type=str, default=DEFAULT_OUTPUT,
                        help="output CSV path")
    parser.add_argument("--first-day", type=int, default=FIRST_FORECAST_DAY,
                        help="earliest cycle-day to forecast from (min 3; day 1-2 are degenerate)")
    args = parser.parse_args()

    if args.first_day < 3:
        raise ValueError("--first-day must be >= 3; a 7-day average over 1-2 days is degenerate.")

    if not os.path.exists(RAW_FILE):
        raise FileNotFoundError(
            f"Could not find {RAW_FILE}.\n"
            "Download 'Individual Household Electric Power Consumption' from the UCI ML "
            "Repository and place household_power_consumption.txt in backend/ml/data/."
        )

    raw = load_and_clean_raw_data()
    daily = aggregate_to_daily_kwh(raw)
    runs = find_contiguous_complete_runs(daily)
    if not runs:
        raise RuntimeError("No contiguous complete 30-day runs found — cannot build cycles.")

    rows = build_training_rows(runs, stride_days=args.stride,
                               first_forecast_day=args.first_day)
    if rows.empty:
        raise RuntimeError("No training rows generated.")

    rows.to_csv(args.out, index=False)
    print(f"[OK] Saved {len(rows)} rows to {args.out}")


if __name__ == "__main__":
    main()
