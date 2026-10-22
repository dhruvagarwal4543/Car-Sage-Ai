import { api, ApiError, query, setSessionExpiredHandler, setTokenProvider } from "./api";
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

describe("protected calls and expired sessions", () => {
  const sent = (n: number) => (vi.mocked(fetch).mock.calls[n][1]!.headers as Record<string, string>).Authorization;

  it("sends the Firebase ID token as a Bearer header, only on protected calls", async () => {
    const provider = vi.fn(async () => "tok-1");
    setTokenProvider(provider);
    stubFetch(() => []);
    await api.savedCars();
    expect(sent(0)).toBe("Bearer tok-1");
    await api.cars({});
    expect(vi.mocked(fetch).mock.calls[1][1]!.headers).not.toHaveProperty("Authorization");
    expect(provider).toHaveBeenCalledTimes(1);                        // public calls never ask for a token
    setTokenProvider(null);
  });

  it("retries exactly once with a force-refreshed token after a 401, then succeeds", async () => {
    const provider = vi.fn(async (force: boolean) => (force ? "fresh" : "stale"));
    setTokenProvider(provider);
    let n = 0;
    stubFetch(() => (++n === 1 ? [401, { detail: "Invalid or expired token" }] : []));
    await expect(api.savedCars()).resolves.toEqual([]);
    expect(provider.mock.calls).toEqual([[false], [true]]);
    expect([sent(0), sent(1)]).toEqual(["Bearer stale", "Bearer fresh"]);
    setTokenProvider(null);
  });

  it("gives up after one retry, reports the expired session once, and never loops", async () => {
    setTokenProvider(async () => "tok");
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    stubFetch(() => [401, { detail: "Invalid or expired token" }]);
    await expect(api.saveCar(1)).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/session has expired/) });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(expired).toHaveBeenCalledTimes(1);
    setTokenProvider(null); setSessionExpiredHandler(null);
  });

  it("explains an unconfigured server instead of leaking details", async () => {
    setTokenProvider(async () => "tok");
    stubFetch(() => [503, { detail: "Authentication is not configured on this server" }]);
    await expect(api.savedCars()).rejects.toMatchObject({ status: 503, message: "Authentication is not configured on this server" });
    setTokenProvider(null);
  });
});
