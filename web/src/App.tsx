import type { ReactNode } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import CapturePage from "./capture/CapturePage";
import DayPage from "./capture/DayPage";
import MapPage from "./map/MapPage";
import TeachPage from "./teach/TeachPage";
import ErpPage from "./erp/ErpPage";
import LoginPage from "./auth/LoginPage";
import ComparePage from "./compare/ComparePage";
import { HealthDots } from "./components/HealthDots";
import { homeFor, logout, useUser, type Role } from "./lib/users";

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
  const { pathname } = useLocation();
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname)}`} replace />;
  if (role && user.role !== role) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}

function Nav() {
  const user = useUser();
  const nav = useNavigate();
  return (
    <nav className="nav">
      <Link to="/" className="brand">Protégé</Link>
      {user?.role === "expert" && <NavLink to="/day">My day</NavLink>}
      {user?.role === "expert" && <NavLink to="/capture">Single task</NavLink>}
      {user?.role === "practicer" && <NavLink to="/learn">Training</NavLink>}
      {user && <NavLink to="/map">Work Maps</NavLink>}
      {user && <NavLink to="/compare">Compare</NavLink>}
      <NavLink to="/erp" target="_blank">MiniERP ↗</NavLink>
      <span className="userchip">
        <HealthDots />
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
