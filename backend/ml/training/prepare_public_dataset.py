"""
Prepares the UCI Individual Household Electric Power Consumption dataset
for training. Transforms 2M+ minute-level rows into daily kWh totals,
then slices the daily series into simulated 30-day billing cycles,
engineering one training row per cycle-day (days 15-30 of each cycle).

Run from backend/:
    python -m ml.training.prepare_public_dataset

Input:  ml/data/household_power_consumption.txt
Output: ml/data/training_rows.csv
"""

import os
import pandas as pd
import numpy as np

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
RAW_FILE = os.path.join(DATA_DIR, "household_power_consumption.txt")
OUTPUT_FILE = os.path.join(DATA_DIR, "training_rows.csv")

CYCLE_LENGTH_DAYS = 30
# Egypt's weekend is Friday/Saturday, not Saturday/Sunday — this is the
# one deliberate localization applied on top of the (non-Egyptian) source
# data, since weekend usage patterns are genuinely behaviorally relevant.
EGYPT_WEEKEND_DAYS = {4, 5}  # Monday=0 ... Friday=4, Saturday=5, Sunday=6


def load_and_clean_raw_data() -> pd.DataFrame:
    """
    Loads the raw UCI file, parses timestamps, and drops missing rows.
    The UCI documentation states ~1.25% of rows have missing values
    (marked as '?') — dropping them is the documented, expected approach,
    not a bug being papered over.
    """
    print("[*] Loading raw dataset (this can take a minute — ~2M rows)...")

    df = pd.read_csv(
        RAW_FILE,
        sep=";",
        na_values=["?"],
        low_memory=False,
    )

    df["timestamp"] = pd.to_datetime(
        df["Date"] + " " + df["Time"], format="%d/%m/%Y %H:%M:%S"
    )

    before = len(df)
    df = df.dropna(subset=["Global_active_power"])
    after = len(df)
    print(f"[*] Dropped {before - after} rows with missing data ({(before-after)/before*100:.2f}%)")

    df["Global_active_power"] = df["Global_active_power"].astype(float)
    return df[["timestamp", "Global_active_power"]]


def aggregate_to_daily_kwh(df: pd.DataFrame) -> pd.DataFrame:
    """
    Converts minute-level kW readings into daily kWh totals.
    Each row is Global_active_power in kW, averaged over that minute,
    so summing (kW / 60) across all minutes in a day gives kWh for that day.
    """
    print("[*] Aggregating minute-level readings into daily kWh totals...")

    df = df.set_index("timestamp")
    daily_kwh = (df["Global_active_power"] / 60.0).resample("D").sum()
    daily_kwh = daily_kwh[daily_kwh > 0]  # drop any fully-empty days

    daily_df = daily_kwh.reset_index()
    daily_df.columns = ["date", "daily_kwh"]
    print(f"[*] Resulting daily series: {len(daily_df)} days")
    return daily_df


def build_training_rows(daily_df: pd.DataFrame, stride_days: int = 5) -> pd.DataFrame:
    """
    Slices the continuous daily series into OVERLAPPING 30-day billing
    cycles (sliding window, stepping forward by stride_days each time)
    rather than disjoint blocks. This multiplies the number of usable
    training cycles from the same underlying data — a standard technique
    for time series with limited total duration but enough continuous
    coverage to resample more densely.

    Each window is still a fully independent, genuine 30-day cycle with
    its own real target_total_kwh — overlap between windows does not
    invalidate them, since walk-forward validation (by date order, not
    row order) is what actually prevents lookahead bias, not disjointness.
    """
    print(f"[*] Building 30-day cycle feature rows (sliding window, stride={stride_days} days)...")

    daily_df = daily_df.sort_values("date").reset_index(drop=True)
    n_days = len(daily_df)

    rows = []
    cycle_idx = 0
    start = 0

    while start + CYCLE_LENGTH_DAYS <= n_days:
        cycle = daily_df.iloc[start : start + CYCLE_LENGTH_DAYS].reset_index(drop=True)
        target_total_kwh = cycle["daily_kwh"].sum()

        for day_of_month in range(15, CYCLE_LENGTH_DAYS + 1):
            day_idx = day_of_month - 1

            cumulative_kwh_so_far = cycle["daily_kwh"].iloc[: day_idx + 1].sum()
            days_remaining = CYCLE_LENGTH_DAYS - day_of_month

            current_date = cycle["date"].iloc[day_idx]
            day_of_week = current_date.dayofweek
            is_weekend = 1 if day_of_week in EGYPT_WEEKEND_DAYS else 0

            window_start = max(0, day_idx - 6)
            rolling_avg_daily_kwh_7d = cycle["daily_kwh"].iloc[window_start : day_idx + 1].mean()

            rows.append({
                "cycle_idx": cycle_idx,
                "cycle_start_date": cycle["date"].iloc[0],
                "cumulative_kwh_so_far": round(cumulative_kwh_so_far, 4),
                "day_of_month": day_of_month,
                "days_remaining": days_remaining,
                "day_of_week": day_of_week,
                "is_weekend": is_weekend,
                "rolling_avg_daily_kwh_7d": round(rolling_avg_daily_kwh_7d, 4),
                "target_total_kwh": round(target_total_kwh, 4),
            })

        cycle_idx += 1
        start += stride_days

    result = pd.DataFrame(rows)
    print(f"[*] Generated {len(result)} training rows across {cycle_idx} overlapping 30-day cycles")
    return result

def main():
    if not os.path.exists(RAW_FILE):
        raise FileNotFoundError(
            f"Could not find {RAW_FILE}. "
            "Place household_power_consumption.txt in backend/ml/data/ first."
        )

    raw = load_and_clean_raw_data()
    daily = aggregate_to_daily_kwh(raw)
    training_rows = build_training_rows(daily)

    training_rows.to_csv(OUTPUT_FILE, index=False)
    print(f"[✓] Saved {len(training_rows)} training rows to {OUTPUT_FILE}")
    print("\nSample rows:")
    print(training_rows.head(3).to_string(index=False))


if __name__ == "__main__":
    main()