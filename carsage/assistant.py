"""Catalogue-grounded car assistant. Rule-based: no LLM, no internet, no live inventory.

Pipeline: message -> intent + preference extraction (regex / keyword rules) -> catalogue tools
(recommend / compare / lookup) -> reply assembled only from tool results. Every car named in a reply
comes from the database. An LLM adapter could replace `parse` and `_reply_*` later without touching the tools.
"""
import re
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from carsage import catalogue
from carsage.models import CatalogueCar as C
from carsage.recommend import inr, recommend
from carsage.schemas import AssistantOut, Preferences

FUELS = {"petrol": "Petrol", "diesel": "Diesel", "cng": "CNG", "electric": "Electric", "ev": "Electric", "hybrid": "Hybrid"}
BODIES = {"suv": "SUV", "sedan": "Sedan", "hatchback": "Hatchback", "hatch": "Hatchback", "mpv": "MPV", "muv": "MUV", "coupe": "Coupe"}
PRIORITY_WORDS = {"mileage": r"mileage|efficien|economical|economy|fuel.saving", "power": r"power|performance|fast|quick|sporty",
                  "safety": r"\bsafe|safety|airbag", "space": r"spacious|space|boot|luggage|legroom", "price": r"cheap|affordable|value|budget.friendly|low.cost"}
AMBIGUOUS_MODELS = {"city", "sport", "classic", "active", "cross", "plus", "power", "one", "go"}   # common words: need the make before them
UNIT = r"(lakhs?|lacs?|lk|l|crores?|cr)"
NUM = r"(\d[\d,]*(?:\.\d+)?)"
MONEY = rf"(?:rs\.?|inr|₹)?\s*{NUM}\s*(?:{UNIT}\b)?"


def _amount(num, unit):
    n = Decimal(num.replace(",", ""))
    amount = n * (10**7 if unit and unit.lower().startswith("c") else 10**5 if unit else 1)
    if not 1 <= amount <= 10**10:
        raise ValueError("budget outside supported range")
    return int(amount) if unit or n >= 10000 else None      # a bare small number is ambiguous: ignored


def _budget(text):
    m = re.search(rf"between\s*{MONEY}\s*(?:and|to|-)\s*{MONEY}", text)
    if m:
        unit2 = m.group(4) or m.group(2)
        lo, hi = _amount(m.group(1), m.group(2) or unit2), _amount(m.group(3), unit2)
        if lo and hi:
            return min(lo, hi), max(lo, hi)
    m = re.search(rf"(?:under|below|within|upto|up to|less than|max(?:imum)?|budget(?: of)?|around|about)\s*{MONEY}", text)
    if not m:
        m = re.search(rf"(?:rs\.?|inr|₹)?\s*{NUM}\s*{UNIT}\b", text)      # "12 lakh" on its own: treated as a ceiling
    if not m:
        m = re.search(rf"(?:rs\.?|inr|₹)\s*{NUM}\s*(?:{UNIT}\b)?", text)
    if m:
        v = _amount(m.group(1), m.group(2))
        if v:
            return None, v
    return None, None


def parse(text: str, context: Preferences | None = None) -> Preferences:
    t = text.lower()
    p = context.model_copy(deep=True) if context else Preferences()
    lo, hi = _budget(t)
    if hi:
        p.max_price, p.min_price = hi, lo
    fuels = list(dict.fromkeys(v for w, v in FUELS.items() if re.search(rf"\b{w}\b", t)))
    bodies = list(dict.fromkeys(v for w, v in BODIES.items() if re.search(rf"\b{w}s?\b", t)))
    transmissions = []
    if re.search(r"\b(automatic|auto|amt|cvt|dct)\b", t):
        transmissions.append("automatic")
    if re.search(r"\bmanual\b", t):
        transmissions.append("manual")
    if fuels:
        p.fuel_types = fuels
    if bodies:
        p.body_types = bodies
    if transmissions:
        p.transmissions = transmissions
    m = re.search(r"(\d{1,2})\s*[- ]?\s*(?:seater|seats|seat|people|persons)", t)
    if m:
        p.min_seats = min(int(m.group(1)), 20)
    if re.search(r"\bfamily|kids|children\b", t):
        p.use_case, p.min_seats = "family", p.min_seats or 5
    elif re.search(r"city (?:driving|use|commute|traffic|car)|daily commute|in the city|urban|\bcommut", t):
        p.use_case = "city"
    for k, rx in PRIORITY_WORDS.items():
        if re.search(rx, t) and k not in p.priorities:
            p.priorities.append(k)
    return Preferences.model_validate(p.model_dump())


def _has_prefs(p: Preferences):
    return any([p.max_price, p.fuel_types, p.transmissions, p.body_types, p.min_seats, p.use_case, p.priorities])


def _find_models(s: Session, t: str):
    """Catalogue models named in the text (longest names first, no overlaps)."""
    rows = s.execute(select(C.make, C.model).where(catalogue.VISIBLE).distinct()).all()
    found, text = [], " " + re.sub(r"[^\w+\-]+", " ", t.lower()) + " "
    for make, model in sorted(rows, key=lambda r: -len(r[1])):
        name = model.lower()
        if len(name) < 2:
            continue
        needle = f" {make.lower()} {name} " if name in AMBIGUOUS_MODELS else f" {name} "
        if needle in text:
            found.append((make, model)); text = text.replace(needle, " ", 1)
    return found


def _describe(p: Preferences):
    bits = []
    if p.max_price:
        bits.append(f"budget {'between ' + inr(p.min_price) + ' and ' if p.min_price else 'up to '}{inr(p.max_price)}")
    if p.fuel_types:
        bits.append("fuel " + "/".join(p.fuel_types))
    if p.body_types:
        bits.append("body " + "/".join(p.body_types))
    if p.transmissions:
        bits.append("transmission " + "/".join(p.transmissions))
    if p.min_seats:
        bits.append(f"at least {p.min_seats} seats")
    if p.use_case:
        bits.append(f"{p.use_case} use")
    if p.priorities:
        bits.append("priorities: " + ", ".join(p.priorities))
    return "; ".join(bits)


def _name(c):
    return f"{c.make} {c.model} {c.variant}"


def _reply_recommend(s, p):
    out = recommend(s, p)
    if not out.recommendations:
        return "I could not find any catalogue car that meets those requirements.\n" + " ".join(out.notes), []
    lines = [f"I understood: {_describe(p)}." if _has_prefs(p) else "", f"{out.candidates_considered} catalogue variants matched. Top picks:"]
    for i, r in enumerate(out.recommendations[:3], 1):
        lines.append(f"{i}. {_name(r.car)} ({inr(r.car.price_inr)} ex-showroom, score {r.score:g}/100)")
        lines += [f"   + {x}" for x in r.reasons[:3]] + [f"   - {x}" for x in r.tradeoffs[:2]] + [f"   ? {x}" for x in r.missing[:2]]
    for x in out.relaxed_constraints:
        lines.append(f"Nothing matched everything, so I {x}.")
    lines += out.applied_defaults + out.notes
    return "\n".join(x for x in lines if x), [r.car for r in out.recommendations]


def _cheapest(s, make, model):
    return s.scalars(select(C).where(C.make == make, C.model == model, catalogue.VISIBLE).order_by(C.price_inr, C.id)).first()


def _reply_compare(s, models):
    cars = [_cheapest(s, *m) for m in models[:4]]
    cmp = catalogue.compare(s, [c.id for c in cars])
    lines = ["Comparing the lowest-priced variant of each model: " + "; ".join(f"{_name(c)} ({inr(c.price_inr)})" for c in cmp.cars)]
    for f in cmp.fields:
        if f.key in ("price_inr", "mileage_kmpl", "power_ps", "seating_capacity", "boot_space_litres", "fuel_type", "transmission") and f.differs:
            vals = ", ".join(f"{cmp.cars[i].model}: " + ("not recorded" if v is None else inr(v) if f.key == "price_inr" else f"{v:g} {f.unit or ''}".strip() if not isinstance(v, str) else v)
                             for i, v in enumerate(f.values))
            best = f" (best: {cmp.cars[f.best_index].model})" if f.best_index is not None else ""
            lines.append(f"- {f.label}: {vals}{best}")
    if len(lines) == 1:
        lines.append("They are identical on the main attributes I compare.")
    lines.append("Data is from the catalogue (new-car ex-showroom prices); other variants may differ.")
    return "\n".join(lines), cmp.cars


def _reply_lookup(s, models):
    lines, cars = [], []
    for make, model in models[:3]:
        rows = s.scalars(select(C).where(C.make == make, C.model == model, catalogue.VISIBLE).order_by(C.price_inr, C.id)).all()
        lines.append(f"{make} {model}: {len(rows)} variant(s), {inr(rows[0].price_inr)} to {inr(rows[-1].price_inr)} ex-showroom; "
                     f"fuel {', '.join(sorted({r.fuel_type for r in rows}))}; cheapest is {rows[0].variant}.")
        cars.append(catalogue.to_out(rows[0]))
    return "\n".join(lines), cars


HELP = ("I can recommend cars from the catalogue (for example: 'family SUV under 15 lakh, diesel, automatic'), "
        "compare models ('compare Nexon and Brezza'), or summarise a model ('tell me about the Creta'). "
        "I only know the dataset's new-car ex-showroom prices and specifications, not live inventory or on-road costs.")


def respond(s: Session, message: str, context: Preferences | None = None) -> AssistantOut:
    t = message.lower()
    models = _find_models(s, t)
    if len(models) >= 2 and re.search(r"compar|\bvs\b|versus|difference|\bor\b|better", t):
        reply, cars = _reply_compare(s, models)
        return AssistantOut(reply=reply, intent="compare", preferences=context, cars=cars)
    try:
        current, prefs = parse(message), parse(message, context)
    except ValueError:
        return AssistantOut(reply="Please use a budget from ₹1 to ₹1,000 crore and a seat count from 1 to 20.", intent="help", preferences=context, cars=[])
    lookup = models and (not _has_prefs(current) or re.search(r"tell me about|summari[sz]e|details (?:of|about)", t))
    if _has_prefs(prefs) and not lookup:
        reply, cars = _reply_recommend(s, prefs)
        return AssistantOut(reply=reply, intent="recommend", preferences=prefs, cars=cars)
    if models:
        reply, cars = _reply_lookup(s, models)
        if re.search(r"compar|\bvs\b|versus|difference", t):
            reply = "I could only find one of those models in the catalogue, so I cannot compare them. Here is what I have:\n" + reply
        return AssistantOut(reply=reply, intent="lookup", preferences=context, cars=cars)
    return AssistantOut(reply=HELP, intent="help", preferences=context, cars=[])
