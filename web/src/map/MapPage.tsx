/**
 * /map            → sessions + work maps
 * /map/:sessionId → live session timeline + its Work Map (clickable steps with evidence)
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import type { Event, Session, WorkMap } from "@shared/schema";
import { LogIndex } from "@shared/logindex";
import { buildDraft, buildWorkMap, condenseLog, existingIds } from "@shared/workmap";
import { FACT_PATHS } from "@shared/llm";
import { col } from "@shared/paths";
import { getSession, listSessions, listWorkMaps, loadWorkMap, saveWorkMapVersion, subscribeEvents, updateSession, blobUrl, type WorkMapHead } from "../lib/sessions";
import { db, signedIn } from "../lib/firebase";
import { llm } from "../lib/api";
import { EventFeed } from "../components/ui";
import { WorkMapView } from "./WorkMapView";
import type { FrameSource } from "./WorkMapView";

const DEMO_ID = "demo";

export default function MapPage() {
  const { sessionId } = useParams();
  if (sessionId === DEMO_ID) return <DemoMap />;
  return sessionId ? <SessionMap sessionId={sessionId} /> : <MapIndex />;
}

function MapIndex() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [maps, setMaps] = useState<WorkMapHead[]>([]);
  useEffect(() => {
    void signedIn.then(async () => {
      setSessions(await listSessions());
      setMaps(await listWorkMaps());
    });
  }, []);
  return (
    <div className="page">
      <h1>Work Maps</h1>
      <p><Link to={`/map/${DEMO_ID}`}>Open the demo Work Map (bundled, works offline)</Link></p>
      <div className="cols">
        <div className="card">
          <h3>Sessions</h3>
          <table className="grid">
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/map/${s.id}`}>{s.task.title}</Link><div className="muted small mono">{s.id}</div></td>
                  <td>{s.kind}</td><td>{s.participant.displayName}</td><td>{s.status}</td><td className="muted small">{s.createdAt.slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Work Maps</h3>
          <table className="grid">
            <tbody>
              {maps.map((m) => (
                <tr key={m.id}>
                  <td>{m.title ?? m.id}<div className="muted small mono">{m.id}</div></td><td>v{m.latestVersion}</td><td>{m.status}</td>
                  <td>{m.sourceSessionIds[0] && <Link to={`/map/${m.sourceSessionIds[0]}`}>open</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Bundled fixture: no Firestore, no Storage, no API. The demo/video safety net. */
function DemoMap() {
  // loaded on demand so the 200 demo frames + events don't weigh down /capture and /teach
  const [demo, setDemo] = useState<{ events: Event[]; workmap: WorkMap; frame: FrameSource } | null>(null);
  useEffect(() => {
    void import("./fixture").then((f) => setDemo({ ...f.loadFixture(), frame: f.fixtureFrameUrl }));
  }, []);
  if (!demo) return <div className="page">Loading demo…</div>;
  return (
    <>
      <WorkMapView wm={demo.workmap} events={demo.events} frameSource={demo.frame} />
      <div className="page"><details className="card"><summary>Raw event feed ({demo.events.length} events)</summary><EventFeed events={demo.events} max={400} /></details></div>
    </>
  );
}

const storageFrame = async (sessionId: string, frameId: string): Promise<string | null> => {
  for (const ext of ["webp", "png", "jpg", "svg"]) {
    try {
      return await blobUrl(sessionId, `frames/${frameId}.${ext}`);
    } catch { /* try next */ }
  }
  return null;
};

function SessionMap({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [wm, setWm] = useState<WorkMap | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  // live: events + whichever Work Map version is latest (the map grows while the expert works / debriefs)
  useEffect(() => {
    let offEvents = () => {}, offSession = () => {}, offHead = () => {};
    let headFor: string | null = null;
    void signedIn.then(async () => {
      setSession(await getSession(sessionId));
      offEvents = subscribeEvents(sessionId, setEvents);
      offSession = onSnapshot(doc(db, col.sessions, sessionId), (d) => {
        const s = d.data() as Session | undefined;
        if (!s) return;
        setSession(s);
        if (s.workMapId && s.workMapId !== headFor) {
          headFor = s.workMapId;
          offHead();
          offHead = onSnapshot(doc(db, col.workmaps, s.workMapId), () => void loadWorkMap(s.workMapId!).then((w) => w && setWm(w)));
        }
      });
    });
    return () => (offEvents(), offSession(), offHead());
  }, [sessionId]);

  const ix = useMemo(() => new LogIndex(sessionId, events), [sessionId, events]);
  const draft = useMemo(() => (session ? buildDraft(session, events, wm?.id) : null), [session, events, wm?.id]);
  const shown = wm ?? draft;

  async function rebuild() {
    if (!session) return;
    setBusy("Extracting with the LLM…");
    try {
      const proposal = await llm("extract_workmap", { log: condenseLog(ix), factPaths: [...FACT_PATHS], existingIds: existingIds(wm) });
      const { workmap, problems } = buildWorkMap(session, events, proposal, wm, "Re-extracted from session log");
      if (!workmap.steps.length) throw new Error("The LLM returned no steps (mock mode without ANTHROPIC_API_KEY?). Nothing saved.");
      const next = { ...workmap, status: wm?.status === "confirmed" ? ("teachback_pending" as const) : workmap.status };
      await saveWorkMapVersion(next);
      if (!session.workMapId) await updateSession(session.id, { workMapId: next.id });
      setWm(next);
      setProblems(problems.map((p) => `${p.where}: ${p.problem}`));
    } catch (e) {
      setProblems([(e as Error).message]);
    } finally {
      setBusy(null);
    }
  }

  if (!session) return <div className="page">Loading session…</div>;
  return (
    <>
      {shown && <WorkMapView wm={shown} events={events} frameSource={storageFrame} live={session.status === "live" || session.status === "debrief" || session.status === "teachback"} />}
      <div className="page">
        <div className="btns">
          <button onClick={rebuild} disabled={!!busy}>{busy ?? "Build / rebuild Work Map (LLM)"}</button>
          <span className="muted small">{session.participant.displayName} · {session.kind} · {session.status} · {events.length} events · {ix.frames.length} frames · {wm ? `v${wm.version} ${wm.status}` : "draft (not saved)"}</span>
          <Link to="/map">← all sessions</Link>
        </div>
        {problems.length > 0 && <details className="card"><summary>{problems.length} evidence problems (claims dropped or downgraded)</summary><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></details>}
        <details className="card"><summary>Raw event feed</summary><EventFeed events={events} max={300} /></details>
      </div>
    </>
  );
}
