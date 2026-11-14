"""The outbound request scheduler: spacing, single-flight, bounded waiting, queue and budget limits, deadlines and cancellation (real threads, tiny gaps)."""
import threading
import time

import pytest

from carsage import scheduler as sched


def run_in_threads(n, target):
    out, errs = [None] * n, [None] * n

    def work(i):
        try:
            out[i] = target(i)
        except Exception as e:      # noqa: BLE001 - collected for assertions
            errs[i] = e
    ts = [threading.Thread(target=work, args=(i,)) for i in range(n)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(5)
    return out, errs


def test_requests_to_one_host_are_spread_out_not_rejected():
    s = sched.Scheduler(min_gap=0.1, max_wait=2, max_pending=10)
    starts = []
    out, errs = run_in_threads(4, lambda i: s.run(f"k{i}", "h", lambda: starts.append(time.monotonic()) or i))
    assert errs == [None] * 4 and sorted(out) == [0, 1, 2, 3]
    starts.sort()
    assert all(b - a >= 0.08 for a, b in zip(starts, starts[1:]))             # at least ~min_gap between consecutive fetches


def test_different_hosts_do_not_wait_for_each_other():
    s = sched.Scheduler(min_gap=0.5, max_wait=2)
    t0 = time.monotonic()
    run_in_threads(2, lambda i: s.run(f"k{i}", f"host{i}", lambda: i))
    assert time.monotonic() - t0 < 0.4


def test_identical_in_flight_fetches_are_shared():
    s = sched.Scheduler(min_gap=0, max_wait=2)
    calls, gate = [], threading.Event()

    def fetch():
        calls.append(1)
        gate.wait(2)
        return "page"
    owner = threading.Thread(target=lambda: s.run("same-url", "h", fetch))
    owner.start()
    while not calls:
        time.sleep(0.005)
    waiters = []
    for _ in range(5):                                                         # five more callers arrive while the first fetch is still running
        t = threading.Thread(target=lambda: waiters.append(s.run("same-url", "h", fetch, deadline=time.monotonic() + 3)))
        t.start()
        waiters.append(t)
    time.sleep(0.1)
    gate.set()
    owner.join(2)
    for t in waiters[:]:
        if isinstance(t, threading.Thread):
            t.join(2)
    assert len(calls) == 1 and [w for w in waiters if not isinstance(w, threading.Thread)] == ["page"] * 5     # ten popups, one request


def test_a_failure_is_shared_with_waiters_and_the_key_is_free_again_afterwards():
    s = sched.Scheduler(min_gap=0, max_wait=2)
    gate = threading.Event()

    def boom():
        gate.wait(1)
        raise RuntimeError("HTTP 500")
    first = {}
    t = threading.Thread(target=lambda: first.setdefault("e", _catch(lambda: s.run("k", "h", boom))))
    t.start()
    time.sleep(0.05)
    waiter = {}
    w = threading.Thread(target=lambda: waiter.setdefault("e", _catch(lambda: s.run("k", "h", boom, deadline=time.monotonic() + 2))))
    w.start()
    time.sleep(0.05)
    gate.set()
    t.join(2)
    w.join(2)
    assert str(first["e"]) == "HTTP 500" and str(waiter["e"]) == "HTTP 500"
    assert s.run("k", "h", lambda: "ok") == "ok"


def _catch(fn):
    try:
        return fn()
    except Exception as e:   # noqa: BLE001
        return e


def test_waiting_is_bounded_and_the_caller_gets_a_retry_hint():
    s = sched.Scheduler(min_gap=1.0, max_wait=0.5, max_pending=10)
    assert s.run("a", "h", lambda: 1) == 1                                    # the next slot is now ~1 s away, beyond max_wait
    with pytest.raises(sched.RateLimited) as e:
        s.run("b", "h", lambda: 2)
    assert 0 < e.value.retry_after_s <= 1.0 and e.value.kind == "rate_limited"
    assert s.run("c", "other-host", lambda: 3) == 3


def test_the_queue_is_bounded():
    s = sched.Scheduler(min_gap=0.15, max_wait=5, max_pending=2)
    out, errs = run_in_threads(5, lambda i: s.run(f"k{i}", "h", lambda: i))
    queue_full = [e for e in errs if isinstance(e, sched.QueueFull)]
    assert 1 <= len(queue_full) <= 3 and queue_full[0].kind == "queue_full" and queue_full[0].retry_after_s > 0
    assert sum(1 for o in out if o is not None) + len(queue_full) == 5          # everyone either ran or was told to retry, nobody hung


def test_the_rolling_budget_caps_total_fetches_per_host():
    s = sched.Scheduler(min_gap=0, budget=2, window=60)
    assert [s.run(f"k{i}", "h", lambda: "x") for i in range(2)] == ["x", "x"]
    with pytest.raises(sched.RateLimited) as e:
        s.run("k3", "h", lambda: "x")
    assert 50 < e.value.retry_after_s <= 60


def test_a_deadline_shorter_than_the_wait_is_refused_without_fetching():
    s = sched.Scheduler(min_gap=0.5, max_wait=5)
    s.run("a", "h", lambda: 1)
    ran = []
    with pytest.raises(sched.RateLimited):
        s.run("b", "h", lambda: ran.append(1), deadline=time.monotonic() + 0.1)
    assert ran == []


def test_cancellation_stops_a_queued_request_before_it_fetches():
    s = sched.Scheduler(min_gap=0.6, max_wait=2)
    s.run("a", "h", lambda: 1)
    ticket, ran, err = sched.Ticket(), [], {}
    t = threading.Thread(target=lambda: err.setdefault("e", _catch(lambda: s.run("b", "h", lambda: ran.append(1), ticket=ticket))))
    t.start()
    time.sleep(0.1)
    assert ticket.state == "queued"
    ticket.cancel.set()
    t.join(1)
    assert isinstance(err["e"], sched.Cancelled) and ran == [] and ticket.state == "cancelled"


def test_ticket_states_follow_the_request():
    s = sched.Scheduler(min_gap=0)
    ticket, seen = sched.Ticket(), []
    s.run("a", "h", lambda: seen.append(ticket.state), ticket=ticket)
    assert seen == ["fetching"] and ticket.state == "done"
    bad = sched.Ticket()
    with pytest.raises(ValueError):
        s.run("b", "h", lambda: (_ for _ in ()).throw(ValueError("x")), ticket=bad)
    assert bad.state == "failed"


def test_concurrent_extension_and_website_requests_for_two_models_share_the_provider_politely():
    s = sched.Scheduler(min_gap=0.05, max_wait=3, max_pending=10)
    fetched = []

    def slow(url):
        fetched.append(url)
        time.sleep(0.3)                                                        # long enough that all five callers overlap
        return url
    urls = ["creta", "nexon", "creta", "nexon", "creta"]                      # five callers, two distinct pages
    out, errs = run_in_threads(5, lambda i: s.run(urls[i], "cardekho", lambda: slow(urls[i]), deadline=time.monotonic() + 4))
    assert errs == [None] * 5 and out == urls and sorted(fetched) == ["creta", "nexon"]
