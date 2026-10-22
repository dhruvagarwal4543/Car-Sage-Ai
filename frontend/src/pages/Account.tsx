import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { authMessage, useAuth } from "../auth";
import { CarCard } from "../components/CarCard";
import { Empty, ErrorBox, Loading } from "../components/States";
import { useAsync } from "../useAsync";

export function Login() {
  const { configured, user, signIn, signUp, signInGoogle } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (user) nav("/saved", { replace: true }); }, [user, nav]);

  if (!configured) {
    return (
      <>
        <h1>Sign in</h1>
        <Empty title="Sign-in is not configured on this deployment.">The site owner needs to set the <code>VITE_FIREBASE_*</code> variables (see <code>frontend/.env.example</code>). Browsing, comparing and the advisor work without an account.</Empty>
      </>
    );
  }
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError(authMessage(e)); } finally { setBusy(false); } };
  const submit = (e: FormEvent) => { e.preventDefault(); void run(() => (mode === "in" ? signIn(email, password) : signUp(email, password))); };
  return (
    <div className="auth-box">
      <h1>{mode === "in" ? "Sign in" : "Create account"}</h1>
      <form onSubmit={submit}>
        <label className="field">Email<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field">Password<input type="password" required minLength={6} autoComplete={mode === "in" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="notice" role="alert">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>{mode === "in" ? "Sign in" : "Create account"}</button>
      </form>
      <button className="btn" onClick={() => void run(signInGoogle)} disabled={busy}>Continue with Google</button>
      <p className="muted small">{mode === "in" ? "New here? " : "Have an account? "}<button className="link-btn" onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? "Create an account" : "Sign in"}</button></p>
      <p className="muted small">Accounts are handled by Firebase Authentication; CarSage never sees or stores your password.</p>
    </div>
  );
}

export function Saved() {
  const { user, loading, configured, saved } = useAuth();
  const res = useAsync(() => (user ? api.savedCars() : Promise.resolve([])), [user?.uid, saved.size]);
  if (loading) return <Loading />;
  if (!configured || !user) return <><h1>Saved cars</h1><Empty title="Sign in to see your saved cars."><Link to="/login">Go to sign in</Link></Empty></>;
  return (
    <>
      <h1>Saved cars</h1>
      {res.loading && !res.data && <Loading />}
      {res.error && <ErrorBox message={res.error} onRetry={res.reload} />}
      {res.data && res.data.length === 0 && <Empty title="Nothing saved yet.">Use the Save button on any car.</Empty>}
      <div className="grid three">{res.data?.map((c) => <CarCard key={c.id} car={c} />)}</div>
    </>
  );
}
