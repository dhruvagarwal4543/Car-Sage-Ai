import { lazy, Suspense } from "react";

const EmblemScene = lazy(() => import("./EmblemScene"));

export function Emblem({ label = "" }: { label?: string }) {
  return <Suspense fallback={<div className="emblem" />}><EmblemScene label={label} /></Suspense>;
}
