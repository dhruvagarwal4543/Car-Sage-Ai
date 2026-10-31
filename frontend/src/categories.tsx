const silhouettes: Record<string, string> = {
  SUV: "M3 15V10l3-1 3-4h9l3 4 1 1v5H3Z",
  Sedan: "M2 15v-4l5-1 3-4h6l5 5 2 1v3H2Z",
  Hatchback: "M3 15V9l4-4h10l4 5 1 1v4H3Z",
  Crossover: "M2 15v-5l5-1 3-4h7l5 5v5H2Z",
  MPV: "M2 15V9l4-4h13l3 5v5H2Z",
  MUV: "M2 15V8l4-3h14l2 4v6H2Z",
  Coupe: "M2 15v-4l6-1 4-4h4l6 5v4H2Z",
  Convertible: "M2 15v-4h7l2-4h2l2 4h7v4H2Z",
  "Pick-up": "M2 15V8h9l3 4h8v3H2Z",
  Sports: "M2 15v-3l7-2 4-3h4l4 5 1 1v2H2Z",
};

export function CategoryIcon({ category }: { category: string }) {
  return <svg viewBox="0 0 24 21" fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" aria-hidden="true"><path d={silhouettes[category] ?? silhouettes.SUV} /><circle cx="6" cy="15" r="2" fill="none" /><circle cx="18" cy="15" r="2" fill="none" /></svg>;
}

export function makeLabel(make: string) {
  return ({ Bmw: "BMW", Mg: "MG", Dc: "DC", Icml: "ICML" } as Record<string, string>)[make] ?? make;
}
