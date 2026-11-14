"""Knowledge base: explicit if-then suitability rules over catalogue attributes (knowledge representation = production rules).

Each rule is data: id, the attributes it needs, a condition, a consequence (a tag), a priority and a plain-language explanation.
Missing-data semantics: a rule fires only when every attribute it needs is recorded; an unknown value never counts as
true, so a car with no seat count is neither "family friendly" nor "not family friendly", it is undetermined.
Eligibility rules (budget, fuel, ...) are the hard constraints in carsage.csp; explanation rules live in carsage.recommend.
"""
from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class Rule:
    id: str
    needs: tuple[str, ...]                 # attributes that must be recorded for the rule to be decidable
    condition: Callable[[object], bool]    # evaluated only when all `needs` are recorded
    consequence: str                       # tag asserted when the condition holds
    explanation: str                       # the rule in words, shown to users
    priority: int = 0                      # higher fires first in listings; no rule overrides another today
    source: str = "project heuristic, not a fact from the dataset"


RULES: dict[str, Rule] = {r.id: r for r in [
    Rule("family_friendly", ("seating_capacity", "boot_space_litres"),
         lambda c: c.seating_capacity >= 6 or (c.seating_capacity >= 5 and c.boot_space_litres >= 350),
         "family_friendly", "seats >= 6, or seats >= 5 with boot space >= 350 L", priority=2),
    Rule("city_friendly", ("length_mm",), lambda c: c.length_mm <= 4000 or _le(c.min_turning_radius_m, 5.0),
         "city_friendly", "length <= 4000 mm, or minimum turning radius <= 5.0 m", priority=2),
    Rule("fuel_efficient", ("mileage_kmpl",), lambda c: c.mileage_kmpl >= 20, "fuel_efficient", "ARAI mileage >= 20 km/l", priority=1),
    Rule("electric", ("fuel_type",), lambda c: c.fuel_type == "Electric", "fuel_efficient", "electric drivetrain", priority=1),
    Rule("powerful", ("power_ps",), lambda c: c.power_ps >= 150, "powerful", "power >= 150 PS", priority=1),
]}


def _le(v, x):
    return v is not None and v <= x


def decidable(rule: Rule, car) -> bool:
    return all(getattr(car, a, None) is not None for a in rule.needs)


def fire(car) -> list[Rule]:
    """Rules whose condition holds for this car, highest priority first."""
    return sorted((r for r in RULES.values() if decidable(r, car) and r.condition(car)), key=lambda r: (-r.priority, r.id))


def undetermined(car) -> list[Rule]:
    """Rules that could not be evaluated because an attribute they need is not recorded."""
    return [r for r in RULES.values() if not decidable(r, car)]


def derive_tags(car) -> list[str]:
    return list(dict.fromkeys(r.consequence for r in fire(car)))
