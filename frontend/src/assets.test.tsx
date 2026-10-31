import { fireEvent, render, screen } from "@testing-library/react";
import { vehicleAsset, vehicleAssets } from "./assets";
import { CarImage } from "./components/CarImage";

it("resolves assets by make and full model name, without substituting a different vehicle", () => {
  expect(vehicleAsset({ make: "hyundai", model: "creta" })?.image).toContain("hyundai-creta");
  expect(vehicleAsset({ make: "Tata", model: "Nexon" })?.image).toContain("tata-nexon");
  expect(vehicleAsset({ make: "Tata", model: "Nexon Ev" })).toBeUndefined();
  expect(vehicleAsset({ make: "Honda", model: "Creta" })).toBeUndefined();
});

it("limits the 4S reference mesh to the supported closed-roof 911 record", () => {
  expect(vehicleAsset({ make: "Porsche", model: "911", variant: "Carrera S" })?.modelUrl).toMatch(/\.glb$/);
  expect(vehicleAsset({ make: "Porsche", model: "911", variant: "Carrera S Cabriolet" })?.modelUrl).toBeUndefined();
  expect(vehicleAsset({ make: "Porsche", model: "911" })?.modelUrl).toBeUndefined();
});

it("retains source and licence metadata for every bundled asset", () => {
  for (const asset of vehicleAssets) {
    expect(asset.image).toMatch(/^\/assets\/vehicles\/[a-z0-9-]+\.webp$/);
    expect(asset.source).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    expect(asset.license).toMatch(/^CC|Public domain/);
    expect(asset.author).not.toBe("");
    if (asset.modelUrl) {
      expect(asset.modelAuthor).toBeTruthy();
      expect(asset.modelLicense).toBe("CC BY-SA 4.0");
      expect(asset.modelNote).toContain("Carrera 4S");
      expect(asset.modelVariants?.length).toBeGreaterThan(0);
    }
  }
});

it("falls back honestly when a photograph fails, then loads the newly selected vehicle", () => {
  const { rerender } = render(<CarImage make="Hyundai" model="Creta" />);
  const img = screen.getByRole("img");
  expect(img).toHaveAttribute("src", expect.stringContaining("hyundai-creta"));
  fireEvent.error(img);
  expect(screen.getByRole("img")).toHaveAccessibleName("No photo available for Hyundai Creta");
  rerender(<CarImage make="Tata" model="Nexon" />);
  expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining("tata-nexon"));
});
