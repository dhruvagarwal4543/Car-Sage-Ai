# Data Audit — `cars_ds_final.csv` (pre-modelling)

Scope: new-car variant specs, target `Ex-Showroom_Price`. Evidence comes from `notebooks/01_indian_cars_eda.ipynb`, ad-hoc checks on the raw CSV, and `python3 src/preprocess.py` (outputs in `data/processed/`). Raw CSVs were only read. No model has been trained.

## 1. Target
- `Ex-Showroom_Price` is present in 1,276/1,276 rows and every value matches `Rs. <digits with commas>`; parsed to `price_inr` (INR) with no failures.
- Range Rs 2.36 lakh – Rs 21.2 crore, skew 8.79 (1.24 after log10). Plan to model log(price).
- *Assumption:* prices are new-car list prices at an unknown date (no date column).

## 2. Duplicates and leakage risk
| Check | Result |
|---|---|
| Exact duplicate rows (ignoring index col) | 9 (no conflicting prices) — flagged, not removed |
| Distinct Make+Model+Variant | 1,267 for 1,276 rows |
| Rows sharing model + displacement + fuel + transmission + power with another row | 988 of 1,276 (77%) |
| Price spread inside those near-identical groups (max/min) | median 1.14, 90th percentile 1.36 |
| Random 80/20 split: test rows whose model also appears in train | 92.9% |

**Conclusion:** a random row split would put near-copies of the same car (same engine, price within ~14% typically) in both train and test, which inflates scores. **Rule (superseded by `reports/modelling_readiness.md`):** split by `family_group`, not row. `model_group` (263 exact models) was found too narrow because sibling models such as Nexon / Nexon Ev would straddle partitions. Exact duplicates should be dropped from training *at modelling time* using `is_exact_duplicate` (traceable via `duplicate_of_source_row`).

## 3. Missing values (of the proposed features, after cleaning)
Coverage ≥95%: price, power, torque, length, width, height, seating, doors, displacement, wheelbase, fuel tank, cylinders. 70–95%: ARAI mileage (91%), gears (92%), airbags count (89%), boot space (80%), ground clearance (77%), kerb weight (71%), turning radius (70%). Gross vehicle weight 52%.
Electric/hybrid rows have legitimately blank displacement/cylinders/gears — *assumption:* missing here is structural, not random. Not imputed; the modelling step must choose an imputer and fit it on training folds only.

## 4. Suspicious values and units (all written to `data/processed/qc_log.csv` with the original text)
| Column | Finding | Action |
|---|---|---|
| Length/Width/Height | `4.64 mm`, `1.845 mm` (metres labelled mm), 3 rows | NaN |
| ARAI mileage | `142 km/litre` (x4, Mercedes E-Class), `1449` (C-Class) | NaN |
| Min. turning radius | `6750 meter` (Winger) | NaN |
| Displacement | `72 cc` on an electric car (x3) | NaN |
| Gross vehicle weight | lower than kerb weight in 14 rows (+1 out of range) | NaN |
| Power | `1600Nm@…` (Bugatti Chiron Sport, torque entered as power); 2 values with no unit | NaN |
| Torque | `1479bhp…`, `320hp…` (power entered as torque), 2 with no unit | NaN |
| Power units | PS 1,095 rows, bhp 150, hp 27, kW 1 | converted to PS (bhp/hp x1.0139, kW x1.3596) |
| Torque units | Nm 1,266, kgm 4 | converted to Nm (kgm x9.80665) |
| City/ARAI mileage | decimal commas (`22,95`) | parsed as decimals |
| Make/Model | `Land Rover Rover`+`Range Evoque` and `Maruti Suzuki R`+`Wagon` were split at the wrong space (41 rows) | repaired to `Land Rover`/`Range Rover Evoque`, `Maruti Suzuki`/`Wagon R` |
| Make | blank in 75 rows (Mercedes-Benz 57, Rolls-Royce 9, Datsun 9) but stated in Model/Variant | filled only from that text, logged |
| Power/torque, no unit | e.g. `563@5000rpm` | NaN (units not guessed) |
Kept as real: Rs 21 crore Bugatti, 16-seat Winger, 216 cc Bajaj Qute, 1,479 bhp Chiron — extreme but consistent.
Plausibility ranges live in `NUMERIC` / `INT_COLS` in `src/preprocess.py` and are my choices, not from the data: please review.

## 5. Feature-selection proposal
**Use (coverage + consistent units):** make, model_group (for splitting only, not as a feature unless target-encoded within folds), power_ps, torque_nm, displacement, length, width, height, wheelbase, fuel tank, kerb weight, ground clearance, boot space, ARAI mileage, cylinders, gears, seats, doors, airbag count, Fuel_Type, Body_Type, Type (transmission), Drivetrain, Cylinder_Configuration, Emission_Norm.
**Do not use / defer:**
- `Variant` text (unique-ish, but contains trim words such as "Zxi"; consider later, risk of leakage) and `Unnamed: 0` (row index).
- 43 columns >50% empty (Battery, Electric_Range, Apple_CarPlay, Heads-Up_Display…).
- Equipment columns (ABS, Bluetooth, Cruise_Control…) are mostly `Yes`/blank; blank may mean "not offered" or "not recorded" — unverified, so deferred. Cruise control (43% filled) and ESP (39%) show how patchy this is.
- `Valves_Per_Cylinder` (inconsistent: Micra 12, Chiron 4), `Fuel_System` (99% one value), `City/Highway_Mileage` (>43% missing), tyre fields (free text, mixed formats), `Odometer` (display type, not km driven).
**Preprocessing for modelling (next step, not done):** log-transform target; impute and one-hot encode inside the CV pipeline; keep Power/Displacement-style collinearity in mind (Spearman with price 0.88–0.93).

## 6. Files created
- `src/preprocess.py` — reproducible pipeline: `python3 src/preprocess.py`
- `data/processed/cars_processed.csv` — 1,276 rows x 34 columns, `source_row` = raw `Unnamed: 0`
- `data/processed/qc_log.csv` — 173 logged actions (34 blanked values, 75 Make fills, 41 Make/Model repairs, 23 first-number-of-several) (original text, action, reason)
- `data/processed/transformations.json` — counts and missing-after summary
- `tests/test_preprocess.py` — 10 tests (`python3 -m pytest tests`), all pass
- this report; `requirements.txt` gained `pytest`

## 7. Limitations
- It is one snapshot of a catalogue, not market data: no date, region, discounts or on-road price.
- Many near-identical variants mean the effective sample size is closer to the number of models than 1,276.
- Plausibility thresholds are judgement calls; EV/hybrid handling rests on a few rows (14 EV, 15 hybrid).
- I checked values via counts and samples, not every row by hand; further errors in unreviewed columns are possible.
