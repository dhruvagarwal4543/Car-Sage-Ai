import { inr, lakhToRupees, num } from "./format";

describe("format", () => {
  it("formats rupees as lakh or crore", () => {
    expect(inr(695000)).toBe("₹6.95 lakh");
    expect(inr(21215539 * 10)).toBe("₹21.22 crore");
    expect(inr(null)).toBe("Not recorded");
  });
  it("formats numbers with units and never invents missing ones", () => {
    expect(num(22.4, "km/l")).toBe("22.4 km/l");
    expect(num(5)).toBe("5");
    expect(num(undefined, "cc")).toBe("Not recorded");
  });
  it("converts lakh input to rupees and rejects junk", () => {
    expect(lakhToRupees("12.5")).toBe(1250000);
    expect(lakhToRupees("")).toBeUndefined();
    expect(lakhToRupees("abc")).toBeUndefined();
    expect(lakhToRupees("-3")).toBeUndefined();
  });
});
