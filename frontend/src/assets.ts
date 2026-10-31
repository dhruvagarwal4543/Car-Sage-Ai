import catalogue from "./vehicle-assets.json";

export interface VehicleAsset {
  make: string; model: string; image: string; imageLabel: string;
  author: string; license: string; licenseUrl: string; source: string; note: string;
  modelUrl?: string; modelVariants?: string[]; modelAuthor?: string; modelSource?: string; modelLicense?: string; modelNote?: string;
}

export const vehicleAssets: VehicleAsset[] = catalogue;

export function vehicleAsset(car: { make: string; model: string; variant?: string }): VehicleAsset | undefined {
  const asset = vehicleAssets.find((a) => a.make.toLowerCase() === car.make.toLowerCase() && a.model.toLowerCase() === car.model.toLowerCase());
  if (!asset) return undefined;
  // Mesh compatibility is explicit so a different trim or roof never inherits a model accidentally.
  if (asset.modelUrl && !asset.modelVariants?.includes(car.variant ?? "")) return { ...asset, modelUrl: undefined };
  return asset;
}
