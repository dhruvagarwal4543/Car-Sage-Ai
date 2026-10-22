"""Database connection settings. PostgreSQL only; the URL comes from the environment (.env), never from source code.

Neon notes:
  * DATABASE_URL        -> Neon *pooled* connection string (host contains "-pooler"), used by the API and the importer.
  * DATABASE_URL_UNPOOLED -> Neon *direct* connection string, used by Alembic (DDL should not go through PgBouncer).
  * SSL is required by Neon; it is added automatically for *.neon.tech hosts if the URL does not set sslmode.
  * Behind Neon's PgBouncer (transaction mode) psycopg server-side prepared statements must be off.
"""
import os
from urllib.parse import urlparse

from dotenv import load_dotenv
from sqlalchemy import create_engine


def _env(var):
    load_dotenv()
    url = os.environ.get(var)
    if not url:
        raise RuntimeError(f"{var} is not set. Copy .env.example to .env and fill it in.")
    return url


def database_url(var="DATABASE_URL"):
    return _env(var)


def migration_url():
    """Direct (unpooled) URL for Alembic when provided, otherwise DATABASE_URL."""
    load_dotenv()
    return os.environ.get("DATABASE_URL_UNPOOLED") or _env("DATABASE_URL")


def normalize_url(url):
    """Accept postgres:// and postgresql:// (as Neon prints them) and use the psycopg 3 driver."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def engine_options(url):
    opts = {"pool_pre_ping": True, "pool_recycle": 300}      # Neon suspends idle compute: drop stale connections quietly
    if not url.startswith("postgresql"):
        return {}                                            # e.g. the SQLite URLs used by fast unit tests
    host = urlparse(url.replace("+psycopg", "", 1)).hostname or ""
    connect_args = {}
    if "sslmode" not in url and host.endswith(".neon.tech"):
        connect_args["sslmode"] = "require"
    if "-pooler" in host:
        connect_args["prepare_threshold"] = None             # PgBouncer transaction mode: no server-side prepared statements
        opts.update(pool_size=5, max_overflow=5)
    if connect_args:
        opts["connect_args"] = connect_args
    return opts


def get_engine(url=None):
    url = normalize_url(url or database_url())
    return create_engine(url, **engine_options(url))
