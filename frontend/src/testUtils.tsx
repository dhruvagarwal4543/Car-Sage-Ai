import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "./auth";
import { CompareProvider } from "./compare";
import type { Car } from "./types";

export function renderApp(ui: ReactElement, route = "/") {
  return render(<MemoryRouter initialEntries={[route]}><AuthProvider><CompareProvider>{ui}</CompareProvider></AuthProvider></MemoryRouter>);
}

export function car(over: Partial<Car> = {}): Car {
  return {
    id: 1, source_row: 1, make: "Tata", model: "Nexon", variant: "XM", fuel_type: "Diesel", price_inr: 900000, transmission: "Manual", body_type: "SUV",
    drivetrain: null, cylinder_configuration: null, emission_norm: null, seating_capacity: 5, doors: null, cylinders: null, gears: null, number_of_airbags: null,
    displacement_cc: null, power_ps: null, torque_nm: null, length_mm: null, width_mm: null, height_mm: null, wheelbase_mm: null, ground_clearance_mm: null,
    kerb_weight_kg: null, gross_vehicle_weight_kg: null, fuel_tank_litres: null, boot_space_litres: null, min_turning_radius_m: null, mileage_kmpl: 21.5,
    family_group: null, tags: [], ...over,
  };
}

/** Route-based fetch stub: handler gets the URL and returns a JSON body (or a [status, body] pair). */
export function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    const out = handler(url, init);
    const [status, body] = Array.isArray(out) && typeof out[0] === "number" ? (out as [number, unknown]) : [200, out];
    return { ok: status < 400, status, json: async () => body } as Response;
  }));
  return calls;
}
