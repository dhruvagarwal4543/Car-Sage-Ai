import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import preprocess as pp  # noqa: E402

BASE = {"Unnamed: 0": 0, "Make": "Tata", "Model": "Nexon", "Variant": "XE", "Ex-Showroom_Price": "Rs. 7,50,000",
        "Displacement": "1199 cc", "Length": "3993 mm", "Width": "1811 mm", "Height": "1606 mm", "Wheelbase": "2498 mm",
        "Ground_Clearance": "209 mm", "Kerb_Weight": "1200 kg", "Gross_Vehicle_Weight": "1700 kg",
        "Fuel_Tank_Capacity": "44 litres", "Boot_Space": "350 litres", "Minimum_Turning_Radius": "5.1 meter",
        "ARAI_Certified_Mileage": "17,57 km/litre", "Power": "120PS@5500rpm", "Torque": "170Nm@1500rpm",
        "Cylinders": 3.0, "Seating_Capacity": 5.0, "Number_of_Airbags": 2.0, "Doors": 5.0, "Gears": "6",
        "Fuel_Type": "Petrol", "Body_Type": "SUV", "Type": "Manual", "Drivetrain": "FWD (Front Wheel Drive)",
        "Cylinder_Configuration": "In-line", "Emission_Norm": "BS VI"}


def run(*rows):
    raw = pd.DataFrame([{**BASE, "Unnamed: 0": i, **r} for i, r in enumerate(rows)])
    return pp.preprocess(raw)


def test_price_and_comma_formats():
    out, _ = run({})
    assert out.price_inr[0] == 750000
    assert out.ARAI_Certified_Mileage[0] == 17.57          # decimal comma, not thousands
    assert out.Emission_Norm[0] == "BS6" and out.Drivetrain[0] == "FWD"


def test_rows_never_dropped_and_traceable():
    out, _ = run({}, {"Length": "4.64 mm"}, {"Make": None, "Model": "Mercedes-Benz B-Class"})
    assert len(out) == 3 and list(out.source_row) == [0, 1, 2]


def test_unit_error_blanked_and_logged_with_raw_text():
    out, log = run({"Length": "4.64 mm"}, {"Minimum_Turning_Radius": "6750 meter"})
    assert np.isnan(out.Length[0]) and np.isnan(out.Minimum_Turning_Radius[1])
    assert "4.64 mm" in set(log.original) and set(log.action) == {"set_NaN"}


def test_power_converted_to_ps_and_torque_to_nm():
    out, _ = run({"Power": "100bhp@4000rpm"}, {"Power": "100kW@4000rpm"}, {"Torque": "10kgm@2000rpm"})
    assert out.power_ps[0] == pytest.approx(101.39) and out.power_ps[1] == pytest.approx(135.96)
    assert out.torque_nm[2] == pytest.approx(98.0665)


def test_power_with_wrong_unit_is_blanked_not_guessed():
    out, log = run({"Power": "1600Nm@2000-6000rpm"}, {"Torque": "1479bhp@6700rpm"})
    assert np.isnan(out.power_ps[0]) and np.isnan(out.torque_nm[1]) and len(log) == 2


def test_gvw_below_kerb_blanked():
    out, _ = run({"Gross_Vehicle_Weight": "1000 kg"})
    assert out.Kerb_Weight[0] == 1200 and np.isnan(out.Gross_Vehicle_Weight[0])


def test_electric_displacement_blanked():
    out, _ = run({"Fuel_Type": "Electric", "Displacement": "72 cc"})
    assert np.isnan(out.Displacement[0])


def test_make_filled_only_when_stated():
    out, log = run({"Make": None, "Model": "Mercedes-Benz B-Class"}, {"Make": None, "Model": "Mystery"})
    assert out.make[0] == "Mercedes-Benz" and pd.isna(out.make[1]) and (log.action == "filled").sum() == 1


def test_exact_duplicates_flagged_not_removed():
    out, _ = run({}, {})
    assert len(out) == 2 and list(out.is_exact_duplicate) == [False, True] and out.duplicate_of_source_row[1] == 0
    assert list(out.near_duplicate_group_size) == [2, 2]


def test_real_data_invariants():
    if not pp.RAW.exists():
        pytest.skip("raw data not present")
    raw = pd.read_csv(pp.RAW); out, _ = pp.preprocess(raw)
    assert len(out) == len(raw) and out.price_inr.notna().all() and out.source_row.is_unique


def test_make_model_repair_is_logged_and_unifies_groups():
    out, log = run({"Make": "Maruti Suzuki R", "Model": "Wagon"}, {"Make": "Land Rover Rover", "Model": "Range Evoque"})
    assert list(out.model) == ["Wagon R", "Range Rover Evoque"] and list(out.make) == ["Maruti Suzuki", "Land Rover"]
    assert (log.action == "repaired").sum() == 2


def test_range_text_logs_first_number_used():
    out, log = run({"Kerb_Weight": "1016-1043 kg"})
    assert out.Kerb_Weight[0] == 1016 and "first_number_used" in set(log.action)


def test_family_group_merges_siblings_not_brands():
    out, _ = run({"Model": "Nexon"}, {"Model": "Nexon Ev"}, {"Model": "Tiago"},
                 {"Make": None, "Model": "Mercedes-Benz E-Class"}, {"Make": None, "Model": "Mercedes-Benz E-Class Cabriolet"},
                 {"Make": None, "Model": "Mercedes-Benz C-Class"})
    g = list(out.family_group)
    assert g[0] == g[1] != g[2] and g[3] == g[4] != g[5]
