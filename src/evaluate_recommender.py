"""Reproducible evaluation of the advisor agent on realistic car-buying scenarios.

    python src/evaluate_recommender.py            # writes reports/evaluation/recommender.{json,md}

Builds a throwaway SQLite catalogue from data/processed/cars_processed.csv (no database server needed) and measures,
per system, what can be measured without human relevance labels: hard-constraint satisfaction, coverage, no-match
handling, explanation consistency, ranking stability and latency. There are no relevance labels for this catalogue, so
no "accuracy" is claimed. Systems: two baselines, the full agent, and ablations of its parts.
"""
import json
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine                                   # noqa: E402
from sqlalchemy.orm import Session                                     # noqa: E402

from carsage import csp, import_catalogue, recommend, search           # noqa: E402
from carsage.models import Base                                        # noqa: E402
from carsage.schemas import Preferences                                # noqa: E402

OUT = ROOT / "reports/evaluation"
SCENARIOS = [
    ("suv_under_15_diesel", dict(max_price=1500000, fuel_types=["Diesel"], body_types=["SUV"])),
    ("family_auto_under_12", dict(max_price=1200000, transmissions=["automatic"], use_case="family")),
    ("mileage_under_10", dict(max_price=1000000, priorities=["mileage"])),
    ("seven_seater_auto", dict(min_seats=7, transmissions=["automatic"])),
    ("city_petrol_hatch_8", dict(max_price=800000, fuel_types=["Petrol"], body_types=["Hatchback"], use_case="city")),
    ("cng_under_7", dict(max_price=700000, fuel_types=["CNG"])),
    ("electric_any", dict(fuel_types=["Electric"], priorities=["mileage", "power"])),
    ("sedan_10_to_15_power", dict(min_price=1000000, max_price=1500000, body_types=["Sedan"], priorities=["power", "safety"])),
    ("luxury_suv_1cr", dict(min_price=10000000, body_types=["SUV"], priorities=["power"])),
    ("impossible_diesel_3l", dict(max_price=300000, fuel_types=["Diesel"])),                       # needs relaxation
    ("impossible_9_seat_auto_5l", dict(max_price=500000, min_seats=9, transmissions=["automatic"])),  # seats never relaxed: may stay empty
    ("mpv_diesel_manual_20", dict(max_price=2000000, fuel_types=["Diesel"], transmissions=["manual"], body_types=["MPV"], min_seats=7)),
    ("coupe_under_20", dict(max_price=2000000, body_types=["Coupe"])),
    ("balanced_under_6", dict(max_price=600000)),
    ("space_family_any_budget", dict(use_case="family", priorities=["space", "safety"])),
    ("hybrid_under_30", dict(max_price=3000000, fuel_types=["Hybrid"])),
]


def build_engine(csv=import_catalogue.DEFAULT_CSV):
    e = create_engine("sqlite://")
    Base.metadata.create_all(e)
    import_catalogue.import_catalogue(e, csv)
    return e


# ---- systems: each returns (cars, relaxed, notes, recs) for one Preferences
def catalogue_order(s, p):
    """Baseline 1: ignore the request; the first N cars by price (what a plain listing shows)."""
    rows = sorted(recommend.domain(s), key=lambda r: (r.price_inr, r.id))[:p.limit]
    return rows, [], [], None


def constraint_only(s, p):
    """Baseline 2: hard constraints only (strict), cheapest first, no scoring, no rules, no relaxation."""
    rows = csp.feasible(recommend.domain(s), csp.build(p))
    return sorted(rows, key=lambda r: (r.price_inr, r.id))[:p.limit], [], [], None


def full_agent(s, p):
    out = recommend.recommend(s, p)
    return [r.car for r in out.recommendations], out.relaxed_constraints, out.notes, out


def no_relaxation(s, p):
    return full_agent(s, p.model_copy(update={"allow_relaxation": False}))


def no_rules(s, p):
    """Ablation: suitability rules switched off (use case ignored)."""
    return full_agent(s, p.model_copy(update={"use_case": None}))


def no_scoring(s, p):
    """Ablation: feasibility + relaxation search, but ranked by price instead of the utility."""
    rows = recommend.domain(s)
    res = search.solve(rows, csp.build(p), p.allow_relaxation)
    return sorted(res.cars, key=lambda r: (r.price_inr, r.id))[:p.limit], res.relaxed, [], None


def greedy_relaxation(s, p):
    """The previous engine's relaxation: fixed cumulative order instead of a search for the cheapest relaxation."""
    rows = recommend.domain(s)
    res = search.greedy(rows, csp.build(p))
    return [r for _, r, _ in recommend.pick(recommend.rank(res.cars, p.priorities or recommend.BALANCED), p.limit)], res.relaxed, [], None


SYSTEMS = {"catalogue_order": catalogue_order, "constraint_only": constraint_only, "greedy_relaxation": greedy_relaxation,
           "agent_no_scoring": no_scoring, "agent_no_rules": no_rules, "agent_no_relaxation": no_relaxation, "agent_full": full_agent}


def consistent(rec, p):
    """Every claim in an explanation must hold on the car it describes."""
    c = rec.car
    for text in rec.reasons:
        if "within the budget of" in text and p.max_price is not None and c.price_inr > p.max_price:
            return False
        if "within the raised budget" in text and c.price_inr > int(p.max_price * csp.BUDGET_RELAX):
            return False
        if text.startswith("Fuel ") and not any(f.lower() in (c.fuel_type or "").lower() for f in p.fuel_types):
            return False
        if text.startswith("Seats ") and (c.seating_capacity is None or c.seating_capacity < (p.min_seats or 0)):
            return False
    for text in rec.missing:
        attr = {"Mileage": "mileage_kmpl", "Power": "power_ps", "Airbag count": "number_of_airbags", "Boot space": "boot_space_litres", "Price": "price_inr"}.get(text.split(" is not")[0])
        if attr and getattr(c, attr) is not None:
            return False
    return True


def evaluate(engine, scenarios=SCENARIOS, systems=SYSTEMS):
    results = {}
    with Session(engine) as s:
        for name, fn in systems.items():
            rows, strict_ok, strict_total, consistent_ok, consistent_total, latencies, stable, covered, explained_empty, relaxed_n = [], 0, 0, 0, 0, [], 0, 0, 0, 0
            for sid, prefs in scenarios:
                p = Preferences(**prefs)
                hard = csp.build(p)
                t0 = time.perf_counter()
                cars, relaxed, notes, out = fn(s, p)
                latencies.append((time.perf_counter() - t0) * 1000)
                again = fn(s, p)[0]
                stable += [c.id for c in cars] == [c.id for c in again]
                covered += bool(cars)
                relaxed_n += bool(relaxed)
                if not cars:
                    explained_empty += bool(notes)
                if not relaxed:                                     # strict answers must satisfy every original constraint
                    strict_total += len(cars)
                    strict_ok += sum(csp.satisfies(c, hard) for c in cars)
                if out is not None:
                    consistent_total += len(out.recommendations)
                    consistent_ok += sum(consistent(r, p) for r in out.recommendations)
                rows.append({"scenario": sid, "n": len(cars), "relaxed": relaxed, "top": [f"{c.make} {c.model} {c.variant}" for c in cars[:3]]})
            n = len(scenarios)
            results[name] = {
                "hard_constraint_satisfaction": round(strict_ok / strict_total, 3) if strict_total else None,
                "strict_results_checked": strict_total,
                "coverage": round(covered / n, 3), "scenarios_relaxed": relaxed_n,
                "empty_results_explained": f"{explained_empty}/{n - covered}" if n > covered else "n/a",
                "explanation_consistency": round(consistent_ok / consistent_total, 3) if consistent_total else None,
                "ranking_stability": round(stable / n, 3),
                "latency_ms_median": round(statistics.median(latencies), 1), "latency_ms_max": round(max(latencies), 1),
                "per_scenario": rows,
            }
    return results


def write(results, out=OUT):
    out.mkdir(parents=True, exist_ok=True)
    (out / "recommender.json").write_text(json.dumps(results, indent=1, ensure_ascii=False))
    cols = ["hard_constraint_satisfaction", "coverage", "scenarios_relaxed", "empty_results_explained", "explanation_consistency", "ranking_stability", "latency_ms_median"]
    lines = ["# Recommender evaluation", "", f"{len(SCENARIOS)} scenarios, catalogue from data/processed/cars_processed.csv. Reproduce: `python src/evaluate_recommender.py`.",
             "No relevance labels exist for this catalogue, so no ranking accuracy is claimed; the table measures what the agent promises.", "",
             "| system | " + " | ".join(cols) + " |", "|---|" + "---|" * len(cols)]
    for name, r in results.items():
        lines.append(f"| {name} | " + " | ".join(str(r[c]) for c in cols) + " |")
    lines += ["", "- hard_constraint_satisfaction: share of cars in *strict* (unrelaxed) answers that satisfy every stated constraint (catalogue_order ignores the request, so it is low by design).",
              "- coverage: scenarios with at least one car; scenarios_relaxed: how many needed a concession; empty_results_explained: empty answers that carry a note.",
              "- explanation_consistency: reasons/missing notes checked against the car's own data (only systems that explain).",
              "- ranking_stability: identical result on a second run. Latency: single process, SQLite in memory, includes loading the domain."]
    (out / "recommender.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    res = evaluate(build_engine())
    write(res)
    for name, r in res.items():
        print(f"{name:22} hard={r['hard_constraint_satisfaction']} coverage={r['coverage']} consistent={r['explanation_consistency']} stable={r['ranking_stability']} median={r['latency_ms_median']}ms")
