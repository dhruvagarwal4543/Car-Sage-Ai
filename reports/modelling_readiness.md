# Modelling-Readiness Review (no models trained)

Reviewed: `src/preprocess.py`, `tests/test_preprocess.py`, `reports/data_audit.md`; checks run on `cars_ds_final.csv` and `data/processed/`. **No model has been trained, so there are no performance numbers.**

## 1. Issues found and what was done
| # | Issue (evidence) | Fix |
|---|---|---|
| 1 | `model_group` (exact `make|model`) is too narrow: 33 sibling families straddle groups (Nexon / Nexon Ev, Alto / Alto 800, Etios Liva / Cross, E-Class / E-Class Cabriolet). A group split on it would still leak near-twins. | Added `family_group` = make + first word of model (brand prefix stripped): 263 → 221 groups. **Splits use `family_group`.** Done + tested. |
| 2 | Raw `Make` had split artefacts: `Land Rover Rover` + `Range Evoque`, `Maruti Suzuki R` + `Wagon` (41 rows). They made one real model appear under two makes. | Repaired to `Land Rover`/`Range Rover …`, `Maruti Suzuki`/`Wagon R`; each row logged (`action=repaired`). Done + tested. |
| 3 | `source_row` (raw row order) has Spearman 0.40 with price: row order carries target information. | Listed in `NEVER_FEATURES`; `feature_config` asserts none are used; test added. |
| 4 | Numeric text with several numbers used the first one silently: `1016-1043 kg`, `22.4-21.9 km/litre`, Ertiga boot space `209(All3RowsUp).550…` (23 rows). | Now logged (`first_number_used`), values unchanged. Lower bound is an arbitrary choice; impact is small (23 values). |
| 5 | Residual leakage: even with `family_group`, 342 rows have a same-make, same-engine/power, other-family twin priced within 10% (393 with `model_group`). Cannot be removed without dropping whole makes. | Not fixable cheaply. Report as a limitation; run a leave-make-out sensitivity check at evaluation time. |
| 6 | Test split is lopsided by chance: held-out groups contain no Bugatti (max Rs 5.3 cr vs Rs 21.2 cr in dev) and one make (Bajaj) unseen in dev. | Use `handle_unknown="ignore"`; report errors by price band, and do not read the test score as covering supercars. |

## 2. Verified
- **Group integrity:** 221 family groups; dev = 985 rows/176 groups, test = 291 rows/45 groups (seed 42, `GroupShuffleSplit`). `check_partitions` asserts no group is in two partitions; tests run it on the real data for the test split and every CV fold.
- **Duplicates:** all 9 exact duplicates share their original's `family_group` (tested), so they cannot cross partitions; `check_partitions` also checks `duplicate_of_source_row` independently of groups. Within a training set, drop `is_exact_duplicate` rows.
- **Flagged values / conversions / Make recovery:** 173 entries in `qc_log.csv` (34 blanked, 75 Make fills, 41 repairs, 23 first-number). Every row has `source_row`, original text, action and reason. All 75 Make fills were inspected: Mercedes-Benz 57, Rolls-Royce 9, Datsun 9 (all stated in the text). Power/torque conversions use fixed factors (bhp/hp x1.0139, kW x1.3596, kgm x9.80665); values with no unit are blanked, not guessed. Unintended-correction risks remaining: the plausibility ranges (my judgement) and first-number-of-several.
- **Target leakage:** `price_inr` is the only price column; `variant` contains no 5+-digit numbers; no derived column uses price. `NEVER_FEATURES` = target, `source_row`, duplicate fields, `near_duplicate_group_size`, group columns and `model`.

## 3. Feature configurations (`src/modeling_setup.py: feature_config`)
- **A (no Variant):** 17 numeric (power_ps, torque_nm, displacement, dimensions, tank, weights, boot, mileage, cylinders, gears, seats, doors, airbags) + 7 categorical (make, fuel, body, transmission, drivetrain, cylinder config, emission norm).
- **B (with Variant):** A + `variant` text. Preprocessing inside each fold only: lowercase, `TfidfVectorizer(ngram_range=(1,2), min_df=3)` fit on training rows. Caution: 121 variant strings repeat across models (e.g. "Lxi"), so tokens are trim-level hints, not identifiers; with group splits this is a fair test. For the tree model use TruncatedSVD(~30) of the TF-IDF, or run B with Ridge only.

## 4. Splits
1. Held-out test: `split_dev_test(df)` — 20% of `family_group`s, seed 42; touched **once**, after all choices are made.
2. Dev CV: `cv_folds(dev)` — `GroupKFold(5)` on `family_group` (deterministic). Imputers, scalers, encoders, TF-IDF all live in the sklearn `Pipeline`, so nothing is fit on validation rows.
3. Sensitivity (optional): leave-one-make-out on the largest makes to measure how much issue #5 inflates scores.

## 5. Proposed pipeline (not implemented)
Target: `TransformedTargetRegressor(func=np.log1p, inverse_func=np.expm1)` so the model fits log1p(price) and predictions come back in rupees.
| Model | Preprocessing | Role |
|---|---|---|
| `DummyRegressor(strategy="median")` | none | floor; any model must beat it |
| `Ridge` | median impute + missing-indicator, StandardScaler, OneHot(`handle_unknown="ignore"`); tune `alpha` on the CV folds | linear, interpretable |
| `HistGradientBoostingRegressor` | OneHot categoricals; native NaN support; tune depth/learning rate/iterations with early stopping inside folds | non-linear |
Metrics on the **rupee scale** (after expm1): MAE, median AE, RMSE, and MAPE; also RMSLE and R² on log scale for comparison; plus MAE by price band (<10 lakh, 10–30 lakh, 30 lakh–1 cr, >1 cr). Compare mean ± std across CV folds, then report the single held-out test result for the chosen config only.

## 6. Tests added
`tests/test_modeling_setup.py` (forbidden-feature rejection; target/identifier absent from both configs; reproducible test split; no group overlap between train/valid/test across all folds; every dev row validated once; exact duplicates stay with their original; `check_partitions` catches planted leaks) and three new cases in `tests/test_preprocess.py` (Make/Model repair, range logging, sibling grouping). 19 tests pass.

## 7. Limitations
- Scores will still be optimistic because of issue #5 and because variants of one family are near-copies.
- ~221 effective independent groups: expect noisy CV; do not over-tune.
- Rupee-scale metrics are dominated by the few supercars; read the price-band breakdown.
- No date: the price level is a single unknown snapshot.
