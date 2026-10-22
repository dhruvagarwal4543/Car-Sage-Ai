// Neutral placeholder: the dataset has no images and we have no licensed photos, so we never show fake ones.
export function CarImage({ make, model }: { make: string; model: string }) {
  return (
    <div className="car-image" role="img" aria-label={`No photo available for ${make} ${model}`}>
      <svg viewBox="0 0 200 90" aria-hidden="true">
        <path d="M20 62l14-26c3-5 8-8 14-8h74c6 0 12 3 16 8l20 22c4 1 8 5 8 10v6H12v-6c0-4 3-7 8-6z" fill="currentColor" opacity="0.14" />
        <circle cx="56" cy="68" r="11" fill="currentColor" opacity="0.28" />
        <circle cx="150" cy="68" r="11" fill="currentColor" opacity="0.28" />
      </svg>
      <span>{make}</span>
    </div>
  );
}
