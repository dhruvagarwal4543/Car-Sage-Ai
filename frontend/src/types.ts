export interface Car {
  id: number; source_row: number; make: string; model: string; variant: string; fuel_type: string; price_inr: number;
  transmission: string | null; body_type: string | null; drivetrain: string | null; cylinder_configuration: string | null; emission_norm: string | null;
  seating_capacity: number | null; doors: number | null; cylinders: number | null; gears: number | null; number_of_airbags: number | null;
  displacement_cc: number | null; power_ps: number | null; torque_nm: number | null; length_mm: number | null; width_mm: number | null;
  height_mm: number | null; wheelbase_mm: number | null; ground_clearance_mm: number | null; kerb_weight_kg: number | null;
  gross_vehicle_weight_kg: number | null; fuel_tank_litres: number | null; boot_space_litres: number | null; min_turning_radius_m: number | null;
  mileage_kmpl: number | null; family_group: string | null; tags: string[];
}
export interface CarPage { items: Car[]; total: number; page: number; page_size: number }
export interface CarDetail extends Car { related: Car[] }
export interface CompareField { key: string; label: string; unit: string | null; values: (string | number | null)[]; differs: boolean; best_index: number | null; missing: number[] }
export interface CompareOut { cars: Car[]; fields: CompareField[] }
export interface Facet { value: string; count: number }
export interface Filters { makes: Facet[]; fuel_types: Facet[]; transmissions: Facet[]; body_types: Facet[]; seating_capacities: number[]; price_min: number | null; price_max: number | null }
export interface Preferences {
  max_price?: number | null; min_price?: number | null; fuel_types: string[]; transmissions: ("manual" | "automatic")[]; body_types: string[];
  min_seats?: number | null; use_case?: "family" | "city" | null; priorities: string[]; limit?: number;
}
export interface Recommendation { car: Car; score: number; reasons: string[]; tradeoffs: string[]; missing: string[] }
export interface AssistantOut { reply: string; intent: "recommend" | "compare" | "lookup" | "help"; preferences: Preferences | null; cars: Car[] }
export interface PriceOut {
  predicted_price_inr: number; actual_ex_showroom_price_inr: number | null; experimental: boolean; typical_error: string; warnings: string[]; model_info: Record<string, string | number>;
}
