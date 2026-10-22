export function inr(v: number | null | undefined): string {
  if (v == null) return "Not recorded";
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} crore`;
  return `₹${(v / 1e5).toFixed(2)} lakh`;
}

export function num(v: number | null | undefined, unit = ""): string {
  if (v == null) return "Not recorded";
  return `${Number.isInteger(v) ? v : Number(v.toFixed(2))}${unit ? ` ${unit}` : ""}`;
}

export function lakhToRupees(text: string): number | undefined {
  const n = Number(text);
  return text.trim() !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n * 1e5) : undefined;
}

export const SPEC_ROWS: [key: string, label: string, unit: string][] = [
  ["fuel_type", "Fuel type", ""], ["transmission", "Transmission", ""], ["body_type", "Body type", ""], ["drivetrain", "Drivetrain", ""],
  ["mileage_kmpl", "Mileage (ARAI)", "km/l"], ["displacement_cc", "Engine displacement", "cc"], ["power_ps", "Power", "PS"], ["torque_nm", "Torque", "Nm"],
  ["cylinders", "Cylinders", ""], ["gears", "Gears", ""], ["emission_norm", "Emission norm", ""], ["seating_capacity", "Seats", ""], ["doors", "Doors", ""],
  ["number_of_airbags", "Airbags", ""], ["boot_space_litres", "Boot space", "litres"], ["fuel_tank_litres", "Fuel tank", "litres"],
  ["length_mm", "Length", "mm"], ["width_mm", "Width", "mm"], ["height_mm", "Height", "mm"], ["wheelbase_mm", "Wheelbase", "mm"],
  ["ground_clearance_mm", "Ground clearance", "mm"], ["kerb_weight_kg", "Kerb weight", "kg"], ["min_turning_radius_m", "Min. turning radius", "m"],
];

export const TAG_LABELS: Record<string, string> = { family_friendly: "Family friendly", city_friendly: "City friendly", fuel_efficient: "Fuel efficient", powerful: "Powerful" };
