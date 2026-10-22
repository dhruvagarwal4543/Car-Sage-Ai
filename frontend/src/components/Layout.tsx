import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";
import { useCompare } from "../compare";

export function Layout() {
  const { user, configured, signOut } = useAuth();
  const { ids } = useCompare();
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="nav">
        <div className="wrap nav-inner">
          <Link to="/" className="brand" aria-label="CarSage AI home"><span className="logo" aria-hidden="true">C</span>CarSage<span className="ai">AI</span></Link>
          <nav aria-label="Main">
            <NavLink to="/cars">Explore</NavLink>
            <NavLink to={`/compare${ids.length ? `?ids=${ids.join(",")}` : ""}`}>Compare{ids.length > 0 && <span className="badge">{ids.length}</span>}</NavLink>
            <NavLink to="/advisor">AI Advisor</NavLink>
            {user && <NavLink to="/saved">Saved</NavLink>}
            {user ? <button className="link-btn" onClick={() => void signOut()}>Sign out</button> : configured ? <NavLink to="/login">Sign in</NavLink> : null}
          </nav>
        </div>
      </header>
      <main id="main" className="wrap"><Outlet /></main>
      <footer className="footer">
        <div className="wrap">
          <p><strong>CarSage AI</strong>: a university AI course project. Data: an Indian new-car specification dataset (1,267 distinct variants).</p>
          <p className="muted small">Prices are ex-showroom prices of <em>new</em> cars at an unknown date. There is no live inventory, no on-road pricing and no used-car data. The advisor is rule-based, not a language model.</p>
          <p className="muted small"><a href="https://github.com/dhruvagarwal4543/Car-Sage-Ai">Source code on GitHub</a></p>
        </div>
      </footer>
    </>
  );
}
