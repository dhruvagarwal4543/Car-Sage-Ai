import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { CategoryIcon, makeLabel } from "../categories";
import { CarCard } from "../components/CarCard";
import { Icon } from "../components/Icon";
import { Empty, ErrorBox, Loading } from "../components/States";
import { lakhToRupees } from "../format";
import { useAsync } from "../useAsync";
import type { Facet } from "../types";

const SORTS = [["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"], ["mileage_desc", "Mileage: best first"], ["power_desc", "Power: highest first"], ["name", "Name"]];
const PAGE_SIZE = 12;
const FILTER_KEYS = ["q", "make", "model", "fuel_type", "transmission", "body_type", "min_price", "max_price", "min_seats"];

export function Explore() {
  const [params, setParams] = useSearchParams();
  const current = useRef(params); current.current = params;
  const get = (key: string) => params.get(key) ?? "";
  const [text, setText] = useState(get("q"));
  const lakh = (value: string) => value ? String(Number(value) / 1e5) : "";
  const [minText, setMinText] = useState(lakh(get("min_price")));
  const [maxText, setMaxText] = useState(lakh(get("max_price")));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const set = (patch: Record<string, string>, replace = false) => {
    const next = new URLSearchParams(current.current);
    for (const [key, value] of Object.entries(patch)) value ? next.set(key, value) : next.delete(key);
    if ("make" in patch) next.delete("model");
    if (!("page" in patch)) next.delete("page");
    current.current = next;
    setParams(next, { replace });
  };
  const search = get("q"), minP = get("min_price"), maxP = get("max_price");
  useEffect(() => { setText(search); }, [search]);
  useEffect(() => {
    const timer = setTimeout(() => { if (text.trim() !== (current.current.get("q") ?? "")) set({ q: text.trim() }, true); }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  useEffect(() => {
    if (String(lakhToRupees(minText) ?? "") !== minP) setMinText(lakh(minP));
    if (String(lakhToRupees(maxText) ?? "") !== maxP) setMaxText(lakh(maxP));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minP, maxP]);
  useEffect(() => {
    const min = String(lakhToRupees(minText) ?? ""), max = String(lakhToRupees(maxText) ?? "");
    if (min === minP && max === maxP) return;
    const timer = setTimeout(() => set({ min_price: min, max_price: max }, true), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minText, maxText, minP, maxP]);

  const page = Math.min(10000, Math.max(1, Math.floor(Number(get("page"))) || 1));
  const view = get("view") === "variants" ? "variants" : "models";
  const sort = SORTS.some(([value]) => value === get("sort")) ? get("sort") : "price_asc";
  const query = Object.fromEntries(FILTER_KEYS.map((key) => [key, get(key)]));
  const filterKey = JSON.stringify(query);
  const invalidBudget = Boolean(minP && maxP && Number(minP) > Number(maxP));
  const filters = useAsync(() => api.filters(invalidBudget ? {} : query), [filterKey], true);
  const result = useAsync(() => invalidBudget ? Promise.reject(new Error("Minimum price must not exceed maximum price.")) : api.cars({ ...query, view, sort, page, page_size: PAGE_SIZE }), [filterKey, view, sort, page], true);
  const pages = Math.max(1, Math.ceil((result.data?.total ?? 0) / PAGE_SIZE));
  useEffect(() => {
    if (!result.loading && result.data && page > pages) set({ page: String(pages) }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.loading, result.data, page, pages]);
  const active = FILTER_KEYS.filter((key) => get(key));
  const reset = () => { setText(""); setMinText(""); setMaxText(""); setParams(view === "variants" ? { view } : {}); };
  const label = (key: string, value: string) => key.includes("price") ? `${key === "min_price" ? "Min" : "Max"} ₹${Number(value) / 1e5} lakh` : key === "min_seats" ? `${value}+ seats` : makeLabel(value);
  const select = (name: string, title: string, options: Facet[] = [], disabled = false) => {
    const value = get(name);
    return <label className="field">{title}<select value={value} disabled={disabled} onChange={(event) => set({ [name]: event.target.value })}>
      <option value="">{disabled ? "Choose a make first" : "Any"}</option>
      {value && !options.some((option) => option.value === value) && <option value={value}>{makeLabel(value)} (0)</option>}
      {options.map((option) => <option key={option.value} value={option.value}>{makeLabel(option.value)} ({option.count})</option>)}
    </select></label>;
  };

  return <>
    <div className="page-heading" data-reveal><p className="eyebrow">THE CATALOGUE / FIND YOUR FIT</p><h1>Explore cars</h1><p>Different lives. Different drives. Start with what matters to you.</p></div>
    <div className="category-strip" aria-label="Body type categories"><button className={!get("body_type") ? "selected" : ""} aria-pressed={!get("body_type")} onClick={() => set({ body_type: "" })}><Icon name="search" /><span>All cars</span></button>{filters.data?.body_types.map((body) => <button key={body.value} className={get("body_type") === body.value ? "selected" : ""} aria-pressed={get("body_type") === body.value} onClick={() => set({ body_type: get("body_type") === body.value ? "" : body.value })}><CategoryIcon category={body.value} /><span>{body.value}</span></button>)}</div>
    <div className="catalogue-toolbar"><button className="btn mobile-filter-toggle" aria-expanded={filtersOpen} aria-controls="catalogue-filters" onClick={() => setFiltersOpen(!filtersOpen)}>Filters {active.length ? `(${active.length})` : ""}<Icon name="plus" size={15} /></button><div className="view-switch" aria-label="Catalogue grouping"><button aria-pressed={view === "models"} onClick={() => set({ view: "models" })}>Models</button><button aria-pressed={view === "variants"} onClick={() => set({ view: "variants" })}>All variants</button></div><span className="muted small">{view === "models" ? "One matching variant per model. Open variants to see more." : "Every matching variant, with its own specifications."}</span></div>
    <div className="explore">
      <form id="catalogue-filters" className={`filters ${filtersOpen ? "is-open" : ""}`} onSubmit={(event) => event.preventDefault()} aria-label="Filters">
        <div className="filter-heading"><strong>Refine your search</strong><span className="small muted">Counts show matching variants</span></div>
        <label className="field">Search<input type="search" value={text} maxLength={100} onChange={(event) => setText(event.target.value)} placeholder="Make, model or variant" /></label>
        {select("make", "Make", filters.data?.makes)}
        {select("model", "Model", filters.data?.models, !get("make"))}
        {select("fuel_type", "Fuel type", filters.data?.fuel_types)}
        {select("transmission", "Transmission", filters.data?.transmission_groups ?? filters.data?.transmissions)}
        {select("body_type", "Body type", filters.data?.body_types)}
        <div className="field-row"><label className="field">Min price (₹ lakh)<input type="number" min="0" max="100000" step="any" inputMode="decimal" value={minText} onChange={(event) => setMinText(event.target.value)} /></label><label className="field">Max price (₹ lakh)<input type="number" min="0" max="100000" step="any" inputMode="decimal" value={maxText} onChange={(event) => setMaxText(event.target.value)} /></label></div>
        <label className="field">Minimum seats<select value={get("min_seats")} onChange={(event) => set({ min_seats: event.target.value })}><option value="">Any</option>{filters.data?.seating_capacities.map((seats) => <option key={seats} value={seats}>{seats}+</option>)}</select></label>
        <button type="button" className="btn" disabled={!active.length && !text && !minText && !maxText} onClick={reset}>Reset filters</button>
        {filters.error && <ErrorBox message="Could not load filter options." onRetry={filters.reload} />}
      </form>
      <section aria-label="Results" aria-busy={result.loading}>
        <div className="results-head"><p aria-live="polite">{result.data ? <><strong>{result.data.total.toLocaleString("en-IN")}</strong> {view === "models" ? "models" : "variants"} found</> : "Finding your next drive…"}</p><label className="field inline">Sort by<select value={sort} onChange={(event) => set({ sort: event.target.value })}>{SORTS.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label></div>
        {active.length > 0 && <div className="active-filters" aria-label="Active filters">{active.map((key) => <button key={key} onClick={() => { if (key === "q") setText(""); set({ [key]: "" }); }} aria-label={`Remove ${label(key, get(key))} filter`}>{label(key, get(key))}<Icon name="close" size={12} /></button>)}<button className="clear-filters" onClick={reset}>Clear all</button></div>}
        {result.loading && !result.data && <Loading label="Loading cars" />}
        {result.loading && result.data && <p className="updating-results" role="status">Updating your results…</p>}
        {result.error && <ErrorBox message={result.error} onRetry={result.reload} />}
        {result.data && !result.loading && result.data.items.length === 0 && <Empty title="No cars match these filters">Try widening the budget or clearing a filter.</Empty>}
        <div className={`grid three catalogue-grid ${result.loading ? "is-updating" : ""}`}>{result.data?.items.map((car) => <CarCard key={car.id} car={car} modelView={view === "models"} />)}</div>
        {result.data && result.data.total > PAGE_SIZE && <nav className="pager" aria-label="Pagination"><button className="btn" disabled={page <= 1 || result.loading} onClick={() => { set({ page: String(page - 1) }); window.scrollTo(0, 0); }}>Previous</button><span>Page {page} of {pages}</span><button className="btn" disabled={page >= pages || result.loading} onClick={() => { set({ page: String(page + 1) }); window.scrollTo(0, 0); }}>Next</button></nav>}
      </section>
    </div>
  </>;
}
