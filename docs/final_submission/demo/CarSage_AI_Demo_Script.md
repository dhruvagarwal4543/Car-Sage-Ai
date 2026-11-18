# CarSage AI: Demo Script (5-7 minutes)

Audience: examiners at the project presentation. Total target: 6 minutes plus questions.

## Before you start (5 minutes, do this earlier)
1. Start PostgreSQL, then the API with the extension allowed (from the repo root): `CORS_ORIGINS=http://localhost:5173,chrome-extension://<ID> .venv/bin/uvicorn carsage.app:app --port 8000`. The extension ID is shown in Settings in the popup (for the loaded `extension/` folder on the audit machine it was `ccgjepfafepmkjjmhcddonmihiaepoda`). Without it the popup shows Offline. Check `http://127.0.0.1:8000/api/health/ready` returns `"database":"ok"`.
2. Start the website: `npm run dev` in `frontend/` (Vite, port 5173). Open `http://localhost:5173`.
3. Load the extension unpacked in Chrome (`extension/`), open the popup, confirm it says Connected.
4. Open one real CarDekho model page in a tab (a popular, current model such as Swift or Creta).
5. Keep `docs/final_submission/assets/` open as the fallback (screenshots listed at the end).
6. Run the two advisor requests below once so any first-request delay is behind you.

## Test commands (optional, before the demo)
- Python: `.venv/bin/python -m pytest -q` (277 passed, 5 skipped on 2026-11-18)
- Frontend: `cd frontend && npx tsc --noEmit && npx vitest run` (41 passed)
- Extension: `cd extension && ../frontend/node_modules/.bin/vitest run` (64 passed)
- Recommender evaluation: `.venv/bin/python src/evaluate_recommender.py`
- Browser (API on :8000 with the extension in CORS_ORIGINS, website on :5173; run one after another): `node extension/tests/e2e/site.mjs`, `popup.mjs`, `live-journey.mjs`

## Scenario 1: Advisor, feasible request (about 1.5 min)
**Type:** `family SUV under 15 lakh, diesel, automatic`
- Say: "The agent reads the sentence with rules, not an LLM, and builds six hard constraints."
- Point to the *how this was decided* panel: 1,267 variants; body SUV rules out 825, transmission 722, fuel 693, family rule 628, budget 463, seats 115; together 14 cars remain; no relaxation.
- Point to scores and the weights line ("price, mileage, power, safety, equal weights, missing = 0") and the note that "highway/driving use" was not supported and was ignored.
- Expected top picks (from the saved trace): Tata Nexon Xma Diesel 58.5, Kia Seltos Htk Plus AT 1.5 Diesel 56.2, Tata Nexon Xza Plus Diesel 49.4.
- Be ready to say: some rows are BS4 and flagged *historical*; the catalogue is an old snapshot.

## Scenario 2: Advisor, relaxation (about 1.5 min)
**Type:** `diesel car under 3 lakh`
- Say: "Nothing satisfies both. The agent runs uniform-cost search over the ways to relax."
- Point to: 0 of 1,267 cars met every requirement; budget rules out 1,255, fuel 693; *Relaxed (uniform-cost, cheapest first): dropped the fuel-type requirement*; search expanded 3 states, cost 5.
- Explain with slide 8: budget +15 percent costs 1 but is still empty; dropping fuel costs 5 and is the goal; the answer says what was given up.
- Show strict mode if asked: with relaxation off the agent says none and explains.
- Expected cars: Maruti Alto Std (O), Tata Nano Genx Xe, Datsun Redi-Go D.

## Scenario 3: Catalogue, compare and detail page (about 1 min)
- Explore: filter by fuel and price; open a car; add two or three cars to Compare and open the comparison table.
- Open a detail page and scroll to the live price panel. For an old catalogue entry such as the Creta shown in the report, the panel may show only model-level references, with a clear note that no exact variant quote was found. This is correct behaviour; say so.

## Scenario 4: Chrome extension on a real listing (about 1.5 min)
- On the open CarDekho page, click the extension: it detects make, model, variant and the displayed price, and matches the catalogue entry.
- Choose city, press compare: show the groups by price basis, the exact versus probable labels, the source links and freshness.
- Say: "It only claims lowest across websites when both quotes share one basis. Otherwise it says no claim is possible."
- Mention the price-history chart and alternatives within budget in one sentence each.

## Closing (30 seconds)
"Hard requirements are never traded for score. When nothing fits, search finds the cheapest honest concession and says so. Everything can be inspected. Limits: undated catalogue, no user study, rule-based language understanding, live data depends on third-party pages."

## Fallbacks
| Problem | What to do |
|---|---|
| API or database down | Use `docs/final_submission/assets/ss_advisor_trace.png` and `ss_advisor_relaxation.png`; say "this is a screenshot of the running application". The JSON traces `trace_assistant_example.json` and `trace_relaxation_example.json` hold the exact numbers. |
| Provider slow, blocked or returns nothing | The panel will show a failure with a retry hint or a stale copy. Say that this is by design and that provider pages can change. Show `ss_detail_live_panel.png`, `ss_ext_live_panel.png` and the 28-probe result from the report (25 had exact quotes from both providers on 2026-11-12). |
| No internet | Skip Scenario 4's live compare; show the extension screenshots `ss_ext_detect.png` and `ss_ext_live_panel.png` and say they came from a real CarDekho page. |
| Extension does not load | Show the screenshots and the popup test results from the report (46/46, re-run 2026-11-18). Most common cause: the extension ID is missing from CORS_ORIGINS. |
| Advisor gives a different top car | The catalogue is deterministic, so check for a typo; if the wording differs, read the constraints panel instead of the exact picks. |

## Things not to claim during the demo
- Do not call the scores accuracy; they are relative heuristics with no relevance labels.
- Do not say prices are current: the catalogue has no date.
- Do not say the ML estimate drives recommendations; it does not.
- Do not say a provider permits automated reading; that has not been verified.

## Screenshot inventory (all in `docs/final_submission/assets/`)
`ss_home.png`, `ss_explore.png`, `ss_compare.png`, `ss_advisor_trace.png`, `ss_advisor_relaxation.png`, `ss_detail_live_panel.png`, `ss_ext_detect.png`, `ss_ext_live_panel.png`. The extension screenshots show the real popup acting on a real live CarDekho page with only `chrome.tabs` and `chrome.scripting` stubbed to point at that page.
