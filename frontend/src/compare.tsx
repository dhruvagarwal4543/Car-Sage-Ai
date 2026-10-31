import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export const MAX_COMPARE = 4;
const KEY = "carsage.compare";

export function normalizeCompareIds(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, MAX_COMPARE);
}

function read(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? normalizeCompareIds(v) : [];
  } catch { return []; }
}

interface Ctx { ids: number[]; has: (id: number) => boolean; toggle: (id: number) => boolean; replace: (ids: number[]) => void; clear: () => void }
const C = createContext<Ctx | null>(null);

export function CompareProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<number[]>(read);
  const save = useCallback((next: number[]) => {
    next = normalizeCompareIds(next);
    setIds((current) => current.join(",") === next.join(",") ? current : next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  }, []);
  const toggle = useCallback((id: number) => {
    if (ids.includes(id)) { save(ids.filter((x) => x !== id)); return true; }
    if (ids.length >= MAX_COMPARE) return false;      // caller shows a message
    save([...ids, id]); return true;
  }, [ids, save]);
  const value = useMemo<Ctx>(() => ({ ids, has: (id) => ids.includes(id), toggle, replace: save, clear: () => save([]) }), [ids, toggle, save]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useCompare() {
  const v = useContext(C);
  if (!v) throw new Error("CompareProvider missing");
  return v;
}
