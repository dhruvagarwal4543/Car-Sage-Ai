"""LIVE integration tests against real Neon and Firebase. Skipped unless explicitly enabled; never part of an ordinary run.

    RUN_LIVE_TESTS=1 python -m pytest tests/test_live_integration.py -v

Neon (read-only):   DATABASE_URL must point at the dedicated CarSage database; CARSAGE_CONFIRM_TARGET must equal its host.
Firebase:           FIREBASE_PROJECT_ID + FIREBASE_CREDENTIALS_FILE, and LIVE_FIREBASE_ID_TOKEN = an ID token of a real test user
                    of the CarSage Firebase project (sign in on the website and copy it from the browser; it expires after an hour).
Credentials are read from the environment / .env only and are never printed.
"""
import os

import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import text

from carsage import auth, db
from carsage.app import create_app

load_dotenv()
pytestmark = pytest.mark.skipif(os.environ.get("RUN_LIVE_TESTS") != "1", reason="live tests are opt-in: set RUN_LIVE_TESTS=1")


@pytest.fixture(scope="module")
def engine():
    url = db.database_url()
    if db.target_host(url) in db.LOCAL_HOSTS:
        pytest.skip("DATABASE_URL is a local database; this test is for the live Neon target")
    db.require_target_confirmation(url, "live tests")          # the host must be confirmed explicitly
    return db.get_engine(url)


def test_neon_connection_uses_tls_and_answers(engine):
    with engine.connect() as c:
        assert c.scalar(text("select 1")) == 1
        assert c.scalar(text("select ssl from pg_stat_ssl where pid = pg_backend_pid()")) is True


def test_neon_schema_is_migrated_to_head_and_catalogue_is_loaded(engine):
    with engine.connect() as c:
        assert c.scalar(text("select version_num from alembic_version")) == "0002"
        assert c.scalar(text("select count(*) from catalogue_cars where not is_exact_duplicate")) > 1000


def test_api_serves_the_live_catalogue(engine):
    client = TestClient(create_app(engine))
    assert client.get("/api/health/ready").json()["database"] == "ok"
    assert client.get("/api/cars?page_size=1").json()["total"] > 1000
    first = client.get("/api/cars?page_size=1").json()["items"][0]["id"]
    assert client.get(f"/api/cars/{first}").status_code == 200
    ids = [i["id"] for i in client.get("/api/cars?page_size=2").json()["items"]]
    assert client.get(f"/api/cars/compare?ids={ids[0]},{ids[1]}").status_code == 200
    assert client.post("/api/recommendations", json={"max_price": 1500000}).status_code == 200


@pytest.fixture
def firebase_token():
    tok = os.environ.get("LIVE_FIREBASE_ID_TOKEN")
    if not (tok and os.environ.get("FIREBASE_PROJECT_ID") and os.environ.get("FIREBASE_CREDENTIALS_FILE")):
        pytest.skip("set FIREBASE_PROJECT_ID, FIREBASE_CREDENTIALS_FILE and LIVE_FIREBASE_ID_TOKEN")
    return tok


def test_real_firebase_token_is_verified_and_saved_cars_persist(engine, firebase_token):
    client = TestClient(create_app(engine))
    h = {"Authorization": f"Bearer {firebase_token}"}
    me = client.get("/api/me", headers=h)
    assert me.status_code == 200 and me.json()["uid"]
    car = client.get("/api/cars?page_size=1").json()["items"][0]["id"]
    assert client.put(f"/api/me/saved-cars/{car}", headers=h).status_code == 204
    assert car in [c["id"] for c in client.get("/api/me/saved-cars", headers=h).json()]
    assert client.delete(f"/api/me/saved-cars/{car}", headers=h).status_code == 204     # leaves no test data behind


def test_tampered_real_token_is_rejected(engine, firebase_token):
    client = TestClient(create_app(engine))
    head, body, sig = firebase_token.split(".")
    assert client.get("/api/me", headers={"Authorization": f"Bearer {head}.{body}.{sig[:-4]}AAAA"}).status_code == 401
