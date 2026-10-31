import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";

declare const jsdom: { window: Window };
// Node's experimental localStorage can mask the browser storage supplied by jsdom.
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: jsdom.window.localStorage });
window.scrollTo = () => {};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
