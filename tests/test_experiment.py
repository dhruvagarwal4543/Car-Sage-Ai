import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import experiment as ex  # noqa: E402
import modeling_setup as ms  # noqa: E402

PROCESSED = Path(__file__).resolve().parents[1] / "data/processed/cars_processed.csv"
needs_data = pytest.mark.skipif(not PROCESSED.exists(), reason="run src/preprocess.py first")


def test_metrics_values():
    m = ex.rupee_metrics([100, 200, 400], [110, 180, 400])
    assert m["mae"] == pytest.approx(10) and m["medae"] == 10 and m["rmse"] == pytest.approx(np.sqrt(500 / 3))
    assert m["mape_pct"] == pytest.approx((0.1 + 0.1 + 0) / 3 * 100)


def test_metrics_zero_denominator_and_undefined():
    m = ex.rupee_metrics([0, 100], [5, 110])
    assert m["n_excluded_mape"] == 1 and m["mape_pct"] == pytest.approx(10) and m["mae"] == pytest.approx(7.5)
    assert np.isnan(ex.rupee_metrics([0], [5])["mape_pct"])                 # all-zero targets: MAPE undefined, not inf
    e = ex.rupee_metrics([], [])
    assert e["n"] == 0 and np.isnan(e["mae"])                                # empty input: NaN, no crash
    n = ex.rupee_metrics([1, np.nan], [1, 2]); assert n["n"] == 1 and n["n_excluded_nonfinite"] == 1


def test_band_mae_handles_empty_band():
    d = pd.DataFrame({"price_inr": [5e5, 6e5, 2e7], "pred": [5.5e5, 6e5, 2e7]})
    b = ex.band_mae(d).set_index("band")
    assert b.loc["<10 lakh", "n"] == 2 and b.loc["<10 lakh", "mae"] == pytest.approx(25000)
    assert b.loc["10-30 lakh", "n"] == 0 and np.isnan(b.loc["10-30 lakh", "mae"])
    assert b.n.sum() == 3


def _frame(n=60, seed=0):
    r = np.random.default_rng(seed)
    d = pd.DataFrame({c: r.normal(100, 10, n) for c in ms.NUMERIC})
    for c in ms.CATEGORICAL: d[c] = r.choice(["a", "b"], n)
    d["variant"] = r.choice(["alpha one", "beta two", "gamma"], n)
    d["price_inr"] = np.exp(r.normal(14, .5, n)); d["family_group"] = [f"g{i % 12}" for i in range(n)]
    return d


@pytest.mark.parametrize("model", ["dummy", "ridge", "hgb"])
@pytest.mark.parametrize("config", ex.CONFIGS)
def test_pipeline_runs_and_predicts_rupees(config, model):
    d = _frame()
    pred, _ = ex.fit_predict(d.iloc[:45], d.iloc[45:], config, model)
    assert pred.shape == (15,) and (pred >= 0).all() and 1e4 < np.median(pred) < 1e9      # original rupee scale, not log


def test_preprocessing_is_fit_on_training_rows_only():
    d = _frame(); train, valid = d.iloc[:45].copy(), d.iloc[45:].copy()
    valid["variant"] = "zzzunseen " * 1; valid.loc[valid.index[0], "power_ps"] = 1e9          # extreme / unseen only in validation
    inner, cfg = ex.build_estimator("B_with_variant", "dummy")                                # un-searched estimator exposes the pipeline
    inner.fit(train[cfg["numeric"] + cfg["categorical"] + cfg["text"]], train.price_inr)
    prep = inner.regressor_.named_steps["prep"]
    assert "zzzunseen" not in prep.named_transformers_["txt"].vocabulary_
    assert prep.named_transformers_["num"].named_steps["scale"].mean_.max() < 1e3          # validation outlier not in scaler stats
    med = prep.named_transformers_["num"].named_steps["impute"].statistics_
    assert np.allclose(med, train[cfg["numeric"]].median().values)
    cats = prep.named_transformers_["cat"].categories_
    assert all(set(c) <= set(train[col].unique()) for c, col in zip(cats, cfg["categorical"]))


def test_features_exclude_identifiers_and_target():
    for c in ex.CONFIGS:
        est, cfg = ex.build_estimator(c, "dummy")
        cols = set(cfg["numeric"] + cfg["categorical"] + cfg["text"])
        assert not cols & ms.NEVER_FEATURES and ms.TARGET not in cols
        prep = est.regressor.named_steps["prep"]
        used = {c for _, _, cols_ in prep.transformers for c in ([cols_] if isinstance(cols_, str) else cols_)}
        assert used == cols and prep.remainder == "drop"     # exactly the declared features reach the model


@needs_data
def test_real_variant_never_contains_price_and_features_exist():
    df = pd.read_csv(PROCESSED)
    cfg = ms.feature_config(True)
    assert set(cfg["numeric"] + cfg["categorical"] + cfg["text"]) <= set(df.columns)


@needs_data
def test_duplicates_removed_only_inside_run_one():
    df = pd.read_csv(PROCESSED); rows, params = [], []
    dev, test = ms.split_dev_test(df)
    train, valid = df.iloc[dev], df.iloc[test]
    ex.run_one(train, valid, "A_no_variant", "dummy", {"split": "test"}, rows, params)
    out = rows[0]
    assert not out.source_row.isin(df[df.is_exact_duplicate].source_row).any() and len(out) == (~valid.is_exact_duplicate).sum()
    assert set(out.source_row).isdisjoint(train.source_row)
