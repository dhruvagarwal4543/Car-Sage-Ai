"""Runs real signed JWTs through the REAL Firebase Admin SDK verification code, using keys generated here.

Nothing contacts Google and no real credentials are used: the SDK's certificate download is replaced by our own
test certificate, and the 'service account' file is generated on the fly (it belongs to no real project).
"""
import datetime as dt
import json
import time

import firebase_admin
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient
from google.auth import crypt, jwt
from sqlalchemy import create_engine

from carsage import auth
from carsage.app import create_app

PROJECT = "carsage-test"


def _key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _pem(key):
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())


def _cert(key):
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test")])
    now = dt.datetime.now(dt.timezone.utc)
    c = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(1)
         .not_valid_before(now - dt.timedelta(days=1)).not_valid_after(now + dt.timedelta(days=1)).sign(key, hashes.SHA256()))
    return c.public_bytes(serialization.Encoding.PEM).decode()


@pytest.fixture(scope="module")
def keys():
    return {"signing": _key(), "other": _key(), "service": _key()}


@pytest.fixture
def sdk(monkeypatch, tmp_path, keys):
    """Configure the app as production would (explicit project id + service-account file), with test keys."""
    sa = tmp_path / "service-account.json"
    sa.write_text(json.dumps({"type": "service_account", "project_id": PROJECT, "private_key_id": "x", "private_key": _pem(keys["service"]).decode(),
                              "client_email": f"test@{PROJECT}.iam.gserviceaccount.com", "client_id": "1", "token_uri": "https://oauth2.googleapis.com/token"}))
    monkeypatch.setenv("FIREBASE_PROJECT_ID", PROJECT)
    monkeypatch.setenv("FIREBASE_CREDENTIALS_FILE", str(sa))
    monkeypatch.setattr("google.oauth2.id_token._fetch_certs", lambda request, url: {"k1": _cert(keys["signing"])})
    auth._app = None
    yield sa
    if auth._app is not None:
        firebase_admin.delete_app(auth._app)
    auth._app = None


def token(key, project=PROJECT, uid="uid-1", exp_in=3600, **extra):
    now = int(time.time())
    payload = {"aud": project, "iss": f"https://securetoken.google.com/{project}", "sub": uid, "iat": now - 10, "auth_time": now - 10,
               "exp": now + exp_in, "email": "a@example.com", **extra}
    return jwt.encode(crypt.RSASigner.from_string(_pem(key).decode(), "k1"), payload, header={"kid": "k1", "alg": "RS256"}).decode()


@pytest.fixture
def client():
    return TestClient(create_app(create_engine("sqlite://")))


def me(client, tok, **kw):
    return client.get("/api/me", headers={"Authorization": f"Bearer {tok}"}, **kw)


def test_valid_token_yields_verified_uid_and_email(sdk, client, keys):
    r = me(client, token(keys["signing"], uid="alice"))
    assert r.status_code == 200 and r.json() == {"uid": "alice", "email": "a@example.com"}


def test_sdk_is_initialised_once(sdk, client, keys):
    for _ in range(3):
        assert me(client, token(keys["signing"])).status_code == 200
    assert len(firebase_admin._apps) == 1


def test_token_from_another_firebase_project_is_rejected(sdk, client, keys):
    assert me(client, token(keys["signing"], project="someone-elses-project")).status_code == 401


def test_expired_token_is_rejected(sdk, client, keys):
    assert me(client, token(keys["signing"], exp_in=-3600)).status_code == 401


def test_token_signed_with_an_unknown_key_is_rejected(sdk, client, keys):
    assert me(client, token(keys["other"])).status_code == 401


@pytest.mark.parametrize("bad", ["garbage", "a.b.c", "x" * 40, "Bearer", ""])
def test_malformed_tokens_are_rejected(sdk, client, bad):
    r = me(client, bad) if bad else client.get("/api/me", headers={"Authorization": "Bearer "})
    assert r.status_code == 401


def test_token_without_subject_is_rejected(sdk, client, keys):
    assert me(client, token(keys["signing"], uid="")).status_code == 401


def test_identity_comes_only_from_the_verified_token(sdk, client, keys):
    r = client.get("/api/me", headers={"Authorization": f"Bearer {token(keys['signing'], uid='alice')}", "X-User-Id": "mallory", "X-Uid": "mallory"},
                   params={"uid": "mallory", "email": "m@evil.example"})
    assert r.json()["uid"] == "alice"


def test_tokens_never_appear_in_responses_or_logs(sdk, client, keys, caplog):
    bad = token(keys["other"])
    with caplog.at_level("DEBUG"):
        r = me(client, bad)
    assert bad not in r.text and bad not in caplog.text and bad.split(".")[1] not in caplog.text


def test_missing_project_id_means_503_not_a_silent_fallback(sdk, client, keys, monkeypatch):
    monkeypatch.delenv("FIREBASE_PROJECT_ID")
    r = me(client, token(keys["signing"]))
    assert r.status_code == 503 and "not configured" in r.json()["detail"]


def test_service_account_from_a_different_project_is_refused(sdk, client, keys, monkeypatch):
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "another-project")
    r = me(client, token(keys["signing"], project="another-project"))
    assert r.status_code == 503 and "different Firebase project" not in r.text      # detail stays generic for clients
    with pytest.raises(auth.FirebaseNotConfigured, match="different Firebase project"):
        auth._firebase_app()


def test_missing_or_unreadable_credentials_file_means_503(sdk, client, keys, monkeypatch, tmp_path):
    monkeypatch.setenv("FIREBASE_CREDENTIALS_FILE", str(tmp_path / "missing.json"))
    assert me(client, token(keys["signing"])).status_code == 503
    bad = tmp_path / "bad.json"; bad.write_text("not json")
    monkeypatch.setenv("FIREBASE_CREDENTIALS_FILE", str(bad))
    assert me(client, token(keys["signing"])).status_code == 503
