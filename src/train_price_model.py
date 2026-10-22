"""Build the price-model artifact used by the API:  python src/train_price_model.py

Fits the Ridge pipeline of feature config A (no Variant) on all de-duplicated processed rows, with the same group-aware
alpha search as the experiment, and saves models/price_model.joblib + .json. The held-out figures in the JSON are copied
from reports/experiment/metrics_test.csv (measured by the experiment on unseen car families, not by this fit).
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import pandas as pd

import experiment as ex
import modeling_setup as ms

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "models/price_model.joblib"


def main():
    df = pd.read_csv(ROOT / "data/processed/cars_processed.csv")
    df = df[~df.is_exact_duplicate]
    est, cfg = ex.build_estimator("A_no_variant", "ridge")
    cols = cfg["numeric"] + cfg["categorical"]
    est.fit(df[cols], df[ms.TARGET], groups=df[ms.GROUP].values)
    t = pd.read_csv(ROOT / "reports/experiment/metrics_test.csv")
    t = t[(t.config == "A_no_variant") & (t.model == "ridge")]
    meta = {"model": f"Ridge (alpha={est.best_params_['regressor__model__alpha']}) on log1p(price), config A", "n_rows": len(df),
            "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "features": cols, "numeric": cfg["numeric"],
            "categorical": cfg["categorical"], "numeric_ranges": {c: [float(df[c].min()), float(df[c].max())] for c in cfg["numeric"]},
            "categories": {c: sorted(df[c].dropna().unique().tolist()) for c in cfg["categorical"]},
            "held_out_test": {"mae_inr": float(t.mae.iloc[0]), "median_ae_inr": float(t.medae.iloc[0]), "mape_pct": float(t.mape_pct.iloc[0]),
                              "source": "reports/experiment/metrics_test.csv"} if len(t) else None}
    OUT.parent.mkdir(exist_ok=True)
    joblib.dump(est.best_estimator_, OUT)
    OUT.with_suffix(".json").write_text(json.dumps(meta, indent=1))
    print("saved", OUT.relative_to(ROOT), meta["model"], "rows", meta["n_rows"])


if __name__ == "__main__":
    main()
