"""Polite, bounded scheduling of outbound provider fetches.

Every fetch to a host first reserves a time slot (leaky bucket): slots are `min_gap` seconds apart, so a burst of requests is spread out
instead of rejected, but nobody waits longer than `max_wait` (the caller gets `RateLimited` with a retry hint instead). Identical in-flight
fetches are shared (single-flight), so ten popups asking for the same page cause one request. A rolling budget caps the total per host.
Waiting is cancellable and bounded by the caller's deadline. Nothing here sleeps while holding the lock.

States a caller can observe via `Ticket.state`: queued -> fetching -> done | failed | cancelled.
Process-local by design: several server processes each have their own slots (see extension/README.md, "Operational limits").
"""
import threading
import time
from concurrent.futures import Future


class SchedulerError(RuntimeError):
    kind = "error"
    retry_after_s: float | None = None


class RateLimited(SchedulerError):
    kind = "rate_limited"

    def __init__(self, msg, retry_after_s):
        super().__init__(msg)
        self.retry_after_s = round(retry_after_s, 1)


class QueueFull(RateLimited):
    kind = "queue_full"


class Timeout(SchedulerError):
    kind = "timeout"


class Cancelled(SchedulerError):
    kind = "cancelled"


class Ticket:
    def __init__(self):
        self.state = "queued"
        self.cancel = threading.Event()


class HostState:
    def __init__(self):
        self.next_slot = 0.0
        self.pending = 0                  # slots reserved and not yet used
        self.history: list[float] = []    # start times inside the rolling budget window


class Scheduler:
    def __init__(self, min_gap=2.0, max_wait=6.0, max_pending=6, budget=30, window=600.0, clock=time.monotonic, sleep=None):
        self.min_gap, self.max_wait, self.max_pending, self.budget, self.window, self.clock = min_gap, max_wait, max_pending, budget, window, clock
        self.hosts: dict[str, HostState] = {}
        self.inflight: dict[str, Future] = {}
        self.lock = threading.Lock()

    # -- slot reservation -------------------------------------------------------------------------------------------------------
    def _reserve(self, host, deadline):
        with self.lock:
            now = self.clock()
            h = self.hosts.setdefault(host, HostState())
            h.history = [t for t in h.history if now - t < self.window]
            if len(h.history) >= self.budget:
                raise RateLimited(f"fetch budget for {host} used up", (h.history[0] if h.history else now) + self.window - now)
            if h.pending >= self.max_pending:
                raise QueueFull(f"too many queued fetches for {host}", max(h.next_slot - now, self.min_gap))
            slot = max(now, h.next_slot)
            wait = slot - now
            if wait > self.max_wait or (deadline is not None and now + wait > deadline):
                raise RateLimited(f"{host} is busy; next free slot in {wait:.1f}s", wait)
            h.next_slot = slot + self.min_gap
            h.pending += 1
            h.history.append(slot)
            return slot, h

    def _release(self, h):
        with self.lock:
            h.pending = max(0, h.pending - 1)

    # -- public ---------------------------------------------------------------------------------------------------------------
    def run(self, key, host, fn, deadline=None, ticket=None):
        """Run fn() for `key` at most once at a time. A second caller with the same key waits for the first one's result."""
        ticket = ticket or Ticket()
        with self.lock:
            existing = self.inflight.get(key)
            if existing is None:
                fut = self.inflight[key] = Future()
                owner = True
            else:
                fut, owner = existing, False
        if not owner:                                           # single-flight: share the result, bounded by our own deadline
            timeout = None if deadline is None else max(0.0, deadline - self.clock())
            try:
                return fut.result(timeout=timeout)
            except TimeoutError:
                raise Timeout("deadline reached while waiting for an identical in-flight fetch")
        try:
            slot, h = self._reserve(host, deadline)
            try:
                wait = max(0.0, slot - self.clock())
                if ticket.cancel.wait(wait):                    # cancellable sleep until our slot
                    ticket.state = "cancelled"
                    raise Cancelled("request cancelled before the fetch started")
                if deadline is not None and self.clock() >= deadline:
                    raise Timeout("deadline reached before the fetch started")
                ticket.state = "fetching"
            finally:
                self._release(h)
            result = fn()
            ticket.state = "done"
            fut.set_result(result)
            return result
        except BaseException as e:
            if ticket.state != "cancelled":
                ticket.state = "failed"
            fut.set_exception(e)
            raise
        finally:
            with self.lock:
                self.inflight.pop(key, None)
