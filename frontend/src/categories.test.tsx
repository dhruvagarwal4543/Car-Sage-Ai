import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Explore } from "./pages/Explore";
import { car, renderApp, stubFetch } from "./testUtils";

const facets = { makes: [{ value: "Tata", count: 2 }, { value: "Hyundai", count: 1 }], models: [{ value: "Nexon", count: 2 }], fuel_types: [{ value: "Petrol", count: 2 }], transmissions: [], transmission_groups: [{ value: "Automatic", count: 2 }], body_types: [{ value: "SUV", count: 2 }, { value: "Crossover", count: 1 }], seating_capacities: [5, 7] };
function catalogue() {
  return stubFetch((url) => url.startsWith("/api/filters") ? facets : { items: [car()], total: 1, page: 1, page_size: 12 });
}

it("restores model filters, loads dependent facets and clears the model when make changes", async () => {
  const calls = catalogue();
  renderApp(<Explore />, "/cars?make=Tata&model=Nexon&fuel_type=Petrol");
  await screen.findByRole("article");
  expect(screen.getByLabelText("Model")).toHaveValue("Nexon");
  expect(calls.some((url) => url.startsWith("/api/filters?") && url.includes("model=Nexon"))).toBe(true);
  await userEvent.selectOptions(screen.getByLabelText("Make"), "Hyundai");
  await waitFor(() => expect(calls.some((url) => url.startsWith("/api/cars?") && url.includes("make=Hyundai") && url.includes("fuel_type=Petrol") && !url.includes("model="))).toBe(true));
  expect(screen.getByLabelText("Model")).toHaveValue("");
});

it("keeps all active filters when switching models to individual variants", async () => {
  const calls = catalogue();
  renderApp(<Explore />, "/cars?body_type=SUV&transmission=Automatic&max_price=1500000");
  const variants = await screen.findByRole("link", { name: "View variants" });
  const search = new URL(variants.getAttribute("href")!, "http://test").searchParams;
  expect(Object.fromEntries(search)).toMatchObject({ make: "Tata", model: "Nexon", view: "variants", body_type: "SUV", transmission: "Automatic", max_price: "1500000" });
  await userEvent.click(screen.getByRole("button", { name: "All variants" }));
  await waitFor(() => expect(calls.some((url) => url.includes("view=variants") && url.includes("transmission=Automatic") && url.includes("body_type=SUV"))).toBe(true));
  await userEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  await waitFor(() => expect(screen.getByLabelText("Transmission")).toHaveValue(""));
  expect(screen.getByRole("button", { name: "All variants" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("Model")).toBeDisabled();
});

it("does not request cars with an inverted budget and recovers when reset", async () => {
  const calls = catalogue();
  renderApp(<Explore />, "/cars?min_price=2000000&max_price=1000000");
  expect(await screen.findByRole("alert")).toHaveTextContent("Minimum price must not exceed maximum price");
  expect(calls.some((url) => url.startsWith("/api/cars?"))).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  await screen.findByRole("article");
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(screen.getByLabelText("Min price (₹ lakh)")).toHaveValue(null);
  expect(screen.getByLabelText("Max price (₹ lakh)")).toHaveValue(null);
});
