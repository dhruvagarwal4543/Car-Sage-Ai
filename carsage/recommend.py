"""Explainable recommendations: hard constraints -> relative heuristic score -> ranked list with reasons.

Concepts used: constraint satisfaction (hard filters, ordered relaxation when nothing satisfies them),
heuristic ranking (weighted min-max score), knowledge rules (carsage.rules tags) and explanations.
"""
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from carsage.catalogue import apply_filters, category_condition, to_out
from carsage.models import CatalogueCar as C
from carsage.rules import RULES, derive_tags
from carsage.schemas import Preferences, Recommendation, RecommendationOut

USE_CASE_TAG = {"family": "family_friendly", "city": "city_friendly"}
BALANCED = ["price", "mileage", "power", "safety"]
# criterion -> (label, attribute, higher_is_better, unit)
CRITERIA = {"price": ("price", "price_inr", False, ""), "mileage": ("mileage", "mileage_kmpl", True, " km/l"),
            "power": ("power", "power_ps", True, " PS"), "space": ("boot space", "boot_space_litres", True, " L"),
            "safety": ("airbag count", "number_of_airbags", True, "")}
MAX_PER_MODEL = 2   # keep the list diverse: at most two variants of one model


def inr(v):
    return f"₹{v / 1e7:.2f} crore" if v >= 1e7 else f"₹{v / 1e5:.2f} lakh"


def _candidates(s: Session, p: Preferences):
    stmt = apply_filters(select(C), min_price=p.min_price, max_price=p.max_price, min_seats=p.min_seats)
    if p.fuel_types:
        stmt = stmt.where(or_(*(category_condition("fuel_type", f) for f in p.fuel_types)))
    if p.transmissions:
        stmt = stmt.where(or_(*(category_condition("transmission", tr) for tr in p.transmissions)))
    if p.body_types:
        stmt = stmt.where(or_(*(category_condition("body_type", b) for b in p.body_types)))
    rows = s.scalars(stmt).all()
    if p.use_case:
        rows = [r for r in rows if USE_CASE_TAG[p.use_case] in derive_tags(r)]
    return rows


def _relaxations(p: Preferences):
    """Ordered, cumulative ways to loosen constraints when nothing satisfies them all."""
    steps = []
    if p.max_price:
        steps.append((f"raised the budget by 15% to {inr(int(p.max_price * 1.15))}", {"max_price": int(p.max_price * 1.15)}))
    if p.use_case:
        steps.append((f"dropped the '{p.use_case}' use-case requirement", {"use_case": None}))
    if p.body_types:
        steps.append(("dropped the body-type requirement", {"body_types": []}))
    if p.transmissions:
        steps.append(("dropped the transmission requirement", {"transmissions": []}))
    if p.fuel_types:
        steps.append(("dropped the fuel-type requirement", {"fuel_types": []}))
    return steps


def _norm(rows, attr, higher):
    vals = [getattr(r, attr) for r in rows if getattr(r, attr) is not None]
    lo, hi = (min(vals), max(vals)) if vals else (0, 0)
    def f(r):
        v = getattr(r, attr)
        if v is None:
            return None
        if hi == lo:
            return 0.5
        x = (v - lo) / (hi - lo)
        return x if higher else 1 - x
    return f


def recommend(s: Session, p: Preferences) -> RecommendationOut:
    notes = ["Scores are relative heuristics over catalogue data (new-car ex-showroom prices, ARAI mileage). "
             "There is no live inventory, discount or on-road cost information."]
    used, relaxed = p, []
    rows = _candidates(s, used)
    for text, change in _relaxations(p):
        if rows:
            break
        used = used.model_copy(update=change); relaxed.append(text)
        rows = _candidates(s, used)
    if not rows:
        return RecommendationOut(recommendations=[], candidates_considered=0, applied_defaults=[], relaxed_constraints=relaxed,
                                 notes=notes + ["No catalogue car satisfies these requirements, even after relaxing them."])
    defaults = []
    prios = p.priorities or BALANCED
    if not p.priorities:
        defaults.append("No priorities given: using a balanced mix of price, mileage, power and safety.")
    if p.max_price is None:
        defaults.append("No budget given: all prices were considered.")
    norms = {k: _norm(rows, CRITERIA[k][1], CRITERIA[k][2]) for k in prios}
    scored = []
    for r in rows:
        parts = {k: norms[k](r) for k in prios}
        score = sum(v or 0 for v in parts.values()) / len(prios) * 100
        scored.append((score, r, parts))
    scored.sort(key=lambda t: (-t[0], t[1].price_inr, t[1].id))
    picked, per_model = [], {}
    for item in scored:
        g = item[1].model_group
        if per_model.get(g, 0) < MAX_PER_MODEL:
            per_model[g] = per_model.get(g, 0) + 1; picked.append(item)
        if len(picked) == p.limit:
            break
    n = len(rows)
    recs = []
    for score, r, parts in picked:
        reasons, trade, missing = [], [], []
        if used.max_price:
            reasons.append(f"Ex-showroom price {inr(r.price_inr)} is within the budget of {inr(used.max_price)}")
        for label, want, have in (("fuel", used.fuel_types, r.fuel_type), ("body type", used.body_types, r.body_type)):
            if want:
                reasons.append(f"{label.capitalize()} {have} matches your request")
        if used.transmissions:
            reasons.append(f"Transmission {r.transmission} matches your request")
        if used.min_seats:
            reasons.append(f"Seats {r.seating_capacity} (needs at least {used.min_seats})")
        if used.use_case:
            tag = USE_CASE_TAG[used.use_case]
            reasons.append(f"Rule '{tag}' holds: {RULES[tag][0]}")
        for k, v in parts.items():
            label, attr, _, unit = CRITERIA[k]
            val = getattr(r, attr)
            if v is None:
                missing.append(f"{label.capitalize()} is not recorded in the dataset")
            elif v >= 0.75 and n > 1:
                reasons.append(f"Among the cheapest of the {n} matches: {inr(val)}" if k == "price" else f"Strong on {label}: {val:g}{unit} (top range of the {n} matches)")
            elif v <= 0.25 and n > 1:
                trade.append(f"Among the priciest of the {n} matches: {inr(val)}" if k == "price" else f"Weaker on {label}: {val:g}{unit} (bottom range of the {n} matches)")
        recs.append(Recommendation(car=to_out(r), score=round(score, 1), reasons=reasons, tradeoffs=trade, missing=missing))
    return RecommendationOut(recommendations=recs, candidates_considered=n, applied_defaults=defaults, relaxed_constraints=relaxed, notes=notes)
