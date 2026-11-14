"""Live cross-website price comparison: SSRF-safe fetching through a polite scheduler, a bounded TTL cache, strict identity matching and
quotes grouped by price basis (type + location semantics). The catalogue supplies identity only; these quotes are the only "current price".

Rules (all enforced here and covered in tests/test_prices.py):
  * Quotes are compared only inside one *basis group* (e.g. DELHI_EX_SHOWROOM). Different bases are shown apart and never produce a lowest,
    a saving or a difference. An UNSPECIFIED location never equals a known city or the national average.
  * Only EXACT matches enter the primary comparison; PROBABLE ones are listed apart with the missing evidence; AMBIGUOUS ones are only counted.
  * Without any exact variant quote the model-level starting prices are shown as references, never as variant prices.
  * Nothing here claims a quote is live unless it was fetched in this request; freshness is fresh / cached / stale / unavailable.
Provider pages and their price semantics: carsage/providers.py.
"""
import re
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from ipaddress import ip_address
from socket import getaddrinfo
from typing import Literal
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field

from carsage import scheduler as sched
from carsage.history import clean_url, norm
from carsage.providers import PROVIDERS, PageSpec, Parsed, basis, basis_label, canonical_city, fuel_of, gear_of, year_range   # noqa: F401

PriceType = Literal["ex_showroom", "on_road", "offer", "unknown"]
Match = Literal["exact", "probable", "ambiguous", "mismatch"]
Freshness = Literal["fresh", "cached", "stale", "unavailable"]
FRESH_S, STALE_S, CACHE_SIZE = 6 * 3600, 24 * 3600, 300
DEADLINE_S, VERIFY_MAX = 14.0, 2
UA = "CarSageAI/0.1 (+student project; price comparison for the page the user is viewing)"
NOISE = {"turbo", "l", "litre", "liter", "petrol", "diesel", "cng", "electric", "hybrid", "manual", "automatic", "at", "mt", "amt", "cvt", "dct", "ivt", "dsg", "tc",
         "bsvi", "bs6", "bs-vi", "edition", "ags", "ev", "speed", "gear", "gears", "bhp", "ps"}
ENGINE_SIZE = re.compile(r"^\d\.\dl?$")        # "1.2L": an engine size, not part of the trim name (a battery "19.2 kWh" and seat counts are kept: they distinguish variants)
SYNONYMS = {"str": "seater", "seaters": "seater", "seat": "seater", "seats": "seater"}
DIFFERENT_BASES = "Prices shown are from different location bases and cannot be directly compared."


class Identity(BaseModel):
    """Canonical vehicle identity. City, year, generation and status are part of it because prices and variants depend on them."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    make: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=120)
    variant: str | None = Field(None, max_length=160)
    fuel_type: str | None = Field(None, max_length=40)
    transmission: str | None = Field(None, max_length=40)
    engine_cc: int | None = Field(None, ge=50, le=10000)
    model_year: int | None = Field(None, ge=1990, le=2100)
    generation: str | None = Field(None, max_length=40, description="e.g. '2020-2023' when the listing states it")
    city: str | None = Field(None, max_length=80, description="the city the user wants to compare for")
    vehicle_status: Literal["new", "used"] = "new"


class CompareIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vehicle: Identity
    source_url: str | None = Field(None, max_length=2048, description="page the user is on: identifies the provider and the variant, is never fetched")
    displayed_price_inr: int | None = Field(None, gt=0, le=10**10)
    displayed_price_type: PriceType = "unknown"
    displayed_price_city: str | None = Field(None, max_length=80, description="city the displayed price is quoted for, when the page says")
    displayed_price_national_average: bool = False
    preferred_price_type: PriceType = "ex_showroom"
    refresh: bool = Field(False, description="ignore a fresh cache entry (still subject to the provider schedule)")


class Quote(BaseModel):
    provider: str
    source_url: str
    vehicle: str                      # the provider's own name for the variant
    fuel_type: str | None
    transmission: str | None          # Manual / Automatic
    transmission_type: str | None     # CVT, DCT, AMT ...
    engine_l: float | None
    emission_norm: str | None = None
    model_year: int | None
    generation: tuple[int, int] | None   # (from, to) when the provider's name states one
    price_inr: int
    currency: str = "INR"
    price_type: PriceType
    price_label: str                  # the provider's own label, verbatim
    basis: dict                       # code, price_type, location_kind (city/national_average/unspecified), location
    basis_label: str
    retrieved_at: str
    freshness: Freshness
    match: Match
    match_evidence: str
    scope: str = "variant"
    verified: bool = False            # a quote is never marked verified automatically


# ---------------------------------------------------------------- safe fetching
def public_address(host):
    """True when every address the host resolves to is a public one (defence in depth on top of the fixed host allowlist)."""
    try:
        infos = getaddrinfo(host, 443)
    except OSError:
        return False
    return bool(infos) and all(ip_address(i[4][0]).is_global for i in infos)


def allowed(url):
    u = urlsplit(url)
    return u.scheme == "https" and u.hostname in PROVIDERS and u.port in (None, 443) and not u.username and not u.password


def default_http(url):
    """One GET, redirects followed by hand: every hop must stay on an allowlisted https host that resolves to public addresses.
    shortcut: the address is checked, then httpx resolves again, so a DNS answer that changes in between is not pinned; the host list is fixed to two providers."""
    for _ in range(4):
        if not allowed(url):
            raise ValueError(f"refusing to fetch {urlsplit(url).hostname!r}")
        if not public_address(urlsplit(url).hostname):
            raise ValueError("refusing a host that does not resolve to a public address")
        r = httpx.get(url, headers={"User-Agent": UA, "Accept": "text/html"}, timeout=8.0, follow_redirects=False)
        if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
            url = str(httpx.URL(url).join(r.headers["location"]))
            continue
        return r
    raise RuntimeError("too many redirects")


class Fetcher:
    """Only allowlisted provider URLs pass. Slots, budget, single-flight and cancellation come from the scheduler."""

    def __init__(self, http=None, scheduler=None):
        self.http = http or default_http
        self.scheduler = scheduler or sched.Scheduler()

    def get(self, url, deadline=None, ticket=None):
        u = urlsplit(url)
        if not allowed(url):
            raise ValueError(f"refusing to fetch {u.hostname!r}")
        return self.scheduler.run(url, u.hostname, lambda: self._fetch(url, deadline), deadline, ticket)

    def _fetch(self, url, deadline):
        for attempt in (1, 2):
            try:
                r = self.http(url)
                break
            except httpx.TimeoutException:
                if attempt == 2 or (deadline and time.monotonic() > deadline - 2):
                    raise sched.Timeout("provider did not answer in time")
                time.sleep(0.3)
            except httpx.HTTPError as e:
                if attempt == 2:
                    raise RuntimeError(f"network error: {type(e).__name__}")
                time.sleep(0.3)
        if r.status_code == 403:
            raise RuntimeError("blocked by the provider (HTTP 403); not retried or bypassed")
        if r.status_code == 404:
            raise LookupError("page not found (HTTP 404)")
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}")
        if not allowed(str(r.url)):
            raise RuntimeError("redirected off the provider")
        return r.text, str(r.url)                      # the page and the URL it was finally served from (a model can redirect to its canonical slug)


class Cache:
    """Bounded LRU. Key (provider, kind, city, make, model, url-for-variant-pages); value {at, parsed, error}."""

    def __init__(self, size=CACHE_SIZE):
        self.size, self.items, self.lock = size, OrderedDict(), threading.Lock()

    def get(self, key):
        with self.lock:
            if key in self.items:
                self.items.move_to_end(key)
                return self.items[key]
        return None

    def put(self, key, value):
        with self.lock:
            self.items[key] = value
            self.items.move_to_end(key)
            while len(self.items) > self.size:
                self.items.popitem(last=False)

    def snapshot(self):
        with self.lock:
            return list(self.items.items())


fetcher, cache = Fetcher(), Cache()


class PageResult:
    def __init__(self, spec, parsed=None, at=None, freshness="unavailable", error=None, kind=None, retry_after_s=None):
        self.spec, self.parsed, self.at, self.freshness, self.error, self.kind, self.retry_after_s = spec, parsed or Parsed(), at, freshness, error, kind, retry_after_s


def failure_kind(e):
    if isinstance(e, sched.SchedulerError):
        return e.kind, e.retry_after_s
    if isinstance(e, LookupError):
        return "not_found", None
    return ("blocked" if "403" in str(e) else "unavailable"), None


def page_result(spec, make, model, refresh=False, now=None, deadline=None, ticket=None, parse=None):
    """Serve a page's quotes: cache when fresh, else fetch through the scheduler; fall back to a stale copy (<= 24 h) when the fetch fails."""
    now = now or time.time()
    key = (*spec.key, norm(make), norm(model), spec.url if spec.kind == "variant" else "")
    hit = cache.get(key)
    if hit and not refresh and now - hit["at"] < FRESH_S and not hit.get("error"):
        return PageResult(spec, hit["parsed"], hit["at"], "cached")
    provider = PROVIDERS[urlsplit(spec.url).hostname]
    parsed, error, kind, retry = Parsed(), None, None, None
    try:
        html, final = fetcher.get(spec.url, deadline, ticket)
        spec = PageSpec(spec.provider, spec.kind, final, spec.city)
        parsed = (parse or provider.parse)(spec, html, make, model)
        if not (parsed.quotes or parsed.model_level) and spec.kind != "variant":
            error, kind = "no prices found on the page (layout changed?)", "layout_changed"
    except (sched.SchedulerError, RuntimeError, ValueError, LookupError) as e:
        error = str(e)
        kind, retry = failure_kind(e)
    except (AttributeError, TypeError, KeyError, IndexError):       # a changed layout must degrade to "unavailable", never a 500
        error, kind = "the page could not be read (layout changed?)", "layout_changed"
    if not error:
        cache.put(key, {"at": now, "parsed": parsed, "error": None})
        return PageResult(spec, parsed, now, "fresh")
    if hit and hit["parsed"] and (hit["parsed"].quotes or hit["parsed"].model_level) and now - hit["at"] < STALE_S:
        return PageResult(spec, hit["parsed"], hit["at"], "stale", error, kind, retry)
    return PageResult(spec, None, None, "unavailable", error, kind, retry)


# ---------------------------------------------------------------- identity matching
def tokens(variant):
    v = re.sub(r"\[[^\]]*\]|\b(?:19|20)\d{2}\b|\b\d{1,2}[- ]?speed\b", " ", variant or "", flags=re.I)   # generation ranges, years and "5 Speed": checked elsewhere or not trim words
    t = norm(v.replace("(", " ").replace(")", " ").replace("+", " plus ").replace("-", " "))
    return {SYNONYMS.get(w, w) for w in t.split() if w not in NOISE and not ENGINE_SIZE.match(w)}


def same_url(a, b):
    f = lambda u: (urlsplit(u).hostname or "", urlsplit(u).path.lower().rstrip("/"))   # noqa: E731
    try:
        return f(a) == f(b) and bool(f(a)[0])
    except ValueError:
        return False


def match(identity, q, own_page=False) -> tuple[Match, str]:
    """Evidence-based. Contradictions are mismatches; the variant words decide how close the names are; EXACT additionally needs fuel and
    transmission stated by both sides and agreeing (or the quote being the very page the user is viewing)."""
    if identity.fuel_type and q["fuel_type"] and norm(identity.fuel_type) != norm(q["fuel_type"]):
        return "mismatch", f"fuel {q['fuel_type']} differs from {identity.fuel_type}"
    want_gear, want_type = gear_of(identity.transmission or "")
    if want_gear and q["transmission"] and want_gear != q["transmission"]:
        return "mismatch", f"transmission {q['transmission']} differs from {want_gear}"
    if want_type and q.get("transmission_type") and want_type != q["transmission_type"]:
        return "mismatch", f"gearbox {q['transmission_type']} differs from {want_type}"
    if identity.engine_cc and q.get("engine_l") and abs(identity.engine_cc / 1000 - q["engine_l"]) > 0.06:
        return "mismatch", f"engine {q['engine_l']} L differs from {identity.engine_cc} cc"
    gen = year_range(identity.generation or "") or ((identity.model_year, identity.model_year) if identity.model_year and q.get("generation") else None)
    if gen and q.get("generation") and (gen[1] < q["generation"][0] or gen[0] > q["generation"][1]):
        return "mismatch", f"generation {q['generation'][0]}-{q['generation'][1]} does not cover {gen[0]}" + (f"-{gen[1]}" if gen[1] != gen[0] else "")
    if identity.model_year and q.get("model_year") and identity.model_year != q["model_year"]:
        return "mismatch", f"model year {q['model_year']} differs from {identity.model_year}"
    want, have = tokens(identity.variant), tokens(q["vehicle"])
    if not want:
        return "ambiguous", "no variant given; cannot tell which provider variant is meant"
    if want == have:
        if own_page:
            return "exact", "this is the page the user is viewing"
        electric = "Electric" in (norm(identity.fuel_type or "").title(), q["fuel_type"])     # an EV has no gearbox choice to verify
        missing = [k for k, ok in (("fuel", identity.fuel_type and q["fuel_type"]), ("transmission", electric or (want_gear and q["transmission"]))) if not ok]
        if not missing:
            return "exact", "variant name, fuel and transmission agree"
        who = "the provider" if (identity.fuel_type and identity.transmission) else "the listing or the provider"
        return "probable", f"variant name agrees; {who} does not state the {' and '.join(missing)}"
    # extra or missing trim words mean a different trim ("Smart" vs "Smart Plus S"): never exact or probable
    if len(want & have) * 2 >= len(want):
        return "ambiguous", f"'{q['vehicle']}' shares trim words with '{identity.variant}' but is not the same name"
    return "mismatch", "variant names share too few words"


# ---------------------------------------------------------------- comparison
def _verify_facts(html):
    """Spec facts from a CarDekho variant page's spec table: fuel, transmission, displacement, emission norm."""
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", html)))
    g = lambda rx: (re.search(rx, text) or [None, None])[1]    # noqa: E731
    return dict(fuel=g(r"Fuel Type\s*(Petrol|Diesel|CNG|Electric|Hybrid)"), gear=g(r"Transmission Type\s*(Manual|Automatic|AMT|CVT|DCT|IVT|DSG|AT)"),
                cc=g(r"Displacement\s*(\d{3,4})\s*cc"), emission=g(r"Emission Norm Compliance\s*(BS ?[IVX]+(?: ?\d\.\d)?)"))


def verify_probables(items, ident, make, model, deadline, ticket, now, failures=None):
    """A probable CarDekho quote lacks fuel/transmission in its name; its own variant page states them. Read at most VERIFY_MAX of those pages."""
    todo = [it for it in items if it["m"] == "probable" and it["q"]["source_url"].startswith("https://www.cardekho.com/") and ident.fuel_type and ident.transmission]
    todo.sort(key=lambda it: (it["q"]["fuel_type"] is None, it["q"]["price_inr"]))      # names that already state the listing's fuel first; unlabelled names last
    todo = list({it["q"]["source_url"]: it for it in todo}.values())[:VERIFY_MAX]
    for it in todo:
        q = it["q"]
        r = page_result(PageSpec("CarDekho", "variant", q["source_url"]), make, model, now=now, deadline=deadline, ticket=ticket,
                        parse=lambda spec, html, mk, md: Parsed(quotes=[_verify_facts(html)]))
        facts = r.parsed.quotes[0] if r.parsed.quotes else None
        if r.error and failures is not None:
            failures.append({"provider": "CarDekho", "page": "variant page (verification)", "error": r.error, "kind": r.kind, "retry_after_s": r.retry_after_s, "served": r.freshness})
        if not facts:
            continue
        if facts["fuel"]:
            q["fuel_type"] = facts["fuel"]
        if facts["gear"]:
            q["transmission"], q["transmission_type"] = gear_of(facts["gear"])
        if facts["cc"]:
            q["engine_l"] = round(int(facts["cc"]) / 1000, 1)
        q["emission_norm"] = facts["emission"]
        it["m"], it["why"] = match(ident, q)
        if it["m"] == "exact":
            it["why"] += " (read from the provider's own variant page)"


def _iso(at):
    return datetime.fromtimestamp(at, timezone.utc).isoformat() if at else ""


def compare(body: CompareIn, providers=None, now=None, cancel=None, deadline_s=DEADLINE_S):
    now = now or time.time()
    ident = body.vehicle
    providers = providers or list(PROVIDERS.values())
    deadline = time.monotonic() + deadline_s
    ticket = sched.Ticket()
    if cancel is not None:
        ticket.cancel = cancel
    base = {"vehicle": ident.model_dump(), "city": canonical_city(ident.city), "providers_consulted": [p.name for p in providers]}
    if ident.vehicle_status == "used":
        return {**base, "current_provider": None, "quotes": [], "comparable_groups": [], "probable_quotes": [], "model_level": [], "lowest_comparable": None, "savings_inr": None,
                "difference_from_displayed_inr": None, "provider_failures": [], "retrieved_at": None, "incompatible_bases": None,
                "warnings": ["used listings cannot be compared with new-car prices, so nothing was fetched"]}
    current_host = None
    if body.source_url:
        try:
            current_host = urlsplit(clean_url(body.source_url)).hostname
        except ValueError:
            pass
    own_url = body.source_url or ""
    plan = [(p, spec) for p in providers for spec in p.pages(ident.make, ident.model, ident.city, body.preferred_price_type)]
    with ThreadPoolExecutor(max_workers=4) as pool:        # bounded concurrency; the scheduler spaces the actual requests
        results = list(pool.map(lambda ps: (ps, page_result(ps[1], ident.make, ident.model, body.refresh, now, deadline, ticket)), plan))
    items, failures, model_level, warnings = [], [], [], []
    for (p, spec), r in results:
        if r.error:
            failures.append({"provider": p.name, "page": spec.kind + (f" ({spec.city})" if spec.city else ""), "error": r.error, "kind": r.kind, "retry_after_s": r.retry_after_s, "served": r.freshness})
        for ml in r.parsed.model_level:
            model_level.append({**ml, "provider": p.name, "basis_label": basis_label(ml["basis"]), "freshness": r.freshness, "retrieved_at": _iso(r.at),
                                "note": "model-level reference for the whole model, not a price for your variant"})
        per_url = {}
        for q in r.parsed.quotes:
            per_url[(q["source_url"], q["price_type"])] = per_url.get((q["source_url"], q["price_type"]), 0) + 1
        for q in r.parsed.quotes:
            own = bool(own_url) and per_url[(q["source_url"], q["price_type"])] == 1 and same_url(own_url, q["source_url"])
            m, why = match(ident, q, own)
            items.append({"p": p, "r": r, "q": dict(q), "m": m, "why": why, "own": own})
    by_provider = {}
    for it in items:
        by_provider.setdefault(it["p"].name, []).append(it)
    for group in by_provider.values():
        verify_probables(group, ident, ident.make, ident.model, deadline, ticket, now, failures)
    # a provider listing several fuel/transmission versions under one trim name cannot be told apart unless the listing states which one
    for name, group in by_provider.items():
        key = lambda it: (tuple(sorted(tokens(it["q"]["vehicle"]))), it["q"]["price_type"], it["q"]["basis"]["code"])   # noqa: E731
        versions = {}
        for it in group:
            if not (ident.fuel_type and ident.transmission) and it["m"] in ("exact", "probable"):
                versions.setdefault(key(it), set()).add((it["q"]["fuel_type"], it["q"]["transmission"]))
        for it in group:
            if it["m"] in ("exact", "probable") and len(versions.get(key(it), ())) > 1 and not it["own"]:
                it["m"], it["why"] = "ambiguous", f"{name} lists more than one fuel/transmission version of this trim; state the fuel and transmission to pick one"
    quotes = [Quote(provider=it["p"].name, retrieved_at=_iso(it["r"].at), freshness=it["r"].freshness, match=it["m"], match_evidence=it["why"], basis_label=basis_label(it["q"]["basis"]), **it["q"])
              for it in items if it["m"] != "mismatch"]
    exact = [q for q in quotes if q.match == "exact" and q.freshness != "unavailable"]
    probable = [q for q in quotes if q.match == "probable" and q.freshness != "unavailable"]
    groups = {}
    for q in exact:
        groups.setdefault(q.basis["code"], []).append(q)
    out_groups = []
    for qs in groups.values():
        qs.sort(key=lambda q: (q.price_inr, q.provider))
        provs = sorted({q.provider for q in qs})
        tied = sorted({q.provider for q in qs if q.price_inr == qs[0].price_inr})
        out_groups.append({"basis": qs[0].basis, "basis_label": qs[0].basis_label, "price_type": qs[0].price_type, "quotes": qs, "lowest": qs[0], "providers": provs,
                           "tied_lowest_providers": tied, "comparable_across_providers": len(provs) > 1, "single_source": len(provs) == 1})
    city = canonical_city(ident.city)
    of_type = sorted((g for g in out_groups if g["price_type"] == body.preferred_price_type),
                     key=lambda g: (g["basis"]["location"] != city if city else False, -len(g["providers"]), g["basis"]["code"]))
    pref = of_type[0] if of_type else None
    lowest = pref["lowest"] if pref else None
    bases = sorted({q.basis["code"] for q in exact + probable if q.price_type == body.preferred_price_type})
    incompatible = DIFFERENT_BASES if len(bases) > 1 else None
    if incompatible:
        warnings.append(incompatible + " They are grouped by basis: " + ", ".join(bases) + ".")
    displayed = basis(body.displayed_price_type, body.displayed_price_city, body.displayed_price_national_average) if body.displayed_price_inr else None
    diff = savings = None
    if lowest and displayed and displayed["code"] == lowest.basis["code"] and displayed["location_kind"] != "unspecified":
        diff = lowest.price_inr - body.displayed_price_inr
        current = PROVIDERS[current_host].name if current_host in PROVIDERS else None
        if diff < 0 and pref["comparable_across_providers"] and lowest.provider != current and len(pref["tied_lowest_providers"]) == 1:
            savings = -diff
    elif lowest and displayed:
        warnings.append(f"the displayed price ({basis_label(displayed)}) has a different basis from the lowest quote ({lowest.basis_label}), so no difference or saving is calculated")
    if pref and pref["single_source"]:
        warnings.append(f"only {pref['providers'][0]} returned an exact {pref['basis_label']} quote, so no 'cheapest across websites' claim is possible")
    if probable:
        warnings.append(f"{len(probable)} probable match(es) are listed apart: the variant name agrees but fuel or transmission could not be verified, so they are not in the comparison")
    if any(q.match == "ambiguous" for q in quotes):
        warnings.append("ambiguous provider variants were left out; state the exact variant, fuel and transmission to include them")
    if any(q.freshness == "stale" for q in exact + probable):
        warnings.append("one or more quotes are stale (older than 6 hours) because the provider could not be reached just now")
    if not ident.variant:
        warnings.append("no exact variant was given, so quotes could not be matched; choose a variant first")
    if not exact and model_level:
        warnings.append("no exact variant price was found; the model-level starting prices are references for the whole model, not prices for your variant")
    warnings.append("listed prices are what the websites display; the dealer's final price can differ. The providers' pages show their current lineup; model year/generation is not stated per variant.")
    return {**base, "current_provider": PROVIDERS[current_host].name if current_host in PROVIDERS else None, "quotes": quotes, "comparable_groups": out_groups,
            "probable_quotes": probable, "model_level": model_level if not exact else [], "lowest_comparable": lowest, "savings_inr": savings, "difference_from_displayed_inr": diff,
            "incompatible_bases": incompatible, "provider_failures": failures, "warnings": warnings, "retrieved_at": max((q.retrieved_at for q in quotes if q.retrieved_at), default=None)}


def cached_quote(make, model, variant, fuel_type=None, transmission=None, now=None):
    """Cache-only lookup for the recommendation agent: exact/probable ex-showroom quotes from cached model/city pages (24 h at most), each with its basis."""
    now = now or time.time()
    ident = Identity(make=make, model=model, variant=variant, fuel_type=fuel_type, transmission=transmission)
    found, status = [], []
    for name in sorted({p.name for p in PROVIDERS.values()}):
        entries = [(k, v) for k, v in cache.snapshot() if k[0] == name and k[1] in ("model", "city") and k[3] == norm(make) and k[4] == norm(model)]
        if not entries:
            status.append(f"{name}: no quotes cached")
            continue
        best = None
        for _, hit in entries:
            age = now - hit["at"]
            if age >= STALE_S or not hit["parsed"].quotes:
                continue
            for q in hit["parsed"].quotes:
                if q["price_type"] != "ex_showroom":
                    continue
                m, _ = match(ident, q)
                if m in ("exact", "probable") and (best is None or (m != "exact", q["price_inr"]) < (best[0] != "exact", best[1]["price_inr"])):
                    best = (m, q, hit, age)
        if not best:
            status.append(f"{name}: no matching variant in cache")
            continue
        m, q, hit, age = best
        found.append({"provider": name, "price_inr": q["price_inr"], "source_url": q["source_url"], "match": m, "stale": age >= FRESH_S, "basis": q["basis"], "basis_label": basis_label(q["basis"]),
                      "retrieved_at": _iso(hit["at"])})
    return found, status
