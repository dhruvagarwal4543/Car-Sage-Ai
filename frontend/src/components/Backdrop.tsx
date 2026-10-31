import { lazy, Suspense } from "react";

// The ambient field is the only thing on every page that needs three, so it loads after the
// page does and never sits in the entry bundle.
const BackdropField = lazy(() => import("./BackdropField"));

export function Backdrop() {
  return <Suspense fallback={null}><BackdropField /></Suspense>;
}
