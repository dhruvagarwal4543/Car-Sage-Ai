# Cloud setup: Neon PostgreSQL and Firebase Authentication

This guide connects CarSage AI to a **dedicated Neon project** and a **dedicated Firebase project**. Nothing here has been run against live services yet (see the checklist). No secret belongs in this repository: keep real values in `.env`, `frontend/.env.local` and a service-account file stored **outside** the repo.

## Checklist

| # | Item | Status |
|---|---|---|
| 1 | Neon-compatible connection handling (TLS, pooled URL for the app, direct URL for Alembic, no prepared statements behind the pooler) | Done and unit-tested |
| 2 | Safety latch: migrations and imports refuse a non-local database unless `CARSAGE_CONFIRM_TARGET` equals its host | Done and tested |
| 3 | Read-only database check `python -m carsage.check_db` | Done; run against the local database only |
| 4 | Backend verifies Firebase ID tokens with the Admin SDK, requires an explicit `FIREBASE_PROJECT_ID`, refuses a service account from another project | Done; tested through the real SDK code path with locally generated keys (valid, expired, wrong project, forged, malformed) |
| 5 | Saved cars bound to the verified UID; users cannot see or change each other's | Done and tested |
| 6 | Frontend sends the ID token, retries once with a refreshed token on 401, then signs out with a clear message | Done and tested (mocked fetch) |
| 7 | Startup validation naming missing settings; production refuses unsafe CORS/configuration | Done and tested |
| 8 | **Create the `carsage-ai` Neon project** | **Not done: needs your action (it was not authorised to be created from here)** |
| 9 | **Migrate and import into Neon** | **Not done: needs step 8 and your confirmation** |
| 10 | **Create the Firebase project, enable providers, register the web app, create a service account** | **Not done: needs your action** |
| 11 | Live tests (`RUN_LIVE_TESTS=1`) against Neon and Firebase | Written; never run (no credentials) |
| 12 | Browser test of sign-in/out and saved cars with real Firebase | Not done |

## Prerequisites
Python 3.12, Node 22 with npm, Git. Optional: `psql` and the Neon CLI (`neon`). Install: `pip install -r requirements.txt` (or `requirements-app.txt` + `requirements-data.txt`) and `cd frontend && npm install`.

## 1. Neon (dedicated project `carsage-ai`)
1. In the Neon console (or with the CLI) create a project named `carsage-ai` on the free plan. CLI form, to be run by you:
   `neon projects create --name carsage-ai --region-id aws-us-east-2 --org-id <your-org-id>`
   Do **not** reuse another application's project (for example an existing `cweb` project) or its production branch.
2. Copy two connection strings (console: *Connect*; toggle *Connection pooling*): **pooled** (`…-pooler…`) and **direct**.
3. Put them in `.env` (never commit it):
   ```
   DATABASE_URL=<pooled string>
   DATABASE_URL_UNPOOLED=<direct string>
   ```
   Keep the `sslmode=require` Neon gives you (TLS stays on; the code also forces it for `*.neon.tech` if missing). For certificate verification you may use `sslmode=verify-full&sslrootcert=system`; the code leaves explicit settings untouched. Pooled connections run with prepared statements disabled (PgBouncer transaction mode), which the code does automatically for `-pooler` hosts.
4. **Verify the target** (read-only; prints host and database, no credentials):
   ```bash
   python -m carsage.check_db
   ```
   Check that the host is your `carsage-ai` endpoint, TLS says `yes`, and the revision says `none (not migrated yet)`.
5. **Migrate**, only after step 4 shows the right database. Never run this against an unknown database, and never reset a database to make it pass:
   ```bash
   export CARSAGE_CONFIRM_TARGET=<host shown by check_db>
   alembic upgrade head          # creates catalogue_cars and saved_cars (non-destructive; downgrade is not run automatically)
   python -m carsage.check_db    # revision should now be 0002
   ```
6. **Import the catalogue** (requires `data/processed/cars_processed.csv` from `python src/preprocess.py`, and the dataset's licence is unverified; see the README):
   ```bash
   python -m carsage.import_catalogue     # idempotent upsert on source_row; re-running creates no duplicates
   python -m carsage.check_db             # expect 1267 visible rows
   ```
7. Live tests (read-only except a saved-car round trip that it removes):
   `RUN_LIVE_TESTS=1 python -m pytest tests/test_live_integration.py -v`

## 2. Firebase (new project for CarSage; authentication only)
1. Firebase console: create a project. Stay on the free **Spark** plan; do not enable billing. Do **not** enable Firestore or Realtime Database.
2. *Authentication > Sign-in method*: enable **Email/Password** and **Google**. *Authentication > Settings > Authorized domains*: keep `localhost` and add your deployed website domain later.
3. *Project settings > Your apps*: register a **Web** app and copy its config into `frontend/.env.local` (public values, but keep yours out of git):
   ```
   VITE_FIREBASE_API_KEY=...   VITE_FIREBASE_AUTH_DOMAIN=...   VITE_FIREBASE_PROJECT_ID=...   VITE_FIREBASE_APP_ID=...
   ```
4. *Project settings > Service accounts > Generate new private key*. Move the JSON file **outside the repository** (for example `~/.config/carsage/firebase-service-account.json`, `chmod 600`) and set in `.env`:
   ```
   FIREBASE_PROJECT_ID=<the same project id>
   FIREBASE_CREDENTIALS_FILE=/absolute/path/to/that/file.json
   ```
   The API refuses to start verifying tokens if the file's `project_id` differs from `FIREBASE_PROJECT_ID`, so a key from another project cannot be used by mistake. `.gitignore` blocks common service-account file names and a test checks it. In hosted environments prefer a platform secret file or workload identity over a long-lived key.

## 3. Run locally
```bash
uvicorn carsage.app:app --reload          # API on :8000, docs at /docs
cd frontend && npm run dev                # website on :5173 (proxies /api)
```
`.env` must list the website origin in `CORS_ORIGINS` (default `http://localhost:5173`); wildcards are rejected in production.

## 4. Tests
| Kind | Command | Needs credentials? |
|---|---|---|
| Backend unit/integration (SQLite + local `carsage_test`, mocked and generated-key Firebase) | `python -m pytest tests` | No |
| Frontend (Vitest) + type check + build | `cd frontend && npm test && npm run build` | No |
| Live Neon + Firebase | `RUN_LIVE_TESTS=1 python -m pytest tests/test_live_integration.py -v` (plus `LIVE_FIREBASE_ID_TOKEN` of a real test user) | Yes; skipped by default |

No linter is configured in this repository; type checking is `tsc --noEmit` for the frontend.

## 5. Common problems
| Symptom | Likely cause and fix |
|---|---|
| `Refusing to run … against remote database host` | The safety latch: verify the host with `check_db`, then set `CARSAGE_CONFIRM_TARGET` to it |
| `Database unavailable` (503) / `CONNECTION FAILED` | wrong `DATABASE_URL`, network, or Neon compute waking up (retry); check the project is the right one |
| `prepared statement … does not exist` | a pooled URL used without the pooler settings; use the `-pooler` host (handled automatically) or the direct URL |
| `password authentication failed` | rotate the role password in Neon and update `.env`; never paste it into chat or commits |
| Browser CORS error | the website origin is not in `CORS_ORIGINS`; restart the API after editing `.env` |
| `Authentication is not configured on this server` (503) | `FIREBASE_PROJECT_ID` / `FIREBASE_CREDENTIALS_FILE` missing, unreadable, or for a different project |
| `Invalid or expired token` (401) | token from another Firebase project, expired (the website refreshes once automatically), or malformed |
| "Sign-in is not configured on this deployment" | `VITE_FIREBASE_*` not set at build/dev time |
| `auth/unauthorized-domain`, popup blocked | add the domain to Firebase *Authorized domains*; allow popups for Google sign-in |

## 6. Remaining risks
- No live verification of Neon connectivity, TLS parameters or Firebase sign-in has happened; first real use may need small configuration fixes.
- `sslmode=require` encrypts but does not verify the server certificate; use `verify-full` if you need that.
- Firebase tokens are verified without a revocation check (it costs an extra network call per request); revoking a user takes effect when the token expires (about one hour).
- There is no rate limiting in the application, and the free tiers of Neon and Firebase have quotas. Nothing here enables paid features.
