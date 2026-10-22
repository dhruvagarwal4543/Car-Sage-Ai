"""Knowledge base: transparent if-then rules that derive tags from catalogue attributes.

These are heuristics chosen for this project, not facts from the dataset. A rule only fires when
the attributes it needs are present; missing data never produces a tag.
"""
RULES = {
    "family_friendly": ("seats >= 6, or seats >= 5 with boot space >= 350 L",
                        lambda c: _ge(c.seating_capacity, 6) or (_ge(c.seating_capacity, 5) and _ge(c.boot_space_litres, 350))),
    "city_friendly": ("length <= 4000 mm, or minimum turning radius <= 5.0 m",
                      lambda c: _le(c.length_mm, 4000) or _le(c.min_turning_radius_m, 5.0)),
    "fuel_efficient": ("ARAI mileage >= 20 km/l or electric", lambda c: _ge(c.mileage_kmpl, 20) or c.fuel_type == "Electric"),
    "powerful": ("power >= 150 PS", lambda c: _ge(c.power_ps, 150)),
}


def _ge(v, x):
    return v is not None and v >= x


def _le(v, x):
    return v is not None and v <= x


def derive_tags(car):
    return [name for name, (_, test) in RULES.items() if test(car)]
