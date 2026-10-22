import type { AssistantOut, Car, CarDetail, CarPage, CompareOut, Filters, Preferences, PriceOut } from "./types";

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
let tokenProvider: (() => Promise<string | null>) | null = null;
export const setTokenProvider = (fn: (() => Promise<string | null>) | null) => { tokenProvider = fn; };

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function query(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && String(v).trim() !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

async function request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) };
  if (auth) {
    const token = tokenProvider ? await tokenProvider() : null;
    if (!token) throw new ApiError("Please sign in to use this feature.", 401);
    headers.Authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, headers });
  } catch {
    throw new ApiError("Cannot reach the CarSage server. Please check that the API is running.", 0);
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
      else if (Array.isArray(body?.detail) && body.detail[0]?.msg) detail = String(body.detail[0].msg);
    } catch { /* keep the generic message */ }
    throw new ApiError(detail, res.status);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
  cars: (p: Record<string, string | number | null | undefined>) => request<CarPage>(`/api/cars${query(p)}`),
  car: (id: number) => request<CarDetail>(`/api/cars/${id}`),
  compare: (ids: number[]) => request<CompareOut>(`/api/cars/compare?ids=${ids.join(",")}`),
  filters: () => request<Filters>("/api/filters"),
  assistant: (message: string, context: Preferences | null) => request<AssistantOut>("/api/assistant", post({ message, context })),
  predict: (carId: number) => request<PriceOut>("/api/price-predictions", post({ car_id: carId })),
  savedCars: () => request<Car[]>("/api/me/saved-cars", {}, true),
  saveCar: (id: number) => request<void>(`/api/me/saved-cars/${id}`, { method: "PUT" }, true),
  unsaveCar: (id: number) => request<void>(`/api/me/saved-cars/${id}`, { method: "DELETE" }, true),
};
