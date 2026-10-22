import re
import subprocess
from pathlib import Path

import pytest

from carsage import config, db
from carsage.app import create_app

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def clean_env(monkeypatch):
    monkeypatch.setattr(config, "load_dotenv", lambda: None)
    for v in ("DATABASE_URL", "CORS_ORIGINS", "FIREBASE_PROJECT_ID", "FIREBASE_CREDENTIALS_FILE", "GOOGLE_APPLICATION_CREDENTIALS", "APP_ENV", "CARSAGE_CONFIRM_TARGET"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setattr(db, "load_dotenv", lambda: None)


# ---- startup validation: names only, never values
def test_missing_settings_are_reported_by_name(clean_env):
    fatal, warn = config.problems()
    assert any("DATABASE_URL" in m for m in fatal) and any("CORS_ORIGINS" in m for m in fatal)
    assert any("FIREBASE_PROJECT_ID" in m for m in warn) and any("FIREBASE_CREDENTIALS_FILE" in m for m in warn)


def test_secret_values_never_appear_in_messages(clean_env, monkeypatch, tmp_path):
    secret = "postgresql://user:SuperSecretPw123@ep-x.neon.tech/db"
    monkeypatch.setenv("DATABASE_URL", secret); monkeypatch.setenv("FIREBASE_CREDENTIALS_FILE", str(tmp_path / "nope.json"))
    text = " ".join(sum(config.problems(), []))
    assert "SuperSecretPw123" not in text and secret not in text and str(tmp_path) not in text


def test_production_refuses_unsafe_configuration(clean_env, monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        config.validate_startup()
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/d"); monkeypatch.setenv("CORS_ORIGINS", "*")
    with pytest.raises(RuntimeError, match="explicit origins"):
        create_app()
    monkeypatch.setenv("CORS_ORIGINS", "https://carsage.example")
    config.validate_startup()                                              # now acceptable (Firebase only warns)


def test_development_only_warns(clean_env, caplog):
    with caplog.at_level("WARNING"):
        config.validate_startup()
    assert "DATABASE_URL" in caplog.text


# ---- remote database safety: writes need an explicit host confirmation
def test_local_targets_need_no_confirmation(clean_env):
    for u in ("postgresql+psycopg://u:p@localhost:5432/carsage", "postgresql://u:p@127.0.0.1/x", "sqlite:///x.db"):
        db.require_target_confirmation(u)


def test_remote_target_requires_matching_confirmation(clean_env, monkeypatch):
    url = "postgresql://user:secretpw@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require"
    with pytest.raises(RuntimeError) as e:
        db.require_target_confirmation(url, "migrations")
    assert "ep-cool-123.us-east-2.aws.neon.tech" in str(e.value) and "secretpw" not in str(e.value) and "user" not in str(e.value).replace("user:", "")
    monkeypatch.setenv("CARSAGE_CONFIRM_TARGET", "some-other-host.neon.tech")
    with pytest.raises(RuntimeError):
        db.require_target_confirmation(url)
    monkeypatch.setenv("CARSAGE_CONFIRM_TARGET", "ep-cool-123.us-east-2.aws.neon.tech")
    db.require_target_confirmation(url)
    db.require_target_confirmation(url.replace("ep-cool-123.", "ep-cool-123-pooler."))      # pooled and direct hosts are one endpoint
    monkeypatch.setenv("CARSAGE_CONFIRM_TARGET", "")
    with pytest.raises(RuntimeError):
        db.require_target_confirmation(url)                                                  # an empty confirmation never passes


def test_describe_target_hides_credentials():
    d = db.describe_target("postgresql://user:secretpw@ep-x-pooler.neon.tech/neondb?sslmode=require")
    assert d == "ep-x-pooler.neon.tech/neondb"


def test_pooled_neon_url_options_keep_tls_and_disable_prepared_statements():
    o = db.engine_options("postgresql+psycopg://u:p@ep-x-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require")
    assert o["connect_args"] == {"prepare_threshold": None} and o["pool_pre_ping"] is True           # explicit sslmode is respected as written
    o = db.engine_options("postgresql+psycopg://u:p@ep-x.us-east-2.aws.neon.tech/neondb")
    assert o["connect_args"]["sslmode"] == "require"                                                  # TLS can never be silently dropped
    o = db.engine_options("postgresql+psycopg://u:p@ep-x.neon.tech/neondb?sslmode=verify-full&sslrootcert=system")
    assert "connect_args" not in o                                                                    # stricter verification is left untouched


def test_migrations_refuse_unconfirmed_remote_database(clean_env, monkeypatch):
    from alembic import command
    from alembic.config import Config
    cfg = Config(str(ROOT / "alembic.ini")); cfg.set_main_option("script_location", str(ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", "postgresql://u:p@ep-unknown.neon.tech/neondb")
    with pytest.raises(RuntimeError, match="Refusing to run migrations"):
        command.upgrade(cfg, "head")                  # fails BEFORE any connection is attempted


# ---- repository hygiene: nothing secret can be committed by accident
@pytest.mark.skipif(not (ROOT / ".git").exists(), reason="not a git checkout")
@pytest.mark.parametrize("name", ["service-account.json", "cweb-fd244-firebase-adminsdk-abc.json", "serviceAccountKey.json", ".env", ".env.local", "key.pem"])
def test_gitignore_blocks_secret_files(name):
    r = subprocess.run(["git", "check-ignore", "-q", name], cwd=ROOT)
    assert r.returncode == 0, f"{name} would not be ignored"


@pytest.mark.skipif(not (ROOT / ".git").exists(), reason="not a git checkout")
def test_tracked_files_contain_no_secrets():
    """Scans tracked files for private keys and database URLs with real-looking passwords (test fixtures and local hosts are allowed)."""
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout.split()
    this_suite = {"tests/test_config_and_safety.py", "tests/test_firebase_sdk.py"}
    url = re.compile(r"postgres(?:ql)?(?:\+psycopg)?://[^:\s/]+:([^@\s]+)@([^/\s:?]+)")
    bad = []
    for f in files:
        if f.endswith((".png", ".ipynb")) or f.endswith("package-lock.json") or f in this_suite or not (ROOT / f).is_file():
            continue
        txt = (ROOT / f).read_text(errors="ignore")
        bad += [(f, m) for m in ("BEGIN PRIVATE KEY", "BEGIN RSA PRIVATE KEY", '"private_key"', "npg_") if m in txt]
        bad += [(f, "database URL with a password") for pw, host in url.findall(txt) if host not in db.LOCAL_HOSTS and pw != "CHANGE_ME" and len(pw) >= 8]   # 1-3 char passwords are obvious test dummies
    assert bad == []
