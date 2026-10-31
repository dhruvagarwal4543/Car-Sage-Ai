import { useEffect, useState } from "react";
import { vehicleAsset } from "../assets";

export function CarImage({ make, model, eager = false }: { make: string; model: string; eager?: boolean }) {
  const asset = vehicleAsset({ make, model });
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [asset?.image]);
  if (asset?.image && !failed) return <div className="car-image photo" title={asset.note}>
    <img src={asset.image} alt={`${make} ${model} — model reference photograph`} loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setFailed(true)} />
    <span className="photo-note">Model reference</span>
  </div>;
  return (
    <div className="car-image" role="img" aria-label={`No photo available for ${make} ${model}`}>
      <svg viewBox="0 0 200 90" aria-hidden="true">
        <path d="M20 62l14-26c3-5 8-8 14-8h74c6 0 12 3 16 8l20 22c4 1 8 5 8 10v6H12v-6c0-4 3-7 8-6z" fill="currentColor" opacity="0.14" />
        <circle cx="56" cy="68" r="11" fill="currentColor" opacity="0.28" />
        <circle cx="150" cy="68" r="11" fill="currentColor" opacity="0.28" />
      </svg>
      <span>{make} {model} · Photo unavailable</span>
    </div>
  );
}
