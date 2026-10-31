# Deployment guide

**Status: nothing is deployed.** This file lists the manual steps. No paid resources are created by the repository, and no credentials are included.

| Piece | Suggested host (free tiers exist, check current terms) | Needs |
|---|---|---|
| PostgreSQL | Neon | project + database, pooled and direct connection strings |
| API (FastAPI) | any Python host (Render, Fly.io, Railway, ...) | Python 3.12, env vars below |
| Website (static) | Netlify, Vercel, Cloudflare Pages, GitHub Pages | `npm run build`, SPA fallback to `index.html` |
| Authentication | Firebase Authentication | Email/Password and/or Google enabled, service account |

## 1. Neon (PostgreSQL)
1. In the Neon console create (or choose) a project and a database for CarSage. Do not reuse a database that belongs to another application.
2. Copy two connection strings: **pooled** (host contains `-pooler`) and **direct**.
3. Put them in the API host's environment as `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct). Neon requires SSL, which the code enables automatically.
4. Create the schema and load the catalogue from a machine that has the processed dataset (the data is not in the repository, and its licence is unverified):
   ```bash
   DATABASE_URL_UNPOOLED=... alembic upgrade head
   DATABASE_URL=...          python -m carsage.import_catalogue     # idempotent; safe to re-run
   ```
5. For the PostgreSQL tests use a separate Neon branch or database named exactly `carsage_test` as `TEST_DATABASE_URL`.

## 2. Firebase
1. Create a Firebase project, enable **Authentication** with Email/Password and/or Google, and add the website's domain under *Authorized domains*.
2. Server: create a service-account key (Project settings > Service accounts). Store the JSON as a **secret file** on the API host and set `FIREBASE_CREDENTIALS_FILE` to its path and `FIREBASE_PROJECT_ID`. Never commit it.
3. Website: register a web app and put its public config in the website build environment: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.

## 3. API
```bash
pip install -r requirements-app.txt          # plus scikit-learn, pandas<3, numpy, joblib for the price endpoint
uvicorn carsage.app:app --host 0.0.0.0 --port $PORT
```
Environment: `DATABASE_URL`, `FIREBASE_*`, `CORS_ORIGINS` (the website origin, comma separated), optional `PRICE_MODEL_PATH`.
Health checks: liveness `GET /api/health`, readiness `GET /api/health/ready` (checks the database).

*Price model:* `models/price_model.joblib` is built from the processed dataset by `python src/train_price_model.py` and is **not** in the repository. Either upload the file to the host and set `PRICE_MODEL_PATH`, or leave it out: `/api/price-predictions` then answers `503` and the rest of the site works.

## 4. Website

Use Node 22.12+ for the patched Vite/Vitest tooling. React remains on 18.
```bash
cd frontend && npm ci && npm run build      # output: frontend/dist
```
Set `VITE_API_BASE_URL` to the API's public origin and the `VITE_FIREBASE_*` values at build time. Configure the host to rewrite unknown application paths to `/index.html` (client-side routing). Serve actual files under `/assets/` before the SPA fallback, including the GLB, WebP photos, font and Draco WASM/JS files. Preserve their licence files and `/credits`. See [VEHICLE_ASSETS.md](VEHICLE_ASSETS.md) for exact model coverage and compatibility. The browser requires a WebGL-capable device for 3D; photo fallbacks remain usable.

For a local production-build check, run `npm run preview -- --host 127.0.0.1` with the API on port 8000. Vite preview proxies `/api`, like the dev server. A deployed static host needs the production API origin in `VITE_API_BASE_URL`; the local proxy is not a production backend.

For caching, hashed JavaScript/CSS can use immutable cache headers. The manually named vehicle assets should use validators or versioned names on replacement. Do not apply immutable caching to changing `index.html`. Verify the hosting CSP permits local workers (`worker-src blob:`) and WebAssembly decoding when Draco is enabled; keep any change scoped to the viewer.

## Known limitations of free hosting
- Free API instances sleep when idle, so the first request can take many seconds; Neon also suspends idle compute (the engine pre-pings connections to recover).
- There is no rate limiting in the application. For a public deployment add it at the host or a reverse proxy.
- There is no LLM: the assistant is rule-based, so there is no model download or provider key to manage.
- Docker is not provided (it was not available in the development environment, so a Compose file could not be tested).
