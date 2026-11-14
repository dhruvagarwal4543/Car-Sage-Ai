# Recommender evaluation

16 scenarios, catalogue from data/processed/cars_processed.csv. Reproduce: `python src/evaluate_recommender.py`.
No relevance labels exist for this catalogue, so no ranking accuracy is claimed; the table measures what the agent promises.

| system | hard_constraint_satisfaction | coverage | scenarios_relaxed | empty_results_explained | explanation_consistency | ranking_stability | latency_ms_median |
|---|---|---|---|---|---|---|---|
| catalogue_order | 0.188 | 1.0 | 0 | n/a | None | 1.0 | 6.8 |
| constraint_only | 1.0 | 0.812 | 0 | 0/3 | None | 1.0 | 7.1 |
| greedy_relaxation | 1.0 | 1.0 | 3 | n/a | None | 1.0 | 7.4 |
| agent_no_scoring | 1.0 | 1.0 | 3 | n/a | None | 1.0 | 7.6 |
| agent_no_rules | 0.984 | 1.0 | 3 | n/a | 1.0 | 1.0 | 9.2 |
| agent_no_relaxation | 1.0 | 0.812 | 0 | 3/3 | 1.0 | 1.0 | 9.4 |
| agent_full | 1.0 | 1.0 | 3 | n/a | 1.0 | 1.0 | 9.1 |

- hard_constraint_satisfaction: share of cars in *strict* (unrelaxed) answers that satisfy every stated constraint (catalogue_order ignores the request, so it is low by design).
- coverage: scenarios with at least one car; scenarios_relaxed: how many needed a concession; empty_results_explained: empty answers that carry a note.
- explanation_consistency: reasons/missing notes checked against the car's own data (only systems that explain).
- ranking_stability: identical result on a second run. Latency: single process, SQLite in memory, includes loading the domain.
