import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { CarCard } from "../components/CarCard";
import { Empty, ErrorBox, Loading } from "../components/States";
import { lakhToRupees } from "../format";
import { useAsync } from "../useAsync";

const SORTS: [string, string][] = [["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"], ["mileage_desc", "Mileage: best first"], ["power_desc", "Power: highest first"], ["name", "Name"]];
const PAGE_SIZE = 12;

export function Explore() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const [text, setText] = useState(get("q"));
  const [notice, setNotice] = useState("");
  const filters = useAsync(() => api.filters(), []);
  const lakh = (v: string) => (v ? String(Number(v) / 1e5) : "");
  const [minText, setMinText] = useState(lakh(get("min_price")));      // local text so "12." and "12.5" can be typed
  const [maxText, setMaxText] = useState(lakh(get("max_price")));

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  useEffect(() => {                      // debounce typing into the URL (which drives the API call)
    const t = setTimeout(() => { if (text !== get("q")) set({ q: text.trim() }); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const page = Math.max(1, Number(get("page")) || 1);
  const minP = get("min_price"), maxP = get("max_price");
  useEffect(() => {                      // follow external changes (reset button, budget shortcuts on the home page)
    if (String(lakhToRupees(minText) ?? "") !== minP) setMinText(lakh(minP));
    if (String(lakhToRupees(maxText) ?? "") !== maxP) setMaxText(lakh(maxP));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minP, maxP]);
  const key = params.toString();
  const result = useAsync(() => api.cars({
    q: get("q"), make: get("make"), fuel_type: get("fuel_type"), transmission: get("transmission"), body_type: get("body_type"),
    min_price: minP, max_price: maxP, min_seats: get("min_seats"), sort: get("sort") || "price_asc", page, page_size: PAGE_SIZE,
  }), [key]);

  const pages = result.data ? Math.max(1, Math.ceil(result.data.total / PAGE_SIZE)) : 1;
  const active = ["q", "make", "fuel_type", "transmission", "body_type", "min_price", "max_price", "min_seats"].some((k) => get(k));
  const select = (name: string, label: string, options: { value: string; count: number }[] | undefined) => (
    <label className="field">{label}
      <select value={get(name)} onChange={(e) => set({ [name]: e.target.value })}>
        <option value="">Any</option>
        {options?.map((o) => <option key={o.value} value={o.value}>{o.value} ({o.count})</option>)}
      </select>
    </label>
  );

  return (
    <>
      <h1>Explore cars</h1>
      <div className="explore">
        <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label="Filters">
          <label className="field">Search
            <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Make, model or variant" />
          </label>
          {select("make", "Make", filters.data?.makes)}
          {select("fuel_type", "Fuel type", filters.data?.fuel_types)}
          {select("transmission", "Transmission", filters.data?.transmissions)}
          {select("body_type", "Body type", filters.data?.body_types)}
          <div className="field-row">
            <label className="field">Min price (₹ lakh)
              <input type="number" min="0" step="0.5" inputMode="decimal" value={minText} onChange={(e) => { setMinText(e.target.value); set({ min_price: String(lakhToRupees(e.target.value) ?? "") }); }} />
            </label>
            <label className="field">Max price (₹ lakh)
              <input type="number" min="0" step="0.5" inputMode="decimal" value={maxText} onChange={(e) => { setMaxText(e.target.value); set({ max_price: String(lakhToRupees(e.target.value) ?? "") }); }} />
            </label>
          </div>
          <label className="field">Minimum seats
            <select value={get("min_seats")} onChange={(e) => set({ min_seats: e.target.value })}>
              <option value="">Any</option>
              {filters.data?.seating_capacities.filter((n) => n >= 2 && n <= 9).map((n) => <option key={n} value={n}>{n}+</option>)}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => { setText(""); setParams({}, { replace: true }); }} disabled={!active}>Reset filters</button>
        </form>

        <section aria-live="polite" aria-label="Results">
          <div className="results-head">
            <p>{result.data ? <><strong>{result.data.total.toLocaleString("en-IN")}</strong> cars found</> : " "}</p>
            <label className="field inline">Sort by
              <select value={get("sort") || "price_asc"} onChange={(e) => set({ sort: e.target.value })}>
                {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
          {notice && <p className="notice" role="alert">{notice}</p>}
          {result.loading && !result.data && <Loading label="Loading cars" />}
          {result.error && <ErrorBox message={result.error} onRetry={result.reload} />}
          {result.data && result.data.items.length === 0 && <Empty title="No cars match these filters">Try widening the budget or clearing a filter.</Empty>}
          <div className={`grid three ${result.loading ? "dim" : ""}`}>{result.data?.items.map((c) => <CarCard key={c.id} car={c} onNotice={setNotice} />)}</div>
          {result.data && result.data.total > PAGE_SIZE && (
            <nav className="pager" aria-label="Pagination">
              <button className="btn" disabled={page <= 1} onClick={() => { set({ page: String(page - 1) }); window.scrollTo(0, 0); }}>Previous</button>
              <span>Page {page} of {pages}</span>
              <button className="btn" disabled={page >= pages} onClick={() => { set({ page: String(page + 1) }); window.scrollTo(0, 0); }}>Next</button>
            </nav>
          )}
        </section>
      </div>
    </>
  );
}
