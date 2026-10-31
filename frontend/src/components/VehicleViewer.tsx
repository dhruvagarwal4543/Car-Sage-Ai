import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { vehicleAsset } from "../assets";
import type { Car } from "../types";
import { CarImage } from "./CarImage";
import { Icon } from "./Icon";

const VehicleScene = lazy(() => import("./VehicleScene"));

class SceneBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError("The 3D viewer could not be started."); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function VehicleViewer({ car }: { car: Car }) {
  return <Viewer key={car.id} car={car} />;
}

function Viewer({ car }: { car: Car }) {
  const asset = vehicleAsset(car);
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState(false);
  const modelEnabled = Boolean(asset?.modelUrl && !error && !photo);
  return <><div className={`vehicle-viewer ${modelEnabled ? "has-model" : "image-viewer"}`}>
    <div className="viewer-badge"><Icon name={modelEnabled ? "cube" : "search"} size={15} />{modelEnabled ? "Interactive 3D" : "Photo view"}</div>
    {asset?.modelUrl && !error && <div className="viewer-mode" aria-label="Vehicle visual format"><button aria-pressed={!photo} onClick={() => setPhoto(false)}>3D</button><button aria-pressed={photo} onClick={() => setPhoto(true)}>Photo</button></div>}
    {asset?.modelUrl && modelEnabled ? <SceneBoundary onError={setError}><Suspense fallback={<><CarImage make={car.make} model={car.model} eager /><p className="viewer-loading" role="status">Preparing the showroom…</p></>}>
      <VehicleScene url={asset.modelUrl} car={car} onError={setError} />
    </Suspense></SceneBoundary> : <CarImage make={car.make} model={car.model} eager />}
    {error && <p className="viewer-message" role="status">{error} Showing the available photo instead.</p>}
    {!asset?.modelUrl && <p className="viewer-message">{asset ? "Model reference photo. Interactive 3D is not available for this variant." : "A verified photo or 3D model is not available for this vehicle yet."}</p>}
  </div>{modelEnabled && <p className="viewer-asset-note">{asset?.modelNote}</p>}</>;
}
