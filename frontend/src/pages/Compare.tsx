import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Empty, ErrorBox, Loading } from "../components/States";
import { MAX_COMPARE, useCompare } from "../compare";
import { inr, num } from "../format";
import type { CompareField } from "../types";
import { useAsync } from "../useAsync";
import { useState } from "react";

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
  const fromUrl = (params.get("ids") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, MAX_COMPARE);
  const ids = fromUrl.length ? fromUrl : stored.ids;
  const res = useAsync(() => (ids.length >= 2 ? api.compare(ids) : Promise.resolve(null)), [ids.join(",")]);

  if (ids.length < 2) {
    return (
      <>
        <h1>Compare cars</h1>
        <Empty title={ids.length === 1 ? "Add one more car to compare." : "No cars selected yet."}>Use the Compare button on any car card (up to {MAX_COMPARE}).</Empty>
        <p><Link className="btn primary" to="/cars">Browse cars</Link></p>
      </>
    );
  }
  if (res.loading && !res.data) return <Loading label="Loading comparison" />;
  if (res.error) return <ErrorBox message={res.error} onRetry={res.reload} />;
  const data = res.data;
  if (!data) return null;

  const win = (key: string) => { const f = data.fields.find((x) => x.key === key); return f?.best_index != null ? data.cars[f.best_index] : null; };
  const summary = [["Lowest price", win("price_inr")], ["Best mileage", win("mileage_kmpl")], ["Most power", win("power_ps")], ["Most airbags", win("number_of_airbags")], ["Biggest boot", win("boot_space_litres")]] as const;
  const fields = data.fields.filter((f) => f.values.some((v) => v != null) && (!onlyDiff || f.differs));

  return (
    <>
      <h1>Compare cars</h1>
      <div className="toolbar">
        <label><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Show only differences</label>
        <button className="btn" onClick={() => { stored.clear(); nav("/compare"); }}>Clear selection</button>
      </div>
      <ul className="summary" aria-label="Summary">
        {summary.filter(([, c]) => c).map(([label, c]) => <li key={label}><span className="muted small">{label}</span><strong>{c!.make} {c!.model}</strong></li>)}
      </ul>
      <div className="table-scroll" tabIndex={0} aria-label="Comparison table (scrolls horizontally on small screens)">
        <table className="compare">
          <thead>
            <tr><th scope="col">Specification</th>{data.cars.map((c) => (
              <th scope="col" key={c.id}>
                <Link to={`/cars/${c.id}`}>{c.make} {c.model}</Link><div className="variant">{c.variant}</div>
                <button className="link-btn" onClick={() => { stored.remove(c.id); const rest = ids.filter((i) => i !== c.id); nav(rest.length ? `/compare?ids=${rest.join(",")}` : "/compare"); }}>Remove</button>
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
      <p className="muted small">Highlighted cells are the best value where “better” is clear (lower price; higher mileage, power, airbags, boot space). “Not recorded” means the dataset has no value, so it is not compared.</p>
    </>
  );
}
