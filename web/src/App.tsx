import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import CapturePage from "./capture/CapturePage";
import MapPage from "./map/MapPage";
import TeachPage from "./teach/TeachPage";
import ErpPage from "./erp/ErpPage";
import { apiHealth } from "./lib/api";

export default function App() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/erp")) return <ErpPage />;
  return (
    <>
      <nav className="nav">
        <Link to="/" className="brand">AI Apprentice</Link>
        <NavLink to="/capture">1 · Capture</NavLink>
        <NavLink to="/map">2 · Map</NavLink>
        <NavLink to="/teach">3 · Teach</NavLink>
        <NavLink to="/erp" target="_blank">MiniERP ↗</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/capture" element={<CapturePage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/map/:sessionId" element={<MapPage />} />
        <Route path="/teach" element={<TeachPage />} />
      </Routes>
    </>
  );
}

function Home() {
  const [h, setH] = useState<string>("checking…");
  useEffect(() => {
    apiHealth().then((x) => setH(`api ok · ${x.mock ? "MOCK LLM (no ANTHROPIC_API_KEY)" : x.model} · voice ${x.voice ? "ElevenLabs" : "browser fallback"}`)).catch(() => setH("api not reachable: run `npm run api`"));
  }, []);
  return (
    <div className="page narrow">
      <h1>AI Apprentice</h1>
      <p>An apprentice, not a recorder: it watches an expert work, asks why at natural pauses, maps the work with its guardrails, and tutors the next new hire.</p>
      <p className="muted small mono">{h}</p>
      <div className="cards3">
        <Link className="card big" to="/capture"><b>1 · Capture</b><span>Expert shares the screen and works in MiniERP; the agent asks why.</span></Link>
        <Link className="card big" to="/map/ses_demo_sabine_01"><b>2 · Map</b><span>Open the seeded demo session and its confirmed Work Map.</span></Link>
        <Link className="card big" to="/teach"><b>3 · Teach</b><span>New hire works a case the expert never showed; the tutor catches mistakes before save.</span></Link>
      </div>
    </div>
  );
}
