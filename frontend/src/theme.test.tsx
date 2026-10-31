import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, useTheme } from "./theme";

function Picker() {
  const { preference, setPreference } = useTheme();
  return <select aria-label="Theme" value={preference} onChange={(event) => setPreference(event.target.value as "system" | "light" | "dark")}><option>system</option><option>light</option><option>dark</option></select>;
}

it("follows system changes only in system mode and persists an explicit preference", async () => {
  const media = new EventTarget() as EventTarget & { matches: boolean };
  media.matches = false;
  vi.stubGlobal("matchMedia", () => media);
  const app = render(<ThemeProvider><Picker /></ThemeProvider>);
  expect(document.documentElement.dataset.theme).toBe("light");
  act(() => { media.matches = true; media.dispatchEvent(new Event("change")); });
  expect(document.documentElement.dataset.theme).toBe("dark");
  await userEvent.selectOptions(screen.getByLabelText("Theme"), "light");
  act(() => media.dispatchEvent(new Event("change")));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(localStorage.getItem("carsage.theme")).toBe("light");
  app.unmount();
  render(<ThemeProvider><Picker /></ThemeProvider>);
  expect(screen.getByLabelText("Theme")).toHaveValue("light");
  expect(document.documentElement.dataset.theme).toBe("light");
  await userEvent.selectOptions(screen.getByLabelText("Theme"), "system");
  expect(document.documentElement.dataset.theme).toBe("dark");
});
