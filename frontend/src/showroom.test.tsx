import { screen, within } from "@testing-library/react";
import { api } from "./api";
import { Home } from "./pages/Home";
import { car, renderApp } from "./testUtils";

vi.mock("./components/VehicleScene", () => ({ default: () => <div data-testid="model-scene" /> }));
const porsche = car({ id: 10, make: "Porsche", model: "911", variant: "Carrera S", fuel_type: "Petrol", transmission: "Automatic", price_inr: 19100000 });

beforeEach(() => {
  vi.spyOn(api, "filters").mockResolvedValue({ makes: [], fuel_types: [], transmissions: [], body_types: [], seating_capacities: [], price_min: null, price_max: null });
  vi.spyOn(api, "cars").mockImplementation(async (params) => ({ items: params.make === "Porsche" ? [porsche] : [], total: 1, page: 1, page_size: 1 }));
});
afterEach(() => vi.restoreAllMocks());

it("stages the one credited vehicle in 3D with its real catalogue identity", async () => {
  renderApp(<Home />);
  expect(await screen.findByTestId("model-scene")).toBeInTheDocument();
  const caption = screen.getByRole("heading", { name: "911 Carrera S" }).closest(".showroom-caption") as HTMLElement;
  expect(within(caption).getByText("₹1.91 crore")).toBeInTheDocument();
  expect(within(caption).getByText(/Petrol/)).toBeInTheDocument();
  expect(api.cars).toHaveBeenCalledWith(expect.objectContaining({ make: "Porsche", model: "911" }));
});

it("offers no vehicle switcher and no photo fallback toggle", async () => {
  renderApp(<Home />);
  await screen.findByTestId("model-scene");
  expect(screen.queryByLabelText("Showroom vehicle selection")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Vehicle visual format")).not.toBeInTheDocument();
});

it("reports a failure to reach the catalogue instead of staging nothing", async () => {
  vi.mocked(api.cars).mockRejectedValue(new Error("Database unavailable"));
  renderApp(<Home />);
  const alerts = await screen.findAllByRole("alert");
  expect(alerts[0]).toHaveTextContent("Database unavailable");
  expect(screen.queryByTestId("model-scene")).not.toBeInTheDocument();
});
