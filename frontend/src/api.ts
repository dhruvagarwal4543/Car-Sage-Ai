import type { AssistantOut, Car, CarDetail, CarPage, CompareOut, Filters, Preferences, PriceOut } from "./types";

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
let tokenProvider: ((forceRefresh: boolean) => Promise<string | null>) | null = null;
let onSessionExpired: (() => void) | null = null;
export const setTokenProvider = (fn: ((forceRefresh: boolean) => Promise<string | null>) | null) => { tokenProvider = fn; };
export const setSessionExpiredHandler = (fn: (() => void) | null) => { onSessionExpired = fn; };

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
  const send = async (forceRefresh: boolean): Promise<Response> => {
    const headers: Record<string, string> = { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) };
    if (auth) {
      const token = tokenProvider ? await tokenProvider(forceRefresh) : null;
      if (!token) throw new ApiError("Please sign in to use this feature.", 401);
      headers.Authorization = `Bearer ${token}`;
    }
    try {
      return await fetch(BASE + path, { ...init, headers });
    } catch {
      throw new ApiError("Cannot reach the CarSage server. Please check that the API is running.", 0);
    }
  };
  let res = await send(false);
  if (auth && res.status === 401) {
    res = await send(true);                       // the token may just be stale: retry ONCE with a force-refreshed one
    if (res.status === 401) {                     // still rejected: the session is over; never loop
      onSessionExpired?.();
      throw new ApiError("Your session has expired. Please sign in again.", 401);
    }
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
  filters: (params: Record<string, string | number | null | undefined> = {}) => request<Filters>(`/api/filters${query(params)}`),
  assistant: (message: string, context: Preferences | null) => request<AssistantOut>("/api/assistant", post({ message, context })),
  predict: (carId: number) => request<PriceOut>("/api/price-predictions", post({ car_id: carId })),
  savedCars: () => request<Car[]>("/api/me/saved-cars", {}, true),
  saveCar: (id: number) => request<void>(`/api/me/saved-cars/${id}`, { method: "PUT" }, true),
  unsaveCar: (id: number) => request<void>(`/api/me/saved-cars/${id}`, { method: "DELETE" }, true),
};
