"""Live price comparison on recorded real pages: provider parsing, price bases, identity matching, grouping, verification, fallbacks, cache,
failures, SSRF and the API. Fixtures are trimmed copies of real public pages (tests/fixtures/prices/README.md); nothing here touches the network."""
import re
import threading
import time
from pathlib import Path

import httpx
import pytest

from carsage import prices, providers, scheduler as sched
from carsage.prices import CompareIn, Identity, compare, match
from carsage.providers import CarDekho, CarWale, PageSpec, basis, raw
from tests.test_api import client, engine, rec  # noqa: F401

FIX = Path(__file__).parent / "fixtures/prices"
read = lambda n: (FIX / n).read_text()   # noqa: E731
CD_E = "https://www.cardekho.com/overview/Hyundai_Creta/Hyundai_Creta_E.htm"
CD_MODEL = "https://www.cardekho.com/hyundai/creta"
PAGES = {
    CD_MODEL: "cardekho-creta.html",
    "https://www.cardekho.com/hyundai/creta/price-in-mumbai": "cardekho-creta-mumbai.html",
    CD_E: "cardekho-variant-creta-e.html",
    "https://www.carwale.com/hyundai-cars/creta/": "carwale-creta.html",
    "https://www.carwale.com/hyundai-cars/creta/price-in-delhi/": "carwale-creta-delhi.html",
    "https://www.carwale.com/hyundai-cars/creta/price-in-mumbai/": "carwale-creta-mumbai.html",
}
CALLS, OVERRIDE = [], {}


def fake_http(url):
    CALLS.append(url)
    if url in OVERRIDE:
        return httpx.Response(200, text=OVERRIDE[url], request=httpx.Request("GET", url))
    name = PAGES.get(url)
    return httpx.Response(200 if name else 404, text=read(name) if name else "nope", request=httpx.Request("GET", url))


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    """Empty cache, a scheduler with no spacing, fake pages, no real network."""
    CALLS.clear()
    OVERRIDE.clear()
    monkeypatch.setattr(prices, "cache", prices.Cache())
    monkeypatch.setattr(prices, "fetcher", prices.Fetcher(http=fake_http, scheduler=sched.Scheduler(min_gap=0, max_wait=1, budget=1000)))


def creta(**kw):
    return Identity(**{"make": "Hyundai", "model": "Creta", "variant": "E", "fuel_type": "Petrol", "transmission": "Manual", **kw})


def body(vehicle=None, **kw):
    return CompareIn(vehicle=vehicle or creta(), **kw)


def codes(out, price_type="ex_showroom"):
    return {g["basis"]["code"]: g["providers"] for g in out["comparable_groups"] if g["price_type"] == price_type}


def serve(monkeypatch, per_provider):
    """Replace page fetching: {provider name: [raw quotes]}; other providers are unavailable."""
    monkeypatch.setattr(prices, "page_result", lambda spec, *a, **k: prices.PageResult(spec, providers.Parsed(quotes=per_provider[spec.provider]), 1.0, "fresh") if spec.provider in per_provider else prices.PageResult(spec))


# ================================================================ price basis
def test_basis_codes_distinguish_city_national_average_and_unspecified():
    assert basis("ex_showroom", "New Delhi")["code"] == "DELHI_EX_SHOWROOM" and basis("on_road", "mumbai")["code"] == "MUMBAI_ON_ROAD"
    assert basis("ex_showroom", national_average=True)["code"] == "NATIONAL_AVERAGE_EX_SHOWROOM" and basis("ex_showroom")["code"] == "UNSPECIFIED_EX_SHOWROOM"
    assert basis("on_road", "Atlantis")["location_kind"] == "unspecified" and basis("weird")["code"] == "UNSPECIFIED_UNKNOWN"
    assert len({basis("ex_showroom")["code"], basis("ex_showroom", "Delhi")["code"], basis("ex_showroom", national_average=True)["code"]}) == 3   # never equal


# ================================================================ providers on recorded pages
def test_cardekho_model_page_is_ex_showroom_in_the_city_the_page_names_and_gives_a_model_level_range():
    p = CarDekho().parse(PageSpec("CarDekho", "model", CD_MODEL), read("cardekho-creta.html"), "Hyundai", "Creta")
    q = p.quotes[0]
    assert len(p.quotes) == 12 and (q["vehicle"], q["price_inr"], q["price_type"], q["source_url"]) == ("E", 1090700, "ex_showroom", CD_E)
    assert q["basis"]["code"] == "DELHI_EX_SHOWROOM" and q["price_label"] == "Ex-Showroom Price in New Delhi" and q["fuel_type"] is None
    assert [q["fuel_type"] for q in p.quotes if q["vehicle"] == "E Diesel"] == ["Diesel"]
    assert [(m["price_low"], m["price_high"]) for m in p.model_level] == [(1090700, 2045700)]


def test_cardekho_city_page_is_on_road_and_only_trusted_when_the_title_confirms_the_city():
    spec = PageSpec("CarDekho", "city", "https://www.cardekho.com/hyundai/creta/price-in-mumbai", "Mumbai")
    p = CarDekho().parse(spec, read("cardekho-creta-mumbai.html"), "Hyundai", "Creta")
    assert (p.quotes[0]["vehicle"], p.quotes[0]["price_inr"], p.quotes[0]["price_type"], p.quotes[0]["basis"]["code"]) == ("E", 1316173, "on_road", "MUMBAI_ON_ROAD")
    assert CarDekho().parse(PageSpec("CarDekho", "city", "x", "Pune"), read("cardekho-creta-mumbai.html"), "Hyundai", "Creta").quotes == []   # would mislabel Mumbai prices as Pune


def test_cardekho_model_page_without_a_city_sentence_has_an_unspecified_location():
    html = re.sub(r"Ex-Showroom Price in\s+New Delhi", "Ex-Showroom Price", read("cardekho-creta.html"))
    assert "New Delhi" not in html
    q = CarDekho().parse(PageSpec("CarDekho", "model", "u"), html, "Hyundai", "Creta").quotes[0]
    assert q["basis"]["code"] == "UNSPECIFIED_EX_SHOWROOM" and "city not stated" in q["price_label"]


def test_carwale_model_page_is_a_national_average():
    p = CarWale().parse(PageSpec("CarWale", "model", "https://www.carwale.com/hyundai-cars/creta/"), read("carwale-creta.html"), "Hyundai", "Creta")
    q = p.quotes[0]
    assert len(p.quotes) == 10 and (q["vehicle"], q["price_inr"], q["price_type"], q["basis"]["code"]) == ("E Petrol 1.5L Manual", 1090700, "ex_showroom", "NATIONAL_AVERAGE_EX_SHOWROOM")
    assert (q["fuel_type"], q["transmission"], q["engine_l"]) == ("Petrol", "Manual", 1.5) and q["source_url"] == "https://www.carwale.com/hyundai-cars/creta/e/"


def test_carwale_city_page_gives_ex_showroom_and_on_road_for_that_city():
    spec = PageSpec("CarWale", "city", "https://www.carwale.com/hyundai-cars/creta/price-in-delhi/", "Delhi")
    p = CarWale().parse(spec, read("carwale-creta-delhi.html"), "Hyundai", "Creta")
    e = {(q["price_type"], q["basis"]["code"]): q["price_inr"] for q in p.quotes if q["vehicle"] == "E Petrol 1.5L Manual"}
    assert e == {("on_road", "DELHI_ON_ROAD"): 1261704, ("ex_showroom", "DELHI_EX_SHOWROOM"): 1090700}
    assert CarWale().parse(PageSpec("CarWale", "city", "x", "Mumbai"), read("carwale-creta-delhi.html"), "Hyundai", "Creta").quotes == []    # the title says Delhi


def test_transmission_types_engines_and_generations_are_parsed_from_names():
    assert providers.gear_of("EX (O) Petrol 1.5L CVT Speed Automatic (CVT)") == ("Automatic", "CVT") and providers.gear_of("Smart 5 Speed Manual") == ("Manual", None)
    assert providers.gear_of("Automatic") == ("Automatic", None) and providers.gear_of("") == (None, None) and providers.gear_of("manual or automatic") == (None, None)
    assert providers.year_range("Creta [2020-2023]") == (2020, 2023) and providers.year_range("Creta 2024") is None and providers.engine_litres("Smart 1.2L Turbo") == 1.2


@pytest.mark.parametrize("html", ["", "<html><body>moved</body></html>", '<script type="application/ld+json">{not json</script>', '"versions":[{"versionId":1,"versionName":"X"}]', '"versions":[{"broken'])
def test_malformed_or_changed_pages_yield_no_quotes_not_errors(html):
    for prov in (CarDekho(), CarWale()):
        assert prov.parse(PageSpec(prov.name, "model", "u"), html, "Hyundai", "Creta").quotes == []


def test_json_ld_may_be_a_list_a_graph_or_hold_non_objects_and_foreign_currency_is_dropped():
    html = ('<script type="application/ld+json">[{"@type":"WebPage"},"text",{"@graph":[{"hasVariant":[{"name":"Hyundai Creta E","url":"https://www.cardekho.com/overview/a.htm","offers":{"price":"1090700","priceCurrency":"INR"}},'
            '"junk",{"name":"Hyundai Creta X","url":"https://www.cardekho.com/x","offers":{"price":"1","priceCurrency":"USD"}},{"name":"Hyundai Creta Y","url":"https://evil.example/y","offers":{"price":"5","priceCurrency":"INR"}}]}]}]</script>')
    assert [q["price_inr"] for q in CarDekho().parse(PageSpec("CarDekho", "model", "u"), html, "Hyundai", "Creta").quotes] == [1090700]


# ================================================================ identity matching
def q(vehicle, fuel=None, gear=None, price=1, ptype="ex_showroom", url="https://www.carwale.com/x/"):
    out = raw(vehicle, url, price, ptype, "label", basis(ptype, "Delhi"))
    out.update(fuel_type=fuel or out["fuel_type"], transmission=gear or out["transmission"])
    return out


def nexon(**kw):
    return Identity(**{"make": "Tata", "model": "Nexon", "variant": "Smart", "fuel_type": "Petrol", "transmission": "Manual", **kw})


@pytest.mark.parametrize("ident, quote, expect", [
    (creta(), q("E Petrol 1.5L Manual"), "exact"),
    (creta(), q("E"), "probable"),                                                 # the provider states neither fuel nor transmission
    (creta(fuel_type=None), q("E Petrol 1.5L Manual"), "probable"),               # the listing does not say: cannot be verified
    (creta(), q("E Diesel 1.5L Turbo Manual"), "mismatch"),                        # fuel
    (creta(transmission="Automatic"), q("E Petrol 1.5L Manual"), "mismatch"),     # transmission
    (creta(transmission="Automatic (CVT)"), q("E Petrol 1.5L IVT Automatic (IVT)"), "mismatch"),           # CVT is not IVT
    (creta(transmission="Automatic"), q("E Petrol 1.5L CVT Automatic (CVT)"), "exact"),                     # a bare "automatic" is compatible
    (creta(engine_cc=1493), q("E Petrol 1.5L Manual"), "exact"),                                              # 1.5 L ~ 1493 cc
    (creta(engine_cc=1197), q("E Petrol 1.5L Manual"), "mismatch"),                                           # different displacement
    (creta(variant="SX"), q("SX (O) Petrol 1.5L Manual"), "ambiguous"),            # an extra trim word is a different trim
    (creta(variant="SX (O) Knight"), q("SX Petrol"), "mismatch"),
    (nexon(), q("Smart Plus S Petrol 1.2L Turbo 5 Speed Manual"), "ambiguous"),
    (nexon(), q("Smart Petrol 1.2L Turbo 5 Speed Manual"), "exact"),               # drivetrain words are not trim words
    (nexon(variant="Smart Plus S", fuel_type="Diesel", transmission=None), q("Fearless Plus A PS Red Dark DCA", "Diesel"), "mismatch"),
    (creta(variant=None), q("E Petrol 1.5L Manual"), "ambiguous"),
    (creta(variant="EX"), q("E Petrol 1.5L Manual"), "mismatch"),
    (Identity(make="Tata", model="Tiago EV", variant="Smart 19.2 kWh", fuel_type="Electric"), q("Smart 19.2 kWh", "Electric"), "exact"),     # an EV has no gearbox to verify
    (Identity(make="Tata", model="Tiago EV", variant="Smart 19.2 kWh", fuel_type="Electric"), q("Smart 24 kWh", "Electric"), "ambiguous"),   # a different battery is a different variant
])
def test_match_levels(ident, quote, expect):
    assert match(ident, quote)[0] == expect


def test_generation_and_model_year_contradictions_are_mismatches_and_a_missing_generation_is_not_guessed():
    old, new = q("E Petrol 1.5L Manual [2020-2023]"), q("E Petrol 1.5L Manual")
    assert match(creta(generation="2015-2019"), old)[0] == "mismatch" and match(creta(generation="2020-2023"), old)[0] == "exact"
    assert match(creta(model_year=2024), old)[0] == "mismatch" and match(creta(model_year=2022), old)[0] == "exact"
    assert match(creta(generation="2015-2019"), new)[0] == "exact"           # the quote states no generation: not contradicted, and not guessed either
    assert match(creta(model_year=2024), dict(new, model_year=2019))[0] == "mismatch"


def test_the_page_being_viewed_is_exact_without_stating_fuel_or_gearbox_unless_it_contradicts():
    assert match(creta(), q("E"), own_page=True)[0] == "exact" and match(creta(fuel_type="Diesel"), q("E Petrol"), own_page=True)[0] == "mismatch"


# ================================================================ comparison by basis
def test_delhi_ex_showroom_from_both_providers_is_one_comparable_group():
    out = compare(body(vehicle=creta(city="Delhi"), source_url=CD_E, displayed_price_inr=1090700, displayed_price_type="ex_showroom", displayed_price_city="New Delhi"))
    assert out["current_provider"] == "CarDekho" and out["provider_failures"] == [] and out["incompatible_bases"] is None
    assert codes(out) == {"DELHI_EX_SHOWROOM": ["CarDekho", "CarWale"]}
    g = out["comparable_groups"][0]
    assert g["comparable_across_providers"] and {x.match for x in g["quotes"]} == {"exact"} and out["lowest_comparable"].price_inr == 1090700
    assert g["tied_lowest_providers"] == ["CarDekho", "CarWale"]                           # same price on both: no winner is named
    assert out["difference_from_displayed_inr"] == 0 and out["savings_inr"] is None and out["probable_quotes"] == []
    assert "https://www.carwale.com/hyundai-cars/creta/price-in-delhi/" in CALLS and "https://www.carwale.com/hyundai-cars/creta/" not in CALLS     # CarWale: the city page only


def test_without_a_city_the_two_bases_are_separate_and_never_compared():
    out = compare(body(source_url=CD_E, displayed_price_inr=1090700, displayed_price_type="ex_showroom", displayed_price_city="New Delhi"))
    assert codes(out) == {"DELHI_EX_SHOWROOM": ["CarDekho"], "NATIONAL_AVERAGE_EX_SHOWROOM": ["CarWale"]}
    assert out["incompatible_bases"] == "Prices shown are from different location bases and cannot be directly compared."
    assert out["savings_inr"] is None and any("no 'cheapest across websites' claim" in w for w in out["warnings"])
    assert out["lowest_comparable"].basis["code"] == "DELHI_EX_SHOWROOM" and out["difference_from_displayed_inr"] == 0      # displayed Delhi vs Delhi only


def test_a_displayed_price_with_an_unspecified_or_different_basis_gets_no_difference_or_saving():
    out = compare(body(displayed_price_inr=1200000, displayed_price_type="ex_showroom"))                          # no city stated for the displayed price
    assert out["difference_from_displayed_inr"] is None and out["savings_inr"] is None and any("different basis" in w for w in out["warnings"])
    out = compare(body(displayed_price_inr=1200000, displayed_price_type="ex_showroom", displayed_price_national_average=True))
    assert out["lowest_comparable"].basis["code"] == "DELHI_EX_SHOWROOM" and out["difference_from_displayed_inr"] is None      # national average != Delhi


def test_unspecified_location_never_equals_a_known_city():
    OVERRIDE[CD_MODEL] = re.sub(r"Ex-Showroom Price in\s+New Delhi", "Ex-Showroom Price", read("cardekho-creta.html"))
    out = compare(body(vehicle=creta(city="Delhi", variant="E Diesel", fuel_type="Diesel"), source_url=CD_E))
    assert set(codes(out)) <= {"UNSPECIFIED_EX_SHOWROOM", "DELHI_EX_SHOWROOM"} and "UNSPECIFIED_EX_SHOWROOM" in {x.basis["code"] for x in out["quotes"]}
    assert out["incompatible_bases"] and out["lowest_comparable"].basis["code"] == "DELHI_EX_SHOWROOM"                # the user's city wins; the unspecified one is only listed


def test_on_road_in_one_city_compares_both_providers_and_names_the_cheaper_one_and_the_saving():
    out = compare(body(vehicle=creta(city="Mumbai"), preferred_price_type="on_road", source_url=CD_E, displayed_price_inr=1316173, displayed_price_type="on_road", displayed_price_city="Mumbai"))
    assert codes(out, "on_road") == {"MUMBAI_ON_ROAD": ["CarDekho", "CarWale"]}
    low = out["lowest_comparable"]
    assert (low.provider, low.price_inr) == ("CarWale", 1308385) and out["difference_from_displayed_inr"] == -7788 and out["savings_inr"] == 7788
    assert out["comparable_groups"][0]["tied_lowest_providers"] == ["CarWale"]


def test_different_cities_on_road_are_never_in_one_group():
    mumbai = compare(body(vehicle=creta(city="Mumbai"), preferred_price_type="on_road"))
    delhi = compare(body(vehicle=creta(city="Delhi"), preferred_price_type="on_road"))               # no CarDekho Delhi page in the fixtures: CarWale only
    assert set(codes(mumbai, "on_road")) == {"MUMBAI_ON_ROAD"} and set(codes(delhi, "on_road")) == {"DELHI_ON_ROAD"} and delhi["lowest_comparable"].provider == "CarWale"
    assert [(f["provider"], f["kind"]) for f in delhi["provider_failures"]] == [("CarDekho", "not_found")]


def test_offer_and_unknown_price_types_stay_in_their_own_groups(monkeypatch):
    qs = [raw("E Petrol 1.5L Manual", "https://www.carwale.com/a/", 1000000, "offer", "Festive offer", basis("offer", national_average=True)),
          raw("E Petrol 1.5L Manual", "https://www.carwale.com/a/", 900000, "unknown", "mystery", basis("unknown")),
          raw("E Petrol 1.5L Manual", "https://www.carwale.com/a/", 1090700, "ex_showroom", "Ex", basis("ex_showroom", "Delhi"))]
    serve(monkeypatch, {"CarWale": qs})
    out = compare(body())
    assert {g["price_type"] for g in out["comparable_groups"]} == {"offer", "unknown", "ex_showroom"} and out["lowest_comparable"].price_type == "ex_showroom"   # not the cheapest number


# ================================================================ exact vs probable, verification, fallbacks
def test_a_probable_carDekho_quote_is_verified_from_its_own_variant_page():
    out = compare(body(vehicle=creta(city="Mumbai"), preferred_price_type="on_road"))               # no source page: CarDekho's "E" names neither fuel nor gearbox
    assert codes(out, "on_road") == {"MUMBAI_ON_ROAD": ["CarDekho", "CarWale"]}
    cd = [x for x in out["quotes"] if x.provider == "CarDekho" and x.vehicle == "E"][0]
    assert cd.match == "exact" and "read from the provider's own variant page" in cd.match_evidence and cd.emission_norm == "BS VI 2.0" and CD_E in CALLS


def test_without_verification_the_probable_quote_stays_out_of_the_comparison(monkeypatch):
    monkeypatch.setattr(prices, "VERIFY_MAX", 0)
    out = compare(body(vehicle=creta(city="Mumbai"), preferred_price_type="on_road"))
    assert codes(out, "on_road") == {"MUMBAI_ON_ROAD": ["CarWale"]} and [(x.provider, x.vehicle) for x in out["probable_quotes"]] == [("CarDekho", "E")]
    assert out["lowest_comparable"].provider == "CarWale" and any("probable match" in w for w in out["warnings"]) and any("no 'cheapest across websites' claim" in w for w in out["warnings"])


def test_verification_that_contradicts_the_listing_removes_the_quote():
    out = compare(body(vehicle=creta(transmission="Automatic", city="Mumbai"), preferred_price_type="on_road"))      # the variant page says Manual
    assert [x for x in out["quotes"] if x.provider == "CarDekho"] == []


def test_model_level_prices_are_a_labelled_fallback_not_a_variant_price():
    out = compare(body(vehicle=creta(variant="Imaginary Edition", fuel_type=None, transmission=None)))
    assert out["lowest_comparable"] is None and out["comparable_groups"] == [] and out["quotes"] == []
    ml = out["model_level"]
    assert [(m["provider"], m["price_low"], m["price_high"]) for m in ml] == [("CarDekho", 1090700, 2045700)] and "not a price for your variant" in ml[0]["note"]
    assert any("model-level starting prices are references" in w for w in out["warnings"])
    assert compare(body())["model_level"] == []                                           # with exact variant quotes the fallback is hidden


def test_same_trim_in_several_fuels_is_ambiguous_until_the_listing_says_which(monkeypatch):
    serve(monkeypatch, {"CarDekho": [raw("E", "https://www.cardekho.com/a", 1090700, "ex_showroom", "l", basis("ex_showroom", "Delhi")),
                                     raw("E Diesel", "https://www.cardekho.com/b", 1261000, "ex_showroom", "l", basis("ex_showroom", "Delhi"))]})
    unknown = compare(body(vehicle=Identity(make="Hyundai", model="Creta", variant="E")))
    assert {x.match for x in unknown["quotes"]} == {"ambiguous"} and unknown["lowest_comparable"] is None and any("state the exact variant" in w for w in unknown["warnings"])


def test_used_listings_fetch_nothing():
    out = compare(body(vehicle=creta(vehicle_status="used")))
    assert out["quotes"] == [] and CALLS == [] and "used listings" in out["warnings"][0]


# ================================================================ cache, freshness, failures
def test_cache_serves_fresh_then_stale_then_unavailable(monkeypatch):
    spec = PageSpec("CarDekho", "model", CD_MODEL)
    assert prices.page_result(spec, "Hyundai", "Creta", now=1000).freshness == "fresh" and len(CALLS) == 1
    assert prices.page_result(spec, "Hyundai", "Creta", now=1000 + 3600).freshness == "cached" and len(CALLS) == 1
    assert prices.page_result(spec, "Hyundai", "Creta", refresh=True, now=1000 + 3600).freshness == "fresh" and len(CALLS) == 2
    monkeypatch.setattr(prices, "fetcher", prices.Fetcher(http=lambda u: (_ for _ in ()).throw(httpx.ConnectError("down")), scheduler=sched.Scheduler(min_gap=0)))
    monkeypatch.setattr(prices.time, "sleep", lambda s: None)
    r = prices.page_result(spec, "Hyundai", "Creta", now=1000 + 3600 + 7 * 3600)
    assert r.freshness == "stale" and r.parsed.quotes and r.error.startswith("network error") and r.at == 1000 + 3600
    r = prices.page_result(spec, "Hyundai", "Creta", now=1000 + 3600 + 25 * 3600)
    assert (r.freshness, r.kind) == ("unavailable", "unavailable") and not r.parsed.quotes


def test_blocked_pages_are_reported_as_blocked_and_not_retried(monkeypatch):
    n = []
    monkeypatch.setattr(prices, "fetcher", prices.Fetcher(http=lambda u: n.append(u) or httpx.Response(403, request=httpx.Request("GET", u)), scheduler=sched.Scheduler(min_gap=0)))
    out = compare(body())
    assert {f["kind"] for f in out["provider_failures"]} == {"blocked"} and len(n) == 2 and out["quotes"] == []


def test_a_timeout_is_retried_once_then_reported(monkeypatch):
    n = {"calls": 0}

    def slow(url):
        n["calls"] += 1
        raise httpx.ReadTimeout("x")
    monkeypatch.setattr(prices, "fetcher", prices.Fetcher(http=slow, scheduler=sched.Scheduler(min_gap=0)))
    monkeypatch.setattr(prices.time, "sleep", lambda s: None)
    out = compare(body())
    assert {f["kind"] for f in out["provider_failures"]} == {"timeout"} and n["calls"] == 4


def test_a_parser_crash_becomes_unavailable_not_an_error(monkeypatch):
    monkeypatch.setattr(CarDekho, "parse", lambda self, *a: (_ for _ in ()).throw(AttributeError("layout changed")))
    out = compare(body())
    assert [(f["provider"], f["kind"]) for f in out["provider_failures"]] == [("CarDekho", "layout_changed")] and {x.provider for x in out["quotes"]} == {"CarWale"}


def test_rate_limited_provider_reports_a_retry_hint_and_serves_the_cache(monkeypatch):
    spec = PageSpec("CarDekho", "model", CD_MODEL)
    assert prices.page_result(spec, "Hyundai", "Creta", now=1000).freshness == "fresh"
    monkeypatch.setattr(prices, "fetcher", prices.Fetcher(http=fake_http, scheduler=sched.Scheduler(min_gap=0, budget=0)))
    r = prices.page_result(spec, "Hyundai", "Creta", refresh=True, now=1100)
    assert (r.freshness, r.kind) == ("stale", "rate_limited") and r.retry_after_s > 0 and r.parsed.quotes
    out = compare(body(refresh=True))
    assert {f["kind"] for f in out["provider_failures"]} == {"rate_limited"} and all(f["retry_after_s"] for f in out["provider_failures"])


def test_cache_is_bounded():
    c = prices.Cache(size=2)
    for i in range(3):
        c.put(("p", "m", str(i)), {"at": i})
    assert c.get(("p", "m", "0")) is None and c.get(("p", "m", "2"))


# ================================================================ SSRF
@pytest.mark.parametrize("url", ["http://www.cardekho.com/x", "https://127.0.0.1:8000/api/health", "https://169.254.169.254/latest", "https://evil.example/", "file:///etc/passwd",
                                 "https://www.cardekho.com.evil.example/x", "https://user:pw@www.cardekho.com/x", "https://www.cardekho.com:8443/x"])
def test_only_https_provider_hosts_are_ever_fetched(url):
    assert not prices.allowed(url)
    with pytest.raises(ValueError, match="refusing"):
        prices.Fetcher(http=fake_http).get(url)


def test_a_host_resolving_to_a_private_address_is_refused(monkeypatch):
    monkeypatch.setattr(prices, "getaddrinfo", lambda host, port: [(2, 1, 6, "", ("127.0.0.1", 443))])
    with pytest.raises(ValueError, match="public address"):
        prices.default_http("https://www.cardekho.com/hyundai/creta")
    monkeypatch.setattr(prices, "getaddrinfo", lambda host, port: [(2, 1, 6, "", ("203.0.113.5", 443)), (2, 1, 6, "", ("10.0.0.2", 443))])   # one bad address is enough
    assert not prices.public_address("www.cardekho.com")


def test_a_redirect_to_another_host_is_refused_before_it_is_requested(monkeypatch):
    monkeypatch.setattr(prices, "public_address", lambda h: True)
    hops = []

    def get(url, **kw):
        hops.append(url)
        return httpx.Response(302, headers={"location": "http://127.0.0.1:8000/secret"}, request=httpx.Request("GET", url))
    monkeypatch.setattr(prices.httpx, "get", get)
    with pytest.raises(ValueError, match="refusing"):
        prices.default_http("https://www.cardekho.com/hyundai/creta")
    assert hops == ["https://www.cardekho.com/hyundai/creta"]                           # the internal URL was never requested


def test_a_same_host_redirect_is_followed(monkeypatch):
    monkeypatch.setattr(prices, "public_address", lambda h: True)
    seq = iter([httpx.Response(301, headers={"location": "/hyundai/creta/"}, request=httpx.Request("GET", CD_MODEL)),
                httpx.Response(200, text="ok", request=httpx.Request("GET", CD_MODEL + "/"))])
    monkeypatch.setattr(prices.httpx, "get", lambda url, **kw: next(seq))
    assert prices.default_http(CD_MODEL).text == "ok"


def test_a_user_supplied_source_url_is_never_fetched_only_classified():
    out = compare(body(source_url="http://127.0.0.1:8000/secret"))
    assert out["current_provider"] is None and all(prices.allowed(u) for u in CALLS)


# ================================================================ API and agent
def test_compare_live_endpoint_validates_and_returns_basis_and_sources(client):
    payload = {"vehicle": {"make": "Hyundai", "model": "Creta", "variant": "E", "fuel_type": "Petrol", "transmission": "Manual", "city": "Delhi"}, "source_url": CD_E,
               "displayed_price_inr": 1090700, "displayed_price_type": "ex_showroom", "displayed_price_city": "New Delhi"}
    r = client.post("/api/prices/compare-live", json=payload)
    assert r.status_code == 200
    d = r.json()
    g = d["comparable_groups"][0]
    assert d["current_provider"] == "CarDekho" and g["basis"]["code"] == "DELHI_EX_SHOWROOM" and g["comparable_across_providers"] and g["lowest"]["source_url"].startswith("https://www.")
    assert d["quotes"][0]["retrieved_at"] and d["quotes"][0]["verified"] is False and d["difference_from_displayed_inr"] == 0
    assert client.post("/api/prices/compare-live", json={"vehicle": {"make": "Hyundai"}}).status_code == 422
    assert client.post("/api/prices/compare-live", json={**payload, "extra": 1}).status_code == 422


def test_a_cancelled_request_makes_no_fetches():
    ev = threading.Event()
    ev.set()
    out = compare(body(), cancel=ev)
    assert {f["kind"] for f in out["provider_failures"]} == {"cancelled"} and CALLS == []


def test_the_agent_cites_only_cached_quotes_with_their_basis_and_never_changes_the_ranking(client):
    before = rec(client, max_price=1600000, fuel_types=["Diesel"], live_prices=True)
    r = next(x for x in before["recommendations"] if x["car"]["model"] == "Creta")
    assert any("No current website quote in cache" in m for m in r["missing"])
    prices.cache.put(("CarDekho", "model", "-", "hyundai", "creta", ""), {"at": time.time(), "error": None, "parsed": providers.Parsed(
        quotes=[raw("SX Diesel Automatic", "https://www.cardekho.com/x", 1450000, "ex_showroom", "l", basis("ex_showroom", "Delhi"))])})
    after = rec(client, max_price=1600000, fuel_types=["Diesel"], live_prices=True)
    r2 = next(x for x in after["recommendations"] if x["car"]["model"] == "Creta")
    assert after["trace"]["ranking"] == before["trace"]["ranking"] and after["trace"]["feasible"] == before["trace"]["feasible"]
    assert any("External listed price on CarDekho (ex-showroom, Delhi): ₹14.50 lakh (exact variant match" in x and "within your budget" in x and "historical and has no stated city" in x for x in r2["reasons"])
    assert any("never change which cars qualify" in n for n in after["notes"])


def test_quote_urls_follow_a_redirected_model_slug(monkeypatch):
    seen = []

    def redirecting(url):
        seen.append(url)
        final = "https://www.carwale.com/hyundai-cars/creta-og/" if url.endswith("/creta/") else url
        return httpx.Response(200, text=read("carwale-creta.html"), request=httpx.Request("GET", final))
    monkeypatch.setattr(prices, "fetcher", prices.Fetcher(http=redirecting, scheduler=sched.Scheduler(min_gap=0)))
    r = prices.page_result(PageSpec("CarWale", "model", "https://www.carwale.com/hyundai-cars/creta/"), "Hyundai", "Creta")
    assert r.parsed.quotes[0]["source_url"] == "https://www.carwale.com/hyundai-cars/creta-og/e/"        # not the slug we asked for


# ---- naming differences seen on the real pages (2026-11-12 live check)
@pytest.mark.parametrize("a, b", [("GX Diesel Turbo Manual 7 STR", "GX 7 Seater"), ("Highline Petrol 1.0L Turbo Automatic (TC)", "Highline AT"), ("Smart Petrol 1.2L Turbo 5 Speed Manual", "Smart"),
                                  ("Lxi CNG 1.5L Manual", "LXi CNG"), ("Classic Plus Petrol 1.0L Turbo Automatic (TC)", "Classic Plus AT")])
def test_marketing_and_drivetrain_wording_does_not_change_the_trim(a, b):
    assert prices.tokens(a) == prices.tokens(b)


@pytest.mark.parametrize("a, b", [("GX 7 STR", "GX 8 STR"), ("Smart 19.2 kWh", "Smart 24 kWh"), ("Highline", "Highline Plus"), ("LXT 4WD", "OG 2.0L LXT 4WD"), ("Classic", "Classic Plus")])
def test_seat_count_battery_and_extra_trim_words_do_change_the_trim(a, b):
    assert prices.tokens(a) != prices.tokens(b)


def test_torque_converter_automatics_are_a_known_gearbox_type():
    assert providers.gear_of("Highline Petrol 1.0L Turbo Automatic (TC)") == ("Automatic", "AT") and match(creta(variant="Highline", transmission="Automatic"), q("Highline Petrol 1.0L Turbo Automatic (TC)"))[0] == "exact"


def test_carwale_city_titles_come_in_three_formats_and_a_wrong_city_is_rejected():
    for title in ("Maruti Swift On Road Price Delhi - Rs. 6.52 Lakh - Rs. 10.1 Lakh | CarWale", "Hyundai Creta Price in Delhi | CarWale", "Hyundai i20 On road price Delhi: Rs. 6.62 Lakh - Rs. 12.36 Lakh | CarWale"):
        html = f'<title>{title}</title><script>"versions":[{{"versionName":"Smart 19.2 kWh","trimMaskingName":"smart","priceOverview":{{"priceLabel":"On-Road Price","price":742039,"exShowRoomPrice":699000}}}}]</script>'
        spec = PageSpec("CarWale", "city", "https://www.carwale.com/tata-cars/tiago-ev/price-in-delhi/", "Delhi")
        qs = CarWale().parse(spec, html, "Tata", "Tiago EV").quotes
        assert {(x["price_type"], x["price_inr"], x["fuel_type"]) for x in qs} == {("on_road", 742039, "Electric"), ("ex_showroom", 699000, "Electric")}      # kWh in the name => electric
        assert CarWale().parse(PageSpec("CarWale", "city", "x", "Mumbai"), html, "Tata", "Tiago EV").quotes == []


def test_structured_specs_fill_what_the_name_leaves_out_but_never_override_it():
    q = raw("Era", "u", 1, "ex_showroom", "l", basis("ex_showroom"), {"Fuel Type": "Petrol", "Transmission Type": "Manual", "Displacement": "1197"})
    assert (q["fuel_type"], q["transmission"], q["engine_l"]) == ("Petrol", "Manual", 1.2)
    q = raw("Era Diesel Automatic", "u", 1, "ex_showroom", "l", basis("ex_showroom"), {"Fuel Type": "Petrol", "Transmission Type": "Manual", "Displacement": "1197"})
    assert (q["fuel_type"], q["transmission"]) == ("Diesel", "Automatic")


def test_agent_names_a_cheaper_listing_only_between_quotes_of_the_same_basis(client):
    same_basis, other = basis("ex_showroom", "Delhi"), basis("ex_showroom", national_average=True)

    def put(provider, price, b):
        prices.cache.put((provider, "model", "-", "hyundai", "creta", ""), {"at": time.time(), "error": None, "parsed": providers.Parsed(
            quotes=[raw("SX Diesel Automatic", f"https://www.{provider.lower()}.com/x", price, "ex_showroom", "l", b)])})
    put("CarDekho", 1500000, same_basis)
    put("CarWale", 1450000, same_basis)
    out = rec(client, max_price=1600000, fuel_types=["Diesel"], live_prices=True)
    creta_rec = next(x for x in out["recommendations"] if x["car"]["model"] == "Creta")
    assert any("Cheaper listing found: CarWale lists ₹0.50 lakh less than CarDekho on the same basis (ex-showroom, Delhi)" in x for x in creta_rec["reasons"])
    put("CarWale", 1450000, other)                                                  # a different basis: still shown, but never called cheaper
    out = rec(client, max_price=1600000, fuel_types=["Diesel"], live_prices=True)
    creta_rec = next(x for x in out["recommendations"] if x["car"]["model"] == "Creta")
    assert not any("Cheaper listing" in x for x in creta_rec["reasons"]) and any("national average" in x for x in creta_rec["reasons"])


def test_verification_goes_first_to_the_names_that_state_the_listings_fuel(monkeypatch):
    b = basis("ex_showroom", "Delhi")
    qs = [raw("LXi Turbo", "https://www.cardekho.com/overview/a_LXi_Turbo.htm", 900000, "ex_showroom", "l", b), raw("LXi", "https://www.cardekho.com/overview/a_LXi.htm", 800000, "ex_showroom", "l", b),
          raw("LXi CNG", "https://www.cardekho.com/overview/a_LXi_CNG.htm", 950000, "ex_showroom", "l", b)]
    OVERRIDE["https://www.cardekho.com/overview/a_LXi_CNG.htm"] = "Fuel Type CNG CNG Mileage Transmission Type Manual Gearbox Displacement 1462 cc Emission Norm Compliance BS VI 2.0"
    real, seen = prices.page_result, []

    def fake(spec, *a, **k):
        seen.append(spec.url)
        return real(spec, *a, **k) if spec.kind == "variant" else prices.PageResult(spec, providers.Parsed(quotes=qs), 1.0, "fresh")
    monkeypatch.setattr(prices, "page_result", fake)
    out = compare(body(vehicle=Identity(make="Maruti Suzuki", model="Brezza", variant="LXi", fuel_type="CNG", transmission="Manual")))
    assert [u for u in seen if "overview" in u][0].endswith("LXi_CNG.htm")            # the CNG name is verified before the unlabelled (petrol) ones
    assert {x.vehicle: x.match for x in out["quotes"] if x.provider == "CarDekho"}["LXi CNG"] == "exact"
