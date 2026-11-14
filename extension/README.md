# CarSage AI Chrome extension (Manifest V3)

Plain JavaScript, no build step. Open a car page, click the CarSage icon: the popup reads the page, matches the car to the CarSage catalogue, and lets you compare, view price history and find alternatives.

## Load it
1. Apply migrations to your **local** database (price history needs table `price_observations`, migration 0003): `.venv/bin/alembic upgrade head`.
2. Start the API with the extension allowed (step 4 gives the ID): `CORS_ORIGINS=http://localhost:5173,chrome-extension://<ID> .venv/bin/uvicorn carsage.app:app --port 8000`. Optionally the website: `cd frontend && npm run dev`.
3. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose the `extension/` folder.
4. The **ID** is shown on the extension's card (32 letters a–p). For an unpacked extension it comes from the folder's absolute path, so it differs per machine. For this checkout on the author's machine it was `ccgjepfafepmkjjmhcddonmihiaepoda`.
5. Pin the icon, open a car page, click it. The popup's **Settings** shows the exact origin to put in `CORS_ORIGINS`.

No wildcard is used. In production add the real extension ID to the API's `CORS_ORIGINS` and use the HTTPS addresses in Settings.

## Configuration
Popup → Settings (kept on the device, not in the code): **API address** (default `http://127.0.0.1:8000`) and **Website address** (default `http://localhost:5173`). Nothing secret is stored in the extension; there are no keys, tokens or passwords in it.

## Verified, and how
| Check | Result (2026-11-12) |
|---|---|
| Extension unit tests (`cd extension && npm install && npm test`, or `../frontend/node_modules/.bin/vitest run`) | 64 pass |
| Real Chrome 155 (throwaway profile): extension loads, popup renders, search, compare list, `Open comparison`, theme, offline + Retry, Settings; vehicle flow on real-page snapshots (page reading stubbed) incl. the live-price panel against the real API and real providers | 46/46 |
| Journey on **real pages**: Chrome opens a live CarDekho variant page and a live CarWale trim page, the extension's detector reads them, the request goes to the API: both providers matched to the same variant in one `DELHI_EX_SHOWROOM` group; a trim page that lists Petrol and Diesel stays ambiguous until a fuel is chosen (`node tests/e2e/live-journey.mjs`) | 9/9 |
| Website in real Chrome: all routes, search, compare, advisor trace, car-detail live-price panel (`node tests/e2e/site.mjs`) | 29/29 |
| Price-history chart, filters, empty state, bases not mixed (`tests/e2e/history.mjs`) | 10/10, **on a throwaway SQLite DB with synthetic rows** |
| 15 models on real CarDekho/CarWale pages (`reports/evaluation/live_providers.md`) | exact quote from both providers in one Delhi ex-showroom group on 25 of 28 probes; the other 3: Thar (CarDekho names it "OG ...": ambiguous by design), Tiago EV (CarDekho "Smart 19 Medium Range" vs CarWale "Smart 19.2 kWh": no shared name, not guessed) |

Run the browser checks yourself (needs Chrome; API on :8000 with the extension in `CORS_ORIGINS`, website on :5173): `node tests/e2e/popup.mjs`, `node tests/e2e/site.mjs`, `node tests/e2e/live-journey.mjs`. They fetch real provider pages through the API, so run them one after another (the per-host budget is 30 fetches per 10 minutes: a failure naming `rate_limited` means wait, not a bug). For the history check: `.venv/bin/python tests/e2e/seed_history.py`, an API with `DATABASE_URL=sqlite:///<printed path>` on :8001, then `node tests/e2e/history.mjs`.

## Supported pages (tested on 2026-10-30, Hyundai Creta)
Only pages of these shapes were examined. Selectors come from those pages; other models or later site changes may differ.

| Page | What is read |
|---|---|
| CarDekho model page | name, year, main image, canonical URL, **starting** ex-showroom price (exact rupees from structured data, marked as a starting price), fuel options, mileage per fuel |
| CarDekho variant page | name, exact ex-showroom price in the page's city. The page's structured data describes a *different* variant, so it is ignored in favour of the car whose name or URL is the page's |
| CarDekho used-car page | variant from the breadcrumb, year, asking price, odometer, fuel, gearbox, city |
| CarWale model page | name, year, image, starting ex-showroom price (marked as such), fuel options |
| CarWale variant page | name, year, **starting** ex-showroom price (page lists two fuel columns). The structured-data price on this page is the Mumbai **on-road** price and is not used as ex-showroom |
| CarWale used-car page | variant from the heading, year, asking price, odometer, fuel, gearbox, city |

Other sites work only if they publish `Car`/`Vehicle` structured data (confidence "medium"). A bare `Product` or a heading alone is not accepted.
Not extracted: mileage on used pages and CarWale pages, city of a new-car price, engine size when a page lists several engines (nothing is guessed: the field stays empty or lists the options). Pages that need a login or are blocked by the site are not read.

## What needs what
| Works on this device only | Needs the API |
|---|---|
| Saved cars, comparison list, theme, Settings | Matching to the catalogue, search, price history, alternatives, opening details |

**Account sync is not implemented.** Saved cars here are not the website's saved cars (they are stored in `chrome.storage.local` and labelled "Saved on this device"). The extension records no price observations.

## Authentication: the gap and the smallest safe path
The website signs in with the Firebase web SDK and sends the ID token as `Authorization: Bearer`; the API verifies it with the Admin SDK (`carsage/auth.py`) and takes the user id only from the verified token. The saved-car and price-observation endpoints already work with any such token, so **no backend change is needed**. What is missing is a way to get a token inside the extension. The smallest option: `chrome.identity.launchWebAuthFlow` with Google sign-in, then Firebase's `accounts:signInWithIdp` REST call, keeping the ID token in memory only. It needs configuration that is not in this repo: a Firebase web API key, a Google OAuth client for the extension, and `https://<ID>.chromiumapp.org/` as an authorised redirect. Not built; adding it should come with `identity` in the manifest permissions.

## Compare prices across websites (live)
Open a CarDekho/CarWale **variant** page, press **Compare Prices** (disabled on model pages: a model has no single price), optionally pick a **city**. The popup asks the API (`POST /api/prices/compare-live`), which reads the same model's public pages on CarDekho and CarWale, matches the listing's variant and shows quotes **grouped by what the price means**, with match level, freshness and a source link for each.

### What the price on each page means (verified on real pages, 2026-11-12)
| Page | Field | Meaning | Basis code |
|---|---|---|---|
| CarDekho `/{make}/{model}` | JSON-LD `hasVariant[].offers.price` | ex-showroom in the city the page names ("Ex-Showroom Price in New Delhi") | `DELHI_EX_SHOWROOM` (`UNSPECIFIED_EX_SHOWROOM` if no city is stated) |
| CarDekho `/{make}/{model}/price-in-{city}` | the **same** JSON-LD field | **on-road** in that city (title "On Road Price in Mumbai"); trusted only when the title confirms the city | `MUMBAI_ON_ROAD` |
| CarWale `/{make}-cars/{model}/` | embedded `versions[].priceOverview` ("Avg. Ex-Showroom price") | national average ex-showroom | `NATIONAL_AVERAGE_EX_SHOWROOM` |
| CarWale `.../price-in-{city}/` | same JSON: `price` = on-road, `exShowRoomPrice` = ex-showroom, both in that city | per-city prices | `DELHI_EX_SHOWROOM`, `DELHI_ON_ROAD`, ... |

A quote's **basis** = price type + location kind (city / national average / unspecified). Quotes are compared only inside one basis. Different bases are shown apart under "Prices shown are from different location bases and cannot be directly compared."; they never produce a lowest, a difference or a saving. An unspecified location never equals a known city or the national average. Choosing a city makes CarWale answer with its city page (ex-showroom and on-road for that city); CarDekho publishes ex-showroom only for its own default city, so for any other city only its on-road page is read.

Not available: ACKO Drive (HTTP 403 to a plain request: reported unavailable, not bypassed), manufacturer sites (not investigated), other cities for CarDekho ex-showroom, used-car price comparison (used listings fetch nothing).

### Matching (`carsage/prices.py`, tests in `tests/test_prices.py`)
- **exact**: variant words equal, and fuel and transmission stated by both sides and agreeing (an EV needs no transmission), no contradiction in gearbox type (CVT is not IVT), engine size (1.5 L vs 1493 cc is fine, 1.2 L is not), year or generation range. The page the user is viewing is exact for itself.
- **probable**: the name agrees but a side does not state fuel or transmission. CarDekho names omit them, so for up to two probable CarDekho quotes the server reads that variant's own page spec table (fuel type, transmission type, displacement, emission norm) and upgrades or removes the quote. Probable quotes are listed apart and never enter the comparison.
- **ambiguous**: extra or missing trim words ("Smart" vs "Smart Plus S", "GX 7 STR" vs "GX 8 STR", a 19.2 kWh vs 24 kWh battery), or several fuel versions under one name when the listing does not say which. Only counted, never compared.
- **mismatch**: contradiction, or too few shared words. Dropped.
- Without any exact variant quote, the model's starting-price range is shown as a labelled **model-level reference** (not a variant price).
Generation: provider pages show their current lineup and do not state a generation per variant, so it is never inferred from one token; a stated range or year that contradicts the listing is a mismatch, and the catalogue match excludes BS4-or-older rows for a listing of model year 2021+.

### Scheduling, freshness and safety
- Every provider fetch goes through `carsage/scheduler.py`: a slot every 2 s per host (bursts are spread out, not rejected), waiting never longer than 6 s (then `rate_limited` with a retry hint), at most 6 queued per host, 30 fetches per 10 minutes per host, identical in-flight fetches shared, cancellable (a closed popup cancels its queued fetches), per-request deadline 14 s. Failures are typed: `rate_limited`, `queue_full`, `timeout`, `blocked` (HTTP 403, never retried or bypassed), `not_found`, `layout_changed`, `unavailable`.
- Freshness: `fresh` (fetched in this request), `cached` (under 6 h), `stale` (older copy, only when a refetch failed, up to 24 h), `unavailable`. A cached quote is never called live. Nothing is written to price history.
- SSRF: only URLs the server builds itself on two fixed HTTPS hosts; no user URL is fetched; redirects are followed by hand and each hop must stay on an allowlisted host that resolves to public addresses; 8 s timeout, one retry; the cache holds 300 pages. Residual: the DNS answer is checked, then resolved again by the HTTP client (not pinned); the host list is fixed to two providers.
- **Operational limits**: the scheduler, cache and per-client request limiter are per process. With several server processes each has its own slots, so provider request rates add up; put one shared limiter/cache (a proxy or Redis) in front before scaling out. Behind a reverse proxy every client may share one address, so configure the proxy to rate-limit per client. Env: `RATE_LIMIT_PER_MINUTE` (default 60 per client on the POST endpoints, 0 disables).

### Real-provider check
`python src/check_live_providers.py` visits 15 models (two variants each where two exist) with the product's 2 s spacing and writes `reports/evaluation/live_providers.{json,md}`; the last run is recorded there. It derives variants from CarWale's own naming, so what it measures is whether CarDekho lands on the same variant, not CarWale agreeing with itself.

## Price history
Reads the existing public endpoint `POST /api/price-history/query`, which returns only sourced, dated observations of the same car, year, market, price type and new/used status. Nothing is estimated or filled in. The chart shows exactly the returned points; the change figures are the server's. The real database has **no observations** until reviewed data is imported (`python -m carsage.import_prices`), so for now the popup will say none exist. Listings' prices are shown, never uploaded.

## Privacy and permissions
Permissions: `activeTab`, `scripting`, `storage`. No host permissions, no content scripts running by default, no background worker, no history, no analytics. The page is read only when you open the popup, and only the car's name/specs are sent (to your own API, to match it). Nothing is sent to CarDekho, CarWale or anyone else.

## Not done / limits
- Rate limiting is **not implemented** (API or extension). `/api/recommendations`, `/api/assistant`, `/api/price-predictions` are public; add limits at the host, as `docs/DEPLOYMENT.md` says. Per-user limits on price-observation creation are not implemented either (the extension does not call that endpoint).
- The catalogue's Creta variants are an older generation (1.4 CRDi, 1.6 VTVT) than the 2024 pages (E, EX, SX…), so every listing shows "several variants fit" and you must choose; the popup shows the backend's note that generation is not verified. A catalogue car is never picked for you.
- Used cars have no catalogue price; a used listing is matched by identity only.
- Popup behaviour on a real active tab (the real `activeTab` grant and injection) was not exercised: headless Chrome has no toolbar click. Everything else in that path was.
- Only Chrome 155 on macOS was tested.

## Troubleshooting
- **"Offline" / "Cannot reach the CarSage server"**: API not running, wrong address in Settings, or the extension ID is missing from `CORS_ORIGINS` (restart the API after changing it). A server error (HTTP 500) can look the same, because the API sends no CORS headers on a 500: check the API log.
- **Price history says "Cannot reach…" while search works**: the `price_observations` table is missing; run `alembic upgrade head` on the local database.
- **"Page not supported" / "No vehicle found"**: open a car or variant page and press Rescan; the page may load its data late. Pages behind a login or bot check are not read.
- **ID changed**: you moved the folder or use another machine; update `CORS_ORIGINS`.
- **Comparison page empty**: the website is not running at the Website address in Settings.
