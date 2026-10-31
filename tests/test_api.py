import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from carsage import auth, import_catalogue as ic, predict as predict_mod
from carsage.app import create_app
from carsage.models import Base

# source_row, make, model, variant, fuel, price, transmission, body, seats, mileage, power, boot, airbags, length
CARS = [
    (0, "Maruti Suzuki", "Alto", "LXi", "Petrol", 400000, "Manual", "Hatchback", 5, 22.0, 48, 177, 2, 3430),
    (1, "Maruti Suzuki", "Alto", "VXi", "Petrol", 450000, "Manual", "Hatchback", 5, 22.0, 48, 177, 2, 3430),
    (2, "Maruti Suzuki", "Alto", "VXi", "Petrol", 450000, "Manual", "Hatchback", 5, 22.0, 48, 177, 2, 3430),   # duplicate row (flagged)
    (3, "Tata", "Nexon", "XM", "Diesel", 900000, "Manual", "SUV", 5, 21.5, 110, 350, 2, 3993),
    (4, "Tata", "Nexon", "XZ+", "Diesel", 1200000, "Automatic", "SUV", 5, 21.0, 110, 350, 6, 3993),
    (5, "Hyundai", "Creta", "SX", "Diesel", 1500000, "Automatic", "SUV", 5, 18.0, 115, 433, 6, 4300),
    (6, "Maruti Suzuki", "Ertiga", "VXi", "Petrol", 900000, "Manual", "MPV", 7, 19.0, 103, 209, 2, 4395),
    (7, "Toyota", "Innova", "GX", "Diesel", 1800000, "Manual", "MPV", 7, 15.0, 148, 300, 3, 4735),
    (8, "BMW", "X5", "xDrive", "Diesel", 9000000, "Automatic", "SUV", 5, None, 265, 650, 8, 4922),
    (9, "Tata", "Tiago EV", "XT", "Electric", 800000, "Automatic", "Hatchback", 5, None, None, 240, None, 3769),
    (10, "Honda", "City", "V", "Petrol", 1100000, "Manual", "Sedan", 5, 17.0, 119, 506, 2, 4549),
]


def build_csv(path, cars=CARS):
    rows = []
    for sr, mk, md, va, fu, pr, tr, bo, se, mi, po, bs, ab, ln in cars:
        r = {c: None for c in ic.COLUMNS}
        r.update(source_row=sr, make=mk, model=md, variant=va, Fuel_Type=fu, price_inr=float(pr), Type=tr, Body_Type=bo, Seating_Capacity=se,
                 ARAI_Certified_Mileage=mi, power_ps=po, Boot_Space=bs, Number_of_Airbags=ab, Length=ln, model_group=f"{mk}|{md}",
                 family_group=f"{mk}|{md.split()[0].lower()}", is_exact_duplicate=(sr == 2), duplicate_of_source_row=1 if sr == 2 else None)
        rows.append(r)
    pd.DataFrame(rows).to_csv(path, index=False)
    return path


@pytest.fixture
def engine(tmp_path):
    e = create_engine(f"sqlite:///{tmp_path / 'api.db'}")
    Base.metadata.create_all(e)
    ic.import_catalogue(e, build_csv(tmp_path / "cars.csv"))
    return e


@pytest.fixture
def client(engine):
    return TestClient(create_app(engine))


def ids_by_model(client):
    items = client.get("/api/cars?page_size=50").json()["items"]
    return {(i["model"], i["variant"]): i["id"] for i in items}


# ---------------- health
def test_health_and_readiness(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    r = client.get("/api/health/ready").json()
    assert r["database"] == "ok" and r["cars"] == 10            # the flagged duplicate is not counted


def test_database_down_is_a_clean_503():
    c = TestClient(create_app(create_engine("postgresql+psycopg://x:y@127.0.0.1:1/none?connect_timeout=1")))
    for path in ("/api/cars", "/api/health/ready"):
        r = c.get(path)
        assert r.status_code == 503 and r.json() == {"detail": "Database unavailable"}
    assert c.get("/api/health").status_code == 200              # the app itself is still alive


# ---------------- catalogue
def test_list_hides_duplicates_and_paginates(client):
    r = client.get("/api/cars?page_size=4&page=1").json()
    assert r["total"] == 10 and len(r["items"]) == 4 and r["page"] == 1
    page3 = client.get("/api/cars?page_size=4&page=3").json()
    assert len(page3["items"]) == 2
    seen = [i["id"] for p in (1, 2, 3) for i in client.get(f"/api/cars?page_size=4&page={p}").json()["items"]]
    assert len(seen) == len(set(seen)) == 10


def test_sorting(client):
    prices = [i["price_inr"] for i in client.get("/api/cars?sort=price_desc").json()["items"]]
    assert prices == sorted(prices, reverse=True)
    mileage = [i["mileage_kmpl"] for i in client.get("/api/cars?sort=mileage_desc").json()["items"]]
    assert mileage[0] == 22.0 and mileage[-2:] == [None, None]    # unknown mileage sorts last


def test_filters_and_search(client):
    g = lambda q: client.get("/api/cars?" + q).json()
    assert {i["make"] for i in g("make=tata")["items"]} == {"Tata"}                        # case-insensitive
    assert {i["fuel_type"] for i in g("fuel_type=Electric")["items"]} == {"Electric"}
    assert all(500000 <= i["price_inr"] <= 1000000 for i in g("min_price=500000&max_price=1000000")["items"])
    assert {i["model"] for i in g("min_seats=7")["items"]} == {"Ertiga", "Innova"}
    assert g("q=nexon xz")["total"] == 1                                                    # every word must match
    assert g("q=tata diesel")["total"] == 0                                                 # fuel is not a searchable text field
    assert g("body_type=mpv&transmission=manual")["total"] == 2


def test_search_input_is_safe(client):
    for q in ["%", "_", "'; DROP TABLE catalogue_cars; --", "\\"]:
        r = client.get("/api/cars", params={"q": q})
        assert r.status_code == 200 and r.json()["total"] == 0
    assert client.get("/api/cars").json()["total"] == 10


@pytest.mark.parametrize("qs", ["page=0", "page_size=0", "page_size=500", "sort=random", "min_price=-1", "min_price=9&max_price=1", "min_seats=0"])
def test_list_validation(client, qs):
    assert client.get("/api/cars?" + qs).status_code == 422


def test_detail_related_and_404(client):
    ids = ids_by_model(client)
    d = client.get(f"/api/cars/{ids[('Nexon', 'XM')]}").json()
    assert d["model"] == "Nexon" and d["price_inr"] == 900000 and "related" in d
    assert all(r["model"] != "Nexon" and r["body_type"] == "SUV" for r in d["related"])
    assert client.get("/api/cars/99999").status_code == 404
    assert client.get("/api/cars/abc").status_code == 422
    dup = client.get("/api/cars?q=alto&page_size=50").json()
    assert dup["total"] == 2                                                                # duplicate hidden here too


def test_missing_values_stay_null(client):
    ev = next(i for i in client.get("/api/cars?fuel_type=Electric").json()["items"])
    assert ev["mileage_kmpl"] is None and ev["power_ps"] is None and ev["number_of_airbags"] is None


def test_compare(client):
    ids = ids_by_model(client)
    a, b = ids[("Nexon", "XM")], ids[("Creta", "SX")]
    r = client.get(f"/api/cars/compare?ids={a},{b}").json()
    f = {x["key"]: x for x in r["fields"]}
    assert [c["id"] for c in r["cars"]] == [a, b]
    assert f["price_inr"]["best_index"] == 0 and f["mileage_kmpl"]["best_index"] == 0 and f["power_ps"]["best_index"] == 1
    ev = ids[("Tiago EV", "XT")]
    m = {x["key"]: x for x in client.get(f"/api/cars/compare?ids={a},{ev}").json()["fields"]}
    assert m["mileage_kmpl"]["missing"] == [1] and m["mileage_kmpl"]["differs"] is True
    assert client.get(f"/api/cars/compare?ids={a},99999").status_code == 404
    for bad in (f"{a}", f"{a},{a}", "1,x", ",".join(str(i) for i in range(1, 7))):
        assert client.get(f"/api/cars/compare?ids={bad}").status_code == 422


def test_filters_endpoint(client):
    f = client.get("/api/filters").json()
    assert f["price_min"] == 400000 and f["price_max"] == 9000000
    assert {m["value"]: m["count"] for m in f["makes"]}["Maruti Suzuki"] == 3             # Alto x2 + Ertiga; duplicate excluded
    assert 7 in f["seating_capacities"] and "Electric" in [x["value"] for x in f["fuel_types"]]


def test_model_grouping_is_paginated_and_picks_a_matching_variant(client):
    all_variants = client.get("/api/cars?page_size=50").json()
    grouped = client.get("/api/cars?view=models&page_size=3").json()
    identities = {(c["make"], c["model"]) for c in all_variants["items"]}
    assert grouped["total"] == len(identities) == 8
    seen = [c for page in (1, 2, 3) for c in client.get(f"/api/cars?view=models&page_size=3&page={page}").json()["items"]]
    assert len({(c["make"], c["model"]) for c in seen}) == len(seen) == 8
    nexon = client.get("/api/cars?view=models&make=Tata&model=Nexon&transmission=automatic").json()
    assert nexon["total"] == 1 and nexon["items"][0]["variant"] == "XZ+"
    assert nexon["items"][0]["price_inr"] == 1200000
    assert client.get("/api/cars?view=unknown").status_code == 422


def test_category_membership_includes_compound_types_and_automatic_families(client, engine):
    from sqlalchemy.orm import Session
    from carsage.models import CatalogueCar
    with Session(engine) as session:
        session.add(CatalogueCar(source_row=100, make="Tata", model="Category test", variant="Dual fuel", fuel_type="CNG + Petrol",
                                 body_type="SUV, Crossover", transmission="AMT", price_inr=800000, seating_capacity=5, is_exact_duplicate=False))
        session.commit()
    for query in ("body_type=SUV", "body_type=Crossover", "fuel_type=CNG", "fuel_type=Petrol", "transmission=automatic", "transmission=AMT"):
        cars = client.get("/api/cars?" + query).json()["items"]
        assert any(c["model"] == "Category test" for c in cars), query
    exact = client.get("/api/cars", params={"body_type": "SUV, Crossover", "fuel_type": "CNG + Petrol"}).json()
    assert exact["total"] == 1
    related = client.get(f"/api/cars/{exact['items'][0]['id']}").json()["related"]
    assert any(car["model"] == "Nexon" for car in related)
    facets = client.get("/api/filters").json()
    assert not any("," in f["value"] for f in facets["body_types"])
    assert {f["value"]: f["count"] for f in facets["body_types"]}["Crossover"] == 1
    assert {f["value"]: f["count"] for f in facets["transmission_groups"]}["Automatic"] == 5
    recommended = rec(client, fuel_types=["CNG"], body_types=["Crossover"], transmissions=["automatic"])
    assert recommended["recommendations"][0]["car"]["model"] == "Category test"


def test_facets_follow_filters_and_models_follow_make(client):
    facets = client.get("/api/filters?make=Tata&fuel_type=Diesel").json()
    assert {v["value"] for v in facets["models"]} == {"Nexon"}
    assert {v["value"]: v["count"] for v in facets["body_types"]} == {"SUV": 2}
    assert {v["value"] for v in facets["makes"]} == {"Tata", "Hyundai", "Toyota", "BMW"}
    assert client.get("/api/filters?min_price=100&max_price=1").status_code == 422


# ---------------- recommendations
def rec(client, **prefs):
    r = client.post("/api/recommendations", json=prefs)
    assert r.status_code == 200, r.text
    return r.json()


def test_recommendations_respect_hard_constraints(client):
    out = rec(client, max_price=1300000, fuel_types=["Diesel"], body_types=["SUV"])
    cars = [r["car"] for r in out["recommendations"]]
    assert cars and all(c["price_inr"] <= 1300000 and c["fuel_type"] == "Diesel" and c["body_type"] == "SUV" for c in cars)
    assert out["relaxed_constraints"] == [] and all(r["reasons"] for r in out["recommendations"])


def test_priority_changes_ranking_and_explains(client):
    by_mileage = rec(client, max_price=2000000, priorities=["mileage"])["recommendations"][0]
    by_power = rec(client, max_price=2000000, priorities=["power"])["recommendations"][0]
    assert by_mileage["car"]["mileage_kmpl"] == 22.0 and by_power["car"]["model"] == "Innova"
    assert any("mileage" in r.lower() for r in by_mileage["reasons"])


def test_missing_attribute_is_flagged_not_invented(client):
    out = rec(client, fuel_types=["Electric"], priorities=["mileage", "power"])
    r = out["recommendations"][0]
    assert r["car"]["model"] == "Tiago EV" and any("mileage" in m.lower() for m in r["missing"]) and r["score"] == 0


def test_transmission_automatic_includes_amt_cvt_family(client):
    cars = [r["car"] for r in rec(client, transmissions=["automatic"], max_price=1300000)["recommendations"]]
    assert cars and all(c["transmission"] == "Automatic" for c in cars)


def test_use_case_rule_and_relaxation(client):
    fam = rec(client, use_case="family")["recommendations"]
    assert fam and all("family_friendly" in r["car"]["tags"] for r in fam)
    relaxed = rec(client, max_price=450000, fuel_types=["Diesel"])
    assert relaxed["relaxed_constraints"] and relaxed["recommendations"]               # nothing diesel <= 4.5 lakh -> constraints loosened, and said so
    none = rec(client, min_seats=15)
    assert none["recommendations"] == [] and none["candidates_considered"] == 0


def test_diversity_cap_and_limit(client):
    out = rec(client, limit=10)["recommendations"]
    from collections import Counter
    assert max(Counter(r["car"]["model"] for r in out).values()) <= 2 and len(out) <= 10


def test_recommendation_validation(client):
    for body in ({"min_price": 9, "max_price": 1}, {"limit": 50}, {"fuel_types": ["a"] * 9}, {"priorities": ["speed"]}, {"min_seats": 0}, {"max_price": -5}):
        assert client.post("/api/recommendations", json=body).status_code == 422


# ---------------- assistant
def ask(client, msg, context=None):
    r = client.post("/api/assistant", json={"message": msg, "context": context})
    assert r.status_code == 200, r.text
    return r.json()


def test_assistant_recommends_from_catalogue_only(client):
    out = ask(client, "I need a family car under 15 lakh, diesel suv, automatic")
    assert out["intent"] == "recommend" and out["preferences"]["max_price"] == 1500000
    assert out["preferences"]["fuel_types"] == ["Diesel"] and out["preferences"]["use_case"] == "family"
    real = {i["id"] for i in client.get("/api/cars?page_size=50").json()["items"]}
    assert out["cars"] and all(c["id"] in real for c in out["cars"])
    assert all(c["model"] in out["reply"] or c["make"] in out["reply"] for c in out["cars"][:3])


def test_assistant_budget_parsing(client):
    p = lambda m: ask(client, m)["preferences"]
    assert p("suv under ₹12 lakh")["max_price"] == 1200000
    assert p("petrol below 1.5 crore")["max_price"] == 15000000
    r = p("diesel between 8 and 12 lakh")
    assert (r["min_price"], r["max_price"]) == (800000, 1200000)
    assert p("petrol car under 900000")["max_price"] == 900000


def test_assistant_compare_lookup_and_help(client):
    c = ask(client, "compare Nexon and Creta")
    assert c["intent"] == "compare" and {x["model"] for x in c["cars"]} == {"Nexon", "Creta"} and "Mileage" in c["reply"]
    lk = ask(client, "tell me about the Innova")
    assert lk["intent"] == "lookup" and "Innova" in lk["reply"]
    h = ask(client, "what's the weather like")
    assert h["intent"] == "help" and h["cars"] == []


def test_assistant_city_word_is_not_mistaken_for_honda_city(client):
    out = ask(client, "family car for city driving under 15 lakh")
    assert out["intent"] == "recommend" and out["preferences"]["use_case"] in ("family", "city")
    assert ask(client, "tell me about the honda city")["intent"] == "lookup"


def test_assistant_refines_previous_preferences(client):
    first = ask(client, "suv under 20 lakh")
    second = ask(client, "make it diesel", first["preferences"])
    assert second["preferences"]["max_price"] == 2000000 and second["preferences"]["fuel_types"] == ["Diesel"]


def test_assistant_replaces_choices_and_can_return_to_model_lookup(client):
    first = ask(client, "automatic diesel SUV under 20 lakh")
    second = ask(client, "actually petrol only, manual hatchback", first["preferences"])
    prefs = second["preferences"]
    assert prefs["fuel_types"] == ["Petrol"] and prefs["transmissions"] == ["manual"]
    assert prefs["body_types"] == ["Hatchback"] and prefs["max_price"] == 2000000
    assert all(c["fuel_type"] == "Petrol" and c["transmission"] == "Manual" for c in second["cars"])
    lookup = ask(client, "tell me about the Hyundai Creta", prefs)
    assert lookup["intent"] == "lookup" and {c["model"] for c in lookup["cars"]} == {"Creta"}
    assert lookup["preferences"] == prefs


@pytest.mark.parametrize("message,lo,hi", [
    ("under 12,00,000", None, 1200000), ("under ₹1,200,000", None, 1200000),
    ("₹12,00,000", None, 1200000), ("under 12.5 lakh", None, 1250000),
    ("between 8,00,000 and 12,00,000", 800000, 1200000),
])
def test_assistant_parses_formatted_budgets(client, message, lo, hi):
    prefs = ask(client, message)["preferences"]
    assert (prefs["min_price"], prefs["max_price"]) == (lo, hi)


@pytest.mark.parametrize("message", ["under 0 lakh", "under " + "9" * 300 + " crore", "0 seater"])
def test_assistant_rejects_invalid_extracted_preferences_without_crashing(client, message):
    reply = ask(client, message)
    assert reply["intent"] == "help" and reply["cars"] == []


def test_assistant_input_limits(client):
    assert client.post("/api/assistant", json={"message": ""}).status_code == 422
    assert client.post("/api/assistant", json={"message": "x" * 501}).status_code == 422


# ---------------- price prediction (experimental)
def test_prediction_503_when_model_missing(client, monkeypatch, tmp_path):
    monkeypatch.setenv("PRICE_MODEL_PATH", str(tmp_path / "nope.joblib"))
    predict_mod._load.cache_clear()
    r = client.post("/api/price-predictions", json={"features": {"power_ps": 100}})
    assert r.status_code == 503 and "train_price_model" in r.json()["detail"]


def test_prediction_with_fake_model_flags_warnings(client, monkeypatch):
    class Fake:
        def predict(self, df):
            return [1_000_000.0]
    meta = {"model": "fake", "n_rows": 1, "trained_at": "x", "features": [predict_mod.ATTR_TO_FEATURE[k] for k in ("power_ps", "fuel_type")],
            "numeric": ["power_ps"], "categorical": ["Fuel_Type"], "numeric_ranges": {"power_ps": [30, 300]}, "categories": {"Fuel_Type": ["Petrol"]},
            "held_out_test": {"mae_inr": 1300000, "median_ae_inr": 120000, "mape_pct": 20}}
    monkeypatch.setattr(predict_mod, "load", lambda: (Fake(), meta))
    r = client.post("/api/price-predictions", json={"features": {"power_ps": 900, "fuel_type": "Diesel"}}).json()
    assert r["predicted_price_inr"] == 1000000 and r["experimental"] is True and "resale" in r["typical_error"]
    joined = " ".join(r["warnings"])
    assert "outside the range" in joined and "not seen in training" in joined and "Only" in joined
    car = ids_by_model(client)[("Creta", "SX")]
    r2 = client.post("/api/price-predictions", json={"car_id": car}).json()
    assert r2["actual_ex_showroom_price_inr"] == 1500000


def test_prediction_validation(client):
    assert client.post("/api/price-predictions", json={}).status_code == 422
    assert client.post("/api/price-predictions", json={"features": {}}).status_code == 422
    assert client.post("/api/price-predictions", json={"features": {"power_ps": -5}}).status_code == 422
    assert client.post("/api/price-predictions", json={"car_id": 99999}).status_code == 404


# ---------------- authentication (Firebase verification mocked) and user-data isolation
TOKENS = {"token-alice": {"uid": "alice", "email": "a@example.com"}, "token-bob": {"uid": "bob", "email": "b@example.com"}}


@pytest.fixture
def fake_firebase(monkeypatch):
    def verify(token):
        if token not in TOKENS:
            raise ValueError("bad token")
        return TOKENS[token]
    monkeypatch.setattr(auth, "verify_token", verify)


def H(name):
    return {"Authorization": f"Bearer token-{name}"}


def test_missing_and_invalid_tokens_are_401(client, fake_firebase):
    for path in ("/api/me", "/api/me/saved-cars"):
        r = client.get(path)
        assert r.status_code == 401 and r.headers["www-authenticate"] == "Bearer"
        assert client.get(path, headers={"Authorization": "Bearer garbage"}).status_code == 401
        assert client.get(path, headers={"Authorization": "Basic abc"}).status_code == 401
    assert client.put("/api/me/saved-cars/1").status_code == 401
    assert client.delete("/api/me/saved-cars/1").status_code == 401


def test_valid_token_identifies_user(client, fake_firebase):
    assert client.get("/api/me", headers=H("alice")).json() == {"uid": "alice", "email": "a@example.com"}


def test_token_without_identity_is_403(client, monkeypatch):
    monkeypatch.setattr(auth, "verify_token", lambda t: {"email": "x@example.com"})
    assert client.get("/api/me", headers=H("alice")).status_code == 403


def test_unconfigured_firebase_is_503_not_500(client, monkeypatch):
    def boom(token):
        raise auth.FirebaseNotConfigured("x")
    monkeypatch.setattr(auth, "verify_token", boom)
    r = client.get("/api/me", headers=H("alice"))
    assert r.status_code == 503 and "not configured" in r.json()["detail"]


def test_public_endpoints_need_no_token(client):
    assert client.get("/api/cars").status_code == 200 and client.get("/api/filters").status_code == 200


def test_saved_cars_are_isolated_per_user(client, fake_firebase):
    ids = ids_by_model(client)
    a, b = ids[("Nexon", "XM")], ids[("Creta", "SX")]
    assert client.put(f"/api/me/saved-cars/{a}", headers=H("alice")).status_code == 204
    assert client.put(f"/api/me/saved-cars/{a}", headers=H("alice")).status_code == 204          # idempotent
    client.put(f"/api/me/saved-cars/{b}", headers=H("alice"))
    assert [c["id"] for c in client.get("/api/me/saved-cars", headers=H("alice")).json()] == [b, a]
    assert client.get("/api/me/saved-cars", headers=H("bob")).json() == []                        # bob sees nothing of alice's
    assert client.delete(f"/api/me/saved-cars/{a}", headers=H("bob")).status_code == 404          # and cannot delete it
    assert len(client.get("/api/me/saved-cars", headers=H("alice")).json()) == 2
    assert client.delete(f"/api/me/saved-cars/{a}", headers=H("alice")).status_code == 204
    assert client.delete(f"/api/me/saved-cars/{a}", headers=H("alice")).status_code == 404
    assert client.put("/api/me/saved-cars/99999", headers=H("alice")).status_code == 404


def test_no_secrets_or_internals_in_error_bodies(client, fake_firebase):
    body = client.get("/api/me", headers={"Authorization": "Bearer garbage"}).text
    assert "garbage" not in body and "Traceback" not in body


def test_bare_letter_is_not_a_unit(client):
    p = ask(client, "I like the 12 lamborghini")["preferences"]
    assert p is None or p["max_price"] is None


def test_compare_with_unknown_model_says_so(client):
    out = ask(client, "compare Nexon and Zzzmodel")
    assert out["intent"] == "lookup" and "could only find one" in out["reply"] and out["cars"][0]["model"] == "Nexon"


def test_price_wording_is_unambiguous(client):
    out = rec(client, priorities=["price"], limit=10)["recommendations"]
    assert any("cheapest" in r for x in out for r in x["reasons"]) and any("priciest" in t for x in out for t in x["tradeoffs"])
