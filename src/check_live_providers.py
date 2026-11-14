"""Live provider check on real public pages (needs network; spaced out by the scheduler, ~3-5 minutes).

    python src/check_live_providers.py            # writes reports/evaluation/live_providers.{json,md}

For each model it reads CarWale's Delhi price page to find real variants, takes up to two (a petrol/CNG manual and one that differs in fuel or gearbox),
turns each into an identity (trim words, fuel, transmission, engine) and runs the same comparison the extension uses for Delhi ex-showroom prices.
The identity is derived from CarWale's own naming, so CarWale agreeing with itself proves nothing; what is measured is whether CarDekho is matched
to the SAME variant, which bases come out, and what fails. Results are recorded as they happened: nothing is edited by hand.
"""
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from carsage import prices, providers, scheduler                    # noqa: E402
from carsage.prices import CompareIn, Identity, compare     # noqa: E402

OUT = ROOT / "reports/evaluation"
# same 2 s spacing as the product; only the per-10-minute budget is raised because this check deliberately visits many models in a row
prices.fetcher = prices.Fetcher(scheduler=scheduler.Scheduler(min_gap=2.0, max_wait=30, max_pending=20, budget=150))
MODELS = [("Maruti Suzuki", "Swift"), ("Maruti Suzuki", "Dzire"), ("Maruti Suzuki", "Brezza"), ("Hyundai", "i20"), ("Hyundai", "Creta"), ("Tata", "Tiago EV"), ("Tata", "Punch"),
          ("Tata", "Nexon"), ("Honda", "City"), ("Mahindra", "Thar"), ("Kia", "Seltos"), ("Toyota", "Innova Crysta"), ("MG", "Hector"), ("Volkswagen", "Virtus"), ("Skoda", "Slavia")]
DROP = re.compile(r"^(petrol|diesel|cng|electric|hybrid|ev|manual|automatic|turbo|cvt|amt|dct|ivt|dsg|at|mt|tc|ags|speed|\d\.\dl?)$", re.I)


def trim_of(name):
    """CarWale's version name without fuel, engine size and gearbox words ("5 Speed" is dropped, a seat count or a battery size is kept: they identify the variant)."""
    words = re.sub(r"\b\d{1,2}[- ]?speed\b", " ", name, flags=re.I).split()
    return " ".join(w for w in words if not DROP.match(w.strip("()")) or w.startswith("(") and w.strip("()").upper() in ("O", "S", "P"))


def probes(make, model, deadline):
    """Up to two real CarWale variants for this model: the first manual petrol/CNG one, and the first that differs in fuel or gearbox."""
    spec = providers.PageSpec("CarWale", "city", f"https://www.carwale.com/{providers.slug(make)}-cars/{providers.slug(model)}/price-in-delhi/", "Delhi")
    r = prices.page_result(spec, make, model, deadline=deadline)
    ex = [q for q in r.parsed.quotes if q["price_type"] == "ex_showroom"]
    if not ex:
        return [], r
    first = next((q for q in ex if q["transmission"] == "Manual" and q["fuel_type"] in ("Petrol", "CNG")), ex[0])
    other = next((q for q in ex if (q["fuel_type"], q["transmission"]) != (first["fuel_type"], first["transmission"])), None)
    return [x for x in (first, other) if x], r


def run():
    rows = []
    for make, model in MODELS:
        t0 = time.monotonic()
        try:
            found, r = probes(make, model, time.monotonic() + 30)
        except Exception as e:      # noqa: BLE001 - recorded, not hidden
            rows.append({"make": make, "model": model, "error": f"{type(e).__name__}: {e}"})
            continue
        if not found:
            rows.append({"make": make, "model": model, "error": r.error or "no CarWale Delhi variants found", "kind": r.kind})
            print(f"{make} {model}: {r.error}", flush=True)
            continue
        for q in found:
            ident = Identity(make=make, model=model, variant=trim_of(q["vehicle"]) or None, fuel_type=q["fuel_type"], transmission=q["transmission"], engine_cc=int(q["engine_l"] * 1000) if q["engine_l"] else None, city="Delhi")
            out = compare(CompareIn(vehicle=ident, preferred_price_type="ex_showroom"))
            by = {}
            for x in out["quotes"]:
                by.setdefault(x.provider, {}).setdefault(x.match, []).append({"vehicle": x.vehicle, "price": x.price_inr, "basis": x.basis["code"], "url": x.source_url})
            groups = [{"basis": g["basis"]["code"], "providers": g["providers"], "lowest": {"provider": g["lowest"].provider, "price": g["lowest"].price_inr}} for g in out["comparable_groups"] if g["price_type"] == "ex_showroom"]
            row = {"make": make, "model": model, "carwale_variant": q["vehicle"], "identity": ident.model_dump(exclude_none=True), "quotes": by, "groups": groups,
                   "cross_provider_comparable": any(len(g["providers"]) > 1 for g in groups), "model_level": [(m["provider"], m["price_low"], m["price_high"]) for m in out["model_level"]],
                   "failures": [(f["provider"], f["page"], f["kind"], f["error"]) for f in out["provider_failures"]], "probable": [(x.provider, x.vehicle) for x in out["probable_quotes"]],
                   "seconds": round(time.monotonic() - t0, 1)}
            rows.append(row)
            print(f"{make} {model} | {q['vehicle']} | groups={[(g['basis'], g['providers']) for g in groups]} probable={row['probable']} failures={row['failures']}", flush=True)
    return rows


def write(rows):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "live_providers.json").write_text(json.dumps({"checked_at": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "results": rows}, indent=1, ensure_ascii=False))
    ok = [r for r in rows if r.get("cross_provider_comparable")]
    lines = ["# Live provider check", "", f"Real CarDekho and CarWale pages, {len(MODELS)} models, Delhi ex-showroom, {time.strftime('%Y-%m-%d', time.gmtime())}. Reproduce: `python src/check_live_providers.py`.",
             "Variants are taken from CarWale's own Delhi page; the question is whether CarDekho is matched to the same variant. Nothing below is edited by hand.", "",
             f"Probes: {len([r for r in rows if 'carwale_variant' in r])}; with an exact quote from both providers in one basis group: {len(ok)}.", "",
             "| model | CarWale variant | groups (basis: providers) | CarDekho probable | failures |", "|---|---|---|---|---|"]
    for r in rows:
        if "carwale_variant" not in r:
            lines.append(f"| {r['make']} {r['model']} | - | - | - | {r.get('error')} |")
        else:
            lines.append(f"| {r['make']} {r['model']} | {r['carwale_variant']} | {'; '.join(g['basis'] + ': ' + '+'.join(g['providers']) for g in r['groups']) or 'none'} | {len(r['probable'])} | {len(r['failures'])} |")
    (OUT / "live_providers.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    res = run()
    write(res)
    print("written", len(res), "rows", flush=True)
