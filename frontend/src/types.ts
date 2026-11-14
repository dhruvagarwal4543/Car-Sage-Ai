export interface Car {
  id: number; source_row: number; make: string; model: string; variant: string; fuel_type: string; price_inr: number;
  transmission: string | null; body_type: string | null; drivetrain: string | null; cylinder_configuration: string | null; emission_norm: string | null;
  seating_capacity: number | null; doors: number | null; cylinders: number | null; gears: number | null; number_of_airbags: number | null;
  displacement_cc: number | null; power_ps: number | null; torque_nm: number | null; length_mm: number | null; width_mm: number | null;
  height_mm: number | null; wheelbase_mm: number | null; ground_clearance_mm: number | null; kerb_weight_kg: number | null;
  gross_vehicle_weight_kg: number | null; fuel_tank_litres: number | null; boot_space_litres: number | null; min_turning_radius_m: number | null;
  mileage_kmpl: number | null; family_group: string | null; tags: string[]; freshness?: "historical" | "possibly_outdated" | "unknown" | null; freshness_reason?: string | null;
}
export interface CarPage { items: Car[]; total: number; page: number; page_size: number }
export interface CarDetail extends Car { related: Car[] }
export interface CompareField { key: string; label: string; unit: string | null; values: (string | number | null)[]; differs: boolean; best_index: number | null; missing: number[] }
export interface CompareOut { cars: Car[]; fields: CompareField[] }
export interface Facet { value: string; count: number }
export interface Filters { makes: Facet[]; models?: Facet[]; fuel_types: Facet[]; transmissions: Facet[]; transmission_groups?: Facet[]; body_types: Facet[]; seating_capacities: number[]; price_min: number | null; price_max: number | null }
export interface Preferences {
  max_price?: number | null; min_price?: number | null; fuel_types: string[]; transmissions: ("manual" | "automatic")[]; body_types: string[];
  min_seats?: number | null; use_case?: "family" | "city" | null; priorities: string[]; limit?: number; allow_relaxation?: boolean;
}
export interface DecisionTrace {
  input: Record<string, unknown>; constraints: { id: string; label: string; relaxable: boolean }[]; initial_candidates: number; eliminated: Record<string, number>;
  feasible: number; relaxation: string[]; search: { strategy: string; states_expanded: number; cost: number }; scoring: { priorities: string[]; method: string };
  missing_attributes: Record<string, string[]>; ranking: { car_id: number; score: number }[]; latency_ms: number;
}
export interface Recommendation { car: Car; score: number; reasons: string[]; tradeoffs: string[]; missing: string[] }
export interface AssistantOut { reply: string; intent: "recommend" | "compare" | "lookup" | "help"; preferences: Preferences | null; cars: Car[]; unsupported?: string[]; trace?: DecisionTrace | null }
export interface PriceOut {
  predicted_price_inr: number; actual_ex_showroom_price_inr: number | null; experimental: boolean; typical_error: string; warnings: string[]; model_info: Record<string, string | number>;
}

export interface PriceBasis { code: string; price_type: string; location_kind: "city" | "national_average" | "unspecified"; location: string | null }
export interface LiveQuote {
  provider: string; source_url: string; vehicle: string; price_inr: number; price_type: string; price_label: string; basis: PriceBasis; basis_label: string; freshness: string; match: string; match_evidence: string; retrieved_at: string; verified: boolean;
}
export interface LiveGroup { basis: PriceBasis; basis_label: string; price_type: string; quotes: LiveQuote[]; lowest: LiveQuote; providers: string[]; tied_lowest_providers?: string[]; comparable_across_providers: boolean; single_source: boolean }
export interface LiveCompare {
  quotes: LiveQuote[]; comparable_groups: LiveGroup[]; probable_quotes: LiveQuote[]; model_level: { provider: string; price_low: number; price_high: number; basis_label: string; source_url: string; note: string }[];
  lowest_comparable: LiveQuote | null; savings_inr: number | null; difference_from_displayed_inr: number | null; incompatible_bases: string | null;
  provider_failures: { provider: string; page: string; error: string; kind: string; retry_after_s: number | null; served: string }[]; warnings: string[]; retrieved_at: string | null;
}
