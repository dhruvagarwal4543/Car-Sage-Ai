"""The CarSage advisor as an intelligent agent: a knowledge-based, goal-directed agent with a utility-based ranking step.

Type: model-based + utility-based agent (not reflex: it keeps the feasible set and the relaxations applied as internal state
during one decision; not learning: the price model in carsage.predict is a separate, experimental ML component).
This module only describes the agent; the decision procedure is carsage.recommend.recommend and is inspectable at GET /api/agent.
"""
from carsage import rules
from carsage.recommend import BALANCED, CRITERIA, MAX_PER_MODEL, recommend as decide   # noqa: F401 - decide is the agent function

PEAS = {
    "performance": [
        "every strict recommendation satisfies all hard constraints (verified in tests/test_agent.py and src/evaluate_recommender.py)",
        "feasible set found whenever one exists; cheapest relaxation when none exists (uniform-cost search, exhaustive over <= 2^6 states)",
        "explanations consistent with the data they cite (checked in the evaluation)",
        "response time: decision latency recorded in every trace",
        "missing data reported as 'not recorded', never assumed",
    ],
    "environment": ["visible catalogue variants (PostgreSQL, historical ex-showroom prices)", "user preferences and chat context",
                    "vehicle specifications with gaps", "sourced price observations (may be empty)", "listing attributes sent by the Chrome extension"],
    "actuators": ["ranked recommendations with score", "comparison tables", "alternatives", "reasons, trade-offs and missing-data notes",
                  "decision trace", "warnings (relaxation applied, unsupported requests, experimental price estimate)"],
    "sensors": ["budget (min/max)", "fuel types", "transmission", "body types", "seats", "use case (family/city)", "priorities",
                "natural-language message (rule-based parser)", "listing attributes from CarDekho/CarWale pages"],
}

DESCRIPTION = {
    "agent_type": "knowledge-based, goal-directed agent with utility ranking; stateless across requests (chat context is passed back by the client)",
    "peas": PEAS,
    "knowledge_base": [{"id": r.id, "needs": list(r.needs), "then": r.consequence, "rule": r.explanation, "priority": r.priority, "source": r.source}
                       for r in rules.RULES.values()],
    "csp": {"variable": "car", "domain": "visible catalogue rows", "constraints": ["max_price (relax: +15%)", "use_case (relax: drop)", "body_type (relax: drop)",
            "transmission (relax: drop)", "fuel_type (relax: drop)", "min_price (never relaxed)", "min_seats (never relaxed)"],
            "missing_data": "an unrecorded attribute never satisfies a hard constraint and is reported, not assumed"},
    "search": {"state": "tuple of applied constraints", "actions": "relax one relaxable constraint", "goal": "feasible set non-empty",
               "cost": "sum of relaxation costs (budget 1, use case 2, body 3, transmission 4, fuel 5)", "strategy": "uniform-cost search; off when allow_relaxation=false"},
    "ranking": {"criteria": {k: v[0] for k, v in CRITERIA.items()}, "default_priorities": BALANCED, "utility": "mean of min-max normalised criteria over the feasible set",
                "diversity": f"at most {MAX_PER_MODEL} variants per model", "tie_break": "lower price, then catalogue id"},
    "non_ai_components": ["catalogue search and filters (/api/cars, /api/filters): plain SQL", "compare table (/api/cars/compare): attribute lookup",
                          "saved cars, authentication, price history storage: ordinary CRUD"],
    "ml_component": "experimental price estimate (carsage.predict): Ridge regression, evaluated in reports/experiment/",
}
