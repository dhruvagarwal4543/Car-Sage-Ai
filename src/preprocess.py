"""Build a processed, traceable dataset from the raw CarSage CSV.

Run:  python3 src/preprocess.py
Rules: no rows are dropped; the raw file is only read; every value that is blanked
or changed is written to data/processed/qc_log.csv (row, column, original, action, reason).
Nothing is imputed: suspect values become NaN, never guessed.
"""
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/archive/cars_ds_final.csv"
OUT = ROOT / "data/processed"

# column -> (expected unit regex, plausible min, max, decimal_comma)
NUMERIC = {
    "Displacement": (r"cc", 100, 8500, False),
    "Length": (r"mm", 2500, 6500, False), "Width": (r"mm", 1300, 2300, False),
    "Height": (r"mm", 1000, 2800, False), "Wheelbase": (r"mm", 1800, 4000, False),
    "Ground_Clearance": (r"mm", 100, 500, False),
    "Kerb_Weight": (r"kg", 500, 4000, False), "Gross_Vehicle_Weight": (r"kg", 500, 7000, False),
    "Fuel_Tank_Capacity": (r"litres", 10, 200, False), "Boot_Space": (r"litres", 10, 2500, False),
    "Minimum_Turning_Radius": (r"meter", 3, 15, False),
    "ARAI_Certified_Mileage": (r"km/litre", 3, 40, True),
}
INT_COLS = {"Cylinders": (1, 16), "Seating_Capacity": (2, 16), "Number_of_Airbags": (0, 14), "Doors": (2, 5)}
MAKE_REPAIR = {   # raw Make -> (make, fn(raw Model) -> model); evidence: audit of Make/Model pairs
    "Land Rover Rover": ("Land Rover", lambda m: m.split(" ", 1)[0] + " Rover" + (" " + m.split(" ", 1)[1] if " " in m else "")),
    "Maruti Suzuki R": ("Maruti Suzuki", lambda m: m + " R"),
}
EXTRA_MAKES = ["Mercedes-Benz", "Rolls-Royce"]   # brands that appear only inside Model when Make is blank (audit evidence)
CATEGORICAL = ["Fuel_Type", "Body_Type", "Type", "Drivetrain", "Cylinder_Configuration", "Emission_Norm"]
NUM_RE = r"(\d+\.?\d*)"


def to_number(s, decimal_comma=False):
    """First number in a text value ('Rs. 5,06,000' -> 506000.0). Commas are thousands separators unless decimal_comma."""
    t = s.astype("string").str.replace(",", "." if decimal_comma else "", regex=False)
    return pd.to_numeric(t.str.extract(NUM_RE)[0], errors="coerce").astype(float)  # plain float64 so blanked values are NaN, not pd.NA


def _blank(out, log, mask, col, reason, orig):
    """Set out[col] to NaN where mask, logging the original raw text (orig, aligned to out) of each affected row."""
    mask = pd.Series(np.asarray(mask), index=out.index, dtype="boolean").fillna(False).astype(bool)
    for i in out.index[mask]:
        log.append({"source_row": out.at[i, "source_row"], "column": col, "original": orig.iloc[i],
                    "action": "set_NaN", "reason": reason})
    out.loc[mask, col] = np.nan


def preprocess(raw):
    """raw: DataFrame as read from the CSV. Returns (processed, qc_log DataFrame). Row count is preserved."""
    log = []
    out = pd.DataFrame({"source_row": raw["Unnamed: 0"].values})          # id from the raw file's own index column
    out["variant"] = raw["Variant"].values
    model, make = raw["Model"].copy(), raw["Make"].copy()
    for i in raw.index:                          # the source split "Wagon R" / "Range Rover ..." at the wrong space
        fix = MAKE_REPAIR.get(raw.at[i, "Make"])
        if fix:
            make[i], model[i] = fix[0], fix[1](raw.at[i, "Model"])
            log.append({"source_row": raw.at[i, "Unnamed: 0"], "column": "make/model", "original": f"{raw.at[i, 'Make']} | {raw.at[i, 'Model']}",
                        "action": "repaired", "reason": f"make/model split at wrong space -> {make[i]} | {model[i]}"})
    out["model"] = model.values

    # make: fill blanks only when the brand is stated in Model or Variant (no guessing)
    makes = {m.lower(): m for m in [*make.dropna().unique(), *EXTRA_MAKES]}
    for i in raw.index[raw["Make"].isna()]:
        for text in (raw.at[i, "Model"], raw.at[i, "Variant"]):
            hit = next((orig for low, orig in makes.items() if str(text).lower().startswith(low)), None)
            if hit:
                make[i] = hit; log.append({"source_row": raw.at[i, "Unnamed: 0"], "column": "make", "original": np.nan,
                                           "action": "filled", "reason": f"brand '{hit}' stated in Model/Variant"}); break
    out["make"] = make.values

    # target
    out["price_inr"] = to_number(raw["Ex-Showroom_Price"]).values
    assert out["price_inr"].notna().all(), "target price must parse for every row"

    # numeric text columns: unit must match, value must be plausible, else NaN + logged
    for c, (unit, lo, hi, dec) in NUMERIC.items():
        txt = raw[c]; out[c] = to_number(txt, dec).values; out[c + "_raw"] = txt.values
        multi = txt.astype("string").str.replace(",", "." if dec else "", regex=False).str.count(NUM_RE).gt(1).fillna(False)      # e.g. '1016-1043 kg': first number used
        for i in out.index[multi]:
            log.append({"source_row": out.at[i, "source_row"], "column": c, "original": txt.iloc[i], "action": "first_number_used",
                        "reason": "text holds several numbers (range or per-configuration values)"})
        _blank(out, log, txt.notna() & ~txt.astype("string").str.contains(unit, case=False, na=False), c, f"unit not '{unit}'", txt)
        _blank(out, log, (out[c] < lo) | (out[c] > hi), c, f"outside plausible range {lo}-{hi}", txt)
    out["Displacement_raw"] = raw["Displacement"].values
    _blank(out, log, raw["Fuel_Type"].eq("Electric").values & out["Displacement"].notna(), "Displacement", "electric car cannot have engine displacement", raw["Displacement"])
    _blank(out, log, out["Gross_Vehicle_Weight"] < out["Kerb_Weight"], "Gross_Vehicle_Weight", "GVW lower than kerb weight", raw["Gross_Vehicle_Weight"])
    out = out.drop(columns=[c for c in out if c.endswith("_raw")])      # raw text is kept in the raw CSV, joinable by source_row

    # power -> PS, torque -> Nm (unit conversion; ambiguous/missing units are blanked)
    ptxt = raw["Power"].astype("string")
    unit = ptxt.str.extract(r"(?i)\d\s*(ps|bhp|hp|kw)\b")[0].str.lower()
    out["power_ps"] = (to_number(ptxt) * unit.map({"ps": 1, "bhp": 1.0139, "hp": 1.0139, "kw": 1.3596})).values
    _blank(out, log, unit.isna().values & ptxt.notna().values, "power_ps", "no PS/bhp/hp/kW unit (e.g. Nm value)", ptxt)
    _blank(out, log, (out["power_ps"] < 10) | (out["power_ps"] > 1700), "power_ps", "outside plausible range 10-1700 PS", ptxt)
    ttxt = raw["Torque"].astype("string")
    tu = ttxt.str.extract(r"(?i)\d\s*(nm|kgm)\b")[0].str.lower()
    out["torque_nm"] = (to_number(ttxt) * tu.map({"nm": 1, "kgm": 9.80665})).values
    _blank(out, log, tu.isna().values & ttxt.notna().values, "torque_nm", "no Nm/kgm unit", ttxt)
    _blank(out, log, (out["torque_nm"] < 8) | (out["torque_nm"] > 1800), "torque_nm", "outside plausible range 8-1800 Nm", ttxt)

    for c, (lo, hi) in INT_COLS.items():
        out[c] = pd.to_numeric(raw[c], errors="coerce").values
        _blank(out, log, (out[c] < lo) | (out[c] > hi), c, f"outside plausible range {lo}-{hi}", raw[c])
    g = raw["Gears"].astype("string")
    out["Gears"] = np.where(g.str.contains("single speed", case=False, na=False), 1, to_number(g)); out["Gears"] = out["Gears"].astype(float)

    # categoricals: normalised text, blanks stay blank
    for c in CATEGORICAL:
        out[c] = raw[c].values
    out["Drivetrain"] = raw["Drivetrain"].str.extract(r"^(\w+)")[0].values
    bs = {"BS III": "BS3", "BS IV": "BS4", "BS 6": "BS6", "BS VI": "BS6"}
    out["Emission_Norm"] = raw["Emission_Norm"].map(bs).values

    # leakage / traceability helpers (rows are flagged, never removed)
    out["model_group"] = (out["make"].fillna("") + "|" + out["model"]).values       # exact model identity
    # family_group merges sibling models (Nexon / Nexon Ev, Alto / Alto 800); SPLIT TRAIN/TEST ON THIS, never on rows
    stem = [m[len(k):].strip() if m.lower().startswith(str(k).lower()) else m for m, k in zip(out["model"], out["make"])]
    out["family_group"] = [f"{k}|{t.split()[0].lower()}" for k, t in zip(out["make"], stem)]
    cols = [c for c in raw if c != "Unnamed: 0"]
    out["is_exact_duplicate"] = raw.duplicated(subset=cols, keep="first").values       # later copy of an identical raw row
    first = raw.drop_duplicates(subset=cols, keep="first")
    first_id = raw.merge(first.assign(_f=first["Unnamed: 0"]), on=cols, how="left")["_f"]
    out["duplicate_of_source_row"] = np.where(out["is_exact_duplicate"], first_id.values, np.nan)
    # near-identical: same model/engine/fuel/transmission/power as another row
    key = raw[["Model", "Displacement", "Fuel_Type", "Type", "Power"]].astype(str).agg("|".join, axis=1)
    out["near_duplicate_group_size"] = key.map(key.value_counts()).values
    return out, pd.DataFrame(log, columns=["source_row", "column", "original", "action", "reason"])


def main():
    raw = pd.read_csv(RAW)
    out, log = preprocess(raw)
    assert len(out) == len(raw), "rows must never be dropped"
    OUT.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUT / "cars_processed.csv", index=False); log.to_csv(OUT / "qc_log.csv", index=False)
    summary = {"input_rows": len(raw), "output_rows": len(out), "source": str(RAW.relative_to(ROOT)),
               "exact_duplicate_rows_flagged": int(out.is_exact_duplicate.sum()),
               "rows_in_near_duplicate_groups": int((out.near_duplicate_group_size > 1).sum()),
               "qc_actions_by_column": log.groupby(["column", "action"]).size().rename("n").reset_index().to_dict("records"),
               "dropped_columns": "all other raw columns (see reports/data_audit.md)", "missing_after": out.isna().sum()[lambda s: s > 0].to_dict()}
    (OUT / "transformations.json").write_text(json.dumps(summary, indent=1, default=str))
    print(json.dumps({k: v for k, v in summary.items() if k != "qc_actions_by_column"}, indent=1, default=str)); print(log.groupby(["column", "reason"]).size())


if __name__ == "__main__":
    main()
