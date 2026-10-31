import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";

declare const jsdom: { window: Window };
// Node's experimental localStorage can mask the browser storage supplied by jsdom.
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: jsdom.window.localStorage });
window.scrollTo = () => {};
// jsdom has no WebGL. The 3D components already fall back when a context cannot be made;
// returning null here keeps that path quiet instead of filling the run with "not implemented".
HTMLCanvasElement.prototype.getContext = () => null;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
