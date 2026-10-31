import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { vehicleAsset } from "../assets";
import type { Car } from "../types";
import { CarImage } from "./CarImage";

const VehicleScene = lazy(() => import("./VehicleScene"));

class SceneBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError("The 3D viewer could not be started."); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function VehicleViewer({ car, stage = false }: { car: Car; stage?: boolean }) {
  return <Viewer key={car.id} car={car} stage={stage} />;
}

// 3D is the only view. A vehicle with no model, or a model that fails, falls back to its
// credited reference photograph — there is no manual switch between the two.
function Viewer({ car, stage }: { car: Car; stage: boolean }) {
  const asset = vehicleAsset(car);
  const [error, setError] = useState("");
  const model = asset?.modelUrl && !error ? asset.modelUrl : "";
  return <>
    <div className={`vehicle-viewer ${model ? "has-model" : "image-viewer"}`}>
      {model
        ? <SceneBoundary onError={setError}>
            <Suspense fallback={<><CarImage make={car.make} model={car.model} eager /><p className="viewer-loading" role="status">Preparing the showroom…</p></>}>
              <VehicleScene url={model} car={car} stage={stage} onError={setError} />
            </Suspense>
          </SceneBoundary>
        : <CarImage make={car.make} model={car.model} eager />}
      {error && <p className="viewer-message" role="status">{error} Showing the available photo instead.</p>}
      {!asset?.modelUrl && <p className="viewer-message">{asset ? "Model reference photo. Interactive 3D is not available for this variant." : "A verified photo or 3D model is not available for this vehicle yet."}</p>}
    </div>
    {model && <p className="viewer-asset-note">{asset?.modelNote}</p>}
  </>;
}
