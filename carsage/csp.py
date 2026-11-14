"""Car selection as a constraint satisfaction problem.

    CSP = (Variables, Domains, Constraints)
    Variable    : `car`, the catalogue variant to recommend.
    Domain      : every visible catalogue row (duplicates hidden), loaded once per request.
    Constraints : unary hard constraints built from the user's Preferences (budget, seats, fuel, transmission, body, use case).

A constraint's `check(car)` answers True (satisfied), False (violated) or None (the attribute is not recorded).
Missing-data policy: None never satisfies a hard constraint, and the car is reported as "not recorded", never assumed.
Soft preferences (priorities) are not constraints; they only rank the feasible set (carsage.recommend).
Relaxation is a separate, explicit step (carsage.search): a constraint may name the weaker constraint it becomes.
"""
from dataclasses import dataclass
from typing import Callable

from carsage.catalogue import AUTOMATIC, inr
from carsage.rules import RULES, decidable, fire

USE_CASE_TAG = {"family": "family_friendly", "city": "city_friendly"}
BUDGET_RELAX = 1.15


@dataclass(frozen=True)
class Constraint:
    id: str
    label: str                                      # what the user asked for, in words
    check: Callable[[object], bool | None]
    reason: Callable[[object], str] | None = None   # why a satisfying car satisfies it, in words
    relax_to: "Constraint | None" = None            # weaker form used by search; None with relax_cost = drop entirely
    relax_cost: int | None = None                   # None = never relaxed (a hard user requirement)
    relax_text: str = ""


def _members(value, sep):
    return {v.strip().lower() for v in (value or "").split(sep) if v.strip()}


def _gear(value):
    v = (value or "").strip().lower()
    return "automatic" if v in AUTOMATIC else v or None


def build(p) -> list[Constraint]:
    """Constraints in relaxation-priority order: the cheapest to relax first."""
    cs = []
    if p.max_price is not None:
        raised = int(p.max_price * BUDGET_RELAX)
        relaxed = Constraint("max_price", f"budget up to {inr(raised)} (raised)", lambda c, v=raised: c.price_inr <= v,
                             lambda c, v=raised: f"Ex-showroom price {inr(c.price_inr)} is within the raised budget of {inr(v)}")
        cs.append(Constraint("max_price", f"budget up to {inr(p.max_price)}", lambda c, v=p.max_price: c.price_inr <= v,
                             lambda c, v=p.max_price: f"Ex-showroom price {inr(c.price_inr)} is within the budget of {inr(v)}",
                             relax_to=relaxed, relax_cost=1, relax_text=f"raised the budget by 15% to {inr(raised)}"))
    if p.use_case:
        tag = USE_CASE_TAG[p.use_case]
        rule = RULES[tag]
        cs.append(Constraint("use_case", f"{p.use_case} use ({rule.explanation})",
                             lambda c, r=rule, t=tag: (t in [x.consequence for x in fire(c)]) if decidable(r, c) else None,
                             lambda c, t=tag, r=rule: f"Rule '{t}' holds: {r.explanation}", relax_cost=2, relax_text=f"dropped the '{p.use_case}' use-case requirement"))
    if p.body_types:
        want = {b.lower().replace(" ", "") for b in p.body_types}
        cs.append(Constraint("body_type", "body " + "/".join(p.body_types),
                             lambda c, w=want: None if c.body_type is None else bool({m.replace(" ", "") for m in _members(c.body_type, ",")} & w),
                             lambda c: f"Body type {c.body_type} matches your request", relax_cost=3, relax_text="dropped the body-type requirement"))
    if p.transmissions:
        want = set(p.transmissions)
        cs.append(Constraint("transmission", "transmission " + "/".join(p.transmissions),
                             lambda c, w=want: None if _gear(c.transmission) is None else _gear(c.transmission) in w,
                             lambda c: f"Transmission {c.transmission} matches your request", relax_cost=4, relax_text="dropped the transmission requirement"))
    if p.fuel_types:
        want = {f.lower() for f in p.fuel_types}
        cs.append(Constraint("fuel_type", "fuel " + "/".join(p.fuel_types), lambda c, w=want: bool(_members(c.fuel_type, "+") & w),
                             lambda c: f"Fuel {c.fuel_type} matches your request", relax_cost=5, relax_text="dropped the fuel-type requirement"))
    # never relaxed: a floor on price or seats is a hard user requirement
    if p.min_price is not None:
        cs.append(Constraint("min_price", f"price at least {inr(p.min_price)}", lambda c, v=p.min_price: c.price_inr >= v))
    if p.min_seats is not None:
        cs.append(Constraint("min_seats", f"at least {p.min_seats} seats", lambda c, v=p.min_seats: None if c.seating_capacity is None else c.seating_capacity >= v,
                             lambda c, v=p.min_seats: f"Seats {c.seating_capacity} (needs at least {v})"))
    return cs


def satisfies(car, constraints) -> bool:
    return all(c.check(car) is True for c in constraints)


def feasible(domain, constraints) -> list:
    return [car for car in domain if satisfies(car, constraints)]


def eliminated(domain, constraints) -> dict[str, int]:
    """How many domain values each constraint rules out on its own (an unrecorded attribute counts as ruled out)."""
    return {c.id: sum(1 for car in domain if c.check(car) is not True) for c in constraints}
