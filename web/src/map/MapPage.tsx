/**
 * /map            → sessions + work maps
 * /map/:sessionId → live session timeline + its Work Map (clickable steps with evidence)
 */
import { useEffect, useMemo, useRef, useState } from "react";
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
    <WorkMapView wm={demo.workmap} events={demo.events} frameSource={demo.frame}
      footer={<details><summary>Raw session log · {demo.events.length} events</summary><EventFeed events={demo.events} max={400} /></details>} />
  );
}

/** Frame URL from Storage: use the exact uri the frame.captured event recorded, else try the usual extensions. */
function storageFrameSource(events: Event[]): FrameSource {
  const uris = new Map<string, string>();
  for (const e of events) if (e.type === "frame.captured") uris.set(e.payload.frameId, e.payload.uri);
  return async (sessionId, frameId) => {
    const known = uris.get(frameId);
    for (const uri of known ? [known] : ["webp", "svg", "png", "jpg"].map((x) => `frames/${frameId}.${x}`)) {
      try {
        return await blobUrl(sessionId, uri);
      } catch { /* try next */ }
    }
    return null;
  };
}

function SessionMap({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [wm, setWm] = useState<WorkMap | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [autoDraft, setAutoDraft] = useState(true);
  const busyRef = useRef(false);
  const builtFor = useRef(0);

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
  const frameCount = ix.frames.length;
  const frameSource = useMemo(() => storageFrameSource(events), [frameCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const draft = useMemo(() => (session ? buildDraft(session, events, wm?.id) : null), [session, events, wm?.id]);
  const shown = wm ?? draft;

  /**
   * Build a new version from the log. `auto` = live draft during capture: only saves if nobody else wrote a
   * version meanwhile and the session is still in capture (the debrief owns the map after that).
   */
  async function rebuild(auto = false) {
    if (!session || busyRef.current) return;
    busyRef.current = true;
    setBusy(auto ? "Updating the live draft…" : "Extracting with the LLM…");
    const prev = wm;
    try {
      const proposal = await llm("extract_workmap", { log: condenseLog(ix), factPaths: [...FACT_PATHS], existingIds: existingIds(prev) });
      const fresh = await getSession(session.id);
      if (auto && fresh?.status !== "live") return; // debrief started meanwhile: it takes over
      const head = fresh?.workMapId ? await loadWorkMap(fresh.workMapId) : null;
      if ((head?.version ?? 0) !== (prev?.version ?? 0)) {
        if (!auto) setProblems(["Someone saved a newer version meanwhile; reload and try again."]);
        return;
      }
      const { workmap, problems } = buildWorkMap(session, events, proposal, prev, auto ? "Live draft during capture" : "Re-extracted from session log");
      if (!workmap.steps.length) throw new Error("The LLM returned no steps (mock mode without GEMINI_API_KEY?). Nothing saved.");
      const next = { ...workmap, status: auto ? ("draft" as const) : prev?.status === "confirmed" ? ("teachback_pending" as const) : workmap.status };
      await saveWorkMapVersion(next);
      if (!session.workMapId) await updateSession(session.id, { workMapId: next.id });
      setWm(next);
      setProblems(problems.map((p) => `${p.where}: ${p.problem}`));
    } catch (e) {
      setProblems([(e as Error).message]);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  // live draft: rebuild after every finished case while the expert is still working
  const casesDone = ix.ofType("marker.case_boundary").filter((e) => e.payload.state === "end").length;
  useEffect(() => {
    if (!autoDraft || !session || session.status !== "live" || casesDone === 0 || casesDone <= builtFor.current) return;
    builtFor.current = casesDone;
    void rebuild(true);
  }, [casesDone, session?.status, autoDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session) return <div className="page">Loading session…</div>;
  const actions = (
    <>
      {session.status === "live" && <label><input type="checkbox" checked={autoDraft} onChange={(e) => setAutoDraft(e.target.checked)} /> Live draft</label>}
      <button onClick={() => void rebuild(false)} disabled={!!busy}>{busy ?? "Rebuild"}</button>
    </>
  );
  const footer = (
    <>
      <p>{session.participant.displayName} · {session.kind} · {session.status} · {events.length} events · {ix.frames.length} frames · <Link to="/map">All sessions</Link></p>
      {problems.length > 0 && <details><summary>{problems.length} evidence notes (claims dropped or downgraded)</summary><ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul></details>}
      <details><summary>Raw session log</summary><EventFeed events={events} max={300} /></details>
    </>
  );
  if (!shown) return <div className="page">Loading Work Map…</div>;
  return <WorkMapView wm={shown} events={events} frameSource={frameSource} live={session.status === "live" || session.status === "debrief" || session.status === "teachback"} actions={actions} footer={footer} />;
}
