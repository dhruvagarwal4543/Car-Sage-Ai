# EDA Summary — Indian Cars Dataset

Source: `notebooks/01_indian_cars_eda.ipynb`, executed with 0 errors. Everything under **Observed** comes from its printed output. Raw CSVs were not modified.

## Datasets compared
| | `cars_ds_final.csv` (analysed) | `cars_ds_final_2021.csv` |
|---|---|---|
| Rows x columns | 1,276 x 141 | 1,267 x 141 |
| Distinct Make+Model+Variant | 1,267 | 1,250 |
| Rows duplicated (ignoring index col) | 9 | 17 |

**Observed:** identical column names. All 1,250 variants in the 2021 file also appear in the newer one, with identical prices (0 differences). The newer file has 17 additional distinct variants, and fills in tyre/wheel fields (`Front_Tyre_&_Rim`, `Rear_Tyre_&_Rim`, `Wheels_Size`: ~1,200 values differ) plus 47 `Airbags` values. **Conclusion:** the newer file is an updated, more complete version of the same data (not an unrelated dataset). *Assumption:* "newer" is inferred from content, not from any date field (none exists).

## Observed results (`cars_ds_final.csv`)
- **Structure:** one row per car *variant* (spec sheet), 263 models, 39 makes (`Make` is blank for 75 rows, e.g. Rolls-Royce; the brand is inside `Model`). Only 7 of 141 columns are fully populated.
- **Types:** most columns are text with units (`Rs. 5,06,000`, `624 cc`, `23.6 km/litre`). Numbers were extracted into `*_num` columns on a copy.
- **Missing:** 43 columns >50% missing, 15 >90% missing (e.g. `Battery`, `Electric_Range`, `Apple_CarPlay`). `Highway_Mileage` 62.7% missing, `City_Mileage` ~43% missing. Price (`Ex-Showroom_Price`), `Length`, `Power` have 0 missing.
- **Duplicates:** 0 exact duplicates including the index column; 9 duplicated rows ignoring it (e.g. Mahindra XUV500 variants appear twice). Not removed.
- **Price:** median ~Rs 10.6 lakh, mean ~Rs 46 lakh, range Rs 2.36 lakh (Tata Nano GenX XE) to Rs 21.2 crore (Bugatti Chiron). Skewness 8.79 raw, 1.24 after log10 — strongly right-skewed.
- **Outliers:** 198 price outliers by 1.5×IQR; these are real luxury/supercar variants, not obvious errors. Source data-entry errors found and left unchanged: `Height`/`Width` 1.845 and `Length` 4.64 (metres labelled "mm"), `City_Mileage` 26032 (Ciaz) and 110 (E Verito), `Minimum_Turning_Radius` 6750 (Winger).
- **Categoricals:** Petrol 643, Diesel 582 (plus CNG, Hybrid, Electric, CNG+Petrol); Body type SUV 447 is the largest of 17 types; Manual 725 is the most common transmission; FWD 887 is the most common drivetrain. Maruti Suzuki is the most frequent make (149 of 1,201 rows with a Make).
- **Correlation (Spearman with price):** Power 0.93, Torque 0.90, Displacement 0.88, Kerb weight 0.87, Width/Length 0.87, Fuel tank 0.85.

## Assumptions (not verified)
- Prices are new-car ex-showroom prices as of an unknown date.
- `Power` mixes PS (1,095 rows), bhp (150), hp (27), kW (1); numbers were not converted, so cross-row comparisons are approximate.
- Strong correlations reflect that bigger/more powerful cars cost more; no causal claim.

## Limitations
- Spec catalogue of new cars, **not** used-car/marketplace listings.
- No date/snapshot column; no year of manufacture, kilometres driven, owners, city/location, seller, listing ID or images. (`Odometer` holds display type: Digital/Analog.)
- Heavy missingness in feature/equipment columns; inconsistent text formats and a few unit errors.
- Many near-identical variants per model → risk of leakage if rows are split randomly instead of by model.

## Suitability
| Use case | Verdict | Evidence |
|---|---|---|
| Price prediction | **Partial** — new-car ex-showroom price only | Price is complete (1,276/1,276); Power/Displacement/size columns are 90%+ populated and strongly rank-correlate with price. Not usable for resale value: no age, mileage or condition. |
| Car recommendation | **Good fit (content-based)** | 263 models with body type, fuel, transmission, mileage, dimensions, safety/features. Needs handling of missing features and mixed units. No user behaviour data, so no collaborative filtering. |
| Fake-listing detection | **Not supported** | No listing ID, seller, fraud label, location, date or images. Could only serve as a reference of "legitimate specs/prices" for validating listings. |

## Next steps (not started)
Decide cleaning rules (unit fixes, `Make` recovery from `Model`, de-duplication), then a baseline price model on log price. Fake-listing detection needs other data.
