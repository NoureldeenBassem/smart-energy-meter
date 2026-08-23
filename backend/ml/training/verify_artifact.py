"""
End-to-end check that the SAVED artifact produces real predictions through the
shared feature builder.

Run from backend/:
    python -m ml.training.verify_artifact

This is deliberately not a unit test with hand-made inputs. It replays real days
from the UCI file through ml.features.build_features -- the exact function the API
calls at request time -- and compares the forecast against the cycle's true
total. If the artifact, the feature contract and the prediction recipe disagree
in any way, this fails loudly here rather than silently serving bad numbers.

It reports on the LAST complete 30-day run in the file (chronologically the most
"future" data), forecasting from several points in the cycle.
"""

import os

import joblib
import numpy as np
import pandas as pd

from ml.features import (
    CYCLE_LENGTH_DAYS, FEATURE_COLUMNS, build_features, apply_prediction,
)
from ml.training.prepare_public_dataset import (
    load_and_clean_raw_data, aggregate_to_daily_kwh, find_contiguous_complete_runs,
)

MODEL_FILE = os.path.join(os.path.dirname(__file__), "..", "models", "lightgbm_model.pkl")


def main():
    if not os.path.exists(MODEL_FILE):
        raise FileNotFoundError(
            f"No model artifact at {MODEL_FILE}. Run:\n"
            "    python -m ml.training.train_model"
        )

    art = joblib.load(MODEL_FILE)
    model, alpha = art["model"], art["alpha"]

    # Fail loudly on any drift between the artifact and the live feature contract.
    if art["feature_columns"] != FEATURE_COLUMNS:
        raise RuntimeError(
            "Feature contract mismatch between the artifact and ml/features.py.\n"
            f"  artifact: {art['feature_columns']}\n"
            f"  current : {FEATURE_COLUMNS}\n"
            "Retrain before serving predictions."
        )

    print(f"[*] Artifact: alpha={alpha}, trained on {art['trained_on_rows']} rows / "
          f"{art['trained_on_cycles']} cycles from {art['trained_on_file']}")
    print(f"[*] Recipe:   {art['prediction_recipe']}")
    print()

    daily = aggregate_to_daily_kwh(load_and_clean_raw_data())
    runs = find_contiguous_complete_runs(daily)

    # Chronologically last cycle available: the most out-of-sample data there is.
    last_run = max(runs, key=lambda r: r["date"].max())
    cycle = last_run.tail(CYCLE_LENGTH_DAYS).reset_index(drop=True)

    cycle_start = cycle["date"].iloc[0].date()
    actual_total = float(cycle["daily_kwh"].sum())
    print(f"[*] Cycle {cycle_start} -> {cycle['date'].iloc[-1].date()}   "
          f"ACTUAL total {actual_total:.1f} kWh")
    print()

    quantiles = art["abs_error_quantiles_by_range"]
    rows = []
    for day in (3, 7, 12, 15, 20, 25, 29, 30):
        observed = cycle["daily_kwh"].iloc[:day].tolist()
        feats = build_features(cycle_start, observed, CYCLE_LENGTH_DAYS)

        X = pd.DataFrame([{c: feats[c] for c in FEATURE_COLUMNS}])
        rate = float(model.predict(X)[0])
        pred = apply_prediction(feats["naive_prediction"], rate, feats["days_remaining"], alpha)

        band = quantiles["day_3_14"]["p80"] if day < 15 else quantiles["day_15_30"]["p80"]
        naive = feats["naive_prediction"]
        rows.append({
            "day": day,
            "naive_kwh": round(naive, 1),
            "model_kwh": round(pred, 1),
            "actual_kwh": round(actual_total, 1),
            "naive_err": round(abs(naive - actual_total), 1),
            "model_err": round(abs(pred - actual_total), 1),
            "band_low": round(max(0.0, pred - band), 1),
            "band_high": round(pred + band, 1),
            "in_band": abs(pred - actual_total) <= band,
        })

    out = pd.DataFrame(rows)
    out["model_better"] = out["model_err"] < out["naive_err"]
    print("[*] Real predictions on this cycle (band = held-out p80 abs error):")
    print(out.to_string(index=False))
    print()

    n_better = int(out["model_better"].sum())
    print(f"[*] Model closer than baseline on {n_better}/{len(out)} of these forecast points.")
    print(f"[*] Mean abs error — naive {out['naive_err'].mean():.1f} kWh, "
          f"model {out['model_err'].mean():.1f} kWh")
    print()
    print("    NOTE: one cycle is an illustration, not a measurement. The honest")
    print("    accuracy figures are the pooled purged walk-forward numbers from")
    print("    train_model.py, over 210 folds / 5880 out-of-sample predictions.")


if __name__ == "__main__":
    main()
