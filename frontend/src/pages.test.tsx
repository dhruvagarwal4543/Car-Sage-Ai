import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { CarCard } from "./components/CarCard";
import { Login } from "./pages/Account";
import { Advisor } from "./pages/Advisor";
import { Compare } from "./pages/Compare";
import { Explore } from "./pages/Explore";
import { car, renderApp, stubFetch } from "./testUtils";

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

const FILTERS = { makes: [{ value: "Tata", count: 2 }], fuel_types: [{ value: "Diesel", count: 2 }], transmissions: [{ value: "Manual", count: 2 }],
  body_types: [{ value: "SUV", count: 2 }], seating_capacities: [5, 7], price_min: 1, price_max: 2 };

describe("Explore", () => {
  it("loads cars from the API, then re-queries the backend when a filter changes", async () => {
    const calls = stubFetch((url) => url.startsWith("/api/filters") ? FILTERS : { items: [car(), car({ id: 2, variant: "XZ" })], total: 2, page: 1, page_size: 12 });
    renderApp(<Explore />, "/cars");
    expect(await screen.findByText(/2/, { selector: "strong" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    await userEvent.selectOptions(screen.getByLabelText("Fuel type"), "Diesel");
    await waitFor(() => expect(calls.some((u) => u.includes("fuel_type=Diesel"))).toBe(true));
  });
  it("shows an empty state, a loading state and an error with retry", async () => {
    stubFetch((url) => url.startsWith("/api/filters") ? FILTERS : { items: [], total: 0, page: 1, page_size: 12 });
    const { unmount } = renderApp(<Explore />, "/cars");
    expect(await screen.findByText("No cars match these filters")).toBeInTheDocument();
    unmount();
    let fail = true;
    stubFetch((url) => url.startsWith("/api/filters") ? FILTERS : fail ? [503, { detail: "Database unavailable" }] : { items: [car()], total: 1, page: 1, page_size: 12 });
    renderApp(<Explore />, "/cars");
    expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("article")).toBeInTheDocument();
  });
});

describe("Explore price inputs", () => {
  it("lets the user type decimal lakh values and sends rupees to the API", async () => {
    const calls = stubFetch((url) => url.startsWith("/api/filters") ? FILTERS : { items: [car()], total: 1, page: 1, page_size: 12 });
    renderApp(<Explore />, "/cars");
    const input = screen.getByLabelText("Max price (₹ lakh)") as HTMLInputElement;
    await userEvent.type(input, "12.5");
    expect(input.value).toBe("12.5");                                   // the dot must survive re-rendering
    await waitFor(() => expect(calls.some((u) => u.includes("max_price=1250000"))).toBe(true));
  });
});

describe("CarCard comparison selection", () => {
  it("toggles and enforces the 4-car limit", async () => {
    renderApp(<>{[1, 2, 3, 4, 5].map((i) => <CarCard key={i} car={car({ id: i, variant: `V${i}` })} />)}</>);
    const buttons = screen.getAllByRole("button", { name: /Compare/ });
    for (const b of buttons.slice(0, 4)) await userEvent.click(b);
    expect(screen.getAllByRole("button", { name: /^In comparison/ })).toHaveLength(4);
    await userEvent.click(buttons[4]);
    expect(screen.getByRole("alert")).toHaveTextContent("You can compare up to 4 cars. Remove one first.");
    expect(JSON.parse(localStorage.getItem("carsage.compare")!)).toEqual([1, 2, 3, 4]);
  });
});

describe("Compare", () => {
  const body = { cars: [car({ id: 1 }), car({ id: 2, model: "Creta", price_inr: 1500000 })],
    fields: [{ key: "price_inr", label: "Ex-showroom price", unit: "INR", values: [900000, 1500000], differs: true, best_index: 0, missing: [] },
             { key: "mileage_kmpl", label: "Mileage (ARAI)", unit: "km/l", values: [21.5, null], differs: true, best_index: null, missing: [1] }] };
  it("highlights the best value and marks missing data instead of inventing it", async () => {
    stubFetch(() => body);
    renderApp(<Compare />, "/compare?ids=1,2");
    const cell = await screen.findByText("₹9.00 lakh");
    expect(cell.closest("td")).toHaveClass("best");
    expect(screen.getByText("Not recorded")).toHaveClass("missing");
  });
  it("asks for more cars when fewer than two are selected", async () => {
    stubFetch(() => ({ ...car(), related: [] }));
    renderApp(<Compare />, "/compare?ids=1");
    expect(await screen.findByText("Add one more car to compare.")).toBeInTheDocument();
  });
});

describe("Advisor", () => {
  it("sends the question, shows the grounded reply and cars, and carries preferences forward", async () => {
    const bodies: { message: string; context: unknown }[] = [];
    stubFetch((_u, init) => { bodies.push(JSON.parse(String(init?.body))); return { reply: "Top pick: Tata Nexon XM", intent: "recommend", preferences: { fuel_types: ["Diesel"], transmissions: [], body_types: [], priorities: [], max_price: 1500000 }, cars: [car()] }; });
    renderApp(<Routes><Route path="/" element={<Advisor />} /></Routes>);
    await userEvent.type(screen.getByLabelText("Your question"), "diesel suv under 15 lakh");
    fireEvent.submit(screen.getByLabelText("Your question").closest("form")!);
    expect(await screen.findByText("Top pick: Tata Nexon XM")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Tata Nexon XM, details/ })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Your question"), "make it automatic{enter}");
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0].context).toBeNull();
    expect(bodies[1].context).toMatchObject({ max_price: 1500000 });
  });
  it("shows a friendly message when the API fails", async () => {
    stubFetch(() => [503, { detail: "Database unavailable" }]);
    renderApp(<Advisor />);
    await userEvent.click(screen.getByRole("button", { name: "Compare Nexon and Creta" }));
    expect(await screen.findByText(/could not answer that: Database unavailable/)).toBeInTheDocument();
  });
});

describe("Sign-in page", () => {
  it("explains that sign-in is not configured instead of showing a broken form", async () => {
    renderApp(<Login />, "/login");
    expect(await screen.findByText("Sign-in is not configured on this deployment.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });
});
