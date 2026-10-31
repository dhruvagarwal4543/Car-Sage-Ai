import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "./api";

const firebase = vi.hoisted(() => ({ currentUser: { uid: "user-1", getIdToken: async () => "token" } }));
vi.mock("firebase/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase/auth", () => ({
  getAuth: () => firebase,
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => { callback(firebase.currentUser); return () => {}; },
  GoogleAuthProvider: vi.fn(), createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(), signOut: vi.fn(),
}));
vi.stubEnv("VITE_FIREBASE_API_KEY", "test");
vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "test");
vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "test");
vi.stubEnv("VITE_FIREBASE_APP_ID", "test");
const { AuthProvider, useAuth } = await import("./auth");

afterEach(() => { vi.restoreAllMocks(); });

it("keeps both saved cars when concurrent requests finish out of order", async () => {
  vi.spyOn(api, "savedCars").mockResolvedValue([]);
  let finishFirst!: () => void;
  let finishSecond!: () => void;
  const save = vi.spyOn(api, "saveCar").mockImplementation((id) => new Promise<void>((resolve) => {
    if (id === 1) finishFirst = resolve; else finishSecond = resolve;
  }));
  function SavedState() {
    const auth = useAuth();
    return <>
      <button disabled={auth.loading} onClick={() => void auth.toggleSaved(1)}>Save first</button>
      <button disabled={auth.loading} onClick={() => void auth.toggleSaved(2)}>Save second</button>
      <output>{[...auth.saved].sort().join(",")}</output>
    </>;
  }
  render(<AuthProvider><SavedState /></AuthProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save first" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Save first" }));
  await userEvent.click(screen.getByRole("button", { name: "Save first" }));
  await userEvent.click(screen.getByRole("button", { name: "Save second" }));
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () => { finishSecond(); });
  expect(screen.getByRole("status")).toHaveTextContent("2");
  await act(async () => { finishFirst(); });
  expect(screen.getByRole("status")).toHaveTextContent("1,2");
});
