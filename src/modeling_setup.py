"""Feature configurations and leakage-safe splits for CarSage price modelling. No model is trained here.

Split unit = family_group (sibling models together), so no model family and no duplicate row
can sit in both train and test. Use `dev` for group-aware CV and `test` once, at the very end.
"""
import pandas as pd
from sklearn.model_selection import GroupKFold, GroupShuffleSplit

TARGET = "price_inr"
GROUP = "family_group"
SEED = 42

NUMERIC = ["power_ps", "torque_nm", "Displacement", "Length", "Width", "Height", "Wheelbase", "Fuel_Tank_Capacity",
           "Kerb_Weight", "Ground_Clearance", "Boot_Space", "ARAI_Certified_Mileage", "Cylinders", "Gears",
           "Seating_Capacity", "Doors", "Number_of_Airbags"]
CATEGORICAL = ["make", "Fuel_Type", "Body_Type", "Type", "Drivetrain", "Cylinder_Configuration", "Emission_Norm"]
# identifiers / helpers that encode the target, row order, or the split itself -- never features
NEVER_FEATURES = {TARGET, "source_row", "duplicate_of_source_row", "is_exact_duplicate", "near_duplicate_group_size",
                  "model_group", "family_group", "model"}


def feature_config(include_variant=False):
    """Config A (default): numeric + categorical. Config B: also the free-text `variant` column.
    Text rule for B (applied inside each CV fold): lowercase, TfidfVectorizer(word 1-2 grams, min_df=3), fit on train only."""
    cfg = {"numeric": list(NUMERIC), "categorical": list(CATEGORICAL), "text": ["variant"] if include_variant else []}
    cols = cfg["numeric"] + cfg["categorical"] + cfg["text"]
    assert not set(cols) & NEVER_FEATURES, f"forbidden feature(s): {set(cols) & NEVER_FEATURES}"
    return cfg


def split_dev_test(df, test_size=0.2, seed=SEED):
    """Reproducible held-out test split by group. Returns (dev_idx, test_idx) as positional index arrays."""
    dev, test = next(GroupShuffleSplit(1, test_size=test_size, random_state=seed).split(df, groups=df[GROUP]))
    return dev, test


def cv_folds(dev_df, n_splits=5):
    """Group-aware CV on the dev partition (deterministic). Yields (train_pos, valid_pos) positions within dev_df."""
    return GroupKFold(n_splits).split(dev_df, groups=dev_df[GROUP])


def check_partitions(df, parts):
    """Raise if any family group, exact duplicate, or duplicate original appears in more than one partition.
    `parts`: list of positional index arrays into df (e.g. [train, valid, test])."""
    for a in range(len(parts)):
        for b in range(a + 1, len(parts)):
            pa, pb = df.iloc[parts[a]], df.iloc[parts[b]]
            shared = set(pa[GROUP]) & set(pb[GROUP])
            assert not shared, f"groups in two partitions: {sorted(shared)[:5]}"
            ids_a = set(pa.source_row) | set(pa.duplicate_of_source_row.dropna().astype(int))
            ids_b = set(pb.source_row) | set(pb.duplicate_of_source_row.dropna().astype(int))
            assert not ids_a & ids_b, "an exact duplicate (or its original) crosses partitions"
