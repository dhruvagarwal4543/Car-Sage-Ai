"""Read-only connectivity and readiness check:  python -m carsage.check_db

Prints the target host/database (no credentials), TLS status, migration revision and catalogue size.
Never writes anything; safe to run against Neon before migrating.
"""
import sys

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from carsage.db import database_url, describe_target, get_engine


def main() -> int:
    url = database_url()
    print("target:", describe_target(url))
    try:
        with get_engine(url).connect() as c:
            print("server:", c.scalar(text("show server_version")))
            ssl = c.scalar(text("select ssl from pg_stat_ssl where pid = pg_backend_pid()"))
            print("tls:", "yes" if ssl else "NO (connection is not encrypted)")
            has_alembic = c.scalar(text("select to_regclass('alembic_version')")) is not None
            print("migration revision:", c.scalar(text("select version_num from alembic_version")) if has_alembic else "none (not migrated yet)")
            if c.scalar(text("select to_regclass('catalogue_cars')")):
                print("catalogue rows (visible):", c.scalar(text("select count(*) from catalogue_cars where not is_exact_duplicate")))
            else:
                print("catalogue_cars: table not found")
    except SQLAlchemyError as e:
        print("CONNECTION FAILED:", type(e).__name__, "(check DATABASE_URL, network and that the endpoint is awake)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
