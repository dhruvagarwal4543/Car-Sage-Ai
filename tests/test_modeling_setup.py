import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import modeling_setup as ms  # noqa: E402

PROCESSED = Path(__file__).resolve().parents[1] / "data/processed/cars_processed.csv"
df = pytest.importorskip("pandas").read_csv(PROCESSED) if PROCESSED.exists() else None
needs_data = pytest.mark.skipif(df is None, reason="run src/preprocess.py first")


@needs_data
def test_no_target_or_identifier_in_features():
    for inc in (False, True):
        cfg = ms.feature_config(inc)
        cols = set(cfg["numeric"] + cfg["categorical"] + cfg["text"])
        assert not cols & ms.NEVER_FEATURES and ("variant" in cols) == inc and cols <= set(df.columns)


def test_forbidden_feature_is_rejected(monkeypatch):
    monkeypatch.setattr(ms, "NUMERIC", ["power_ps", "source_row"])
    with pytest.raises(AssertionError):
        ms.feature_config()


@needs_data
def test_test_split_is_reproducible_and_group_safe():
    a, b = ms.split_dev_test(df), ms.split_dev_test(df)
    assert (a[0] == b[0]).all() and (a[1] == b[1]).all()
    ms.check_partitions(df, [a[0], a[1]])
    assert len(a[0]) + len(a[1]) == len(df) and 0.1 < len(a[1]) / len(df) < 0.35


@needs_data
def test_cv_folds_never_share_groups_with_each_other_or_test():
    dev, test = ms.split_dev_test(df)
    d = df.iloc[dev].reset_index(drop=True)
    seen_valid = set()
    for tr, va in ms.cv_folds(d):
        ms.check_partitions(d, [tr, va])
        ms.check_partitions(pd.concat([d, df.iloc[test]], ignore_index=True), [tr, list(range(len(d), len(d) + len(test)))])
        assert not seen_valid & set(va); seen_valid |= set(va)      # every dev row validated exactly once
    assert len(seen_valid) == len(d)


@needs_data
def test_exact_duplicates_stay_with_their_original():
    dups = df[df.is_exact_duplicate]
    orig = df.set_index("source_row").loc[dups.duplicate_of_source_row.astype(int)]
    assert (orig.family_group.values == dups.family_group.values).all()


def test_check_partitions_catches_leaks():
    t = pd.DataFrame({"source_row": [0, 1, 2], "duplicate_of_source_row": [None, 0.0, None], "family_group": ["a", "b", "c"]})
    ms.check_partitions(t, [[0], [2]])
    with pytest.raises(AssertionError):
        ms.check_partitions(t, [[0], [1]])           # row 1 is a duplicate of row 0
    t.loc[2, "family_group"] = "a"
    with pytest.raises(AssertionError):
        ms.check_partitions(t, [[0], [2]])           # same group
