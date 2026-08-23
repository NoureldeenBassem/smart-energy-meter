"""
Trains and honestly evaluates a month-end kWh forecaster, benchmarked against a
naive baseline.

Run from backend/:
    python -m ml.training.train_model
    python -m ml.training.train_model --data ml/data/rows_disjoint.csv
    python -m ml.training.train_model --no-gate      # report metrics, never save

Input:  ml/data/training_rows.csv   (from ml.training.prepare_public_dataset)
Output: ml/models/lightgbm_model.pkl  (only if the acceptance gate passes)

=============================================================================
1. THE BASELINE
=============================================================================
    naive = cumulative_kwh_so_far + rolling_avg_daily_kwh_7d * days_remaining

Assumes each remaining day repeats the recent 7-day average. It is a genuinely
strong baseline: it adapts instantly to the current cycle's level, needs no
training, and is EXACT on the last day of a cycle. It is not a straw man.

=============================================================================
2. WHAT THE MODEL PREDICTS, AND WHY NOT THE TOTAL
=============================================================================
Predicting `target_total_kwh` directly with gradient-boosted trees performs
badly here, for two structural reasons:

  a) The naive formula is a PRODUCT of two continuous features. Axis-aligned
     tree splits approximate multiplication poorly.
  b) Trees cannot extrapolate. A leaf predicts the mean of its training targets,
     so a cycle exceeding anything seen in training is capped at the training
     range. Household usage is seasonal, so that happens routinely.

Measured: direct-target LightGBM scored MAE 44.86 against the baseline's 26.83
— 67% WORSE.

Learning the raw residual (target - naive) is better but still wrong, because
the residual is NON-STATIONARY:

    residual = days_remaining * (actual_avg_remaining - rolling_avg_7d)

Its magnitude grows with days_remaining (measured 15.9 kWh at 1 day out, 55.4 at
15). Measured: -6.8% vs baseline, and it destroyed the baseline's exactness on
the final day (MAE 10.43 where naive scored 0.00).

So the model predicts the baseline's PER-DAY RATE ERROR, a stationary target:

    rate_error = (target - naive) / days_remaining
    final      = naive + alpha * days_remaining * model.predict(features)

Multiplying by days_remaining makes the correction provably vanish on the last
day, preserving the baseline's exactness there. Rows with days_remaining == 0
define no rate error, so they are excluded from FITTING but kept in TESTING —
the model is never let off the hook for the days it cannot help with.

This is boosting from an offset, not a trick: if the residual held no learnable
structure the model would predict ~0 and the result would collapse back to the
baseline rather than beat it artificially.

=============================================================================
3. WHY PURGED WALK-FORWARD VALIDATION
=============================================================================
Cycles are sliced with a sliding window, so neighbouring cycles share days.
Plain "train on cycles [0..k), test on cycle k" therefore leaks: the training
set contains cycles overlapping test cycle k, including days that determine
k's own target.

Purging fixes it: a fold may train only on cycles whose cycle_end_date falls
strictly BEFORE the test cycle's cycle_start_date. Combined with testing in
chronological order, this guarantees:

  * no training row shares a single calendar day with the test cycle
  * every training row is entirely in the test cycle's past

Random shuffling is never used anywhere in this file.

=============================================================================
4. HOW alpha IS CHOSEN WITHOUT SEEING ITS OWN TEST FOLD
=============================================================================
alpha damps the correction. Fitting it on the test rows would be tuning on the
test set, so instead: for test cycle i, alpha minimises MAE over the pooled
OUT-OF-SAMPLE predictions of every fold j with

    cycle_end_date[j] < cycle_start_date[i]

Every row used to choose alpha therefore lies wholly in cycle i's past and was
itself produced out-of-sample. Folds with no prior evidence get alpha = 0 — the
plain baseline — rather than an unvalidated correction.

(A nested inner walk-forward would give identical answers for ~100x the compute:
under this purging rule the "inner model whose test cycle is j" IS the outer
model of fold j, since both train on every cycle ending before j starts.)

The alpha SHIPPED in the artifact is the same rule applied at the end of
history, which is exactly what it would select for the next unseen cycle.

=============================================================================
5. WHAT IS REPORTED
=============================================================================
Metrics are pooled across folds — every test-cycle prediction is collected and
MAE/MAPE computed once over all of them.

Three ranges are always printed, never just the flattering one:
  * day 3-30   the product's real operating range (a user who installs the
               meter mid-cycle still needs a projected bill)
  * day 15-30  the HARDER subset, where the baseline is already strong
  * day 3-14   early cycle, where the baseline is weakest
Plus a per-day breakdown, so days where the model LOSES stay visible.
"""

import os
import argparse
import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMRegressor

from ml.features import (
    FEATURE_COLUMNS, TARGET_COLUMN, NAIVE_COLUMN, RATE_ERROR_COLUMN,
)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "models")
DEFAULT_DATA = os.path.join(DATA_DIR, "training_rows.csv")
MODEL_OUTPUT_FILE = os.path.join(MODELS_DIR, "lightgbm_model.pkl")

MIN_MAE_IMPROVEMENT_PCT = 10.0   # acceptance gate: do not lower to force a pass

MIN_TRAIN_CYCLES = 8
ALPHA_GRID = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0]

# Conservative hyperparameters — the rate-error signal is modest and the dataset
# has few independent cycles, so capacity is kept low to avoid fitting noise.
# Identical in validation and in the final fit, so what is measured is what ships.
MODEL_PARAMS = dict(
    objective="regression_l1",   # MAE-aligned; robust to rate-error outliers
    num_leaves=7,
    n_estimators=150,
    learning_rate=0.05,
    min_child_samples=20,
    subsample=0.9,
    subsample_freq=1,
    colsample_bytree=0.8,
    reg_alpha=0.5,
    reg_lambda=0.5,
    verbose=-1,
)


def mae(y_true, y_pred) -> float:
    return float(np.mean(np.abs(np.asarray(y_true, float) - np.asarray(y_pred, float))))


def mape(y_true, y_pred) -> float:
    """Mean absolute percentage error. Targets are 30-day kWh totals, always
    comfortably positive here, so no guard is needed beyond the nonzero mask."""
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    nonzero = y_true != 0
    return float(np.mean(np.abs((y_true[nonzero] - y_pred[nonzero]) / y_true[nonzero])) * 100)


def fit_rate_model(train_df: pd.DataFrame) -> LGBMRegressor:
    """
    Fits the rate-error model. Rows with days_remaining == 0 are dropped: they
    define no per-day rate error (division by zero), and the baseline is already
    exact there. They remain in every TEST set.
    """
    fit_df = train_df[train_df["days_remaining"] > 0]
    model = LGBMRegressor(**MODEL_PARAMS)
    model.fit(fit_df[FEATURE_COLUMNS], fit_df[RATE_ERROR_COLUMN])
    return model


def walk_forward(df: pd.DataFrame, verbose: bool = True) -> pd.DataFrame:
    """
    Purged chronological walk-forward. Returns one row per out-of-sample
    prediction, carrying everything needed to score any alpha afterwards.
    """
    if verbose:
        print("[*] Purged walk-forward validation (train strictly before test, no shared days)")

    df = df.copy()
    df["cycle_start_date"] = pd.to_datetime(df["cycle_start_date"])
    df["cycle_end_date"] = pd.to_datetime(df["cycle_end_date"])

    cycles = (
        df[["cycle_idx", "cycle_start_date", "cycle_end_date"]]
        .drop_duplicates("cycle_idx")
        .sort_values("cycle_start_date")
        .reset_index(drop=True)
    )

    out, skipped = [], 0
    for i in range(len(cycles)):
        test_idx = cycles.loc[i, "cycle_idx"]
        test_start = cycles.loc[i, "cycle_start_date"]
        test_end = cycles.loc[i, "cycle_end_date"]

        eligible = cycles[cycles["cycle_end_date"] < test_start]["cycle_idx"]
        if len(eligible) < MIN_TRAIN_CYCLES:
            skipped += 1
            continue

        train_df = df[df["cycle_idx"].isin(eligible)]
        test_df = df[df["cycle_idx"] == test_idx]
        if train_df.empty or test_df.empty:
            skipped += 1
            continue

        model = fit_rate_model(train_df)
        out.append(pd.DataFrame({
            "cycle": test_idx,
            "cycle_start_date": test_start,
            "cycle_end_date": test_end,
            "y": test_df[TARGET_COLUMN].to_numpy(),
            "naive": test_df[NAIVE_COLUMN].to_numpy(),
            "predicted_rate": model.predict(test_df[FEATURE_COLUMNS]),
            "days_remaining": test_df["days_remaining"].to_numpy(),
            "day_of_month": test_df["day_of_month"].to_numpy(),
        }))

    if not out:
        raise RuntimeError(
            f"No validation folds could run — fewer than {MIN_TRAIN_CYCLES} cycles end "
            "before a later cycle starts. Use a larger --stride or more data."
        )

    R = pd.concat(out, ignore_index=True)
    if verbose:
        print(f"[*] Folds evaluated: {R['cycle'].nunique()} "
              f"(skipped {skipped} for insufficient purged history)")
        print(f"[*] Out-of-sample predictions pooled: {len(R)}")
        print()
    return R


def select_alpha_from_prior_folds(R: pd.DataFrame) -> pd.Series:
    """
    Per test cycle, the alpha minimising MAE over folds that ENDED before this
    cycle STARTED. No fold ever contributes to choosing its own alpha.
    Cycles with no prior evidence get 0.0 — the plain baseline.
    """
    meta = (R[["cycle", "cycle_start_date", "cycle_end_date"]]
            .drop_duplicates("cycle")
            .sort_values("cycle_start_date")
            .reset_index(drop=True))

    chosen = {}
    for _, row in meta.iterrows():
        prior_ids = meta[meta["cycle_end_date"] < row["cycle_start_date"]]["cycle"]
        prior = R[R["cycle"].isin(prior_ids)]
        if prior.empty:
            chosen[row["cycle"]] = 0.0
            continue
        scores = {
            a: mae(prior["y"], prior["naive"] + a * prior["predicted_rate"] * prior["days_remaining"])
            for a in ALPHA_GRID
        }
        chosen[row["cycle"]] = min(scores, key=scores.get)
    return R["cycle"].map(chosen)


def shipping_alpha(R: pd.DataFrame) -> float:
    """
    The alpha to deploy: the same selection rule with all of history as prior
    evidence, which is what it would pick for the next unseen cycle.
    """
    scores = {
        a: mae(R["y"], R["naive"] + a * R["predicted_rate"] * R["days_remaining"])
        for a in ALPHA_GRID
    }
    return float(min(scores, key=scores.get))


def score_range(R: pd.DataFrame, label: str, mask=None, verbose: bool = True) -> dict:
    S = R if mask is None else R[mask]
    pred = S["naive"] + S["alpha"] * S["predicted_rate"] * S["days_remaining"]

    naive_mae, naive_mape = mae(S["y"], S["naive"]), mape(S["y"], S["naive"])
    model_mae, model_mape = mae(S["y"], pred), mape(S["y"], pred)
    improvement = (naive_mae - model_mae) / naive_mae * 100

    wins = total = 0
    for _, g in S.groupby("cycle"):
        pg = g["naive"] + g["alpha"] * g["predicted_rate"] * g["days_remaining"]
        wins += int(mae(g["y"], pg) < mae(g["y"], g["naive"]))
        total += 1

    # EMPIRICAL error quantiles from held-out predictions. Used for the
    # dashboard's confidence band in preference to a MAE->sigma conversion,
    # which would assume a normal error distribution that has not been verified.
    # "80% of past forecasts landed within +/- p80" is a directly checkable
    # claim; "1.96 sigma" is an assumption dressed as one.
    abs_err = np.abs(np.asarray(S["y"], float) - np.asarray(pred, float))
    quantiles = {f"p{q}": float(np.quantile(abs_err, q / 100)) for q in (50, 80, 90, 95)}

    # The baseline's own held-out quantiles, so the API's naive-fallback path can
    # also report a MEASURED band instead of a made-up percentage.
    naive_abs_err = np.abs(np.asarray(S["y"], float) - np.asarray(S["naive"], float))
    naive_quantiles = {f"p{q}": float(np.quantile(naive_abs_err, q / 100)) for q in (50, 80, 90, 95)}

    if verbose:
        print(f"    --- {label}  ({len(S)} predictions, {total} cycles) ---")
        print(f"        {'':<22}{'MAE (kWh)':>12}{'MAPE (%)':>12}")
        print(f"        {'Naive baseline':<22}{naive_mae:>12.2f}{naive_mape:>12.2f}")
        print(f"        {'LightGBM rate-resid':<22}{model_mae:>12.2f}{model_mape:>12.2f}")
        print(f"        MAE improvement: {improvement:+.2f}%    "
              f"cycles beaten: {wins}/{total} ({wins / total * 100:.0f}%)")
        print(f"        held-out |error| kWh: p50 {quantiles['p50']:.1f}  "
              f"p80 {quantiles['p80']:.1f}  p90 {quantiles['p90']:.1f}  p95 {quantiles['p95']:.1f}")
        print()

    return {
        "label": label,
        "naive_mae": naive_mae, "naive_mape": naive_mape,
        "model_mae": model_mae, "model_mape": model_mape,
        "improvement_pct": improvement,
        "cycles_beaten": wins, "cycles": total,
        "n_predictions": int(len(S)),
        "abs_error_quantiles": quantiles,
        "naive_abs_error_quantiles": naive_quantiles,
    }


def evaluate(df: pd.DataFrame, verbose: bool = True) -> dict:
    R = walk_forward(df, verbose=verbose)
    R["alpha"] = select_alpha_from_prior_folds(R)

    if verbose:
        counts = R.groupby("cycle")["alpha"].first().value_counts().sort_index()
        print("[*] alpha per fold (chosen from strictly-prior out-of-sample folds only):")
        print("    " + ", ".join(f"{a:.1f}x{int(n)}" for a, n in counts.items()))
        print()
        print("[*] Results — all three ranges, nothing hidden:")
        print()

    full = score_range(R, "FULL operating range (day 3-30)", verbose=verbose)
    late = score_range(R, "Day 15-30 (harder: baseline already strong)",
                       R["day_of_month"] >= 15, verbose=verbose)
    early = score_range(R, "Day 3-14 (early cycle)", R["day_of_month"] < 15, verbose=verbose)

    if verbose:
        pred = R["naive"] + R["alpha"] * R["predicted_rate"] * R["days_remaining"]
        by_day = pd.DataFrame({
            "day_of_month": R["day_of_month"],
            "e_naive": (R["y"] - R["naive"]).abs(),
            "e_model": (R["y"] - pred).abs(),
        }).groupby("day_of_month").mean()
        by_day["improvement_%"] = (by_day["e_naive"] - by_day["e_model"]) / by_day["e_naive"] * 100
        by_day["model_better"] = by_day["e_model"] < by_day["e_naive"]
        print("[*] Per-day breakdown (days where the model LOSES stay visible):")
        print(by_day.round(2).to_string())
        print()

    return {
        "full_range": full,
        "day_15_30": late,
        "day_3_14": early,
        # The gate is judged on the harder late-cycle subset, not the flattering
        # full-range number, so a pass cannot come from easy early-cycle rows.
        "gate_metric": "day_15_30.improvement_pct",
        "improvement_pct": late["improvement_pct"],
        "shipping_alpha": shipping_alpha(R),
        "folds": int(R["cycle"].nunique()),
    }


def main():
    parser = argparse.ArgumentParser(description="Train/evaluate the bill forecaster")
    parser.add_argument("--data", type=str, default=DEFAULT_DATA, help="training rows CSV")
    parser.add_argument("--no-gate", action="store_true",
                        help="report metrics only; never save a model")
    args = parser.parse_args()

    if not os.path.exists(args.data):
        raise FileNotFoundError(
            f"Could not find {args.data}. Run:\n"
            "    python -m ml.training.prepare_public_dataset"
        )

    df = pd.read_csv(args.data)
    print(f"[*] Loaded {len(df)} rows across {df['cycle_idx'].nunique()} cycles from {args.data}")
    print()

    results = evaluate(df)

    print(f"[*] Acceptance gate is judged on the HARDER day 15-30 subset "
          f"({results['day_15_30']['improvement_pct']:+.2f}%), not the full-range "
          f"figure ({results['full_range']['improvement_pct']:+.2f}%).")
    print()

    if args.no_gate:
        print("[*] --no-gate set: metrics reported, model not saved.")
        return

    if results["improvement_pct"] < MIN_MAE_IMPROVEMENT_PCT:
        print(f"[FAIL] ACCEPTANCE GATE NOT MET: MAE improvement "
              f"{results['improvement_pct']:+.2f}% < required {MIN_MAE_IMPROVEMENT_PCT}%.")
        print("       Model NOT saved. The naive baseline remains the honest choice.")
        return

    print(f"[PASS] Acceptance gate met: {results['improvement_pct']:+.2f}% "
          f">= {MIN_MAE_IMPROVEMENT_PCT}% required.")
    print()

    print("[*] Fitting final model on all available cycles (same MODEL_PARAMS as validation)...")
    model = fit_rate_model(df)

    alpha = results["shipping_alpha"]
    print(f"[*] Shipping alpha: {alpha:.1f}")

    # Uncertainty comes from HELD-OUT fold errors, never in-sample residuals —
    # in-sample would understate real error and put a dishonestly narrow band on
    # the dashboard. Stored per range because the model is genuinely far less
    # certain early in a cycle, and the UI should say so rather than hide it.
    quantiles_by_range = {
        "day_3_14": results["day_3_14"]["abs_error_quantiles"],
        "day_15_30": results["day_15_30"]["abs_error_quantiles"],
        "full_range": results["full_range"]["abs_error_quantiles"],
    }
    naive_quantiles_by_range = {
        "day_3_14": results["day_3_14"]["naive_abs_error_quantiles"],
        "day_15_30": results["day_15_30"]["naive_abs_error_quantiles"],
        "full_range": results["full_range"]["naive_abs_error_quantiles"],
    }
    print("[*] Held-out |error| quantiles (kWh), used for the confidence band:")
    for name, q in quantiles_by_range.items():
        nq = naive_quantiles_by_range[name]
        print(f"      {name:<12} model p50 {q['p50']:6.1f} p80 {q['p80']:6.1f} p90 {q['p90']:6.1f}"
              f"   |   naive p50 {nq['p50']:6.1f} p80 {nq['p80']:6.1f} p90 {nq['p90']:6.1f}")

    # Kept for backward compatibility with anything reading residual_std, but the
    # serving path uses the empirical quantiles above.
    sigma_full = results["full_range"]["model_mae"] * 1.2533

    # ---- applicability domain ---------------------------------------------
    # The model predicts an ABSOLUTE per-day kWh correction, so it is only
    # meaningful for a household whose consumption scale resembles the training
    # data. Feeding it a device far outside that scale makes the tree ensemble
    # return leaf values calibrated for a different kind of home, producing a
    # confident-looking number with no evidence behind it. Recording the
    # observed range here lets the API refuse to extrapolate instead.
    #
    # This is NOT a tuning knob and it does not touch the acceptance gate:
    # every row scored during validation lies inside this range by definition
    # (the range is measured FROM those rows), so enforcing it at serving time
    # cannot change any reported metric.
    scale = df["avg_daily_kwh_so_far"]
    training_domain = {
        "scale_feature": "avg_daily_kwh_so_far",
        "min_kwh_per_day": float(scale.min()),
        "max_kwh_per_day": float(scale.max()),
        "p1_kwh_per_day": float(scale.quantile(0.01)),
        "p99_kwh_per_day": float(scale.quantile(0.99)),
        # prepare_public_dataset only emits rows from contiguous COMPLETE runs,
        # so every training row represents a cycle with a reading on every
        # elapsed day. The serving path enforces the same condition.
        "training_rows_have_full_day_coverage": True,
    }
    print(f"[*] Applicability domain: avg_daily_kwh_so_far in "
          f"[{training_domain['min_kwh_per_day']:.2f}, "
          f"{training_domain['max_kwh_per_day']:.2f}] kWh/day "
          f"(p1 {training_domain['p1_kwh_per_day']:.2f}, "
          f"p99 {training_domain['p99_kwh_per_day']:.2f}).")
    print("    Outside this range the API serves the naive baseline and says so.")

    os.makedirs(MODELS_DIR, exist_ok=True)
    joblib.dump(
        {
            "model": model,
            "alpha": alpha,
            "feature_columns": FEATURE_COLUMNS,
            "naive_column": NAIVE_COLUMN,
            "target_column": TARGET_COLUMN,
            "rate_error_column": RATE_ERROR_COLUMN,
            "abs_error_quantiles_by_range": quantiles_by_range,
            "naive_abs_error_quantiles_by_range": naive_quantiles_by_range,
            "residual_std": float(sigma_full),
            "training_domain": training_domain,
            "validation_metrics": results,
            "model_params": MODEL_PARAMS,
            "trained_on_rows": int(len(df)),
            "trained_on_cycles": int(df["cycle_idx"].nunique()),
            "trained_on_file": os.path.basename(args.data),
            "prediction_recipe": (
                "final_kwh = naive_prediction + alpha * days_remaining "
                "* model.predict(FEATURE_COLUMNS);  build features with "
                "ml.features.build_features and apply with ml.features.apply_prediction"
            ),
        },
        MODEL_OUTPUT_FILE,
    )
    print(f"[OK] Saved model artifact to {MODEL_OUTPUT_FILE}")


if __name__ == "__main__":
    main()
