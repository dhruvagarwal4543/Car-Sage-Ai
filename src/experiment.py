"""Price-estimation experiment: configs A/B x Dummy/Ridge/HistGradientBoosting, target log1p(price).

Run: python3 src/experiment.py   (needs data/processed/cars_processed.csv from src/preprocess.py)
Everything fitted (imputer, scaler, encoder, TF-IDF, SVD, model, and the inner hyper-parameter search)
lives inside a sklearn Pipeline that is cloned and fitted on TRAINING rows only.
Scope: NEW-car ex-showroom price. This is not a used-car resale model.
"""
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer, TransformedTargetRegressor
from sklearn.decomposition import TruncatedSVD
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import make_scorer
from sklearn.model_selection import GridSearchCV, GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

import modeling_setup as ms

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports/experiment"
CONFIGS, MODELS = ["A_no_variant", "B_with_variant"], ["dummy", "ridge", "hgb"]
BANDS = [0, 10e5, 30e5, 1e7, np.inf]
BAND_LABELS = ["<10 lakh", "10-30 lakh", "30 lakh-1 crore", ">=1 crore"]
MIN_MAKE_ROWS = 30   # leave-one-make-out only for makes with at least this many (de-duplicated) dev rows
GRIDS = {"dummy": {}, "ridge": {"regressor__model__alpha": [0.1, 1, 10, 100]},
         "hgb": {"regressor__model__max_depth": [3, 6], "regressor__model__learning_rate": [0.05, 0.1]}}


# ---------- metrics (rupee scale) ----------
def rupee_metrics(y, p):
    """MAE, median AE, RMSE, MAPE in rupees / %. Non-finite pairs are excluded; zero targets are excluded from MAPE only.
    Empty input gives n=0 and NaN metrics instead of an error."""
    y, p = np.asarray(y, float), np.asarray(p, float)
    ok = np.isfinite(y) & np.isfinite(p)
    y, p = y[ok], p[ok]
    nan = dict(n=0, n_excluded_nonfinite=int((~ok).sum()), n_excluded_mape=0, mae=np.nan, medae=np.nan, rmse=np.nan, mape_pct=np.nan)
    if len(y) == 0:
        return nan
    e = np.abs(y - p); nz = y != 0
    return dict(n=len(y), n_excluded_nonfinite=int((~ok).sum()), n_excluded_mape=int((~nz).sum()), mae=e.mean(), medae=np.median(e),
                rmse=float(np.sqrt((e ** 2).mean())), mape_pct=float((e[nz] / y[nz]).mean() * 100) if nz.any() else np.nan)


def band_mae(df):
    """MAE per price band of the TRUE price; bands with no rows give n=0 and NaN."""
    b = pd.cut(df.price_inr, BANDS, labels=BAND_LABELS, right=False)
    return pd.DataFrame([{"band": l, "n": int((b == l).sum()), "mae": rupee_metrics(df.price_inr[b == l], df.pred[b == l])["mae"]} for l in BAND_LABELS])


# ---------- model construction ----------
class CappedSVD(TruncatedSVD):
    """TruncatedSVD that lowers n_components to the vocabulary size when a tiny training set has fewer than 30 terms."""
    def fit_transform(self, X, y=None):
        self.n_components = min(self.n_components, X.shape[1])
        return super().fit_transform(X, y)


def log_rmse(y, p):
    return -float(np.sqrt(np.mean((np.log1p(y) - np.log1p(np.clip(p, 0, None))) ** 2)))   # inner-search score, higher is better


def build_estimator(config, model_name):
    cfg = ms.feature_config(include_variant=config.startswith("B"))
    tree = model_name == "hgb"
    num = "passthrough" if tree else Pipeline([("impute", SimpleImputer(strategy="median", add_indicator=True)), ("scale", StandardScaler())])
    cat = OneHotEncoder(handle_unknown="ignore", sparse_output=not tree)
    parts = [("num", num, cfg["numeric"]), ("cat", cat, cfg["categorical"])]
    if cfg["text"]:
        tfidf = TfidfVectorizer(lowercase=True, ngram_range=(1, 2), min_df=3)
        text = Pipeline([("tfidf", tfidf), ("svd", CappedSVD(30, random_state=ms.SEED))]) if tree else tfidf   # HGB needs dense input
        parts.append(("txt", text, cfg["text"][0]))   # string, not list: TfidfVectorizer takes a 1-D column
    reg = {"dummy": DummyRegressor(strategy="median"), "ridge": Ridge(),
           "hgb": HistGradientBoostingRegressor(max_iter=200, early_stopping=False, random_state=ms.SEED)}[model_name]
    inner = Pipeline([("prep", ColumnTransformer(parts, remainder="drop")), ("model", reg)])   # remainder="drop": no stray columns
    est = TransformedTargetRegressor(regressor=inner, func=np.log1p, inverse_func=np.expm1, check_inverse=False)
    grid = GRIDS[model_name]
    if not grid:
        return est, cfg
    return GridSearchCV(est, grid, cv=GroupKFold(3), scoring=make_scorer(log_rmse), n_jobs=1), cfg   # inner search is group-aware too


def fit_predict(train, test, config, model_name):
    """Fit on `train` rows only; return rupee predictions for `test` and the chosen hyper-parameters."""
    est, cfg = build_estimator(config, model_name)
    cols = cfg["numeric"] + cfg["categorical"] + cfg["text"]
    fit_kw = {"groups": train[ms.GROUP].values} if hasattr(est, "param_grid") else {}
    est.fit(train[cols], train[ms.TARGET], **fit_kw)
    pred = est.predict(test[cols])
    return np.clip(pred, 0, None), (getattr(est, "best_params_", {}))


def run_one(train, test, config, model_name, tag, rows, params):
    train = train[~train.is_exact_duplicate]            # exact duplicates are never trained on or scored twice
    test = test[~test.is_exact_duplicate]
    pred, bp = fit_predict(train, test, config, model_name)
    rows.append(test[["source_row", ms.GROUP, "make", ms.TARGET]].assign(pred=pred, config=config, model=model_name, **tag))
    params.append({"config": config, "model": model_name, **tag, "best_params": json.dumps(bp)})


# ---------- bootstrap over family groups ----------
def group_bootstrap(preds, stat, n_boot=1000, seed=ms.SEED):
    """95% interval of stat(df) when resampling whole family groups (the unit of independence)."""
    rng = np.random.default_rng(seed)
    parts = {g: d for g, d in preds.groupby(ms.GROUP)}; keys = list(parts)
    vals = [stat(pd.concat([parts[k] for k in rng.choice(keys, len(keys))])) for _ in range(n_boot)]
    return tuple(np.percentile(vals, [2.5, 97.5]))


def md(df, fmt="{:,.0f}"):
    f = lambda v: fmt.format(v) if isinstance(v, (float, np.floating)) and np.isfinite(v) else ("n/a" if isinstance(v, float) else str(v))
    return "\n".join(["| " + " | ".join(map(str, df.columns)) + " |", "|" + "---|" * len(df.columns)] +
                     ["| " + " | ".join(f(v) for v in r) + " |" for r in df.values])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    df = pd.read_csv(ROOT / "data/processed/cars_processed.csv")
    dev_pos, test_pos = ms.split_dev_test(df)
    ms.check_partitions(df, [dev_pos, test_pos])
    dev, test = df.iloc[dev_pos].reset_index(drop=True), df.iloc[test_pos].reset_index(drop=True)
    cv_rows, test_rows, lomo_rows, params = [], [], [], []

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        for fold, (tr, va) in enumerate(ms.cv_folds(dev)):
            ms.check_partitions(dev, [tr, va])
            for c in CONFIGS:
                for m in MODELS:
                    run_one(dev.iloc[tr], dev.iloc[va], c, m, {"split": "cv", "fold": fold}, cv_rows, params)
        for c in CONFIGS:
            for m in MODELS:
                run_one(dev, test, c, m, {"split": "test", "fold": -1}, test_rows, params)   # held-out groups, evaluated once
        d = dev[~dev.is_exact_duplicate]
        makes = d.make.value_counts()[lambda s: s >= MIN_MAKE_ROWS].index
        for mk in makes:                                 # dev only: the held-out test set is not used here
            for c in CONFIGS:
                for m in MODELS:
                    run_one(dev[dev.make != mk], dev[dev.make == mk], c, m, {"split": "lomo", "fold": -1, "held_out_make": mk}, lomo_rows, params)
    (OUT / "warnings.txt").write_text("\n".join(sorted({f"{w.category.__name__}: {w.message}" for w in caught})) or "none")

    cv, te, lo = (pd.concat(r, ignore_index=True) for r in (cv_rows, test_rows, lomo_rows))
    cv.to_csv(OUT / "predictions_cv.csv", index=False); te.to_csv(OUT / "predictions_test.csv", index=False); lo.to_csv(OUT / "predictions_lomo.csv", index=False)
    pd.DataFrame(params).to_csv(OUT / "best_params.csv", index=False)

    key = ["config", "model"]
    fold_m = pd.DataFrame([{**dict(zip(key + ["fold"], k)), **rupee_metrics(g.price_inr, g.pred)} for k, g in cv.groupby(key + ["fold"])])
    fold_m.to_csv(OUT / "metrics_cv_by_fold.csv", index=False)
    cols = ["mae", "medae", "rmse", "mape_pct"]
    cv_sum = fold_m.groupby(key)[cols].agg(["mean", "std"]); cv_sum.columns = ["_".join(c) for c in cv_sum.columns]; cv_sum = cv_sum.reset_index()
    cv_sum.to_csv(OUT / "metrics_cv_summary.csv", index=False)
    te_m = pd.DataFrame([{**dict(zip(key, k)), **rupee_metrics(g.price_inr, g.pred)} for k, g in te.groupby(key)]); te_m.to_csv(OUT / "metrics_test.csv", index=False)
    lo_m = pd.DataFrame([{**dict(zip(key, k)), **rupee_metrics(g.price_inr, g.pred)} for k, g in lo.groupby(key)]); lo_m.to_csv(OUT / "metrics_lomo_pooled.csv", index=False)
    lo_mk = pd.DataFrame([{**dict(zip(key + ["held_out_make"], k)), **rupee_metrics(g.price_inr, g.pred)} for k, g in lo.groupby(key + ["held_out_make"])]); lo_mk.to_csv(OUT / "metrics_lomo_by_make.csv", index=False)
    bands = []
    for name, p in (("cv_pooled", cv), ("test", te)):
        for k, g in p.groupby(key):
            bands.append(band_mae(g).assign(split=name, config=k[0], model=k[1]))
    bands = pd.concat(bands); bands.to_csv(OUT / "metrics_mae_by_price_band.csv", index=False)

    # comparisons: every model vs dummy (same config); Variant effect (B vs A)
    def vs_dummy(m):
        out = []
        for c in CONFIGS:
            base = m[(m.config == c) & (m.model == "dummy")].iloc[0]
            for mod in ("ridge", "hgb"):
                r = m[(m.config == c) & (m.model == mod)].iloc[0]
                out.append({"config": c, "model": mod, **{f"{k}_vs_dummy_%": (1 - r[k] / base[k]) * 100 for k in ("mae", "medae", "rmse")}})
        return pd.DataFrame(out)
    cvm = cv_sum.rename(columns={f"{k}_mean": k for k in cols})
    vd_cv, vd_te = vs_dummy(cvm), vs_dummy(te_m)
    ci = []
    for (c, m), g in te.groupby(key):
        lo_, hi_ = group_bootstrap(g, lambda d: rupee_metrics(d.price_inr, d.pred)["mae"])
        ci.append({"config": c, "model": m, "test_mae": rupee_metrics(g.price_inr, g.pred)["mae"], "mae_ci95_low": lo_, "mae_ci95_high": hi_})
    ci = pd.DataFrame(ci); ci.to_csv(OUT / "metrics_test_mae_bootstrap_ci.csv", index=False)
    var = []
    for m in MODELS:
        a, b = (te[(te.config == c) & (te.model == m)].set_index("source_row").pred for c in CONFIGS)
        t = te[(te.config == CONFIGS[0]) & (te.model == m)].set_index("source_row")
        diff = pd.DataFrame({"price_inr": t.price_inr, ms.GROUP: t[ms.GROUP], "a": a, "b": b}).dropna()
        stat = lambda d: np.abs(d.price_inr - d.b).mean() - np.abs(d.price_inr - d.a).mean()   # negative = Variant helps
        lo_, hi_ = group_bootstrap(diff, stat)
        f = fold_m[fold_m.model == m].pivot(index="fold", columns="config", values="mae")
        var.append({"model": m, "cv_mae_B_minus_A": (f[CONFIGS[1]] - f[CONFIGS[0]]).mean(), "cv_folds_B_better": f"{int((f[CONFIGS[1]] < f[CONFIGS[0]]).sum())}/5",
                    "test_mae_B_minus_A": stat(diff), "test_ci95_low": lo_, "test_ci95_high": hi_})
    var = pd.DataFrame(var); var.to_csv(OUT / "variant_effect.csv", index=False)

    n = lambda d: f"{len(d)} rows / {d[ms.GROUP].nunique()} groups"
    txt = ["# Price-estimation experiment — results (auto-generated by src/experiment.py)", "",
           "Scope: **new-car ex-showroom price**. Not validated for used-car resale. Target log1p(price); every metric is on the rupee scale. All numbers below are produced by the run, nothing hand-edited.", "",
           f"Data: {len(df)} rows. Dev {n(dev)}; held-out test {n(test)} (seed {ms.SEED}). Exact duplicates removed from training and scoring. CV = 5 folds, group-aware (family_group). Inner tuning = GroupKFold(3) inside each training set.", "",
           "## 1. Cross-validation on development data (mean over 5 folds; ± = std across folds)", md(cv_sum.assign(**{c: cv_sum[c] for c in cv_sum.columns if c not in key})), "",
           "## 2. Held-out test set (single evaluation, 6 model/config combinations, no selection made on it)", md(te_m), "",
           "Test MAE with 95% interval from resampling whole family groups:", md(ci), "",
           "## 3. Improvement over DummyRegressor (percent reduction in error; negative = worse than dummy)", "CV (means):", md(vd_cv, "{:.1f}"), "", "Test:", md(vd_te, "{:.1f}"), "",
           "## 4. Does Variant help? (B minus A; negative = Variant helps)", md(var, "{:,.0f}"), "",
           "## 5. MAE by true price band", md(bands.pivot_table(index=["split", "config", "model"], columns="band", values="mae").reindex(columns=BAND_LABELS).reset_index()), "",
           "Rows per band (test): " + ", ".join(f"{r.band}: {r.n}" for r in bands[(bands.split == "test") & (bands.model == "dummy") & (bands.config == CONFIGS[0])].itertuples()), "",
           f"## 6. Leave-one-make-out (SEPARATE generalisation check, dev data only, makes with >= {MIN_MAKE_ROWS} rows: {', '.join(map(str, makes))})",
           "Pooled over held-out makes; each make is predicted by models that never saw any of its cars.", md(lo_m),
           "", "Dummy vs best per make is in `metrics_lomo_by_make.csv`.", "", "## 7. Warnings raised during the run", "```", (OUT / "warnings.txt").read_text()[:3000], "```"]
    (OUT / "results.md").write_text("\n".join(txt))
    print("\n".join(txt))


if __name__ == "__main__":
    main()
