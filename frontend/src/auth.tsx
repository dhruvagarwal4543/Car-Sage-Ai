import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider, createUserWithEmailAndPassword, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut as fbSignOut, type Auth, type User,
} from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, setSessionExpiredHandler, setTokenProvider } from "./api";

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};
export const firebaseConfigured = Boolean(cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId);
const auth: Auth | null = firebaseConfigured ? getAuth(initializeApp(cfg)) : null;

export function authMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  const map: Record<string, string> = {
    "auth/invalid-credential": "Incorrect email or password.", "auth/wrong-password": "Incorrect email or password.", "auth/user-not-found": "No account for that email.",
    "auth/email-already-in-use": "An account with that email already exists.", "auth/weak-password": "Choose a password of at least 6 characters.",
    "auth/invalid-email": "Enter a valid email address.", "auth/popup-closed-by-user": "Sign-in was cancelled.", "auth/too-many-requests": "Too many attempts. Try again later.",
    "auth/network-request-failed": "Network error. Check your connection.",
  };
  return map[code] ?? "Sign-in failed. Please try again.";
}

interface Ctx {
  configured: boolean; user: User | null; loading: boolean; saved: Set<number>; sessionExpired: boolean;
  signIn: (email: string, password: string) => Promise<void>; signUp: (email: string, password: string) => Promise<void>;
  signInGoogle: () => Promise<void>; signOut: () => Promise<void>; toggleSaved: (carId: number) => Promise<void>;
}
const C = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(firebaseConfigured);
  const [saved, setSaved] = useState<Set<number>>(new Set());
  const [sessionExpired, setSessionExpired] = useState(false);
  const [savedLoading, setSavedLoading] = useState(false);
  const pending = useRef(new Set<number>());

  useEffect(() => {
    if (!auth) return;
    setTokenProvider(async (force) => (auth.currentUser ? auth.currentUser.getIdToken(force) : null));
    setSessionExpiredHandler(() => { setSessionExpired(true); void fbSignOut(auth); });
    const unsubscribe = onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false); setSavedLoading(Boolean(u)); if (u) setSessionExpired(false); });
    return () => { unsubscribe(); setTokenProvider(null); setSessionExpiredHandler(null); };
  }, []);

  useEffect(() => {
    setSaved(new Set());
    if (!user) { setSavedLoading(false); return; }
    let alive = true;
    api.savedCars().then((cars) => alive && setSaved(new Set(cars.map((c) => c.id)))).catch(() => alive && setSaved(new Set())).finally(() => { if (alive) setSavedLoading(false); });
    return () => { alive = false; };
  }, [user]);

  const value = useMemo<Ctx>(() => ({
    configured: firebaseConfigured, user, loading: loading || savedLoading, saved, sessionExpired,
    signIn: async (email, password) => { await signInWithEmailAndPassword(auth!, email, password); },
    signUp: async (email, password) => { await createUserWithEmailAndPassword(auth!, email, password); },
    signInGoogle: async () => { await signInWithPopup(auth!, new GoogleAuthProvider()); },
    signOut: async () => { await fbSignOut(auth!); },
    toggleSaved: async (id) => {
      if (!user) throw new Error("Please sign in to save cars.");
      if (savedLoading) throw new Error("Your saved cars are still loading. Please try again.");
      if (pending.current.has(id)) return;
      const wasSaved = saved.has(id);
      pending.current.add(id);
      try {
        if (wasSaved) await api.unsaveCar(id); else await api.saveCar(id);
        if (auth?.currentUser?.uid === user.uid) setSaved((current) => {
          const next = new Set(current);
          if (wasSaved) next.delete(id); else next.add(id);
          return next;
        });
      } finally { pending.current.delete(id); }
    },
  }), [user, loading, savedLoading, saved, sessionExpired]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useAuth() {
  const v = useContext(C);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}
