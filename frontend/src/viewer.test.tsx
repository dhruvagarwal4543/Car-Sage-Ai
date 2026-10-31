import { render, screen } from "@testing-library/react";
import { VehicleViewer } from "./components/VehicleViewer";
import { car } from "./testUtils";

vi.mock("./components/VehicleScene", () => ({ default: () => { throw new Error("viewer module failed"); } }));

it("keeps the vehicle photo usable if the scene component fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const expectedError = (event: ErrorEvent) => { if (event.error?.message === "viewer module failed") event.preventDefault(); };
  window.addEventListener("error", expectedError);
  try {
    render(<VehicleViewer car={car({ make: "Porsche", model: "911", variant: "Carrera S" })} />);
    expect(await screen.findByText(/The 3D viewer could not be started/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Porsche 911/ })).toHaveAttribute("src", expect.stringContaining("porsche-911.webp"));
  } finally { window.removeEventListener("error", expectedError); vi.restoreAllMocks(); }
});
