import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

type Preference = "system" | "light" | "dark";
const Theme = createContext<{ theme: "light" | "dark"; preference: Preference; setPreference: (value: Preference) => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<Preference>(() => {
    try { const value = localStorage.getItem("carsage.theme"); if (value === "light" || value === "dark") return value; } catch { /* storage unavailable */ }
    return "system";
  });
  const [systemDark, setSystemDark] = useState(() => typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const theme = preference === "system" ? (systemDark ? "dark" : "light") : preference;
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem("carsage.theme", preference); } catch { /* the theme still works without persistence */ }
  }, [theme, preference]);
  const value = useMemo(() => ({ theme, preference, setPreference }), [theme, preference]);
  return <Theme.Provider value={value}>{children}</Theme.Provider>;
}

export function useTheme() {
  const value = useContext(Theme);
  if (!value) throw new Error("ThemeProvider missing");
  return value;
}
