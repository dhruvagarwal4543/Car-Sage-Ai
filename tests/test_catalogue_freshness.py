"""Catalogue freshness (evidence-based status) and generation-aware matching of listings to catalogue rows."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from carsage import catalogue
from carsage.app import create_app
from carsage.models import Base, CatalogueCar


@pytest.fixture
def client(tmp_path):
    e = create_engine(f"sqlite:///{tmp_path / 'f.db'}")
    Base.metadata.create_all(e)
    rows = [(1, "1.4 Crdi E Plus", "Diesel", "BS4"), (2, "1.6 Vtvt Sx", "Petrol", "BS4"), (3, "E", "Petrol", "BS6"), (4, "Sx Opt", "Diesel", None), (5, "Old Thing", "Petrol", "BS3")]
    with Session(e) as s:
        s.add_all([CatalogueCar(id=i, source_row=i, make="Hyundai", model="Creta", variant=v, fuel_type=f, price_inr=1000000 + i, emission_norm=n, is_exact_duplicate=False) for i, v, f, n in rows])
        s.add(CatalogueCar(id=9, source_row=9, make="Hyundai", model="Santro Old", variant="Magna", fuel_type="Petrol", price_inr=500000, emission_norm="BS4", is_exact_duplicate=False))
        s.commit()
    return TestClient(create_app(e))


@pytest.mark.parametrize("norm, status", [("BS4", "historical"), ("BS3", "historical"), ("BS IV", "historical"), ("BS6", "possibly_outdated"), ("BS-VI", "possibly_outdated"), (None, "unknown"), ("", "unknown"), ("Euro 5", "unknown")])
def test_freshness_is_judged_from_the_emission_standard_only(norm, status):
    class Car:
        emission_norm = norm
    s, why = catalogue.freshness(Car)
    assert s == status and why and s != "current"


def test_api_exposes_freshness_and_never_says_current(client):
    items = {c["id"]: c for c in client.get("/api/cars?page_size=50&view=variants").json()["items"]}
    assert [items[i]["freshness"] for i in (1, 3, 4, 5)] == ["historical", "possibly_outdated", "unknown", "historical"] and "2020" in items[1]["freshness_reason"]
    assert all(c["freshness"] != "current" for c in items.values())


def match(client, **body):
    return client.post("/api/catalogue/match", json={"make": "Hyundai", "model": "Creta", **body}).json()


def test_a_2024_listing_cannot_match_older_regulation_variants(client):
    out = match(client, model_year=2024)
    assert {c["id"] for c in out["candidates"]} == {3, 4} and out["excluded_older_generation"] == 3 and "older-generation" in out["note"] and out["requires_confirmation"]
    assert {c["id"] for c in match(client)["candidates"]} == {1, 2, 3, 4, 5}                    # no year given: nothing is excluded on a guess
    assert {c["id"] for c in match(client, model_year=2018)["candidates"]} == {1, 2, 3, 4, 5}    # a used 2018 listing may well be BS4


def test_when_only_older_generation_rows_exist_there_is_no_reliable_match(client):
    out = client.post("/api/catalogue/match", json={"make": "Hyundai", "model": "Santro Old", "model_year": 2023}).json()
    assert out["status"] == "unmatched" and out["candidates"] == [] and "only older-generation variants" in out["note"]
