import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "../api";
import { CarCard, SaveButton } from "../components/CarCard";
import { VehicleViewer } from "../components/VehicleViewer";
import { vehicleAsset } from "../assets";
import { ErrorBox, Loading } from "../components/States";
import { useCompare } from "../compare";
import { SPEC_ROWS, TAG_LABELS, inr, num } from "../format";
import type { PriceOut } from "../types";
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
          {c.tags.length > 0 && <ul className="chips">{c.tags.map((t) => <li key={t} className="tag" title="Derived by a simple rule from the specifications">{TAG_LABELS[t] ?? t}</li>)}</ul>}
          <div className="actions">
            <button className={`btn ${compare.has(c.id) ? "active" : ""}`} aria-pressed={compare.has(c.id)} onClick={() => setNotice(compare.toggle(c.id) ? "" : "You can compare up to 4 cars.")}>{compare.has(c.id) ? "In comparison" : "Add to comparison"}</button>
            <Link className="btn" to="/compare">View comparison ({compare.ids.length})</Link>
            <SaveButton car={c} />
            <Link className="btn primary" to={`/advisor?q=${encodeURIComponent(`tell me about the ${c.make} ${c.model}`)}`}>Ask the advisor</Link>
          </div>
          <Link className="text-link small" to={`/?car=${c.id}#showroom`}>View this car in the homepage showroom ↗</Link>
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

      <section aria-labelledby="est-h" className="panel">
        <h2 id="est-h">Price estimate <span className="tag">experimental</span></h2>
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
