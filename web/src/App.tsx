import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import CapturePage from "./capture/CapturePage";
import DayPage from "./capture/DayPage";
import MapPage from "./map/MapPage";
import TeachPage from "./teach/TeachPage";
import ErpPage from "./erp/ErpPage";
import LoginPage from "./auth/LoginPage";
import ComparePage from "./compare/ComparePage";
import { apiHealth } from "./lib/api";
import { homeFor, logout, useUser, type Role } from "./lib/users";
import { mayOpen } from "./lib/teachEntry";

export default function App() {
  const { pathname } = useLocation();
  const user = useUser();
  if (pathname.startsWith("/erp")) return <ErpPage />;
  return (
    <>
      <Nav />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={user ? <Navigate to={homeFor(user)} replace /> : <Navigate to="/login" replace />} />
        <Route path="/day" element={<Guard role="expert"><DayPage /></Guard>} />
        <Route path="/capture" element={<Guard role="expert"><CapturePage /></Guard>} />
        <Route path="/learn" element={<Guard role="practicer"><TeachPage /></Guard>} />
        <Route path="/teach" element={<Navigate to="/learn" replace />} />
        <Route path="/map" element={<Guard><MapPage /></Guard>} />
        <Route path="/compare" element={<Guard><ComparePage /></Guard>} />
        <Route path="/map/:sessionId" element={<MapPage />} />
      </Routes>
    </>
  );
}

/** Needs a logged-in user (and the right role, if given). */
function Guard({ role, children }: { role?: Role; children: ReactNode }) {
  const user = useUser();
  const { pathname, search } = useLocation();
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname)}`} replace />;
  if (!mayOpen(user.role, role, search)) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}

function Nav() {
  const user = useUser();
  const nav = useNavigate();
  const [health, setHealth] = useState<string>("");
  // polled: the api can drop to canned answers mid-session (key or credits), and that must be visible
  useEffect(() => {
    const check = () => void apiHealth()
      .then((x) => setHealth(x.mock ? `AI: MOCK answers, not a real model${x.warning ? ` (${x.warning})` : ""}` : `AI: ${x.model}${x.voice ? " · ElevenLabs" : ""}`))
      .catch(() => setHealth("api offline: npm run api"));
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);
  const mock = health.startsWith("AI: MOCK");
  return (
    <nav className="nav">
      <Link to="/" className="brand">Protégé</Link>
      {user?.role === "expert" && <NavLink to="/day">My day</NavLink>}
      {user?.role === "expert" && <NavLink to="/capture">Single task</NavLink>}
      {user?.role === "practicer" && <NavLink to="/learn">Training</NavLink>}
      {user && <NavLink to="/map">Work Maps</NavLink>}
      {user && <NavLink to="/compare">Compare</NavLink>}
      <NavLink to={user?.app.url ?? "/erp"} target="_blank">{user?.app.name ?? "MiniERP"} ↗</NavLink>
      <span className="userchip">
        {mock ? (
          <span className="health" title={health} style={{ color: "var(--danger)", border: "1px solid var(--danger)", borderRadius: 6, padding: "0 6px", fontWeight: 700, letterSpacing: ".04em" }}>
            <i style={{ background: "var(--danger)" }} />MOCK
          </span>
        ) : (
          <span className={`health ${health.startsWith("api offline") ? "off" : ""}`} title={health}><i />{health.startsWith("api offline") ? "Offline" : "Live"}</span>
        )}
        {user ? (
          <>
            <span className="avatar sm" style={{ background: user.color }}>{user.short[0]}</span>
            <span>{user.name}</span>
            <button className="link" onClick={() => (logout(), nav("/login"))}>Switch user</button>
          </>
        ) : (
          <NavLink to="/login">Log in</NavLink>
        )}
      </span>
    </nav>
  );
}
