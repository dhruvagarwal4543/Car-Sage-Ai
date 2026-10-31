import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In development the API runs on :8000; the proxy keeps the browser same-origin (no CORS needed).
const proxy = { "/api": process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000" };
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/setupTests.ts"] },
});
