import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export const MAX_COMPARE = 4;
const KEY = "carsage.compare";

function read(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => Number.isInteger(x)).slice(0, MAX_COMPARE) : [];
  } catch { return []; }
}

interface Ctx { ids: number[]; has: (id: number) => boolean; toggle: (id: number) => boolean; remove: (id: number) => void; clear: () => void }
const C = createContext<Ctx | null>(null);

export function CompareProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<number[]>(read);
  const save = (next: number[]) => { setIds(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ } };
  const toggle = useCallback((id: number) => {
    if (ids.includes(id)) { save(ids.filter((x) => x !== id)); return true; }
    if (ids.length >= MAX_COMPARE) return false;      // caller shows a message
    save([...ids, id]); return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  const value = useMemo<Ctx>(() => ({ ids, has: (id) => ids.includes(id), toggle, remove: (id) => save(ids.filter((x) => x !== id)), clear: () => save([]) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids, toggle]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useCompare() {
  const v = useContext(C);
  if (!v) throw new Error("CompareProvider missing");
  return v;
}
