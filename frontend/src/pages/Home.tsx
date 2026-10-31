import { FormEvent, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { CategoryIcon, makeLabel } from "../categories";
import { CarCard } from "../components/CarCard";
import { Emblem } from "../components/Emblem";
import { Icon } from "../components/Icon";
import { ErrorBox, Loading } from "../components/States";
import { VehicleViewer } from "../components/VehicleViewer";
import { inr, num } from "../format";
import { useHeroMotion } from "../motion";
import { useAsync } from "../useAsync";
import { vehicleAsset } from "../assets";

const BUDGETS = [["Under ₹5 lakh", 0, 499999], ["₹5–10 lakh", 500000, 999999], ["₹10–20 lakh", 1000000, 1999999], ["₹20 lakh+", 2000000, 0]] as const;
// One vehicle holds the stage. It is the car the project ships a credited 3D model for.
const HERO = { make: "Porsche", model: "911" };
const CHAPTERS = [
  ["01", "The approach", "Walk up to a car the way you would on a forecourt — specifications first, sales talk never."],
  ["02", "The detail", "Engine, body, efficiency and price, read straight off the catalogue record for that variant."],
  ["03", "Across the line", "Past the glass, into the part of a car a brochure photograph never shows you."],
  ["04", "From the seat", "This is where the decision is made. Shortlist, compare, and leave knowing what you are looking at."],
] as const;
const METHOD = [
  ["01", "Start from your life", "Search by make and model, set a budget, or simply describe the week you actually drive."],
  ["02", "Look closer", "Inspect the recorded specifications and put real variants side by side, difference by difference."],
  ["03", "Know what you see", "Historical ex-showroom data. Nothing invented — missing values are marked, never filled in."],
] as const;

export function Home() {
  const nav = useNavigate();
  const hero = useRef<HTMLElement>(null);
  const [q, setQ] = useState("");
  const [budget, setBudget] = useState("");
  const [fuel, setFuel] = useState("");
  const filters = useAsync(() => api.filters(), []);
  const showcase = useAsync(async () => (await api.cars({ ...HERO, sort: "price_asc", page_size: 1 })).items[0] ?? null, []);
  const featured = useAsync(() => api.cars({ view: "models", sort: "mileage_desc", min_price: 500000, max_price: 2000000, page_size: 4 }), []);
  const total = filters.data?.makes.reduce((sum, make) => sum + make.count, 0);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const search = new URLSearchParams({ view: "models" });
    if (q.trim()) search.set("q", q.trim());
    if (budget) search.set("max_price", budget);
    if (fuel) search.set("fuel_type", fuel);
    nav(`/cars?${search}`);
  };
  const c = showcase.data;
  const asset = c ? vehicleAsset(c) : undefined;
  useHeroMotion(hero, c?.id ?? 0);

  return <>
    <section ref={hero} className="cinema" aria-labelledby="hero-title">
      <div className="cinema-sticky">
        <div className="cinema-stage" id="showroom" aria-busy={showcase.loading}>
          <div className="cinema-object">
            {c ? <div className="vehicle-transition"><VehicleViewer car={c} stage /></div>
              : showcase.error ? <ErrorBox message={showcase.error} onRetry={showcase.reload} />
                : <div className="showroom-skeleton"><Loading label="Opening the showroom" /></div>}
          </div>
          <div className="cinema-grade" aria-hidden="true" />
          <div className="cinema-grain" aria-hidden="true" />
        </div>

        <div className="cinema-overlay">
          <header className="hero-copy" data-hero="copy">
            <p className="eyebrow">A new perspective on your next drive</p>
            <h1 className="hero-title" id="hero-title"><span className="hero-line"><span>Find your next.</span></span><span className="hero-line"><span>Drive your story.</span></span></h1>
            <p className="hero-description"><span>Real cars, real specifications, and the quiet confidence of knowing exactly what you are looking at.</span></p>
            <div className="hero-actions"><Link className="btn primary" to="/cars">Explore the collection <Icon name="arrow" size={16} /></Link><Link className="btn ghost" to="/advisor"><Icon name="spark" size={16} /> Find my match</Link></div>
          </header>

          <ol className="cinema-chapters">
            {CHAPTERS.map(([index, title, body]) => <li key={index} className={`chapter${index === "04" ? " interior" : ""}`} data-chapter={index}><span className="chapter-index">{index}</span><h2>{title}</h2><p>{body}</p></li>)}
          </ol>

          <footer className="cinema-rail" data-hero="rail">
            {c && <div className="showroom-caption">
              <div><p className="eyebrow">{c.make}</p><Link to={`/cars/${c.id}`}><h2>{c.model} <span>{c.variant}</span></h2></Link><p className="muted small">{[c.fuel_type, c.transmission, c.power_ps != null ? num(c.power_ps, "PS") : null].filter(Boolean).join(" · ")}</p></div>
              <div className="showroom-price"><strong>{inr(c.price_inr)}</strong><span>Catalogue ex-showroom</span></div>
            </div>}
            <div className="cinema-tabs">
              {asset && <p className="hero-reference-note">{asset.modelUrl ? asset.modelNote : asset.note} <Link to="/credits">Visual credits ↗</Link></p>}
              <a className="scroll-cue" href="#discover"><span className="scroll-rail" aria-hidden="true"><i /></span>Scroll to drive in</a>
            </div>
            <div className="scroll-progress" aria-hidden="true"><span /></div>
          </footer>
        </div>
      </div>
    </section>

    <div className="home-content" id="discover">
      <section className="band search-band">
        <div className="band-head"><p className="eyebrow">The road starts here</p><h2>A world of possibilities.<br /><span className="dim">One drive that feels like you.</span></h2></div>
        <form className="discovery-search" onSubmit={submit} role="search">
          <label className="search-field"><Icon name="search" size={18} /><span className="sr-only">Search by make, model or variant</span><input value={q} maxLength={100} onChange={(event) => setQ(event.target.value)} placeholder="A make, a model, a possibility…" /></label>
          <label className="field">Budget<select value={budget} onChange={(event) => setBudget(event.target.value)}><option value="">Any budget</option><option value="500000">Up to ₹5 lakh</option><option value="1000000">Up to ₹10 lakh</option><option value="2000000">Up to ₹20 lakh</option></select></label>
          <label className="field">Fuel<select value={fuel} onChange={(event) => setFuel(event.target.value)}><option value="">Any fuel</option>{filters.data?.fuel_types.map((option) => <option key={option.value} value={option.value}>{option.value}</option>)}</select></label>
          <button className="btn primary" type="submit">Explore <Icon name="arrow" size={16} /></button>
        </form>
        <p className="catalogue-note">{total != null ? `${total.toLocaleString("en-IN")} catalogue variants across ${filters.data!.makes.length} makes` : "An Indian new-car specification catalogue"}<span>Historical specifications · No live inventory</span></p>
      </section>

      <section className="band" aria-labelledby="shape-h">
        <div className="band-head"><div><p className="eyebrow">Different lives. Different drives.</p><h2 id="shape-h">Find your kind of car.</h2></div><Link className="text-link" to="/cars">All cars <Icon name="arrow" size={15} /></Link></div>
        <div className="category-grid">{filters.data?.body_types.map((body) => <Link key={body.value} to={`/cars?view=models&body_type=${encodeURIComponent(body.value)}`}><CategoryIcon category={body.value} /><strong>{body.value}</strong><span>{body.count} variants</span></Link>)}</div>
        {filters.error && <ErrorBox message={filters.error} onRetry={filters.reload} />}
      </section>

      <section className="band" aria-labelledby="budget-h">
        <div className="band-head"><div><p className="eyebrow">Room for your plans</p><h2 id="budget-h">Big possibilities.<br /><span className="dim">A budget that works.</span></h2></div><Link className="text-link" to="/cars?min_seats=7">7+ seaters <Icon name="arrow" size={15} /></Link></div>
        <div className="budget-grid">{BUDGETS.map(([label, lo, hi], index) => <Link key={label} className="budget-tile" to={`/cars?${["view=models", lo ? `min_price=${lo}` : "", hi ? `max_price=${hi}` : "", "sort=price_asc"].filter(Boolean).join("&")}`}><span className="tile-number">0{index + 1}</span><span className="budget-label">{label}</span><span className="tile-arrow"><Icon name="arrow" size={18} /></span></Link>)}</div>
      </section>

      <section className="band" aria-labelledby="feat-h">
        <div className="band-head"><div><p className="eyebrow">A little inspiration</p><h2 id="feat-h">Make more of every mile.</h2><p className="dim">Fuel-efficient variants between ₹5 and ₹20 lakh, grouped by model.</p></div><Link className="text-link" to="/cars?view=models&sort=mileage_desc&max_price=2000000">The collection <Icon name="arrow" size={15} /></Link></div>
        {featured.loading && <Loading label="Loading featured cars" />}
        {featured.error && <ErrorBox message={featured.error} onRetry={featured.reload} />}
        <div className="grid four">{featured.data?.items.map((car) => <CarCard key={car.id} car={car} modelView />)}</div>
      </section>

      <section className="band advisor-banner" data-reveal>
        <div className="advisor-visual" aria-hidden="true"><Emblem /></div>
        <div className="advisor-copy">
          <p className="eyebrow">Your next drive, thought through</p>
          <h2>Less searching.<br /><span className="dim">More “that’s the one.”</span></h2>
          <p>Tell the advisor what your days look like. Get a shortlist from the real catalogue, with clear reasons and honest trade-offs.</p>
          <Link className="btn primary" to="/advisor">Find my match <Icon name="arrow" size={16} /></Link>
          <ul className="advisor-points"><li><Icon name="check" size={15} />Grounded in recorded specifications</li><li><Icon name="check" size={15} />Reasons you can actually follow</li><li><Icon name="check" size={15} />Transparent, rule-based, no invention</li></ul>
        </div>
      </section>

      <section className="band compare-story" data-reveal>
        <div>
          <p className="eyebrow">The details make the difference</p>
          <h2>Side by side.<br /><span className="dim">The choice gets clearer.</span></h2>
          <p>Two possibilities or four. Compare prices, space, efficiency and performance, with missing information clearly marked.</p>
          <Link className="btn ghost" to="/compare">Build a comparison <Icon name="compare" size={16} /></Link>
        </div>
        <div className="comparison-illustration">
          <div className="comparison-top"><span>From the catalogue</span><Icon name="compare" size={20} /></div>
          {featured.data?.items.slice(0, 2).map((car) => <div key={car.id} className="comparison-preview"><Link to={`/cars/${car.id}`}><strong>{car.make} {car.model}</strong><span>{car.variant}</span></Link><span>{inr(car.price_inr)}</span><span>{car.seating_capacity ?? "—"} seats</span></div>)}
          {featured.data && featured.data.items.length >= 2 && <Link className="text-link" to={`/compare?ids=${featured.data.items.slice(0, 2).map((car) => car.id).join(",")}`}>Compare these variants <Icon name="arrow" size={14} /></Link>}
          <small>Actual catalogue records · Ex-showroom prices</small>
        </div>
      </section>

      <section className="band" aria-labelledby="brands-h">
        <div className="band-head"><div><p className="eyebrow">The names you know</p><h2 id="brands-h">Follow your favourites.</h2></div></div>
        <div className="brand-grid">{[...(filters.data?.makes ?? [])].sort((a, b) => b.count - a.count).slice(0, 6).map((make) => <Link key={make.value} to={`/cars?view=models&make=${encodeURIComponent(make.value)}`}><span className="brand-initial">{makeLabel(make.value).split(" ").map((word) => word[0]).slice(0, 2).join("")}</span><strong>{makeLabel(make.value)}</strong><span>{make.count} variants</span></Link>)}</div>
      </section>

      <section className="band how-it-works">
        <div className="band-head"><div><p className="eyebrow">Clarity, at every turn</p><h2>Real data. A little perspective.</h2></div></div>
        <div className="method">{METHOD.map(([index, title, text]) => <div key={index}><span className="step-number">{index}</span><h3>{title}</h3><p>{text}</p></div>)}</div>
      </section>

      <section className="final-drive" data-reveal>
        <p className="eyebrow">The next chapter is yours</p>
        <h2>Where will you go next?</h2>
        <p>Start with a possibility. Find a drive that feels right.</p>
        <Link className="btn primary" to="/cars">Find my next car <Icon name="arrow" size={16} /></Link>
      </section>
    </div>
  </>;
}
