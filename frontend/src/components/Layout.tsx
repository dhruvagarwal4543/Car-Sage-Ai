import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { useCompare } from "../compare";
import { Icon } from "./Icon";
import { useTheme } from "../theme";
import { usePageMotion } from "../motion";

export function Layout() {
  const { user, configured, signOut } = useAuth();
  const { ids } = useCompare();
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const { theme, preference, setPreference } = useTheme();
  usePageMotion(main, pathname);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); setError(""); setMenuOpen(false); }, [pathname]);
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="nav">
        <div className="wrap nav-inner">
          <Link to="/" className="brand" aria-label="CarSage AI home"><span className="logo" aria-hidden="true">C<span /></span>carsage<span className="ai">AI</span></Link>
          <label className="theme-control"><Icon name={theme === "dark" ? "moon" : "sun"} size={17} /><span className="sr-only">Appearance</span><select value={preference} onChange={(event) => setPreference(event.target.value as "system" | "light" | "dark")}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <button className="menu-toggle" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? "close" : "menu"} /></button>
          <nav id="main-nav" className={menuOpen ? "is-open" : ""} aria-label="Main" onClick={() => setMenuOpen(false)}>
            <NavLink to="/cars">Explore</NavLink>
            <NavLink to={`/compare${ids.length ? `?ids=${ids.join(",")}` : ""}`}>Compare{ids.length > 0 && <span className="badge">{ids.length}</span>}</NavLink>
            <NavLink to="/advisor">AI Advisor</NavLink>
            {user && <NavLink to="/saved">Saved</NavLink>}
            {user ? <button className="link-btn" onClick={() => { void signOut().catch(() => setError("Could not sign out. Please try again.")); }}>Sign out</button> : <NavLink className="nav-signin" to="/login">{configured ? "Sign in" : "Account"} <Icon name="arrow" size={15} /></NavLink>}
          </nav>
        </div>
      </header>
      <main ref={main} id="main" className={pathname === "/" ? "home-page" : "wrap"}>{error && <p className="notice" role="alert">{error}</p>}<Outlet /></main>
      {ids.length > 0 && pathname !== "/compare" && <aside className="compare-bar" aria-label="Selected cars">
        <span><Icon name="compare" size={20} /> <strong>{ids.length} of 4 cars selected</strong>{ids.length === 1 ? " · Add one more to compare" : " · A clearer view, side by side"}</span>
        <Link className="btn primary" to="/compare">{ids.length === 1 ? "View selection" : `Compare ${ids.length} cars`}</Link>
      </aside>}
      <footer className="footer">
        <div className="wrap footer-grid"><div><Link to="/" className="brand"><span className="logo" aria-hidden="true">C<span /></span>carsage<span className="ai">AI</span></Link><p>A little clarity for the road ahead.</p><p className="muted small">An independent university AI project.<br />Built around data. Designed around you.</p></div><div><p className="eyebrow">FIND YOUR NEXT</p><Link to="/cars">Explore the catalogue</Link><Link to="/compare">Compare cars</Link><Link to="/advisor">Meet your advisor</Link><Link to="/saved">Your saved cars</Link></div><div><p className="eyebrow">A NOTE ON THE DATA</p><p className="muted small">Historical new-car ex-showroom prices, at an unknown date. No live inventory or on-road prices. Photos and 3D assets are model references, with variant differences labelled.</p><Link className="text-link small" to="/credits">Visual credits & model information <Icon name="arrow" size={14} /></Link></div></div>
        <div className="wrap footer-bottom"><span>CarSage AI · Thoughtful choices. Better drives.</span><a href="https://github.com/dhruvagarwal4543/Car-Sage-Ai">View the project ↗</a></div>
      </footer>
    </>
  );
}
