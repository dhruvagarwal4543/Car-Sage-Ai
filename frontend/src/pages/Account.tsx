import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { authMessage, useAuth } from "../auth";
import { CarCard } from "../components/CarCard";
import { Empty, ErrorBox, Loading } from "../components/States";
import { useAsync } from "../useAsync";
import { Icon } from "../components/Icon";

function AccountShell({ children }: { children: ReactNode }) {
  return <div className="account-layout"><section className="account-story"><p className="eyebrow">YOUR NEXT CHAPTER</p><h2>Good choices.<br />Great journeys.</h2><p>Keep your favourites in one place. Come back when you’re ready for the next step.</p><div className="account-emblem"><Icon name="bookmark" size={70} /></div><p className="small">Your shortlist is personal. Your saved cars belong to you.</p></section><div className="auth-box">{children}</div></div>;
}

export function Login() {
  const { configured, user, sessionExpired, signIn, signUp, signInGoogle } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const from = location.state?.from;
  const destination = typeof from === "string" && /^\/(cars(?:[/?]|$)|saved(?:\?|$))/.test(from) ? from : "/saved";
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (user) nav(destination, { replace: true }); }, [user, nav, destination]);

  if (!configured) {
    return (
      <AccountShell>
        <p className="eyebrow">A SPACE FOR YOUR SHORTLIST</p>
        <h1>Sign in</h1>
        <Empty title="Sign-in is not configured on this deployment.">Accounts are not available yet. You can browse cars, compare variants and use the advisor without signing in.</Empty>
        <Link className="btn primary" to="/cars">Browse cars</Link>
      </AccountShell>
    );
  }
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError(authMessage(e)); } finally { setBusy(false); } };
  const submit = (e: FormEvent) => { e.preventDefault(); void run(() => (mode === "in" ? signIn(email, password) : signUp(email, password))); };
  return (
    <AccountShell>
      <p className="eyebrow">WELCOME TO CARSAGE</p>
      <h1>{mode === "in" ? "Sign in" : "Create account"}</h1>
      {sessionExpired && <p className="notice" role="alert">Your session has expired. Please sign in again.</p>}
      <form onSubmit={submit}>
        <label className="field">Email<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field">Password<input type="password" required minLength={6} autoComplete={mode === "in" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="notice" role="alert">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>{mode === "in" ? "Sign in" : "Create account"}</button>
      </form>
      <button className="btn" onClick={() => void run(signInGoogle)} disabled={busy}>Continue with Google</button>
      <p className="muted small">{mode === "in" ? "New here? " : "Have an account? "}<button className="link-btn" onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? "Create an account" : "Sign in"}</button></p>
      <p className="muted small">Accounts are handled by Firebase Authentication; CarSage never sees or stores your password.</p>
    </AccountShell>
  );
}

export function Saved() {
  const { user, loading, configured, saved } = useAuth();
  const res = useAsync(() => (user && !loading ? api.savedCars() : Promise.resolve([])), [user?.uid, loading, [...saved].sort((a, b) => a - b).join(",")]);
  if (loading) return <Loading />;
  if (!configured || !user) return <><div className="page-heading"><p className="eyebrow">YOUR PERSONAL SHORTLIST</p><h1>Saved cars</h1><p>A few favourites. A little closer to your next drive.</p></div><Empty title="Sign in to see your saved cars."><Link to="/login">Go to sign in</Link></Empty></>;
  return (
    <>
      <div className="page-heading"><p className="eyebrow">YOUR PERSONAL SHORTLIST</p><h1>Saved cars</h1><p>Good possibilities, kept in one place.</p></div>
      {res.loading && !res.data && <Loading />}
      {res.error && <ErrorBox message={res.error} onRetry={res.reload} />}
      {res.data && res.data.length === 0 && <Empty title="Nothing saved yet.">Use the Save button on any car.</Empty>}
      <div className="grid three">{res.data?.map((c) => <CarCard key={c.id} car={c} />)}</div>
    </>
  );
}
