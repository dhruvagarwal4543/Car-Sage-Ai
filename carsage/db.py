import os

from dotenv import load_dotenv
from sqlalchemy import create_engine


def database_url(var="DATABASE_URL"):
    """Read the connection URL from the environment / untracked .env. Never hard-code credentials."""
    load_dotenv()
    url = os.environ.get(var)
    if not url:
        raise RuntimeError(f"{var} is not set. Copy .env.example to .env and fill it in.")
    return url


def get_engine(url=None):
    return create_engine(url or database_url())
