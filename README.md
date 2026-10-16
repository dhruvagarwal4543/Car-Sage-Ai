# CarSage AI

A course project (Artificial Intelligence): an Indian new-car marketplace with an AI assistant. **Work in progress. Only the data/ML foundation exists; the application does not.**

## Current status
| Component | Status |
|---|---|
| Dataset EDA (`notebooks/01_indian_cars_eda.ipynb`, `reports/eda_summary.md`) | Done |
| Preprocessing pipeline (`src/preprocess.py`) and data audit (`reports/data_audit.md`) | Done |
| Leakage-safe splits and price-model experiment (`src/modeling_setup.py`, `src/experiment.py`, `reports/experiment/`) | Done (Ridge / HistGradientBoosting vs a dummy baseline; new-car price only) |
| Tests (`tests/`) | Data/ML code only |
| PostgreSQL schema, FastAPI backend, authentication | Not started |
| Search, constraint filtering, knowledge-based recommendations | Not started |
| LLM assistant | Not started |
| Website | Not started |
| Chrome extension | Not started |
| Deployed/saved price model | Not started (experiment code does not save a model) |

## Planned architecture (not built)
- **Backend:** FastAPI + PostgreSQL (catalogue, users, listings), JWT auth.
- **Reasoning:** constraint filtering, heuristic ranking, rule-based explanations over the car catalogue.
- **Assistant:** LLM calling tools that read the real catalogue; it must not name cars the tools did not return.
- **Price model:** one evaluated regression model for new-car ex-showroom price.
- **Clients:** website and a Chrome extension for supported listing pages.

## Setup
Recommended: Python 3.12 in a virtual environment (do not use the system Python; it is 3.9, which has reached end of life).
```bash
python3.12 -m venv .venv && source .venv/bin/activate     # or: uv venv --python 3.12
pip install -r requirements-data.txt                       # data/ML only (enough for everything that exists today)
# pip install -r requirements-app.txt                      # only once the application phase starts
cp .env.example .env                                       # placeholders; fill in later phases
```
Place the dataset files (not included in this repository) at `data/raw/archive/cars_ds_final.csv` (and optionally `cars_ds_final_2021.csv`), then:
```bash
python src/preprocess.py        # writes data/processed/
python -m pytest tests          # tests
python src/experiment.py        # writes reports/experiment/ (about 3 minutes)
```

## Data and licensing
The dataset comes from a Google share link supplied for the project. Its original source, licence and terms of use have **not been verified**, so the data files are git-ignored and must not be published until that is resolved. See `reports/data_audit.md` for data quality notes.

## Scope and limitations
The model estimates **new-car ex-showroom prices only**. It is not a used-car resale predictor, and the dataset has no listings, sellers or dates, so fake-listing detection is not supported by this data.
