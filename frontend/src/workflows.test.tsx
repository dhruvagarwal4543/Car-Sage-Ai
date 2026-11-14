import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, Route, Routes, useNavigate } from "react-router-dom";
import App from "./App";
import { api } from "./api";
import { CarDetail } from "./pages/CarDetail";
import { Explore } from "./pages/Explore";
import { car, renderApp, stubFetch } from "./testUtils";
import type { PriceOut } from "./types";

const cars = [car(), car({ id: 2, make: "Hyundai", model: "Creta" }), car({ id: 3, model: "Tiago" })];
const filters = { makes: [{ value: "Tata", count: 2 }], fuel_types: [], transmissions: [], body_types: [], seating_capacities: [] };

function catalogue() {
  return stubFetch((url) => {
    if (url.startsWith("/api/filters")) return filters;
    if (url.startsWith("/api/cars/compare")) return { cars: new URL(url, "http://test").searchParams.get("ids")!.split(",").map((id) => cars.find((c) => c.id === Number(id))), fields: [] };
    if (/\/api\/cars\/\d+$/.test(url)) return { ...cars.find((c) => c.id === Number(url.split("/").pop())), related: [cars[1]] };
    return { items: cars, total: 3, page: 1, page_size: 12 };
  });
}

afterEach(() => vi.restoreAllMocks());

it("keeps a shared comparison selected when browsing and adding another car", async () => {
  catalogue();
  renderApp(<App />, "/compare?ids=1,1,-2,bad,2");
  expect(await screen.findByRole("table")).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("carsage.compare")!)).toEqual([1, 2]);
  await userEvent.click(screen.getByRole("button", { name: "Remove Hyundai Creta XM" }));
  expect(await screen.findByText("Add one more car to compare.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("link", { name: "Add more cars" }));
  await userEvent.click(await screen.findByRole("button", { name: "Compare Tata Tiago XM" }));
  await userEvent.click(screen.getByRole("link", { name: "Compare 2 cars" }));
  const table = await screen.findByRole("table");
  expect(table).toHaveTextContent("Tiago");
  expect(table).not.toHaveTextContent("Creta");
  await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(await screen.findByText("No cars selected yet.")).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("carsage.compare")!)).toEqual([]);
});

it("can recover from unavailable comparison IDs", async () => {
  stubFetch(() => [404, { detail: "cars not found" }]);
  renderApp(<App />, "/compare?ids=1,99999");
  expect(await screen.findByRole("alert")).toHaveTextContent("cars not found");
  await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(await screen.findByText("No cars selected yet.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Browse cars" })).toBeInTheDocument();
});

it("loads only valid distinct positive car IDs from storage", async () => {
  localStorage.setItem("carsage.compare", JSON.stringify([1, 1, -2, "3", 2]));
  const calls = catalogue();
  renderApp(<App />, "/compare");
  await screen.findByRole("table");
  expect(calls).toContain("/api/cars/compare?ids=1,2");
});

it("does not show a late estimate for the previously viewed car", async () => {
  catalogue();
  let finish!: (result: PriceOut) => void;
  vi.spyOn(api, "predict").mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  renderApp(<Routes><Route path="cars/:id" element={<CarDetail />} /></Routes>, "/cars/1");
  await userEvent.click(await screen.findByRole("button", { name: "Estimate from specifications" }));
  await userEvent.click(screen.getByRole("link", { name: "Hyundai Creta XM, details" }));
  await screen.findByRole("heading", { name: "Creta XM", level: 1 });
  await act(async () => { finish({ predicted_price_inr: 123456, actual_ex_showroom_price_inr: null, experimental: true, typical_error: "old estimate", warnings: [], model_info: {} }); });
  expect(screen.queryByText("old estimate")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Estimate from specifications" })).toBeEnabled();
});

it("preserves a filter changed while search is still being typed", async () => {
  const calls = catalogue();
  renderApp(<Explore />, "/cars");
  await screen.findByRole("option", { name: "Tata (2)" });
  await userEvent.type(screen.getByRole("searchbox"), "Nexon");
  await userEvent.selectOptions(screen.getByLabelText("Make"), "Tata");
  await waitFor(() => expect(calls.some((url) => url.includes("make=Tata") && url.includes("q=Nexon"))).toBe(true));
});

it("restores the search input when browser history changes", async () => {
  catalogue();
  function Page() {
    const nav = useNavigate();
    return <><Link to="/cars?q=Creta">Search Creta</Link><button onClick={() => nav(-1)}>Go back</button><Explore /></>;
  }
  renderApp(<Page />, "/cars?q=Nexon");
  await userEvent.click(screen.getByRole("link", { name: "Search Creta" }));
  await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue("Creta"));
  await userEvent.click(screen.getByRole("button", { name: "Go back" }));
  await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue("Nexon"));
});

it("opens the advisor comparison table and clears context for a new conversation", async () => {
  const bodies: { context: unknown }[] = [];
  stubFetch((_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return { reply: "Comparing Nexon and Creta", intent: "compare", preferences: { max_price: 1500000 }, cars: cars.slice(0, 2) };
  });
  renderApp(<App />, "/advisor");
  await userEvent.click(screen.getByRole("button", { name: "Compare Nexon and Creta" }));
  expect(await screen.findByRole("link", { name: "Open comparison table" })).toHaveAttribute("href", "/compare?ids=1,2");
  await userEvent.click(screen.getByRole("button", { name: "New conversation" }));
  expect(screen.queryByText("Comparing Nexon and Creta")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "7 seater under 20 lakh" }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1].context).toBeNull();
});

it("shows live quotes per price basis with sources, refuses a 'cheapest' claim from one site and keeps the catalogue price separate", async () => {
  catalogue();
  const b = { code: "DELHI_EX_SHOWROOM", price_type: "ex_showroom", location_kind: "city" as const, location: "Delhi" };
  const q = { provider: "CarDekho", source_url: "https://www.cardekho.com/overview/Hyundai_Creta/Hyundai_Creta_E.htm", vehicle: "E", price_inr: 1090700, price_type: "ex_showroom", price_label: "Ex-Showroom Price in New Delhi", basis: b,
    basis_label: "ex-showroom, Delhi", freshness: "cached", match: "exact", match_evidence: "", retrieved_at: "2026-11-12T10:00:00+00:00", verified: false };
  const spy = vi.spyOn(api, "compareLive").mockResolvedValue({ quotes: [q], comparable_groups: [{ basis: b, basis_label: "ex-showroom, Delhi", price_type: "ex_showroom", quotes: [q], lowest: q, providers: ["CarDekho"], comparable_across_providers: false, single_source: true }],
    probable_quotes: [], model_level: [{ provider: "CarDekho", price_low: 1090700, price_high: 2045700, basis_label: "ex-showroom, Delhi", source_url: "https://www.cardekho.com/hyundai/creta", note: "model-level reference" }],
    lowest_comparable: q, savings_inr: null, difference_from_displayed_inr: null, incompatible_bases: "Prices shown are from different location bases and cannot be directly compared.",
    provider_failures: [{ provider: "CarWale", page: "city (Delhi)", error: "fetch budget used up", kind: "rate_limited", retry_after_s: 41.2, served: "unavailable" }], warnings: ["listed prices are what the websites display"], retrieved_at: q.retrieved_at });
  renderApp(<Routes><Route path="cars/:id" element={<CarDetail />} /></Routes>, "/cars/1");
  await userEvent.selectOptions(await screen.findByLabelText(/City to compare for/), "Delhi");
  await userEvent.click(screen.getByRole("button", { name: "Check current prices" }));
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), false, "Delhi");
  expect(await screen.findByText(/Only CarDekho returned an exact ex-showroom, Delhi quote, so no "cheapest across websites" claim is possible/)).toBeInTheDocument();
  expect(screen.getByText(/Prices shown are from different location bases and cannot be directly compared/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /ex-showroom, Delhi/ })).toBeInTheDocument();
  expect(screen.getByText("Model-level references (not your variant)")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "source" }).map((a) => a.getAttribute("href"))).toEqual([q.source_url, "https://www.cardekho.com/hyundai/creta"]);
  expect(screen.getByText(/CarWale \(city \(Delhi\)\): fetch budget used up - retry in about 42 s/)).toBeInTheDocument();
  expect(screen.getByText(/The catalogue price above is historical/)).toBeInTheDocument();
});
