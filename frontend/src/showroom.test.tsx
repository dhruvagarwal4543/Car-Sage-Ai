import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "./api";
import { Home } from "./pages/Home";
import { car, renderApp } from "./testUtils";
import type { CarDetail } from "./types";

vi.mock("./components/VehicleScene", () => ({ default: () => <div data-testid="model-scene" /> }));
const porsche = car({ id: 10, make: "Porsche", model: "911", variant: "Carrera S" });
const creta = car({ id: 20, make: "Hyundai", model: "Creta", variant: "SX", price_inr: 1500000 });
const nexon = car({ id: 30, make: "Tata", model: "Nexon" });

beforeEach(() => {
  vi.spyOn(api, "filters").mockResolvedValue({ makes: [], fuel_types: [], transmissions: [], body_types: [], seating_capacities: [], price_min: null, price_max: null });
  vi.spyOn(api, "cars").mockImplementation(async (params) => ({ items: [porsche, creta, nexon].filter((c) => c.make === params.make), total: 1, page: 1, page_size: 1 }));
  vi.spyOn(api, "car").mockImplementation(async (id) => ({ ...[porsche, creta, nexon].find((c) => c.id === id)!, related: [] }));
});
afterEach(() => vi.restoreAllMocks());

it("switches both the real catalogue identity and visual when a showroom vehicle is selected", async () => {
  renderApp(<Home />);
  await screen.findByTestId("model-scene");
  expect(screen.getByRole("heading", { name: "911 Carrera S" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Hyundai Creta/ }));
  await screen.findByRole("heading", { name: "Creta SX" });
  expect(screen.queryByTestId("model-scene")).not.toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Hyundai Creta/ })).toHaveAttribute("src", expect.stringContaining("hyundai-creta"));
  expect(within(screen.getByRole("heading", { name: "Creta SX" }).closest(".showroom-caption") as HTMLElement).getByText("₹15.00 lakh")).toBeInTheDocument();
  expect(api.car).toHaveBeenCalledWith(20);
});

it("ignores a late vehicle response after a newer selection has loaded", async () => {
  let finish!: (value: CarDetail) => void;
  vi.mocked(api.car).mockImplementation((id) => id === 20 ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ ...nexon, related: [] }));
  renderApp(<Home />);
  await screen.findByTestId("model-scene");
  await userEvent.click(screen.getByRole("button", { name: /Hyundai Creta/ }));
  await userEvent.click(screen.getByRole("button", { name: /Tata Nexon/ }));
  await screen.findByRole("heading", { name: "Nexon XM" });
  await act(async () => { finish({ ...creta, related: [] }); });
  expect(screen.getByRole("heading", { name: "Nexon XM" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Tata Nexon/ })).toHaveAttribute("src", expect.stringContaining("tata-nexon"));
  expect(screen.queryByRole("heading", { name: "Creta SX" })).not.toBeInTheDocument();
});

it("loads a vehicle linked from another route using its catalogue ID", async () => {
  renderApp(<Home />, "/?car=30");
  await screen.findByRole("heading", { name: "Nexon XM" });
  expect(api.car).toHaveBeenCalledWith(30);
  expect(screen.queryByTestId("model-scene")).not.toBeInTheDocument();
});
