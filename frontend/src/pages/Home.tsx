import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { CarCard } from "../components/CarCard";
import { ErrorBox, Loading } from "../components/States";
import { useAsync } from "../useAsync";

const BUDGETS = [["Under ₹5 lakh", 0, 500000], ["₹5–10 lakh", 500000, 1000000], ["₹10–20 lakh", 1000000, 2000000], ["₹20 lakh+", 2000000, 0]] as const;

export function Home() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const filters = useAsync(() => api.filters(), []);
  const featured = useAsync(() => api.cars({ sort: "mileage_desc", min_price: 500000, max_price: 2000000, page_size: 24 }), []);

  const submit = (e: FormEvent) => { e.preventDefault(); nav(`/cars${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`); };
  const cars = featured.data ? [...new Map(featured.data.items.map((c) => [c.model, c])).values()].slice(0, 4) : [];
  const bodies = [...(filters.data?.body_types ?? [])].sort((a, b) => b.count - a.count).slice(0, 5);
  const total = filters.data?.makes.reduce((s, m) => s + m.count, 0);

  return (
    <>
      <section className="hero">
        <p className="eyebrow">New cars in India · explainable recommendations</p>
        <h1>Find the new car that actually fits your life.</h1>
        <p className="lead">Search real specifications, compare variants side by side, and let the advisor explain why a car matches your budget and needs, including the trade-offs.</p>
        <form className="searchbar" onSubmit={submit} role="search">
          <label htmlFor="hero-q" className="sr-only">Search by make, model or variant</label>
          <input id="hero-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try “Creta”, “Tata Nexon” or “Maruti Dzire”" />
          <button className="btn primary" type="submit">Explore cars</button>
        </form>
        {total != null && <p className="muted small">{total.toLocaleString("en-IN")} variants from {filters.data!.makes.length} makes in the catalogue</p>}
      </section>

      <section aria-labelledby="budget-h">
        <h2 id="budget-h">Start with a budget</h2>
        <div className="grid four">
          {BUDGETS.map(([label, lo, hi]) => (
            <Link key={label} className="tile" to={`/cars?${[lo ? `min_price=${lo}` : "", hi ? `max_price=${hi}` : "", "sort=price_asc"].filter(Boolean).join("&")}`}>{label}<span aria-hidden="true">→</span></Link>
          ))}
        </div>
        {bodies.length > 0 && (
          <p className="chips-row">Popular body types:{" "}
            {bodies.map((b) => <Link key={b.value} className="chip-link" to={`/cars?body_type=${encodeURIComponent(b.value)}`}>{b.value} <span className="muted">({b.count})</span></Link>)}
          </p>
        )}
      </section>

      <section aria-labelledby="feat-h">
        <h2 id="feat-h">Fuel-efficient picks under ₹20 lakh</h2>
        <p className="muted">Highest ARAI mileage in the catalogue within that budget (one variant per model).</p>
        {featured.loading && <Loading label="Loading featured cars" />}
        {featured.error && <ErrorBox message={featured.error} onRetry={featured.reload} />}
        <div className="grid four">{cars.map((c) => <CarCard key={c.id} car={c} />)}</div>
      </section>

      <section aria-labelledby="how-h">
        <h2 id="how-h">How it works</h2>
        <ol className="steps">
          <li><strong>Tell us what you need.</strong> Budget, fuel, body type, seats and what matters most.</li>
          <li><strong>We filter, then rank.</strong> Hard requirements first; the rest by a transparent score.</li>
          <li><strong>You see the reasons.</strong> Every pick lists why it fits, what it gives up, and what the data does not tell us.</li>
        </ol>
      </section>

      <section className="split">
        <div><h2>Ask the AI Advisor</h2><p>Describe your situation in plain English, for example “family SUV under 15 lakh, diesel”. Answers come only from the catalogue.</p><Link className="btn primary" to="/advisor">Open the advisor</Link></div>
        <div><h2>Compare side by side</h2><p>Pick up to four variants and see price, mileage, power and size with the best value highlighted and missing data marked.</p><Link className="btn" to="/compare">Open comparison</Link></div>
      </section>
    </>
  );
}
