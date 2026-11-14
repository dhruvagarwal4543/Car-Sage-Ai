"""Provider adapters: which public pages to read for a vehicle and how to turn them into normalised quotes.

Verified against real pages on 2026-11-12 (robots.txt allows these paths for `User-agent: *`; fixtures in tests/fixtures/prices/):

  CarDekho  /{make}/{model}                  JSON-LD `hasVariant[].offers.price`  = ex-showroom, in the city named by "Ex-Showroom Price in <city>" (New Delhi)
            /{make}/{model}/price-in-{city}  the SAME JSON-LD field            = ON-ROAD in that city (title "On Road Price in <city>")
  CarWale   /{make}-cars/{model}/            embedded `versions[].priceOverview` labelled "Avg. Ex-Showroom price" = national average
            /{make}-cars/{model}/price-in-{city}/   same JSON: `price` is the on-road price in the city, `exShowRoomPrice` the ex-showroom price in that city

Because one field changes meaning from page to page, the meaning is read from the page's own label/title and recorded as a `PriceBasis`;
a page whose label cannot be read yields quotes with an UNSPECIFIED location, never a guessed one.
"""
import json
import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit

# ---------------------------------------------------------------- price basis
# canonical city -> (CarDekho slug, CarWale slug). A page that does not confirm the city in its own title is rejected.
CITIES = {"Delhi": ("new-delhi", "delhi"), "Mumbai": ("mumbai", "mumbai"), "Bangalore": ("bangalore", "bangalore"), "Chennai": ("chennai", "chennai"),
          "Hyderabad": ("hyderabad", "hyderabad"), "Pune": ("pune", "pune"), "Kolkata": ("kolkata", "kolkata"), "Ahmedabad": ("ahmedabad", "ahmedabad"),
          "Chandigarh": ("chandigarh", "chandigarh"), "Jaipur": ("jaipur", "jaipur")}
CITY_ALIASES = {"new delhi": "Delhi", "delhi": "Delhi", "delhi ncr": "Delhi", "bengaluru": "Bangalore", "bangalore": "Bangalore", "bombay": "Mumbai", "calcutta": "Kolkata", "madras": "Chennai"}
CITY_PATTERN = "|".join(sorted({*CITIES, *(a.title() for a in CITY_ALIASES)}, key=len, reverse=True))
PRICE_TYPES = ("ex_showroom", "on_road", "offer", "unknown")


def canonical_city(name):
    n = re.sub(r"\s+", " ", (name or "").strip().lower())
    if n in CITY_ALIASES:
        return CITY_ALIASES[n]
    return next((c for c in CITIES if c.lower() == n), None)


def basis(price_type, city=None, national_average=False):
    """A quote's price basis: type plus location semantics. code examples: DELHI_EX_SHOWROOM, NATIONAL_AVERAGE_EX_SHOWROOM, UNSPECIFIED_EX_SHOWROOM."""
    pt = price_type if price_type in PRICE_TYPES else "unknown"
    if national_average:
        kind, loc = "national_average", None
    elif canonical_city(city):
        kind, loc = "city", canonical_city(city)
    else:
        kind, loc = "unspecified", None
    where = "NATIONAL_AVERAGE" if kind == "national_average" else loc.upper() if loc else "UNSPECIFIED"
    return {"code": f"{where}_{pt.upper()}", "price_type": pt, "location_kind": kind, "location": loc}


def basis_label(b):
    names = {"ex_showroom": "ex-showroom", "on_road": "on-road", "offer": "offer price", "unknown": "price of unknown type"}
    where = "national average" if b["location_kind"] == "national_average" else b["location"] if b["location"] else "location not stated"
    return f"{names[b['price_type']]}, {where}"


# ---------------------------------------------------------------- name parsing
FUELS = {"petrol": "Petrol", "gasoline": "Petrol", "diesel": "Diesel", "cng": "CNG", "electric": "Electric", "ev": "Electric", "hybrid": "Hybrid"}
GEAR_TYPES = {"cvt": "CVT", "ivt": "IVT", "dct": "DCT", "dsg": "DCT", "amt": "AMT", "ags": "AMT", "torque converter": "AT", "tc": "AT", "at": "AT", "mt": "MT"}


def fuel_of(text):
    hits = {FUELS[w] for w in re.findall(r"\b(petrol|gasoline|diesel|cng|electric|ev|hybrid)\b", text.lower())}
    return hits.pop() if len(hits) == 1 else None


def gear_of(text):
    """(family, type): ("Automatic", "CVT"), ("Automatic", None) for a bare 'automatic', ("Manual", None), or (None, None)."""
    t = text.lower()
    types = {GEAR_TYPES[w] for w in GEAR_TYPES if re.search(rf"\b{re.escape(w)}\b", t)}
    types.discard("MT")
    manual = bool(re.search(r"\bmanual\b|\bmt\b", t))
    auto = bool(types) or bool(re.search(r"\bautomatic\b", t))
    if auto and manual:
        return None, None
    if manual:
        return "Manual", None
    if auto:
        return "Automatic", types.pop() if len(types) == 1 else None
    return None, None


def engine_litres(text):
    m = re.search(r"\b(\d\.\d)\s?l\b", text.lower())
    return float(m.group(1)) if m else None


def year_range(text):
    """A generation range printed in a name, e.g. 'Creta [2020-2023]' -> (2020, 2023); a bare launch year is not a range."""
    m = re.search(r"\[?\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)\d{2})\b\]?", text or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def price_type_of(label):
    t = (label or "").lower()
    if "offer" in t or "discount" in t:
        return "offer"
    if "ex-showroom" in t or "ex showroom" in t or "exshowroom" in t:
        return "ex_showroom"
    if "on-road" in t or "on road" in t or "onroad" in t:
        return "on_road"
    return "unknown"


def raw(vehicle, url, price, ptype, label, bas, specs=None):
    """A normalised quote. `specs` = the provider's structured spec items (fuel, transmission, displacement) used only to fill what the name leaves out."""
    specs = specs or {}
    gf, gt = gear_of(vehicle)
    fuel = fuel_of(vehicle) or fuel_of(specs.get("Fuel Type", "")) or ("Electric" if re.search(r"\bkwh\b", vehicle, re.I) else None)      # an EV's name carries only its battery size
    if gf is None and specs.get("Transmission Type"):
        gf, gt = gear_of(specs["Transmission Type"])
    cc = re.match(r"\d{3,4}$", specs.get("Displacement", ""))
    return dict(vehicle=vehicle, source_url=url, price_inr=int(price), price_type=ptype, price_label=label, basis=bas, fuel_type=fuel,
                transmission=gf, transmission_type=gt, engine_l=engine_litres(vehicle) or (round(int(cc.group()) / 1000, 1) if cc else None), model_year=None, generation=year_range(vehicle))


# ---------------------------------------------------------------- JSON helpers
def ld_nodes(html):
    """Every JSON object in every JSON-LD block, whether the block is an object, a list or an @graph. Malformed blocks are skipped."""
    out = []

    def walk(n):
        if isinstance(n, list):
            for x in n:
                walk(x)
        elif isinstance(n, dict):
            out.append(n)
            walk(n.get("@graph"))
    for m in re.finditer(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', html, re.S | re.I):
        try:
            walk(json.loads(m.group(1)))
        except ValueError:
            continue
    return out


def embedded_array(html, key):
    """The JSON array following `"key":` in the page's embedded state, found by bracket matching (None if absent or broken)."""
    i = html.find(f'"{key}":[')
    if i < 0:
        return None
    j = start = i + len(key) + 3
    depth = 0
    while j < len(html):
        c = html[j]
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(html[start:j + 1])
                except ValueError:
                    return None
        j += 1
    return None


def title_of(html):
    m = re.search(r"<title[^>]*>([^<]*)</title>", html, re.I)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""


# ---------------------------------------------------------------- pages and results
@dataclass(frozen=True)
class PageSpec:
    provider: str
    kind: str                # "model" or "city"
    url: str
    city: str | None = None  # canonical city for kind == "city"

    @property
    def key(self):
        return (self.provider, self.kind, self.city or "-")


@dataclass
class Parsed:
    quotes: list = field(default_factory=list)
    model_level: list = field(default_factory=list)     # {"price_low", "price_high", "price_label", "basis", "source_url"} for the model as a whole


def model_level(node_offers, url, label, bas):
    offers = node_offers[0] if isinstance(node_offers, list) and node_offers else node_offers
    if not isinstance(offers, dict) or offers.get("priceCurrency", "INR") != "INR":
        return []
    try:
        low = int(float(offers.get("lowPrice", offers.get("price"))))
        high = int(float(offers.get("highPrice", low)))
    except (TypeError, ValueError):
        return []
    return [dict(price_low=low, price_high=high, price_label=label, basis=bas, source_url=url)] if low > 0 else []


class CarDekho:
    name, host = "CarDekho", "www.cardekho.com"

    def pages(self, make, model, city, preferred):
        model_page = PageSpec(self.name, "model", f"https://{self.host}/{slug(make)}/{slug(model)}")
        c = canonical_city(city)
        if c and preferred == "on_road":                                # ex-showroom is only published for the page's own city; on-road is published per city
            return [PageSpec(self.name, "city", f"https://{self.host}/{slug(make)}/{slug(model)}/price-in-{CITIES[c][0]}", c)]
        return [model_page]

    def parse(self, spec, html, make, model):
        out = Parsed()
        if spec.kind == "model":
            m = re.search(r"Ex-?Showroom Price in(?:\s|<[^>]+>)+(" + CITY_PATTERN + r")\b", html)
            page_city = canonical_city(m.group(1)) if m else None      # unknown city: unspecified, not Delhi by assumption
            ptype, label = "ex_showroom", f"Ex-Showroom Price in {m.group(1)}" if m else "Ex-Showroom Price (city not stated)"
        else:
            t = title_of(html)
            m = re.search(r"On Road Price(?: in)? (" + CITY_PATTERN + r")\b", t, re.I)
            if not m or canonical_city(m.group(1)) != spec.city:      # the page did not confirm what the JSON-LD price means: trust nothing
                return out
            page_city, ptype, label = spec.city, "on_road", f"On-Road Price in {m.group(1)}"
        bas = basis(ptype, page_city)
        for node in ld_nodes(html):
            if node.get("offers") and node.get("hasVariant") is not None and spec.kind == "model":
                out.model_level += model_level(node["offers"], spec.url, label, bas)
            for v in node.get("hasVariant") or []:
                offer = (v.get("offers") if isinstance(v, dict) else None) or {}
                if not isinstance(v, dict) or not isinstance(offer, dict) or offer.get("priceCurrency", "INR") != "INR" or not v.get("name") or not v.get("url"):
                    continue
                try:
                    price = int(float(offer["price"]))
                except (KeyError, TypeError, ValueError):
                    continue
                if price <= 0 or urlsplit(v["url"]).hostname != self.host:
                    continue
                name = re.sub(rf"^{re.escape(make)}\s+{re.escape(model)}\s*", "", v["name"], flags=re.I).strip() or v["name"]
                out.quotes.append(raw(name, v["url"], price, ptype, label, bas))
        return out


class CarWale:
    name, host = "CarWale", "www.carwale.com"

    def pages(self, make, model, city, preferred):
        base = f"https://{self.host}/{slug(make)}-cars/{slug(model)}/"
        c = canonical_city(city)
        if c in CITIES:
            return [PageSpec(self.name, "city", f"{base}price-in-{CITIES[c][1]}/", c)]
        return [PageSpec(self.name, "model", base)]

    def parse(self, spec, html, make, model):
        out = Parsed()
        page_city = None
        if spec.kind == "city":
            m = re.search(r"\bPrice(?: in)? (" + CITY_PATTERN + r")\b", title_of(html), re.I)     # "Price in Delhi", "On Road Price Delhi", "On road price Delhi:" all occur
            if not m or canonical_city(m.group(1)) != spec.city:
                return out
            page_city = spec.city
        versions = embedded_array(html, "versions") or []
        for v in versions:
            if not isinstance(v, dict):
                continue
            po = v.get("priceOverview") or {}
            name, trim = v.get("versionName"), v.get("trimMaskingName")
            if not isinstance(po, dict) or not name or not trim:
                continue
            url = f"{re.sub(r'price-in-[a-z-]+/?$', '', spec.url).rstrip('/')}/{trim}/"      # built from the page's final URL, which may be a redirected slug
            label = str(po.get("priceLabel") or "")
            ll = label.lower()
            sp = {i.get("itemName"): str(i.get("value") or "") for i in (v.get("specsSummary") or []) if isinstance(i, dict)}
            price, ex = po.get("price"), po.get("exShowRoomPrice")
            if "avg" in ll or "average" in ll:                       # model page: one national average per version
                if isinstance(price, (int, float)) and price > 0:
                    out.quotes.append(raw(name, url, price, "ex_showroom", label, basis("ex_showroom", national_average=True), sp))
            elif page_city and "on-road" in ll:                      # city page: `price` is on-road in the city, exShowRoomPrice the ex-showroom price there
                if isinstance(price, (int, float)) and price > 0:
                    out.quotes.append(raw(name, url, price, "on_road", f"{label} in {page_city}", basis("on_road", page_city), sp))
                if isinstance(ex, (int, float)) and ex > 0:
                    out.quotes.append(raw(name, url, ex, "ex_showroom", f"Ex-Showroom price in {page_city}", basis("ex_showroom", page_city), sp))
            elif isinstance(price, (int, float)) and price > 0:      # a label we do not recognise: keep the number, claim nothing about its meaning
                out.quotes.append(raw(name, url, price, price_type_of(label), label or "unlabelled price", basis(price_type_of(label)), sp))
        if spec.kind == "model":
            for node in ld_nodes(html):
                types = node.get("@type")
                types = [types] if isinstance(types, str) else (types or [])
                if node.get("offers") and "Car" in types:
                    out.model_level += model_level(node["offers"], spec.url, "Starting price (model level)", basis("ex_showroom"))
                    break
        return out


PROVIDERS = {p.host: p for p in (CarDekho(), CarWale())}
