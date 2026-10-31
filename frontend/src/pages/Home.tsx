import { FormEvent, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { CategoryIcon, makeLabel } from "../categories";
import { CarCard } from "../components/CarCard";
import { Icon } from "../components/Icon";
import { ErrorBox, Loading } from "../components/States";
import { VehicleViewer } from "../components/VehicleViewer";
import { inr, num } from "../format";
import { useHeroMotion } from "../motion";
import { useAsync } from "../useAsync";
import { vehicleAsset } from "../assets";

const BUDGETS = [["Under ₹5 lakh", 0, 499999], ["₹5–10 lakh", 500000, 999999], ["₹10–20 lakh", 1000000, 1999999], ["₹20 lakh+", 2000000, 0]] as const;
const SHOWROOM = [["Porsche", "911"], ["Hyundai", "Creta"], ["Tata", "Nexon"]] as const;

export function Home() {
  const nav = useNavigate();
  const hero = useRef<HTMLElement>(null);
  useHeroMotion(hero);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("car");
  const [q, setQ] = useState("");
  const [budget, setBudget] = useState("");
  const [fuel, setFuel] = useState("");
  const filters = useAsync(() => api.filters(), []);
  const showroom = useAsync(async () => (await Promise.all(SHOWROOM.map(([make, model]) => api.cars({ make, model, sort: "price_asc", page_size: 1 })))).flatMap((page) => page.items), []);
  const selected = useAsync(() => selectedId ? api.car(Number(selectedId)) : Promise.resolve(showroom.data?.[0] ?? null), [selectedId, showroom.data?.[0]?.id], true);
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
  const c = selected.data;
  const asset = c ? vehicleAsset(c) : undefined;

  return <>
    <section ref={hero} className="cinema" aria-labelledby="hero-title">
      <div className="cinema-sticky">
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-dot" /> A NEW PERSPECTIVE ON YOUR NEXT DRIVE</p>
          <h1 className="hero-title" id="hero-title"><span className="hero-title-inner">Find your next.<br /><em>Drive your story.</em></span></h1>
          <p className="hero-description"><span>From the everyday escape to the extraordinary.<br className="desktop-break" /> Explore real cars. Compare the details. Find your fit.</span></p>
          <div className="hero-actions"><Link className="btn primary" to="/cars">Explore the collection <Icon name="arrow" size={17} /></Link><Link className="btn quiet" to="/advisor"><Icon name="spark" size={17} /> Find my match</Link></div>
        </div>
        <div className="hero-showroom" id="showroom" aria-busy={selected.loading}>
          <div className="cinema-floor" aria-hidden="true" />
          <div className="cinema-watermark" aria-hidden="true">{c?.model ?? "DRIVE"}</div>
          <div className="cinema-object">
            {c ? <div className="vehicle-transition" key={c.id} data-reveal="vehicle"><VehicleViewer car={c} /></div> : selected.error || showroom.error ? <ErrorBox message={selected.error || showroom.error || "Could not load the showroom."} onRetry={() => { selected.reload(); showroom.reload(); }} /> : <div className="showroom-skeleton"><Loading label="Opening the showroom" /></div>}
          </div>
          {c && <div className="showroom-caption"><div><p className="eyebrow">{c.make}</p><Link to={`/cars/${c.id}`}><h2>{c.model} <span>{c.variant}</span></h2></Link><p className="muted small">{[c.fuel_type, c.transmission, c.power_ps != null ? num(c.power_ps, "PS") : null].filter(Boolean).join(" · ")}</p></div><div className="showroom-price"><strong>{inr(c.price_inr)}</strong><span>catalogue ex-showroom</span></div></div>}
          {selected.loading && c && <p className="showroom-updating" role="status">Loading your selection…</p>}
          {selected.error && <Link className="btn reset-showroom" to="/" replace>Reset showroom selection</Link>}
        </div>
        <div className="cinema-footer">
          <div className="vehicle-tabs" aria-label="Showroom vehicle selection">{showroom.data?.map((car) => <button key={car.id} className={c?.id === car.id ? "selected" : ""} aria-pressed={c?.id === car.id} onClick={() => setParams({ car: String(car.id) }, { replace: true })}><span className="tab-number">0{(showroom.data?.indexOf(car) ?? 0) + 1}</span>{car.make} {car.model}<Icon name="arrow" size={15} /></button>)}</div>
          <a className="scroll-cue" href="#discover">Scroll to discover <span>↓</span></a>
          {asset && <p className="hero-reference-note">{asset.modelUrl ? asset.modelNote : asset.note} <Link to="/credits">Visual credits ↗</Link></p>}
          <div className="scroll-progress" aria-hidden="true"><span /></div>
        </div>
      </div>
    </section>

    <div className="home-content" id="discover">
      <section className="discovery-section" data-reveal>
        <div className="section-heading"><div><p className="eyebrow">THE ROAD STARTS HERE</p><h2>A world of possibilities.<br /><span className="muted">One drive that feels like you.</span></h2></div></div>
        <form className="discovery-search" onSubmit={submit} role="search">
          <label className="search-field"><Icon name="search" /><span className="sr-only">Search by make, model or variant</span><input value={q} maxLength={100} onChange={(event) => setQ(event.target.value)} placeholder="A make, a model, a possibility…" /></label>
          <label className="field">Your budget<select value={budget} onChange={(event) => setBudget(event.target.value)}><option value="">Any budget</option><option value="500000">Up to ₹5 lakh</option><option value="1000000">Up to ₹10 lakh</option><option value="2000000">Up to ₹20 lakh</option></select></label>
          <label className="field">Fuel preference<select value={fuel} onChange={(event) => setFuel(event.target.value)}><option value="">Any fuel</option>{filters.data?.fuel_types.map((option) => <option key={option.value} value={option.value}>{option.value}</option>)}</select></label>
          <button className="btn primary" type="submit">Explore cars <Icon name="arrow" size={18} /></button>
        </form>
        <div className="catalogue-note"><span className="status-dot" />{total != null ? `${total.toLocaleString("en-IN")} catalogue variants · ${filters.data!.makes.length} makes` : "An Indian new-car specification catalogue"}<span>Historical specifications. No live inventory.</span></div>
      </section>

      <section className="home-section" aria-labelledby="shape-h"><div className="section-heading"><div><p className="eyebrow">DIFFERENT LIVES. DIFFERENT DRIVES.</p><h2 id="shape-h">Find your kind of car.</h2><p className="muted">A proper place for every shape. Mixed body types appear in each relevant category.</p></div><Link className="text-link" to="/cars">Explore all cars <Icon name="arrow" size={17} /></Link></div><div className="category-grid">{filters.data?.body_types.map((body) => <Link key={body.value} to={`/cars?view=models&body_type=${encodeURIComponent(body.value)}`} data-reveal><CategoryIcon category={body.value} /><strong>{body.value}</strong><span>{body.count} variants <Icon name="arrow" size={14} /></span></Link>)}</div>{filters.error && <ErrorBox message={filters.error} onRetry={filters.reload} />}</section>

      <section className="home-section" aria-labelledby="budget-h"><div className="section-heading"><div><p className="eyebrow">ROOM FOR YOUR PLANS</p><h2 id="budget-h">Big possibilities.<br />A budget that works.</h2></div><Link className="text-link" to="/cars?min_seats=7">Explore 7+ seaters <Icon name="arrow" size={17} /></Link></div><div className="budget-grid">{BUDGETS.map(([label, lo, hi], index) => <Link key={label} className="budget-tile" to={`/cars?${["view=models", lo ? `min_price=${lo}` : "", hi ? `max_price=${hi}` : "", "sort=price_asc"].filter(Boolean).join("&")}`}><span className="tile-number">0{index + 1}</span><span className="budget-label">{label}</span><span className="tile-arrow"><Icon name="arrow" size={20} /></span></Link>)}</div></section>

      <section className="home-section" aria-labelledby="feat-h"><div className="section-heading"><div><p className="eyebrow">A LITTLE INSPIRATION</p><h2 id="feat-h">Make more of every mile.</h2><p className="muted">Fuel-efficient matching variants between ₹5 and ₹20 lakh, grouped by model.</p></div><Link className="text-link" to="/cars?view=models&sort=mileage_desc&max_price=2000000">View the collection <Icon name="arrow" size={17} /></Link></div>{featured.loading && <Loading label="Loading featured cars" />}{featured.error && <ErrorBox message={featured.error} onRetry={featured.reload} />}<div className="grid four">{featured.data?.items.map((car) => <CarCard key={car.id} car={car} modelView />)}</div></section>

      <section className="advisor-banner"><div className="advisor-orb"><Icon name="spark" size={42} /></div><div><p className="eyebrow">YOUR NEXT DRIVE, THOUGHT THROUGH</p><h2>Less searching.<br />More “that’s the one.”</h2><p>Tell the advisor what your days look like. Get a shortlist from the real catalogue, with clear reasons and honest trade-offs.</p><Link className="btn dark" to="/advisor">Find my match <Icon name="arrow" size={18} /></Link></div><div className="advisor-example"><span className="tag">A CONVERSATION, NOT A GUESS</span><p>“A family SUV under ₹15 lakh.<br />Good mileage. Room for everyone.”</p><div className="advisor-example-rule"><Icon name="check" size={17} /><span>Real specifications<br /><strong>Reasons you can understand</strong></span></div><p className="small muted">A transparent, rule-based assistant.</p></div></section>

      <section className="home-section compare-story" data-reveal><div><p className="eyebrow">THE DETAILS MAKE THE DIFFERENCE</p><h2>Side by side.<br />The choice gets clearer.</h2><p>Two possibilities or four. Compare prices, space, efficiency and performance with missing information clearly marked.</p><Link className="btn" to="/compare">Build a comparison <Icon name="compare" size={17} /></Link></div><div className="comparison-illustration"><div className="comparison-top"><span>A LOOK AT THE SHOWROOM</span><Icon name="compare" size={25} /></div>{showroom.data?.slice(0, 2).map((car) => <div key={car.id} className="comparison-preview"><Link to={`/cars/${car.id}`}><strong>{car.make} {car.model}</strong><span>{car.variant}</span></Link><span>{inr(car.price_inr)}</span><span>{car.seating_capacity ?? "—"} seats</span></div>)}{showroom.data && showroom.data.length >= 2 && <Link className="text-link" to={`/compare?ids=${showroom.data.slice(0, 2).map((car) => car.id).join(",")}`}>Compare these variants <Icon name="arrow" size={15} /></Link>}<small>Actual catalogue records · Ex-showroom prices</small></div></section>

      <section className="home-section" aria-labelledby="brands-h"><div className="section-heading"><div><p className="eyebrow">THE NAMES YOU KNOW</p><h2 id="brands-h">Follow your favourites.</h2></div></div><div className="brand-grid">{[...(filters.data?.makes ?? [])].sort((a, b) => b.count - a.count).slice(0, 6).map((make) => <Link key={make.value} to={`/cars?view=models&make=${encodeURIComponent(make.value)}`}><span className="brand-initial">{makeLabel(make.value).split(" ").map((word) => word[0]).slice(0, 2).join("")}</span><strong>{makeLabel(make.value)}</strong><span>{make.count} variants <Icon name="arrow" size={14} /></span></Link>)}</div></section>

      <section className="home-section how-it-works"><div className="section-heading"><div><p className="eyebrow">CLARITY, AT EVERY TURN</p><h2>Real data. A little perspective.</h2></div></div><div className="grid three">{[["01", "Your needs come first.", "Search by make and model, filter your budget, or describe what matters to the advisor."], ["02", "Look a little closer.", "Inspect the specifications and compare actual variants. Photographs are identified as model references."], ["03", "Know what you’re seeing.", "Historical ex-showroom data. No fabricated inventory, ratings or missing specifications."]].map(([n, title, text]) => <div key={n}><span className="step-number">{n}</span><h3>{title}</h3><p>{text}</p></div>)}</div></section>
      <section className="final-drive" data-reveal><p className="eyebrow">THE NEXT CHAPTER IS YOURS</p><h2>Where will you go next?</h2><p>Start with a possibility. Find a drive that feels right.</p><Link className="btn primary" to="/cars">Find my next car <Icon name="arrow" size={18} /></Link></section>
    </div>
  </>;
}
