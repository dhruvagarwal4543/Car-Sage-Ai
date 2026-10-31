import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { useCompare } from "../compare";
import { Backdrop } from "./Backdrop";
import { Icon } from "./Icon";
import { usePageMotion } from "../motion";

export function Layout() {
  const { user, configured, signOut } = useAuth();
  const { ids } = useCompare();
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  usePageMotion(main, pathname);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); setError(""); setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    const onScroll = () => document.documentElement.classList.toggle("scrolled", window.scrollY > 28);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <Backdrop />
      <a className="skip" href="#main">Skip to content</a>
      <header className="nav">
        <div className="nav-inner">
          <Link to="/" className="brand" aria-label="CarSage AI home"><span className="logo" aria-hidden="true"><i /></span>carsage<span className="ai">AI</span></Link>
          <nav id="main-nav" className={menuOpen ? "is-open" : ""} aria-label="Main" onClick={() => setMenuOpen(false)}>
            <NavLink to="/cars">Explore</NavLink>
            <NavLink to={`/compare${ids.length ? `?ids=${ids.join(",")}` : ""}`}>Compare{ids.length > 0 && <span className="badge">{ids.length}</span>}</NavLink>
            <NavLink to="/advisor">AI Advisor</NavLink>
            {user && <NavLink to="/saved">Saved</NavLink>}
            {user ? <button className="link-btn" onClick={() => { void signOut().catch(() => setError("Could not sign out. Please try again.")); }}>Sign out</button> : <NavLink className="nav-signin" to="/login">{configured ? "Sign in" : "Account"} <Icon name="arrow" size={14} /></NavLink>}
          </nav>
          <div className="nav-tools">
            <button className="menu-toggle" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? "close" : "menu"} /></button>
          </div>
        </div>
      </header>

      <main ref={main} id="main" className={pathname === "/" ? "home-page" : "wrap"}>{error && <p className="notice" role="alert">{error}</p>}<Outlet /></main>

      {ids.length > 0 && pathname !== "/compare" && <aside className="compare-bar" aria-label="Selected cars">
        <span><Icon name="compare" size={18} /> <strong>{ids.length} of 4 cars selected</strong>{ids.length === 1 ? " · Add one more to compare" : " · A clearer view, side by side"}</span>
        <Link className="btn primary" to="/compare">{ids.length === 1 ? "View selection" : `Compare ${ids.length} cars`}</Link>
      </aside>}

      <footer className="footer">
        <div className="footer-top">
          <div>
            <Link to="/" className="brand"><span className="logo" aria-hidden="true"><i /></span>carsage<span className="ai">AI</span></Link>
            <p className="footer-line">A little clarity for the road ahead.</p>
            <p className="dim small">An independent university AI project.<br />Built around data. Designed around you.</p>
          </div>
          <div>
            <p className="eyebrow">Find your next</p>
            <Link to="/cars">Explore the catalogue</Link>
            <Link to="/compare">Compare cars</Link>
            <Link to="/advisor">Meet your advisor</Link>
            <Link to="/saved">Your saved cars</Link>
          </div>
          <div>
            <p className="eyebrow">A note on the data</p>
            <p className="dim small">Historical new-car ex-showroom prices, at an unknown date. No live inventory or on-road prices. Photographs and 3D assets are model references, with variant differences labelled.</p>
            <Link className="text-link small" to="/credits">Visual credits &amp; model information <Icon name="arrow" size={13} /></Link>
          </div>
        </div>
        <div className="footer-bottom">
          <span>CarSage AI — Thoughtful choices. Better drives.</span>
          <a href="https://github.com/dhruvagarwal4543/Car-Sage-Ai">View the project ↗</a>
        </div>
      </footer>
    </>
  );
}
