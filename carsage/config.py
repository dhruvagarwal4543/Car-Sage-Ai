"""Startup validation. Reports the NAMES of missing or unsafe settings, never their values."""
import logging
import os

from dotenv import load_dotenv

log = logging.getLogger("carsage.config")
PRODUCTION = {"production", "prod"}


def problems():
    """Return (fatal_in_production, warnings): lists of human-readable messages that contain variable names only."""
    load_dotenv()
    e = os.environ.get
    fatal, warn = [], []
    if not e("DATABASE_URL"):
        fatal.append("DATABASE_URL is not set")
    origins = [o.strip() for o in (e("CORS_ORIGINS") or "").split(",") if o.strip()]
    if not origins:
        fatal.append("CORS_ORIGINS is not set (comma-separated list of website origins)")
    if "*" in origins:
        fatal.append("CORS_ORIGINS must list explicit origins, not '*'")
    if not e("FIREBASE_PROJECT_ID"):
        warn.append("FIREBASE_PROJECT_ID is not set: protected endpoints will answer 503")
    cred = e("FIREBASE_CREDENTIALS_FILE") or e("GOOGLE_APPLICATION_CREDENTIALS")
    if not cred:
        warn.append("FIREBASE_CREDENTIALS_FILE is not set: protected endpoints will answer 503")
    elif not os.path.isfile(cred):
        warn.append("FIREBASE_CREDENTIALS_FILE does not point to an existing file")
    return fatal, warn


def validate_startup():
    """Log warnings; in APP_ENV=production refuse to start with fatal problems."""
    fatal, warn = problems()
    for w in warn + fatal:
        log.warning("configuration: %s", w)
    if fatal and (os.environ.get("APP_ENV") or "").lower() in PRODUCTION:
        raise RuntimeError("Invalid production configuration: " + "; ".join(fatal))
    return fatal, warn
