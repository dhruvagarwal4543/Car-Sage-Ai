# CarSage AI: Final Project Audit

Audit date: 2026-11-18. Branch `main`, HEAD `c819431`, working tree had uncommitted documentation and the changes listed below. Nothing was committed, pushed, deployed or deleted. Secrets were not read.

## 1. Verdict
The AI core (rules, CSP, uniform-cost relaxation, utility ranking, traces) and the two-provider live comparison work as described, and every automated and real-Chrome check run today passed. No P0 defect was found. The open items are about evidence and polish (user study, current catalogue, mobile check, Firebase end to end), not about broken features.

## 2. What was run (2026-11-18)
| Check | Result | Notes |
|---|---|---|
| Python tests (`.venv/bin/python -m pytest -q`) | **Passed**: 277 passed, 5 skipped | The 5 skipped are opt-in live-database tests |
| Frontend `tsc --noEmit` | **Passed** (no output) | |
| Frontend `vitest run` | **Passed**: 41/41 | |
| Extension `vitest run` | **Passed**: 64/64 | `npm test` in `extension/` fails (see F4); run with `../frontend/node_modules/.bin/vitest run` |
| Recommender evaluation (`src/evaluate_recommender.py`) | **Passed**, same results as before | Only latency figures changed in `reports/evaluation/recommender.{json,md}` |
| Real Chrome, website (`site.mjs`) | **Passed**: 29/29 | Genuine browser, live API |
| Real Chrome, popup (`popup.mjs`) | **Passed**: 46/46 after the CORS fix | 4/7 and "Offline" when the extension origin was not in `CORS_ORIGINS` (F1) |
| Real Chrome, live journey (`live-journey.mjs`) | **Passed**: 9/9 | Real CarDekho and CarWale pages |
| Real Chrome, price history (`history.mjs`) | **Passed**: 10/10 | Throwaway SQLite DB, synthetic rows (not real prices) |
| Seven live comparison cases | **Run**, see section 4 | Direct call to `carsage.prices.compare`, not a browser test |
| ML experiment (`src/experiment.py`) | **Not re-run**; figures checked against `reports/experiment/results.md` | |
| Authentication with real credentials | **Could not be run** | No credentials configured |
| Mobile layout | **Partly checked** | Headless 390 px screenshots only; no overflow measurement (F5) |

## 3. Findings
| ID | Sev. | Finding | Evidence | Status |
|---|---|---|---|---|
| F1 | P1 | The extension popup shows **Offline** unless the API's `CORS_ORIGINS` contains the extension's origin. The first demo script I wrote omitted this, so a demo started from it would have looked broken. | `popup.mjs` 4/7 without it, 46/46 with it; `extension/README.md` lines 7, 100 | Fixed in the demo script (exact command and troubleshooting). Code unchanged: behaviour is intended, no wildcard |
| F2 | P1 | `carsage/agent.py` described the relaxation space as "<= 2^6 states"; the code has five relaxable constraints, so 2^5 = 32. | `carsage/agent.py:13`, `carsage/csp.py` (relax_cost on five constraints) | **Fixed** (comment) |
| F3 | P1 | README "How recommendations work" still described the old fixed-order relaxation. | `README.md:108` | **Fixed** (uniform-cost, costs, strict mode, never-relaxed constraints) |
| F4 | P2 | `npm test` in `extension/` fails on a fresh checkout: `extension/node_modules` has no installed packages, so `npx vitest` tries to download one and cannot resolve `vite`. | Startup error `ERR_MODULE_NOT_FOUND` | Documented workaround (README already lists the frontend vitest binary); not changed |
| F5 | P2 | Mobile responsiveness was not verified. 390 px headless screenshots were captured mid-animation; the Advisor chip row and notice line appear clipped at the right edge, but this could not be confirmed as overflow. `/explore` returns "Page not found" (the route has a different path; the e2e script finds it). | `scratchpad` screenshots, not kept | **Open**: check on a real phone width before the demo |
| F6 | P2 | The catalogue is an undated snapshot: 1,276 rows, 879 BS4, 377 BS6, 9 BS3, 11 unknown. Old generations appear in recommendations (flagged `historical`). The dataset licence is unverified (README says so). | `data/processed/cars_processed.csv` counts verified today; `README.md:145` | **Open by design**: no current licensed data exists; freshness warnings kept |
| F7 | P2 | Source data inconsistency: a Renault Duster row is named "110 Ps Rxs Mt Diesel" but its transmission field says Automatic. It can appear in a top-5 list. | `trace_assistant_example.json` | Open; flagged in the report |
| F8 | P2 | In today's live cases the two providers returned **identical** ex-showroom prices for every comparable vehicle, so the "which source is lower" outcome was not observed. When prices are equal the response's `lowest_comparable.provider` names CarDekho while `tied_lowest_providers` lists both; the extension phrases it "Same price on …". | `docs/final_submission/live_case_tests.json`, `extension/src/core.js` liveSummary | No change needed; stated in the report |
| F9 | P2 | Firebase token verification is unit-tested but untested against the live service. | no credentials | Open; stated in the report |
| F10 | P2 | No user study and no relevance labels, so no ranking accuracy can be claimed. | `reports/evaluation/recommender.md` | Open; stated |
| F11 | P3 | ACKO Drive is not supported (HTTP 403, reported unavailable, not bypassed). Only CarDekho and CarWale are implemented. Provider terms for automated reading are unverified. | `carsage/providers.py:288`, `extension/README.md:67` | By design |
| F12 | P3 | Scheduler state is process-local; the SSRF check resolves DNS twice (documented shortcut). | `carsage/scheduler.py`, `carsage/prices.py` default_http | Known, documented in code |

## 4. Cross-website comparison status
Providers: CarDekho and CarWale only. Seven vehicles, Delhi, 2026-11-18, `carsage.prices.compare` against live pages (log in `live_case_tests.json`):

| Case | Result |
|---|---|
| Hatchback: Maruti Swift VXi Petrol Manual | Exact on both, ex-showroom Delhi ₹6,67,900 each; CarWale also gave on-road ₹7,62,756 in a separate group |
| Sedan: Honda City V Petrol Automatic (CVT) | Exact on both, ₹14,50,700 each |
| SUV diesel: Hyundai Creta E Diesel Manual | Exact on both, ₹12,61,000 each |
| Electric: Tata Tiago EV Smart 19.2 kWh | CarWale only (ex-showroom ₹6,99,000, on-road ₹7,42,039); 2 CarDekho entries ambiguous; no cheapest claim |
| Automatic: Maruti Dzire VXi Petrol AMT | Exact on both, ₹7,72,100 each |
| Diesel SUV: Kia Seltos HTE Diesel Manual | Exact on both, ₹12,93,900 each |
| Ambiguous: Mahindra Thar "LXT", no fuel or gearbox | 21 ambiguous, nothing compared, CarDekho model-level range only |

Matching rules checked in code and tests: fuel and gearbox contradictions are mismatches; CVT and IVT are different; a different battery size, generation or engine is not exact; ambiguous matches are left out of the comparison and counted; only one price basis is ever compared; model-level prices are shown only as references. No matching change was made: for Tiago EV the evidence does not support merging "Smart 19" with "Smart 19.2 kWh", and for Thar the ambiguity is genuine.

Real-browser evidence: `live-journey.mjs` 9/9 (real CarDekho variant page and CarWale trim page, same variant found at both, same price, one basis); `popup.mjs` includes a live panel on a CarDekho variant page. Used-car pages fetch nothing by design.

## 5. AI validation
The advisor's agent type, PEAS, rules, CSP, uniform-cost search, utility ranking, traces and rule-based language reading match the code and are covered by tests (277 Python tests, including `tests/test_agent.py`). Evaluation (16 scenarios, 7 systems): agent_full hard-constraint satisfaction 1.0, coverage 1.0, explanation consistency 1.0; constraint_only coverage 0.812; no_rules 0.984. No LLM is used and none was added. Variant matching is rule-based, not a trained model, and the report says so.

## 6. Data and ML figures (checked)
1,276 variants, 879 BS4: confirmed from the processed CSV. Ridge test MAE ₹1,300,000 (config A) versus dummy ₹3,316,366, from `reports/experiment/results.md` (not re-run). MAE is large because a few luxury cars dominate; median error about ₹1.2 lakh.

## 7. Files changed by this audit
- `carsage/agent.py` (comment only, 2^6 to 2^5 = 32)
- `README.md` (relaxation paragraph)
- `reports/evaluation/recommender.json`, `recommender.md` (regenerated by the evaluation re-run; latency numbers only; they were already modified before this audit)
- `docs/final_submission/` (new): `FINAL_PROJECT_AUDIT.md`, `live_case_tests.json`; regenerated report DOCX/PDF, presentation, viva PDF; updated demo script
