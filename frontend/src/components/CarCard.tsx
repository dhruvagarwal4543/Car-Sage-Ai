import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useCompare } from "../compare";
import { inr, num } from "../format";
import type { Car } from "../types";
import { CarImage } from "./CarImage";
import { Icon } from "./Icon";

export function SaveButton({ car }: { car: Car }) {
  const auth = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isSaved = auth.saved.has(car.id);
  const toggleSave = async () => {
    if (!auth.user) { nav("/login", { state: { from: location.pathname + location.search } }); return; }
    setBusy(true); setError("");
    try { await auth.toggleSaved(car.id); } catch (e) { setError(e instanceof Error ? e.message : "Could not update your saved cars."); }
    finally { setBusy(false); }
  };
  if (!auth.configured) return null;
  return <>
    <button className={`btn small ${isSaved ? "active" : ""}`} disabled={busy || auth.loading} aria-pressed={isSaved} onClick={() => void toggleSave()}>{busy ? "Updating…" : isSaved ? "Saved" : "Save"}<span className="sr-only"> {car.make} {car.model} {car.variant}</span></button>
    {error && <p className="notice" role="alert">{error}</p>}
  </>;
}

export function CarCard({ car, compact = false, modelView = false }: { car: Car; compact?: boolean; modelView?: boolean }) {
  const compare = useCompare();
  const location = useLocation();
  const [notice, setNotice] = useState("");
  const inCompare = compare.has(car.id);
  const variants = new URLSearchParams(location.pathname === "/cars" ? location.search : "");
  variants.set("make", car.make); variants.set("model", car.model); variants.set("view", "variants"); variants.delete("page");

  const toggleCompare = () => setNotice(compare.toggle(car.id) ? "" : "You can compare up to 4 cars. Remove one first.");

  return (
    <article className={`card ${compact ? "compact" : ""}`} data-reveal>
      <Link to={`/cars/${car.id}`} state={{ from: location.pathname === "/cars" ? location.pathname + location.search : "/cars" }} className="card-link" aria-label={`${car.make} ${car.model} ${car.variant}, details`}>
        {!compact && <CarImage make={car.make} model={car.model} />}
        <div className="card-body">
          <p className="muted small">{car.make}</p>
          <h3>{car.model} <span className="variant">{car.variant}</span></h3>
          <p className="price">{modelView && <span className="from-price">From </span>}{inr(car.price_inr)} <span className="muted small">ex-showroom</span></p>
          <ul className="chips" aria-label="Key specifications">
            <li>{car.fuel_type}</li>
            {car.transmission && <li>{car.transmission}</li>}
            {car.body_type && <li>{car.body_type}</li>}
            {car.seating_capacity != null && <li>{car.seating_capacity} seats</li>}
            {car.mileage_kmpl != null && <li>{num(car.mileage_kmpl, "km/l")}</li>}
          </ul>
        </div>
      </Link>
      <div className="card-actions">
        {modelView && <Link className="variants-link" to={`/cars?${variants}`}>View variants <Icon name="arrow" size={14} /></Link>}
        <button className={`btn small ${inCompare ? "active" : ""}`} aria-pressed={inCompare} onClick={toggleCompare}><Icon name={inCompare ? "check" : "compare"} size={15} />{inCompare ? "In comparison" : "Compare"}<span className="sr-only"> {car.make} {car.model} {car.variant}</span></button>
        <Link className="showroom-link" to={`/?car=${car.id}#showroom`} aria-label={`View ${car.make} ${car.model} in showroom`} title="View in showroom"><Icon name="cube" size={18} /></Link>
        <SaveButton car={car} />
      </div>
      {notice && <p className="notice" role="alert">{notice}</p>}
    </article>
  );
}
