"""State-space search over constraint relaxation.

The hard constraints may rule out every car. Instead of a fixed order of concessions, the agent searches the space of
relaxations for the cheapest one that leaves at least one feasible car.

    State       : the tuple of constraints currently applied (initial state = all constraints the user gave).
    Actions     : relax one constraint that still has a `relax_to`/`relax_cost` (replace it by its weaker form, or drop it).
    Transition  : the new constraint tuple; the feasible set is recomputed from the fixed catalogue domain.
    Goal test   : the feasible set is non-empty.
    Path cost   : sum of the relax_cost of the actions taken (user-visible: fewer and cheaper concessions first).
    Strategy    : uniform-cost search. The space is tiny (at most 2^6 states), so it is exhaustive and deterministic:
                  ties are broken by the order constraints were built in (budget before use case before body ...).

`greedy` is the previous behaviour (relax in a fixed cumulative order) and is kept only as a baseline for evaluation.
"""
import heapq
from dataclasses import dataclass, field

from carsage.csp import feasible


@dataclass
class Result:
    constraints: tuple           # final state
    cars: list                   # feasible set in the final state (empty = no solution even after relaxation)
    relaxed: list[str] = field(default_factory=list)   # user-facing descriptions of the actions taken
    cost: int = 0
    expanded: int = 0            # states whose feasible set was computed
    strategy: str = "uniform-cost"


def actions(state):
    """(description, cost, successor) for every constraint that can still be relaxed."""
    out = []
    for i, c in enumerate(state):
        if c.relax_cost is None:
            continue
        succ = state[:i] + ((c.relax_to,) if c.relax_to else ()) + state[i + 1:]
        out.append((c.relax_text, c.relax_cost, succ))
    return out


def solve(domain, constraints, allow_relaxation=True) -> Result:
    start = tuple(constraints)
    if not allow_relaxation:
        return Result(start, feasible(domain, start), expanded=1, strategy="strict")
    frontier = [(0, 0, start, [])]          # (path cost, tie-break counter, state, actions taken)
    seen, counter, expanded = {_key(start)}, 1, 0
    while frontier:
        cost, _, state, path = heapq.heappop(frontier)      # cheapest state first; goal test on expansion keeps it optimal
        expanded += 1
        cars = feasible(domain, state)
        if cars:
            return Result(state, cars, path, cost, expanded, strategy="none" if state == start else "uniform-cost")
        for text, step, succ in actions(state):
            if _key(succ) not in seen:
                seen.add(_key(succ))
                heapq.heappush(frontier, (cost + step, counter, succ, path + [text]))
                counter += 1
    return Result(start, [], [], 0, expanded)


def _key(state):
    return tuple((c.id, c.label) for c in state)


def greedy(domain, constraints) -> Result:
    """Baseline: relax constraints one by one in their built order until something is feasible."""
    state = tuple(constraints)
    path, cost, expanded = [], 0, 1
    cars = feasible(domain, state)
    while not cars:
        acts = actions(state)
        if not acts:
            break
        text, step, state = acts[0]
        path.append(text); cost += step; expanded += 1
        cars = feasible(domain, state)
    return Result(state, cars, path, cost, expanded, strategy="greedy")
