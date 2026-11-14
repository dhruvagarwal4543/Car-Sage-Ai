"""The advisor agent's AI core: knowledge rules, CSP feasibility, relaxation search, decision trace, NLU and the API guards around it."""
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as Car

import pytest
from sqlalchemy import select
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from carsage import csp, history, rules, search
from carsage.app import create_app
from carsage.assistant import parse, unsupported
from carsage.models import CatalogueCar
from carsage.schemas import Preferences
from fastapi.testclient import TestClient
from tests.test_api import ask, client, engine, ids_by_model, rec  # noqa: F401 - fixtures


def car(**kw):
    base = dict(id=1, make="M", model="X", variant="V", price_inr=1000000, fuel_type="Petrol", transmission="Manual", body_type="SUV", seating_capacity=5,
                boot_space_litres=400, length_mm=4000, min_turning_radius_m=None, mileage_kmpl=18, power_ps=100, number_of_airbags=2, model_group="M|X")
    return Car(**{**base, **kw})


# ---------------- knowledge base
def test_rules_fire_only_when_their_attributes_are_recorded():
    assert [r.id for r in rules.fire(car(seating_capacity=7, mileage_kmpl=22, power_ps=160))] == ["city_friendly", "family_friendly", "fuel_efficient", "powerful"]   # priority, then id
    unknown = car(seating_capacity=None)
    assert "family_friendly" not in rules.derive_tags(unknown) and [r.id for r in rules.undetermined(unknown)] == ["family_friendly"]
    assert rules.derive_tags(car(fuel_type="Electric", mileage_kmpl=None, seating_capacity=4)) == ["city_friendly", "fuel_efficient"]   # two rules, one tag, no duplicate


# ---------------- CSP
def test_constraints_use_true_false_none_and_missing_never_satisfies():
    cs = {c.id: c for c in csp.build(Preferences(max_price=900000, fuel_types=["Diesel"], transmissions=["automatic"], body_types=["SUV"], min_seats=5, use_case="family"))}
    c = car(price_inr=800000, fuel_type="Diesel+CNG", transmission="AMT", body_type="SUV, Crossover")
    assert all(cs[k].check(c) is True for k in cs)
    assert cs["max_price"].check(car(price_inr=950000)) is False
    assert cs["transmission"].check(car(transmission=None)) is None and cs["min_seats"].check(car(seating_capacity=None)) is None
    assert cs["use_case"].check(car(boot_space_litres=None)) is None
    no_gear, pricey = car(price_inr=800000, fuel_type="Diesel", transmission=None), car(price_inr=2000000, fuel_type="Diesel", transmission="AMT")
    assert csp.feasible([c, no_gear, pricey], cs.values()) == [c]                  # None is not a pass
    assert csp.eliminated([c, no_gear, pricey], cs.values()) == {"max_price": 1, "use_case": 0, "body_type": 0, "transmission": 1, "fuel_type": 0, "min_seats": 0}


def test_hard_floors_are_never_relaxable():
    cs = csp.build(Preferences(min_price=500000, min_seats=7, max_price=800000))
    assert [(c.id, c.relax_cost) for c in cs] == [("max_price", 1), ("min_price", None), ("min_seats", None)]


# ---------------- state-space search
def test_search_finds_the_cheapest_relaxation_not_the_first_in_order():
    # only a non-SUV diesel exists: dropping body (cost 3) is cheaper than budget (1) + use case (2) + body (3)
    domain = [car(price_inr=700000, fuel_type="Diesel", body_type="Hatchback")]
    r = search.solve(domain, csp.build(Preferences(max_price=800000, fuel_types=["Diesel"], body_types=["SUV"])))
    assert r.cars == domain and r.relaxed == ["dropped the body-type requirement"] and r.cost == 3 and r.strategy == "uniform-cost"


def test_search_combines_relaxations_when_one_is_not_enough_and_is_deterministic():
    domain = [car(price_inr=1100000, transmission="Automatic", fuel_type="Diesel")]
    cs = csp.build(Preferences(max_price=1000000, transmissions=["manual"], fuel_types=["Diesel"]))
    a, b = search.solve(domain, cs), search.solve(domain, cs)
    assert a.relaxed == ["raised the budget by 15% to ₹11.50 lakh", "dropped the transmission requirement"] and a.cost == 5
    assert a.relaxed == b.relaxed and a.expanded == b.expanded


def test_search_terminates_without_a_solution_and_respects_strict_mode():
    domain = [car(seating_capacity=5)]
    cs = csp.build(Preferences(min_seats=7, fuel_types=["Diesel"]))
    r = search.solve(domain, cs)
    assert r.cars == [] and r.relaxed == [] and r.expanded == 2            # start + the only relaxable successor (fuel); seats is never relaxed
    strict = search.solve([car(price_inr=1100000)], csp.build(Preferences(max_price=1000000)), allow_relaxation=False)
    assert strict.cars == [] and strict.strategy == "strict" and strict.expanded == 1
    assert search.solve(domain, [], allow_relaxation=True).strategy == "none"  # initial state already a goal


def test_greedy_baseline_can_concede_more_than_the_search():
    domain = [car(price_inr=700000, fuel_type="Diesel", body_type="Hatchback")]
    cs = csp.build(Preferences(max_price=800000, fuel_types=["Diesel"], body_types=["SUV"]))
    assert search.greedy(domain, cs).cost > search.solve(domain, cs).cost


# ---------------- the agent through the API
def test_strict_results_satisfy_every_declared_constraint_and_carry_a_trace(client):
    out = rec(client, max_price=1300000, fuel_types=["Diesel"], transmissions=["automatic"], body_types=["SUV"], min_seats=5)
    assert out["relaxed_constraints"] == [] and out["recommendations"]
    for r in out["recommendations"]:
        c = r["car"]
        assert c["price_inr"] <= 1300000 and "Diesel" in c["fuel_type"] and c["transmission"].lower() in ("automatic", "amt", "cvt", "dct") and "SUV" in c["body_type"] and c["seating_capacity"] >= 5
    t = out["trace"]
    assert t["initial_candidates"] == 10 and t["feasible"] == len(out["recommendations"]) == 1 and t["search"]["strategy"] == "none"
    assert [c["id"] for c in t["constraints"]] == ["max_price", "body_type", "transmission", "fuel_type", "min_seats"]
    assert t["eliminated"]["fuel_type"] == 5 and t["ranking"][0]["car_id"] == out["recommendations"][0]["car"]["id"] and t["latency_ms"] >= 0
    assert "uid" not in str(t) and "email" not in str(t)


def test_relaxation_is_explained_and_can_be_refused(client):
    relaxed = rec(client, max_price=450000, fuel_types=["Diesel"])
    assert relaxed["trace"]["search"]["strategy"] == "uniform-cost" and relaxed["trace"]["relaxation"] == relaxed["relaxed_constraints"] != []
    strict = rec(client, max_price=450000, fuel_types=["Diesel"], allow_relaxation=False)
    assert strict["recommendations"] == [] and "relaxation was not allowed" in strict["notes"][-1] and strict["trace"]["search"]["strategy"] == "strict"


def test_missing_attributes_are_reported_not_scored(client):
    out = rec(client, fuel_types=["Electric"], priorities=["mileage", "power"])
    r = out["recommendations"][0]
    assert r["car"]["model"] == "Tiago EV" and r["score"] == 0 and {"Mileage is not recorded in the dataset", "Power is not recorded in the dataset"} <= set(r["missing"])
    assert out["trace"]["missing_attributes"]["Tata Tiago EV XT"] == r["missing"]


def test_agent_description_endpoint_matches_the_code(client):
    d = client.get("/api/agent").json()
    assert set(d["peas"]) == {"performance", "environment", "actuators", "sensors"}
    assert [r["id"] for r in d["knowledge_base"]] == list(rules.RULES) and d["search"]["strategy"].startswith("uniform-cost") and d["non_ai_components"]


# ---------------- natural-language understanding
@pytest.mark.parametrize("msg, expect", [
    ("1.5 l diesel suv", {"max_price": None, "fuel_types": ["Diesel"], "body_types": ["SUV"]}),
    ("petrol car with 2.0 litre engine under 10 lakh", {"max_price": 1000000, "fuel_types": ["Petrol"]}),
    ("automatic family car below 12 lakh", {"max_price": 1200000, "transmissions": ["automatic"], "use_case": "family", "min_seats": 5}),
    ("best mileage car under 10 lakh", {"max_price": 1000000, "priorities": ["mileage"]}),
    ("7 seater automatic", {"min_seats": 7, "transmissions": ["automatic"]}),
    ("diesel suv, strict, no compromise", {"fuel_types": ["Diesel"], "allow_relaxation": False}),
])
def test_parse_realistic_queries(msg, expect):
    p = parse(msg).model_dump()
    assert {k: p[k] for k in expect} == expect


def test_unsupported_requests_are_named_not_guessed(client):
    assert unsupported("Diesel SUV for highway driving with 1.5 litre engine") == ["engine size", "highway/driving use"]
    out = ask(client, "diesel suv under 15 lakh for highway driving")
    assert out["intent"] == "recommend" and out["unsupported"] == ["highway/driving use"] and "cannot filter by highway/driving use" in out["reply"]
    assert out["preferences"]["fuel_types"] == ["Diesel"] and out["trace"]["constraints"]
    help_out = ask(client, "how good is the resale after 3 years")
    assert help_out["intent"] == "help" and help_out["unsupported"] == ["resale value"]


# ---------------- API guards
def test_rate_limit_returns_429_after_the_configured_burst(engine, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "3")
    c = TestClient(create_app(engine))
    codes = [c.post("/api/recommendations", json={"max_price": 1000000}).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    assert c.get("/api/cars").status_code == 200                                  # reads are not limited


def test_missing_schema_is_a_503_not_a_crash(client, monkeypatch):
    def boom(*a, **k):
        raise ProgrammingError("select 1", {}, Exception('relation "price_observations" does not exist'))
    monkeypatch.setattr(history, "history", boom)
    r = client.post("/api/price-history/query", json={"car_id": 1, "model_year": 2024, "market": "India", "price_type": "ex_showroom", "vehicle_status": "new"})
    assert r.status_code == 503 and "alembic upgrade head" in r.json()["detail"]


def test_daily_observation_cap_per_user(engine, monkeypatch):
    monkeypatch.setattr(history, "DAILY_LIMIT", 2)
    with Session(engine) as s:
        cid = s.scalar(select(CatalogueCar.id).where(CatalogueCar.variant == "SX"))
        now = datetime.now(timezone.utc)
        obs = lambda i: history.ObservationIn(make="Hyundai", model="Creta", variant="SX", car_id=cid, source_url=f"https://x.example/{i}", price_inr=1500000 + i,
                                              price_type="ex_showroom", vehicle_status="new", model_year=2024, market="India", observed_at=now - timedelta(minutes=i), consent=True)
        assert history.ingest(s, obs(1), "u1")[1] and history.ingest(s, obs(2), "u1")[1]
        with pytest.raises(history.LimitExceeded):
            history.ingest(s, obs(3), "u1")
        assert history.ingest(s, obs(4), "u2")[1]                                 # the cap is per user


# ---------------- evaluation harness
def test_evaluation_runs_on_a_small_catalogue_and_measures_what_it_promises(engine):
    from src.evaluate_recommender import SYSTEMS, evaluate
    res = evaluate(engine, scenarios=[("a", dict(max_price=1000000, fuel_types=["Diesel"])), ("none", dict(max_price=300000, min_seats=9))], systems=SYSTEMS)
    full, base = res["agent_full"], res["catalogue_order"]
    assert full["hard_constraint_satisfaction"] == 1.0 and full["explanation_consistency"] == 1.0 and full["ranking_stability"] == 1.0
    assert full["empty_results_explained"] == "1/1" and base["hard_constraint_satisfaction"] < 1.0


def test_rate_limit_table_is_bounded(engine, monkeypatch):
    from collections import deque
    import carsage.app as app_mod
    monkeypatch.setattr(app_mod, "RATE_TABLE_MAX", 10)
    c = TestClient(create_app(engine))
    for i in range(30):
        c.app.state.rate_hits[f"10.0.0.{i}"] = deque([time.monotonic() - 1000 + i])        # idle clients
    assert c.post("/api/recommendations", json={"max_price": 1000000}).status_code == 200
    assert len(c.app.state.rate_hits) <= 11


def test_daily_cap_holds_under_parallel_requests(engine, monkeypatch):
    import threading
    monkeypatch.setattr(history, "DAILY_LIMIT", 3)
    with Session(engine) as s:
        cid = s.scalar(select(CatalogueCar.id).where(CatalogueCar.variant == "SX"))
    now = datetime.now(timezone.utc)
    made, errors = [], []

    def post(i):
        try:
            with Session(engine) as s:
                data = history.ObservationIn(make="Hyundai", model="Creta", variant="SX", car_id=cid, source_url=f"https://x.example/{i}", price_inr=1500000 + i, price_type="ex_showroom",
                                             vehicle_status="new", model_year=2024, market="India", observed_at=now - timedelta(minutes=i), consent=True)
                made.append(history.ingest(s, data, "racer")[1])
        except history.LimitExceeded:
            errors.append(i)
    ts = [threading.Thread(target=post, args=(i,)) for i in range(8)]
    [t.start() for t in ts]
    [t.join(10) for t in ts]
    assert sum(made) == 3 and len(errors) == 5
