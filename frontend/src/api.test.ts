import { api, ApiError, query } from "./api";
import { stubFetch } from "./testUtils";

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("builds query strings without empty values", () => {
    expect(query({ q: "nexon", make: "", page: 2, x: undefined, y: null })).toBe("?q=nexon&page=2");
    expect(query({})).toBe("");
  });
  it("encodes special characters", () => {
    expect(query({ q: "a&b=c" })).toBe("?q=a%26b%3Dc");
  });
  it("turns server errors into readable messages", async () => {
    stubFetch(() => [404, { detail: "car not found" }]);
    await expect(api.car(5)).rejects.toMatchObject({ message: "car not found", status: 404 });
    stubFetch(() => [422, { detail: [{ msg: "ensure this value is less than or equal to 50" }] }]);
    await expect(api.cars({})).rejects.toThrow("ensure this value");
  });
  it("reports an unreachable server clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    const err = await api.filters().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/Cannot reach/);
  });
  it("refuses protected calls without a signed-in user and never calls the network", async () => {
    const calls = stubFetch(() => []);
    await expect(api.savedCars()).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(0);
  });
});
