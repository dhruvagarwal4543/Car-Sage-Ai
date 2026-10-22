import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useCompare } from "../compare";
import { inr, num } from "../format";
import type { Car } from "../types";
import { CarImage } from "./CarImage";

export function CarCard({ car, compact = false, onNotice }: { car: Car; compact?: boolean; onNotice?: (m: string) => void }) {
  const compare = useCompare();
  const auth = useAuth();
  const nav = useNavigate();
  const inCompare = compare.has(car.id);
  const isSaved = auth.saved.has(car.id);

  const toggleCompare = () => { if (!compare.toggle(car.id)) onNotice?.("You can compare up to 4 cars. Remove one first."); };
  const toggleSave = async () => {
    if (!auth.user) { nav("/login"); return; }
    try { await auth.toggleSaved(car.id); } catch (e) { onNotice?.(e instanceof Error ? e.message : "Could not update your saved cars."); }
  };

  return (
    <article className={`card ${compact ? "compact" : ""}`}>
      <Link to={`/cars/${car.id}`} className="card-link" aria-label={`${car.make} ${car.model} ${car.variant}, details`}>
        {!compact && <CarImage make={car.make} model={car.model} />}
        <div className="card-body">
          <p className="muted small">{car.make}</p>
          <h3>{car.model} <span className="variant">{car.variant}</span></h3>
          <p className="price">{inr(car.price_inr)} <span className="muted small">ex-showroom</span></p>
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
        <button className={`btn small ${inCompare ? "active" : ""}`} aria-pressed={inCompare} onClick={toggleCompare}>{inCompare ? "In comparison" : "Compare"}<span className="sr-only"> {car.make} {car.model} {car.variant}</span></button>
        {auth.configured && <button className={`btn small ${isSaved ? "active" : ""}`} aria-pressed={isSaved} onClick={toggleSave}>{isSaved ? "Saved" : "Save"}<span className="sr-only"> {car.make} {car.model} {car.variant}</span></button>}
      </div>
    </article>
  );
}
