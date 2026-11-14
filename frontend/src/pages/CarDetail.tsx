import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "../api";
import { CarCard, SaveButton } from "../components/CarCard";
import { VehicleViewer } from "../components/VehicleViewer";
import { vehicleAsset } from "../assets";
import { ErrorBox, Loading } from "../components/States";
import { useCompare } from "../compare";
import { SPEC_ROWS, TAG_LABELS, inr, num } from "../format";
import type { Car, LiveCompare, LiveQuote, PriceOut } from "../types";
import { useAsync } from "../useAsync";

export function CarDetail() {
  const id = Number(useParams().id);
  return <CarDetails key={id} id={id} />;
}

function CarDetails({ id }: { id: number }) {
  const location = useLocation();
  const from = location.state?.from;
  const back = typeof from === "string" && (from === "/cars" || from.startsWith("/cars?")) ? from : "/cars";
  const car = useAsync(() => api.car(id), [id]);
  const compare = useCompare();
  const [pred, setPred] = useState<{ data?: PriceOut; error?: string; busy: boolean }>({ busy: false });
  const [notice, setNotice] = useState("");

  if (car.loading && !car.data) return <Loading label="Loading car" />;
  if (car.error || !car.data) return <ErrorBox message={car.error ?? "Car not found."} onRetry={car.reload} />;
  const c = car.data;
  const asset = vehicleAsset(c);
  const rows = SPEC_ROWS.filter(([k]) => (c as unknown as Record<string, unknown>)[k] != null);   // unavailable attributes are hidden, never faked

  const estimate = async () => {
    setPred({ busy: true });
    try { setPred({ busy: false, data: await api.predict(c.id) }); } catch (e) { setPred({ busy: false, error: e instanceof Error ? e.message : "Estimate failed" }); }
  };

  return (
    <article>
      <p><Link to={back}>← All cars</Link></p>
      <div className="detail-head">
        <div className="detail-visual" data-reveal="vehicle"><VehicleViewer car={c} />{asset && <p className="asset-credit small muted">{asset.note} <Link to="/credits">Image & model credits ↗</Link></p>}</div>
        <div data-reveal>
          <p className="eyebrow">{c.make} / THE DETAILS</p>
          <h1>{c.model} <span className="variant">{c.variant}</span></h1>
          <p className="price big">{inr(c.price_inr)} <span className="muted small">ex-showroom</span></p>
          <p className="muted small">Ex-showroom price of a new car. On-road price (registration, insurance, taxes) is not in the data.</p>
          {c.freshness && c.freshness !== "unknown" && <p className="notice small" title={c.freshness_reason ?? undefined}>Catalogue entry: {c.freshness === "historical" ? "historical" : "possibly outdated"}. {c.freshness_reason}</p>}
          {c.tags.length > 0 && <p className="spec-line" title="Derived by a simple rule from the specifications">{c.tags.map((t) => TAG_LABELS[t] ?? t).join(" · ")}</p>}
          <div className="actions">
            <button className={`btn ${compare.has(c.id) ? "active" : ""}`} aria-pressed={compare.has(c.id)} onClick={() => setNotice(compare.toggle(c.id) ? "" : "You can compare up to 4 cars.")}>{compare.has(c.id) ? "In comparison" : "Add to comparison"}</button>
            <Link className="btn" to="/compare">View comparison ({compare.ids.length})</Link>
            <SaveButton car={c} />
            <Link className="btn primary" to={`/advisor?q=${encodeURIComponent(`tell me about the ${c.make} ${c.model}`)}`}>Ask the advisor</Link>
          </div>
          {notice && <p className="notice" role="alert">{notice}</p>}
        </div>
      </div>

      <h2>Specifications</h2>
      <dl className="specs">
        {rows.map(([k, label, unit]) => {
          const v = (c as unknown as Record<string, string | number>)[k];
          return <div key={k}><dt>{label}</dt><dd>{typeof v === "number" ? num(v, unit) : v}</dd></div>;
        })}
      </dl>
      <p className="muted small">Only attributes present in the dataset are shown.</p>

      <LivePrices car={c} />

      <section aria-labelledby="est-h" className="panel">
        <h2 id="est-h">Price estimate</h2><p className="label">Experimental</p>
        <p className="muted">A statistical model estimates this car's ex-showroom price from its specifications, to show how well specs explain price. It is not a quote.</p>
        <button className="btn" onClick={estimate} disabled={pred.busy}>{pred.busy ? "Estimating…" : "Estimate from specifications"}</button>
        {pred.error && <ErrorBox message={pred.error} />}
        {pred.data && (
          <div role="status">
            <p>Model estimate: <strong>{inr(pred.data.predicted_price_inr)}</strong>{pred.data.actual_ex_showroom_price_inr != null && <> vs listed {inr(pred.data.actual_ex_showroom_price_inr)}</>}</p>
            <p className="muted small">{pred.data.typical_error}</p>
            {pred.data.warnings.map((w) => <p key={w} className="notice">{w}</p>)}
          </div>
        )}
      </section>

      {c.related.length > 0 && (
        <section aria-labelledby="rel-h">
          <h2 id="rel-h">Comparable cars</h2>
          <p className="muted">Other models in the same body type within about ±25% of the price.</p>
          <div className="grid four">{c.related.map((r) => <CarCard key={r.id} car={r} compact />)}</div>
        </section>
      )}
    </article>
  );
}

const CITIES = ["Delhi", "Mumbai", "Bangalore", "Chennai", "Hyderabad", "Pune", "Kolkata", "Ahmedabad", "Chandigarh", "Jaipur"];

// Current listed prices on other websites for this exact variant: user-initiated, grouped by price basis (type + city), source-linked,
// and kept apart from the historical catalogue price. Quotes of different bases are never compared with each other.
function LivePrices({ car }: { car: Car }) {
  const [state, setState] = useState<{ busy: boolean; data?: LiveCompare; error?: string }>({ busy: false });
  const [city, setCity] = useState(() => { try { return localStorage.getItem("carsage.liveCity") ?? ""; } catch { return ""; } });
  const run = async (refresh = false) => {
    setState({ busy: true });
    try { localStorage.setItem("carsage.liveCity", city); } catch { /* storage unavailable */ }
    try { setState({ busy: false, data: await api.compareLive(car, refresh, city) }); } catch (e) { setState({ busy: false, error: e instanceof Error ? e.message : "unknown error" }); }
  };
  const d = state.data;
  const low = d?.lowest_comparable;
  const lowGroup = low && d?.comparable_groups.find((g) => g.basis.code === low.basis.code);
  const mark = (g: { lowest: LiveQuote }, q: LiveQuote) => (q.provider === g.lowest.provider && q.source_url === g.lowest.source_url && q.price_inr === g.lowest.price_inr ? "▼ " : "");
  const when = (q: { retrieved_at: string }) => `${q.retrieved_at.slice(0, 16).replace("T", " ")}Z`;
  return (
    <section aria-labelledby="live-h" className="panel">
      <h2 id="live-h">Current prices on other websites</h2>
      <p className="muted">The catalogue price above is historical. This reads CarDekho and CarWale for this variant when you ask (cached up to 6 hours) and compares only prices that mean the same thing: same type, same city.</p>
      <label className="field inline">City to compare for <select value={city} onChange={(e) => setCity(e.target.value)}><option value="">Not specified (each site's own default)</option>{CITIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      <div className="actions"><button className="btn" onClick={() => void run()} disabled={state.busy}>{state.busy ? "Reading websites…" : "Check current prices"}</button>{d && <button className="btn" onClick={() => void run(true)} disabled={state.busy}>Refresh</button>}</div>
      {state.error && <ErrorBox message={state.error} />}
      {d && (
        <div role="status">
          {d.incompatible_bases && <p className="notice" role="alert">{d.incompatible_bases}</p>}
          {d.comparable_groups.length === 0 && <p className="notice">No exact variant quote was found for this catalogue entry.</p>}
          {d.comparable_groups.map((g) => (
            <div key={g.basis.code}>
              <h3>{g.basis_label} <span className="muted small">{g.comparable_across_providers ? `comparable across ${g.providers.join(" and ")}` : "one website only"}</span></h3>
              <ul>{g.quotes.map((q) => <li key={q.provider + q.source_url + q.price_inr}>{mark(g, q)}<strong>{q.provider}</strong>: {inr(q.price_inr)} <span className="muted">{q.vehicle} · {q.match} match · {q.freshness} {when(q)}</span> · <a href={q.source_url} target="_blank" rel="noopener noreferrer">source</a></li>)}</ul>
            </div>
          ))}
          {low && <p>{lowGroup?.comparable_across_providers ? ((lowGroup.tied_lowest_providers?.length ?? 0) > 1 ? `Same listed price on ${lowGroup.tied_lowest_providers!.join(" and ")} (${low.basis_label}): ${inr(low.price_inr)}` : `Lowest comparable listed price (${low.basis_label}): ${low.provider} at ${inr(low.price_inr)}`) : `Only ${low.provider} returned an exact ${low.basis_label} quote, so no "cheapest across websites" claim is possible.`}</p>}
          {d.probable_quotes.length > 0 && <><h3>Probable matches (not in the comparison)</h3><ul>{d.probable_quotes.map((q) => <li key={q.provider + q.source_url}><strong>{q.provider}</strong>: {q.vehicle} {inr(q.price_inr)} <span className="muted">{q.basis_label} · {q.match_evidence}</span> · <a href={q.source_url} target="_blank" rel="noopener noreferrer">source</a></li>)}</ul></>}
          {d.model_level.length > 0 && <><h3>Model-level references (not your variant)</h3><ul>{d.model_level.map((m) => <li key={m.provider}><strong>{m.provider}</strong>: {inr(m.price_low)} – {inr(m.price_high)} <span className="muted">{m.basis_label} · {m.note}</span> · <a href={m.source_url} target="_blank" rel="noopener noreferrer">source</a></li>)}</ul></>}
          {d.provider_failures.map((f) => <p key={f.provider + f.page} className="notice">{f.provider} ({f.page}): {f.error}{f.retry_after_s ? ` - retry in about ${Math.ceil(f.retry_after_s)} s` : ""}{f.served === "stale" ? " (showing an older copy)" : ""}</p>)}
          <p className="muted small">{d.warnings.join(" ")}</p>
        </div>
      )}
    </section>
  );
}
