"""The advisor agent's decision procedure: perceive preferences -> CSP feasibility -> relaxation search -> utility ranking -> explain.

Hard constraints (carsage.csp) decide feasibility; soft priorities rank only the feasible set with a weighted min-max utility;
knowledge rules (carsage.rules) supply suitability tags; every decision is returned with a trace (carsage.schemas.DecisionTrace).
"""
import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from carsage import csp, prices, search
from carsage.catalogue import VISIBLE, inr, to_out   # noqa: F401 - inr re-exported for older importers
from carsage.models import CatalogueCar as C
from carsage.rules import undetermined
from carsage.schemas import DecisionTrace, Preferences, Recommendation, RecommendationOut

BALANCED = ["price", "mileage", "power", "safety"]
# criterion -> (label, attribute, higher_is_better, unit)
CRITERIA = {"price": ("price", "price_inr", False, ""), "mileage": ("mileage", "mileage_kmpl", True, " km/l"),
            "power": ("power", "power_ps", True, " PS"), "space": ("boot space", "boot_space_litres", True, " L"),
            "safety": ("airbag count", "number_of_airbags", True, "")}
MAX_PER_MODEL = 2   # keep the list diverse: at most two variants of one model
NOTE = ("Scores are relative heuristics over catalogue data (new-car ex-showroom prices, ARAI mileage). "
        "There is no live inventory, discount or on-road cost information.")


def domain(s: Session):
    return s.scalars(select(C).where(VISIBLE).order_by(C.id)).all()


def _norm(rows, attr, higher):
    """Min-max over the feasible set; None stays None (unknown is neither good nor bad, it is reported)."""
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


def rank(rows, prios):
    """Utility = mean of the normalised criteria (missing criteria count 0). Ties: cheaper first, then catalogue id."""
    norms = {k: _norm(rows, CRITERIA[k][1], CRITERIA[k][2]) for k in prios}
    scored = [(sum(v or 0 for v in parts.values()) / len(prios) * 100, r, parts) for r in rows for parts in [{k: norms[k](r) for k in prios}]]
    scored.sort(key=lambda t: (-t[0], t[1].price_inr, t[1].id))
    return scored


def pick(scored, limit):
    picked, per_model = [], {}
    for item in scored:
        g = item[1].model_group
        if per_model.get(g, 0) < MAX_PER_MODEL:
            per_model[g] = per_model.get(g, 0) + 1
            picked.append(item)
        if len(picked) == limit:
            break
    return picked


def explain(r, parts, constraints, n):
    reasons = [c.reason(r) for c in constraints if c.reason]
    trade, missing = [], []
    for k, v in parts.items():
        label, attr, _, unit = CRITERIA[k]
        val = getattr(r, attr)
        if v is None:
            missing.append(f"{label.capitalize()} is not recorded in the dataset")
        elif v >= 0.75 and n > 1:
            reasons.append(f"Among the cheapest of the {n} matches: {inr(val)}" if k == "price" else f"Strong on {label}: {val:g}{unit} (top range of the {n} matches)")
        elif v <= 0.25 and n > 1:
            trade.append(f"Among the priciest of the {n} matches: {inr(val)}" if k == "price" else f"Weaker on {label}: {val:g}{unit} (bottom range of the {n} matches)")
    missing += [f"Rule '{rule.id}' could not be checked: {', '.join(rule.needs)} not recorded" for rule in undetermined(r) if rule.id in ("family_friendly", "city_friendly")]
    return reasons, trade, missing


def recommend(s: Session, p: Preferences) -> RecommendationOut:
    t0 = time.perf_counter()
    cars = domain(s)
    constraints = csp.build(p)
    result = search.solve(cars, constraints, p.allow_relaxation)
    prios = p.priorities or BALANCED
    defaults = []
    if not p.priorities:
        defaults.append("No priorities given: using a balanced mix of price, mileage, power and safety.")
    if p.max_price is None:
        defaults.append("No budget given: all prices were considered.")
    scored = rank(result.cars, prios)
    picked = pick(scored, p.limit)
    n = len(result.cars)
    explained = [(score, r, *explain(r, parts, result.constraints, n)) for score, r, parts in picked]
    live_notes = []
    if p.live_prices:                      # optional signal from the provider cache only: no network inside a decision, nothing feasibility-related changes
        for score, r, rs, tr, ms in explained:
            found, status = prices.cached_quote(r.make, r.model, r.variant, r.fuel_type, r.transmission)
            for q in found:
                within = p.max_price is None or q["price_inr"] <= p.max_price
                (rs if within else tr).append(
                    f"External listed price on {q['provider']} ({q['basis_label']}): {inr(q['price_inr'])} ({q['match']} variant match, {'stale, ' if q['stale'] else ''}retrieved {q['retrieved_at'][:16]}Z); "
                    f"{'within' if within else 'ABOVE'} your budget. The catalogue price ({inr(r.price_inr)}) is historical and has no stated city, so the two are not subtracted")
            same = {}
            for q in found:
                same.setdefault(q["basis"]["code"], []).append(q)
            for code, qs in same.items():                  # a "cheaper listing" is only claimed between quotes with the same price basis
                if len(qs) > 1 and len({x["price_inr"] for x in qs}) > 1:
                    lo, hi = min(qs, key=lambda x: x["price_inr"]), max(qs, key=lambda x: x["price_inr"])
                    rs.append(f"Cheaper listing found: {lo['provider']} lists {inr(hi['price_inr'] - lo['price_inr'])} less than {hi['provider']} on the same basis ({lo['basis_label']}). A listing price is not a dealer's final price")
            if not found:
                ms.append("No current website quote in cache for this variant (" + "; ".join(status) + ")")
        live_notes = ["Live website quotes come from CarDekho/CarWale pages cached for up to 6 hours; they are listed prices, not dealer quotes, and never change which cars qualify."]
    recs = [Recommendation(car=to_out(r), score=round(score, 1), reasons=rs, tradeoffs=tr, missing=ms) for score, r, rs, tr, ms in explained]
    notes = [NOTE] + live_notes
    if not recs:
        notes.append("No catalogue car satisfies these requirements" + (", even after relaxing them." if p.allow_relaxation else "; relaxation was not allowed."))
    trace = DecisionTrace(
        input={k: v for k, v in p.model_dump().items() if v not in (None, [])},
        constraints=[{"id": c.id, "label": c.label, "relaxable": c.relax_cost is not None} for c in constraints],
        initial_candidates=len(cars), eliminated=csp.eliminated(cars, constraints), feasible=len(csp.feasible(cars, constraints)),
        relaxation=result.relaxed, search={"strategy": result.strategy, "states_expanded": result.expanded, "cost": result.cost},
        scoring={"priorities": prios, "weights": {k: round(1 / len(prios), 3) for k in prios}, "method": "min-max over the feasible set, equal weights, missing = 0"},
        missing_attributes={f"{r.make} {r.model} {r.variant}": ms for _, r, _, _, ms in explained if ms},
        ranking=[{"car_id": r.id, "score": round(score, 1)} for score, r, _ in picked],
        latency_ms=round((time.perf_counter() - t0) * 1000, 1))
    return RecommendationOut(recommendations=recs, candidates_considered=n, applied_defaults=defaults, relaxed_constraints=result.relaxed, notes=notes, trace=trace)
