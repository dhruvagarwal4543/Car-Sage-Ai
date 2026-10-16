# family_group audit (rules NOT changed)

Evidence: `family_group_audit.csv` (all 221 groups: rows, models, min/max price). `family_group` = make + first word of the model name (brand prefix stripped). 35 groups merge more than one model; 186 hold one.

## Over-merges (distinct products in one group) — conservative for leakage, pessimistic for scores
| Group | Models merged | Rows | Price max/min | Comment |
|---|---|---|---|---|
| Land Rover\|range | Range Rover, Evoque, Evoque Convertible, Sport, Velar | 27 | 7.4 | Five different vehicles; largest spread of any group |
| Hyundai\|grand | Grand I10, Grand I10 Nios, Grand I10 Prime | 22 | 1.7 | Different generations/body styles under one name (the case you asked about) |
| Tata\|nexon | Nexon, Nexon Ev | 27 | 2.3 | Petrol/diesel vs electric powertrain |
| Toyota\|land | Land Cruiser, Land Cruiser Prado | 2 | 1.5 | Distinct vehicles |
| Mercedes-Benz\|e-class / c-class / s-class | base + Cabriolet / All Terrain | 4–10 | 1.9–2.6 | Same family, different body styles |
| Lexus\|lx, Fiat\|abarth, Mini\|cooper | LX 450D/570, Abarth Avventura/Punto, Cooper 3/5 Door | 2–3 | ~1.0–1.2 | First word is generic |
Effect: merged groups are held out together, so scores for these families are harder (safe direction). Largest groups by rows: Land Rover\|range 27, Tata\|nexon 27, Jeep\|compass 23, Mahindra\|kuv100 22, Hyundai\|grand 22 — a single group of 27 rows is 2% of the data, so no group dominates a fold.

## Under-merges (same family in different groups) — possible residual leakage
Found by reading the 263 model names (a token-overlap script was too noisy to use):
- Datsun: `Go` / `Go+` (Redi-Go is a separate car)
- Fiat: `Abarth Punto` / `Punto Evo` (family `punto`), `Abarth Avventura` / `Avventura`
- Hyundai: `Elite I20` / `I20 Active`
- Mahindra: `E Verito` / `Verito` / `Verito Vibe`
- Toyota: `Platinum Etios` / `Etios Cross` / `Etios Liva`
- Mini: `Cooper 3 Door` / `John Cooper Works`
- Mercedes `A-Class` vs `Cla-Class`, Tata `Tigor` vs `Tigor Ev` are correctly handled / separate by design.
About 8 pairs, a few dozen rows at most; I have not measured their exact size. Any one split could still leak those pairs. Not changed, per instruction; if you want them merged, add an alias map in `preprocess.py`.
