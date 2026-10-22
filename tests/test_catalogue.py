import os
from pathlib import Path

import pandas as pd
import pytest
from dotenv import dotenv_values
from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from carsage import import_catalogue as ic
from carsage.models import Base, CatalogueCar

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data/processed/cars_processed.csv"


def row(i, **kw):
    base = {c: None for c in ic.COLUMNS}
    base.update(source_row=i, make="Tata", model="Nexon", variant=f"V{i}", Fuel_Type="Petrol", price_inr=750000.0, Type="Manual",
              Seating_Capacity=5.0, is_exact_duplicate=False)
    base.update(kw)
    return base


@pytest.fixture
def engine(tmp_path):
    e = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(e)
    return e


def write(tmp_path, rows):
    p = tmp_path / "cars.csv"
    pd.DataFrame(rows).to_csv(p, index=False)
    return p


def count(engine):
    with Session(engine) as s:
        return s.scalar(select(func.count()).select_from(CatalogueCar))


# ---- schema
def test_schema_has_catalogue_table_and_no_marketplace_fields(engine):
    cols = {c["name"] for c in inspect(engine).get_columns("catalogue_cars")}
    assert {"source_row", "make", "model", "variant", "price_inr", "fuel_type", "transmission", "seating_capacity"} <= cols
    assert not cols & {"seller", "seller_id", "location", "city", "images", "image_url", "odometer", "owner"}   # nothing invented


def test_db_enforces_unique_source_row_and_positive_price(engine):
    with Session(engine) as s:
        s.add(CatalogueCar(source_row=1, make="A", model="B", variant="C", fuel_type="Petrol", price_inr=1, is_exact_duplicate=False, source_dataset="x"))
        s.commit()
        s.add(CatalogueCar(source_row=1, make="A", model="B", variant="C", fuel_type="Petrol", price_inr=1, is_exact_duplicate=False, source_dataset="x"))
        with pytest.raises(IntegrityError):
            s.commit()
        s.rollback()
        s.add(CatalogueCar(source_row=2, make="A", model="B", variant="C", fuel_type="Petrol", price_inr=-5, is_exact_duplicate=False, source_dataset="x"))
        with pytest.raises(IntegrityError):
            s.commit()


# ---- import: validation, missing values, idempotency
def test_import_keeps_missing_optional_values_as_null(engine, tmp_path):
    out = ic.import_catalogue(engine, write(tmp_path, [row(0, Seating_Capacity=None, Type=None, power_ps=None, Body_Type="  ")]))
    assert out["inserted"] == 1 and out["rejected"] == 0
    with Session(engine) as s:
        car = s.scalars(select(CatalogueCar)).one()
    assert car.seating_capacity is None and car.transmission is None and car.power_ps is None and car.body_type is None   # NULL, not 0 or ""


def test_import_types_ints_and_floats(engine, tmp_path):
    ic.import_catalogue(engine, write(tmp_path, [row(0, Seating_Capacity=7.0, power_ps=118.5, price_inr=1234567.0)]))
    with Session(engine) as s:
        car = s.scalars(select(CatalogueCar)).one()
    assert car.seating_capacity == 7 and isinstance(car.seating_capacity, int) and car.price_inr == 1234567 and car.power_ps == 118.5


def test_invalid_rows_are_rejected_and_reported_not_dropped_silently(engine, tmp_path):
    rows = [row(0), row(1, price_inr=None), row(2, price_inr=0), row(3, make=None), row(4, model=" "), row(0, variant="dup")]
    out = ic.import_catalogue(engine, write(tmp_path, rows))
    assert out["read"] == 6 and out["inserted"] == 1 and out["rejected"] == 5
    assert {sr for sr, _ in out["rejections"]} == {1, 2, 3, 4, 0}
    assert count(engine) == 1


def test_missing_csv_columns_fail_loudly(engine, tmp_path):
    p = tmp_path / "bad.csv"; pd.DataFrame({"source_row": [1]}).to_csv(p, index=False)
    with pytest.raises(ValueError, match="missing expected columns"):
        ic.import_catalogue(engine, p)


def test_repeat_import_is_idempotent(engine, tmp_path):
    p = write(tmp_path, [row(i) for i in range(5)])
    first, second = ic.import_catalogue(engine, p), ic.import_catalogue(engine, p)
    assert first["inserted"] == 5 and second["inserted"] == 0 and second["updated"] == 0 and second["unchanged"] == 5
    assert count(engine) == 5


def test_changed_source_row_is_updated_not_duplicated(engine, tmp_path):
    ic.import_catalogue(engine, write(tmp_path, [row(0, price_inr=100.0)]))
    out = ic.import_catalogue(engine, write(tmp_path, [row(0, price_inr=200.0), row(1)]))
    assert out["updated"] == 1 and out["inserted"] == 1 and count(engine) == 2
    with Session(engine) as s:
        assert s.scalar(select(CatalogueCar.price_inr).where(CatalogueCar.source_row == 0)) == 200


def test_import_does_not_modify_the_csv(engine, tmp_path):
    p = write(tmp_path, [row(0)]); before = p.read_bytes()
    ic.import_catalogue(engine, p)
    assert p.read_bytes() == before


@pytest.mark.skipif(not PROCESSED.exists(), reason="run src/preprocess.py first")
def test_real_processed_csv_imports_every_row_once(engine):
    n = len(pd.read_csv(PROCESSED))
    a, b = ic.import_catalogue(engine), ic.import_catalogue(engine)
    assert a["rejected"] == 0 and a["inserted"] == n == count(engine) and b["inserted"] == 0 and count(engine) == n
    with Session(engine) as s:
        assert s.scalar(select(func.count()).where(CatalogueCar.is_exact_duplicate)) == 9   # duplicates flagged, not removed


# ---- PostgreSQL-specific (dedicated carsage_test database only)
def _pg_url():
    url = os.environ.get("TEST_DATABASE_URL") or dotenv_values(ROOT / ".env").get("TEST_DATABASE_URL")
    if not url or not url.startswith("postgresql"):
        pytest.skip("TEST_DATABASE_URL not set")
    assert url.rsplit("/", 1)[-1] == "carsage_test", "refusing to run destructive tests on any other database"
    try:
        create_engine(url).connect().close()
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"carsage_test not reachable: {type(e).__name__}")
    return url


def test_postgres_migration_matches_models_and_import_is_idempotent(tmp_path):
    from alembic import command
    from alembic.autogenerate import compare_metadata
    from alembic.config import Config
    from alembic.migration import MigrationContext

    url = _pg_url()
    cfg = Config(str(ROOT / "alembic.ini")); cfg.set_main_option("sqlalchemy.url", url); cfg.set_main_option("script_location", str(ROOT / "alembic"))
    engine = create_engine(url)
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    try:
        with engine.connect() as c:
            assert compare_metadata(MigrationContext.configure(c), Base.metadata) == []   # migration == models, no drift
        p = write(tmp_path, [row(i) for i in range(20)])
        assert ic.import_catalogue(engine, p)["inserted"] == 20
        assert ic.import_catalogue(engine, p)["inserted"] == 0 and count(engine) == 20
        with pytest.raises(IntegrityError), engine.begin() as c:
            c.execute(text("insert into catalogue_cars (source_row,make,model,variant,fuel_type,price_inr,is_exact_duplicate,source_dataset) "
                           "values (1,'a','b','c','p',1,false,'x')"))
    finally:
        command.downgrade(cfg, "base")   # leave the test database empty


# ---- connection settings (Neon readiness): pure functions, no network
def test_url_normalisation_and_neon_options():
    from carsage import db
    assert db.normalize_url("postgresql://u:p@h/d?sslmode=require").startswith("postgresql+psycopg://u:p@h/d")
    assert db.normalize_url("postgres://u:p@h/d").startswith("postgresql+psycopg://")
    assert db.normalize_url("sqlite:///x.db") == "sqlite:///x.db"
    pooled = db.engine_options("postgresql+psycopg://u:p@ep-cool-123-pooler.us-east-2.aws.neon.tech/neondb")
    assert pooled["connect_args"] == {"sslmode": "require", "prepare_threshold": None} and pooled["pool_pre_ping"] is True
    direct = db.engine_options("postgresql+psycopg://u:p@ep-cool-123.us-east-2.aws.neon.tech/neondb")
    assert direct["connect_args"] == {"sslmode": "require"}                      # SSL forced for Neon, prepared statements left on
    explicit = db.engine_options("postgresql+psycopg://u:p@x.neon.tech/d?sslmode=verify-full")
    assert "connect_args" not in explicit                                        # an explicit sslmode is respected
    assert "connect_args" not in db.engine_options("postgresql+psycopg://u:p@localhost/d")   # local Postgres untouched
    assert db.engine_options("sqlite:///x.db") == {}


def test_migration_url_prefers_unpooled(monkeypatch):
    from carsage import db
    monkeypatch.setattr(db, "load_dotenv", lambda: None)
    monkeypatch.setenv("DATABASE_URL", "postgresql://pooled")
    monkeypatch.setenv("DATABASE_URL_UNPOOLED", "postgresql://direct")
    assert db.migration_url() == "postgresql://direct"
    monkeypatch.delenv("DATABASE_URL_UNPOOLED")
    assert db.migration_url() == "postgresql://pooled"
    monkeypatch.delenv("DATABASE_URL")
    with pytest.raises(RuntimeError, match="DATABASE_URL is not set"):
        db.migration_url()
