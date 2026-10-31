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
| Check | Result |
|---|---|
| Extension unit tests (`cd extension && npm install && npm test`, or `../frontend/node_modules/.bin/vitest run`) | 53 pass |
| Real Chrome 155 (throwaway profile): extension loads, popup renders, search, compare list (add, duplicate, limit 4, remove, persists after reopening), `Open comparison` opens `/compare?ids=a,b`, theme, offline + Retry, Settings | pass |
| Vehicle flow in real Chrome with real-page snapshots (page reading is the only stubbed part): card, ambiguous match picker, confirm, save, add to compare, alternatives, open details | pass |
| Price-history chart, 1/3-year filters, empty state, price types not mixed | pass, **on a throwaway SQLite DB with synthetic rows** |
| Page detection run inside live, rendered CarDekho and CarWale pages (Chrome DOM) | pass for all six page types below |

Run the browser checks yourself (needs Chrome and the APIs running): `node tests/e2e/popup.mjs` (API on :8000), and `.venv/bin/python tests/e2e/seed_history.py` then an API with `DATABASE_URL=sqlite:///<printed path>` on :8001, then `node tests/e2e/history.mjs`. Expected: all pass except one, `popup.mjs`'s console-error check, until migration 0003 is applied to the :8000 database (see Troubleshooting).

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
