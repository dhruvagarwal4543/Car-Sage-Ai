"""Experimental new-car price estimate from a saved Ridge pipeline (built by src/train_price_model.py).

The model file is not committed. If it is missing the API says so (503) instead of guessing.
"""
import functools
import json
import os
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from carsage.recommend import inr

ROOT = Path(__file__).resolve().parents[1]
# API / database attribute -> column name the model was trained on
ATTR_TO_FEATURE = {
    "power_ps": "power_ps", "torque_nm": "torque_nm", "displacement_cc": "Displacement", "length_mm": "Length", "width_mm": "Width",
    "height_mm": "Height", "wheelbase_mm": "Wheelbase", "fuel_tank_litres": "Fuel_Tank_Capacity", "kerb_weight_kg": "Kerb_Weight",
    "ground_clearance_mm": "Ground_Clearance", "boot_space_litres": "Boot_Space", "mileage_kmpl": "ARAI_Certified_Mileage",
    "cylinders": "Cylinders", "gears": "Gears", "seating_capacity": "Seating_Capacity", "doors": "Doors", "number_of_airbags": "Number_of_Airbags",
    "make": "make", "fuel_type": "Fuel_Type", "body_type": "Body_Type", "transmission": "Type", "drivetrain": "Drivetrain",
    "cylinder_configuration": "Cylinder_Configuration", "emission_norm": "Emission_Norm"}


class ModelUnavailable(RuntimeError):
    pass


def model_path():
    return Path(os.environ.get("PRICE_MODEL_PATH") or ROOT / "models/price_model.joblib")


@functools.lru_cache(maxsize=2)
def _load(path):
    p = Path(path)
    if not p.is_file() or not p.with_suffix(".json").is_file():
        raise ModelUnavailable("Price model not built. Run: python src/train_price_model.py")
    return joblib.load(p), json.loads(p.with_suffix(".json").read_text())


def load():
    return _load(str(model_path()))


def predict(features: dict):
    """features: attribute-name -> value (None = unknown). Returns (price_inr, warnings, model_info)."""
    model, meta = load()
    row = {col: features.get(attr) for attr, col in ATTR_TO_FEATURE.items()}
    df = pd.DataFrame([row])[meta["features"]]
    for c in meta["numeric"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    for c in meta["categorical"]:
        df[c] = df[c].astype(object).where(df[c].notna(), np.nan)
    warnings, given = [], int(df.notna().sum(axis=1).iloc[0])
    if given < 8:
        warnings.append(f"Only {given} of {len(meta['features'])} specifications were provided; the rest are filled with training medians, so this estimate is weak.")
    for c in meta["numeric"]:
        lo, hi = meta["numeric_ranges"][c]
        v = df[c].iloc[0]
        if pd.notna(v) and not lo <= v <= hi:
            warnings.append(f"{c}={v:g} is outside the range seen in training ({lo:g}-{hi:g}); extrapolation is unreliable.")
    for c in meta["categorical"]:
        v = df[c].iloc[0]
        if isinstance(v, str) and v not in meta["categories"][c]:
            warnings.append(f"{c}='{v}' was not seen in training and is ignored.")
    price = int(round(max(float(model.predict(df)[0]), 0)))
    t = meta["held_out_test"]
    info = {"model": meta["model"], "trained_on_rows": meta["n_rows"], "trained_at": meta["trained_at"], "scope": "new-car ex-showroom price in INR"}
    err = (f"On held-out car families the typical error was about {inr(t['mae_inr'])} (median {inr(t['median_ae_inr'])}); "
           "errors are far larger for cars above ₹1 crore. Not a used-car resale estimate.") if t else "Held-out error figures unavailable."
    return price, warnings, info, err
