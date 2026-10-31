import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Empty, ErrorBox, Loading } from "../components/States";
import { MAX_COMPARE, normalizeCompareIds, useCompare } from "../compare";
import { inr, num } from "../format";
import type { CompareField } from "../types";
import { useAsync } from "../useAsync";
import { useEffect, useState } from "react";
import { CarImage } from "../components/CarImage";

function show(f: CompareField, v: string | number | null) {
  if (v == null) return <span className="missing">Not recorded</span>;
  if (f.key === "price_inr") return inr(Number(v));
  return typeof v === "number" ? num(v, f.unit ?? "") : v;
}

export function Compare() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const stored = useCompare();
  const [onlyDiff, setOnlyDiff] = useState(false);
  const rawIds = params.get("ids");
  const ids = rawIds !== null ? normalizeCompareIds(rawIds.split(",").map(Number)) : stored.ids;
  useEffect(() => {
    if (rawIds !== null) stored.replace(normalizeCompareIds(rawIds.split(",").map(Number)));
  }, [rawIds, stored.replace]);
  const res = useAsync(async () => ids.length >= 2 ? api.compare(ids) : ids.length === 1 ? { cars: [await api.car(ids[0])], fields: [] } : null, [ids.join(",")]);
  const update = (next: number[]) => {
    stored.replace(next);
    nav(`/compare${next.length ? `?ids=${next.join(",")}` : ""}`, { replace: true });
  };
  const data = res.data;

  const win = (key: string) => { const f = data?.fields.find((x) => x.key === key); return f?.best_index != null ? data!.cars[f.best_index] : null; };
  const summary = [["Lowest price", win("price_inr")], ["Best mileage", win("mileage_kmpl")], ["Most power", win("power_ps")], ["Most airbags", win("number_of_airbags")], ["Biggest boot", win("boot_space_litres")]] as const;
  const fields = data?.fields.filter((f) => f.values.some((v) => v != null) && (!onlyDiff || f.differs)) ?? [];

  return (
    <>
      <div className="page-heading"><p className="eyebrow">A LITTLE PERSPECTIVE</p><h1>Compare cars</h1><p>The details that matter. Side by side.</p></div>
      <div className="toolbar">
        <p>{ids.length} of {MAX_COMPARE} cars selected</p>
        <Link className="btn primary" to="/cars">{ids.length ? "Add more cars" : "Browse cars"}</Link>
        <button className="btn" disabled={!ids.length} onClick={() => update([])}>Clear selection</button>
      </div>
      {ids.length < 2 && <Empty title={ids.length === 1 ? "Add one more car to compare." : "No cars selected yet."}>Use the Compare button on any car card (up to {MAX_COMPARE}).</Empty>}
      {res.loading && ids.length > 0 && <Loading label="Loading comparison" />}
      {res.error && <>
        <ErrorBox message={res.error} onRetry={res.reload} />
        <p>Remove an unavailable car or clear the selection to start again.</p>
        <div className="actions">{ids.map((id) => <button key={id} className="btn" onClick={() => update(ids.filter((i) => i !== id))}>Remove car #{id}</button>)}</div>
      </>}
      {data && ids.length === 1 && <div className="panel">
        <div className="single-compare-image"><CarImage make={data.cars[0].make} model={data.cars[0].model} /></div>
        <Link to={`/cars/${data.cars[0].id}`}>{data.cars[0].make} {data.cars[0].model} {data.cars[0].variant}</Link>
        <p>{inr(data.cars[0].price_inr)} ex-showroom</p>
        <button className="btn" onClick={() => update([])}>Remove</button>
      </div>}
      {data && ids.length >= 2 && <>
      <label className="difference-toggle"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Show only differences</label>
      <p className="muted small">Swipe or scroll the table horizontally to see all selected cars.</p>
      <ul className="summary" aria-label="Summary">
        {summary.filter(([, c]) => c).map(([label, c]) => <li key={label}><span className="muted small">{label}</span><strong>{c!.make} {c!.model}</strong></li>)}
      </ul>
      <div className="table-scroll" tabIndex={0} aria-label="Comparison table (scrolls horizontally on small screens)">
        <table className="compare">
          <thead>
            <tr><th scope="col">Specification</th>{data.cars.map((c) => (
              <th scope="col" key={c.id}>
                <Link to={`/cars/${c.id}`} aria-label={`${c.make} ${c.model} reference photo`}><CarImage make={c.make} model={c.model} /></Link>
                <Link to={`/cars/${c.id}`}>{c.make} {c.model}</Link><div className="variant">{c.variant}</div>
                <button className="link-btn replace-btn" aria-label={`Replace ${c.make} ${c.model} ${c.variant}`} onClick={() => { stored.replace(ids.filter((i) => i !== c.id)); nav("/cars", { replace: true }); }}>Replace</button>{" · "}
                <button className="link-btn" aria-label={`Remove ${c.make} ${c.model} ${c.variant}`} onClick={() => update(ids.filter((i) => i !== c.id))}>Remove</button>
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.key} className={f.differs ? "differs" : ""}>
                <th scope="row">{f.label}</th>
                {f.values.map((v, i) => <td key={i} className={f.best_index === i ? "best" : ""}>{show(f, v)}{f.best_index === i && <span className="sr-only"> (best)</span>}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onlyDiff && fields.length === 0 && <p role="status">These cars have the same recorded specifications. Turn off “Show only differences” to see all values.</p>}
      <p className="muted small">Highlighted cells are the best value where “better” is clear (lower price; higher mileage, power, airbags, boot space). “Not recorded” means the dataset has no value, so it is not compared.</p>
      </>}
    </>
  );
}
