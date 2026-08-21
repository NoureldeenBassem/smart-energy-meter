"""
Trains a LightGBM regressor to predict total 30-day billing-cycle kWh,
validated with walk-forward (chronological) cross-validation rather than
random train_test_split — random splitting would let the model train on
future cycles to predict past ones, which is lookahead bias and would
make the validation numbers meaningless.

Also computes the naive baseline (linear extrapolation) for comparison,
and enforces the acceptance gate: LightGBM must beat the naive baseline
by at least 10% lower MAE, or this script refuses to save the model.

Run from backend/:
    python -m ml.training.train_model

Input:  ml/data/training_rows.csv
Output: ml/models/lightgbm_model.pkl
"""

import os
import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMRegressor
from sklearn.metrics import mean_absolute_error

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "models")
TRAINING_ROWS_FILE = os.path.join(DATA_DIR, "training_rows.csv")
MODEL_OUTPUT_FILE = os.path.join(MODELS_DIR, "lightgbm_model.pkl")

FEATURE_COLUMNS = [
    "cumulative_kwh_so_far",
    "day_of_month",
    "days_remaining",
    "day_of_week",
    "is_weekend",
    "rolling_avg_daily_kwh_7d",
]
TARGET_COLUMN = "target_total_kwh"

MIN_MAE_IMPROVEMENT_PCT = 10.0  # acceptance gate from the original spec

# Single source of truth for model hyperparameters — used identically in
# both walk_forward_validate() and train_final_model() so the model being
# validated is guaranteed to be the exact same model being deployed.
MODEL_PARAMS = dict(
    num_leaves=7,
    n_estimators=80,
    learning_rate=0.05,
    min_child_samples=15,
    reg_alpha=0.5,
    reg_lambda=0.5,
    verbose=-1,
)


def naive_baseline_predict(row: pd.Series) -> float:
    """
    The naive formula being beaten: cumulative so far + (7-day rolling
    average * days remaining). This assumes usage continues at exactly
    the recent daily rate for the rest of the cycle — no weekday/weekend
    or trend awareness at all.
    """
    return row["cumulative_kwh_so_far"] + (row["rolling_avg_daily_kwh_7d"] * row["days_remaining"])


def walk_forward_validate(df: pd.DataFrame) -> dict:
    """
    Chronological validation: fold k trains on cycles [0..k) and
    evaluates on cycle k. Every test cycle is strictly in the future
    relative to its training data — this is what prevents lookahead bias.
    """
    print("[*] Running walk-forward validation...")

    cycle_ids = sorted(df["cycle_idx"].unique())
    min_train_cycles = 15  # need enough training data before the first fold

    lgbm_errors = []
    naive_errors = []

    for fold_boundary in range(min_train_cycles, len(cycle_ids)):
        train_cycles = cycle_ids[:fold_boundary]
        test_cycle = cycle_ids[fold_boundary]

        train_df = df[df["cycle_idx"].isin(train_cycles)]
        test_df = df[df["cycle_idx"] == test_cycle]

        if len(test_df) == 0 or len(train_df) == 0:
            continue

        X_train, y_train = train_df[FEATURE_COLUMNS], train_df[TARGET_COLUMN]
        X_test, y_test = test_df[FEATURE_COLUMNS], test_df[TARGET_COLUMN]

        model = LGBMRegressor(**MODEL_PARAMS)
        model.fit(X_train, y_train)
        lgbm_preds = model.predict(X_test)

        naive_preds = test_df.apply(naive_baseline_predict, axis=1)

        lgbm_errors.append(mean_absolute_error(y_test, lgbm_preds))
        naive_errors.append(mean_absolute_error(y_test, naive_preds))

    avg_lgbm_mae = float(np.mean(lgbm_errors))
    avg_naive_mae = float(np.mean(naive_errors))
    improvement_pct = (avg_naive_mae - avg_lgbm_mae) / avg_naive_mae * 100

    print(f"[*] Folds evaluated: {len(lgbm_errors)}")
    print(f"[*] Naive baseline MAE:  {avg_naive_mae:.2f} kWh")
    print(f"[*] LightGBM MAE:        {avg_lgbm_mae:.2f} kWh")
    print(f"[*] Improvement:         {improvement_pct:.1f}%")

    return {
        "lgbm_mae": avg_lgbm_mae,
        "naive_mae": avg_naive_mae,
        "improvement_pct": improvement_pct,
    }


def train_final_model(df: pd.DataFrame) -> tuple:
    """
    Fits the final model on ALL available cycles (no holdout — the
    walk-forward validation above already proved the approach works;
    this final fit is meant to be deployed, so it should use every
    scrap of data available). Uses the exact same MODEL_PARAMS as
    validation — no drift between what was tested and what gets shipped.
    """
    print("[*] Fitting final model on all available data...")

    X = df[FEATURE_COLUMNS]
    y = df[TARGET_COLUMN]

    model = LGBMRegressor(**MODEL_PARAMS)
    model.fit(X, y)

    residuals = y - model.predict(X)
    residual_std = float(np.std(residuals))

    print(f"[*] Final model residual std-dev: {residual_std:.2f} kWh")
    return model, residual_std


def main():
    if not os.path.exists(TRAINING_ROWS_FILE):
        raise FileNotFoundError(
            f"Could not find {TRAINING_ROWS_FILE}. "
            "Run 'python -m ml.training.prepare_public_dataset' first."
        )

    df = pd.read_csv(TRAINING_ROWS_FILE)
    print(f"[*] Loaded {len(df)} training rows across {df['cycle_idx'].nunique()} cycles")

    validation_results = walk_forward_validate(df)

    if validation_results["improvement_pct"] < MIN_MAE_IMPROVEMENT_PCT:
        print(
            f"\n[!] ACCEPTANCE GATE FAILED: LightGBM only improved MAE by "
            f"{validation_results['improvement_pct']:.1f}%, below the required "
            f"{MIN_MAE_IMPROVEMENT_PCT}% threshold. Model NOT saved."
        )
        return

    print(f"\n[✓] Acceptance gate passed ({validation_results['improvement_pct']:.1f}% >= {MIN_MAE_IMPROVEMENT_PCT}%)")

    model, residual_std = train_final_model(df)

    os.makedirs(MODELS_DIR, exist_ok=True)
    joblib.dump(
        {
            "model": model,
            "residual_std": residual_std,
            "feature_columns": FEATURE_COLUMNS,
            "validation_metrics": validation_results,
        },
        MODEL_OUTPUT_FILE,
    )
    print(f"[✓] Saved model artifact to {MODEL_OUTPUT_FILE}")


if __name__ == "__main__":
    main()