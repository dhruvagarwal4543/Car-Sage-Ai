"""Idempotent catalogue import:  python -m carsage.import_catalogue [--csv PATH]

Reads the processed CSV (read-only) and upserts rows into catalogue_cars keyed by source_row.
Re-running never creates duplicates. Invalid rows are rejected and listed, never silently dropped
or patched; missing optional values stay NULL.
"""
import argparse
import math
from pathlib import Path

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from carsage.db import database_url, describe_target, get_engine, require_target_confirmation
from carsage.models import CatalogueCar

DEFAULT_CSV = Path(__file__).resolve().parents[1] / "data/processed/cars_processed.csv"
# CSV column -> model attribute
COLUMNS = {
    "source_row": "source_row", "make": "make", "model": "model", "variant": "variant", "Fuel_Type": "fuel_type", "price_inr": "price_inr",
    "Type": "transmission", "Body_Type": "body_type", "Drivetrain": "drivetrain", "Cylinder_Configuration": "cylinder_configuration",
    "Emission_Norm": "emission_norm", "Seating_Capacity": "seating_capacity", "Doors": "doors", "Cylinders": "cylinders", "Gears": "gears",
    "Number_of_Airbags": "number_of_airbags", "Displacement": "displacement_cc", "power_ps": "power_ps", "torque_nm": "torque_nm",
    "Length": "length_mm", "Width": "width_mm", "Height": "height_mm", "Wheelbase": "wheelbase_mm", "Ground_Clearance": "ground_clearance_mm",
    "Kerb_Weight": "kerb_weight_kg", "Gross_Vehicle_Weight": "gross_vehicle_weight_kg", "Fuel_Tank_Capacity": "fuel_tank_litres",
    "Boot_Space": "boot_space_litres", "Minimum_Turning_Radius": "min_turning_radius_m", "ARAI_Certified_Mileage": "mileage_kmpl",
    "model_group": "model_group", "family_group": "family_group", "is_exact_duplicate": "is_exact_duplicate",
    "duplicate_of_source_row": "duplicate_of_source_row", "near_duplicate_group_size": "near_duplicate_group_size"}
INT_FIELDS = {"source_row", "price_inr", "seating_capacity", "doors", "cylinders", "gears", "number_of_airbags",
              "duplicate_of_source_row", "near_duplicate_group_size"}
REQUIRED = ["source_row", "make", "model", "variant", "fuel_type", "price_inr"]


def _clean(attr, v):
    """NaN/blank -> None (stay NULL); whole-number floats -> int for integer columns."""
    if v is None or (isinstance(v, float) and math.isnan(v)) or (isinstance(v, str) and not v.strip()):
        return None
    if attr in INT_FIELDS:
        return int(v)
    if attr == "is_exact_duplicate":
        return bool(v)
    return v.strip() if isinstance(v, str) else (float(v) if isinstance(v, (int, float)) else v)


def parse_rows(df):
    """Return (valid record dicts, list of (source_row, reason) rejections)."""
    missing_cols = [c for c in COLUMNS if c not in df.columns]
    if missing_cols:
        raise ValueError(f"CSV is missing expected columns: {missing_cols}")
    records, rejected, seen = [], [], set()
    for raw in df.astype(object).to_dict("records"):
        rec = {attr: _clean(attr, raw[col]) for col, attr in COLUMNS.items()}
        absent = [f for f in REQUIRED if rec[f] is None]
        if absent:
            rejected.append((rec["source_row"], f"missing required: {absent}"))
        elif rec["price_inr"] <= 0:
            rejected.append((rec["source_row"], "price_inr must be > 0"))
        elif rec["source_row"] in seen:
            rejected.append((rec["source_row"], "duplicate source_row in CSV"))
        else:
            seen.add(rec["source_row"]); records.append(rec)
    return records, rejected


def import_catalogue(engine, csv_path=DEFAULT_CSV):
    """Upsert by source_row. Returns counts: read, inserted, updated, unchanged, rejected (+ rejection list)."""
    records, rejected = parse_rows(pd.read_csv(csv_path))   # read-only
    read = len(records) + len(rejected)
    inserted = updated = 0
    with Session(engine) as s, s.begin():
        existing = {c.source_row: c for c in s.scalars(select(CatalogueCar))}
        for rec in records:
            row = existing.get(rec["source_row"])
            if row is None:
                s.add(CatalogueCar(**rec)); inserted += 1
            elif any(getattr(row, k) != v for k, v in rec.items()):
                for k, v in rec.items():
                    setattr(row, k, v)
                updated += 1
    return {"read": read, "inserted": inserted, "updated": updated, "unchanged": len(records) - inserted - updated,
            "rejected": len(rejected), "rejections": rejected}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--csv", default=str(DEFAULT_CSV))
    args = ap.parse_args()
    url = database_url()
    require_target_confirmation(url, "the catalogue import")
    print("target:", describe_target(url))
    out = import_catalogue(get_engine(url), args.csv)
    print({k: v for k, v in out.items() if k != "rejections"})
    for r in out["rejections"][:20]:
        print("rejected:", r)


if __name__ == "__main__":
    main()
