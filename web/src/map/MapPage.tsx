/**
 * /map            → sessions + work maps
 * /map/:sessionId → live session timeline + its Work Map (clickable steps with evidence)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
  const nav = useNavigate();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [maps, setMaps] = useState<WorkMapHead[] | null>(null);
  useEffect(() => {
    void signedIn.then(async () => {
      setSessions(await listSessions());
      setMaps(await listWorkMaps());
    });
  }, []);
  const STATUS: Record<string, string> = { draft: "Draft", debrief: "In debrief", teachback_pending: "Awaiting teach-back", confirmed: "Confirmed" };
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };
  const sessionTitle = (s: Session) => s.task.title || "Untitled task";
  return (
    <div className="page mapindex">
      <header className="mi-head">
        <div>
          <h1>Work Maps</h1>
          <p className="muted">What the apprentice learned from each expert, ready to teach.</p>
        </div>
        <Link className="mi-btn" to={`/map/${DEMO_ID}`}>Open demo</Link>
      </header>

      <section className="mi-grid">
        {maps === null && <div className="mi-card skeleton" />}
        {maps?.map((m) => (
          <button key={m.id} className="mi-card" onClick={() => m.sourceSessionIds[0] && nav(`/map/${m.sourceSessionIds[0]}`)}>
            <span className="mi-card-top">
              <span className="mi-icon">{(m.title ?? "W").charAt(0)}</span>
              <span className="mi-title">{m.title ?? m.id}</span>
            </span>
            <span className="mi-status"><i className={m.status === "confirmed" ? "ok" : ""} />{STATUS[m.status] ?? m.status}<span className="muted"> · v{m.latestVersion}</span></span>
            <span className="mi-foot muted">Updated {when(m.updatedAt)}</span>
          </button>
        ))}
        {maps?.length === 0 && <p className="muted">No Work Maps yet. Record a task to create one.</p>}
      </section>

      <section className="mi-sessions">
        <h3>Recorded sessions</h3>
        <div className="mi-table">
          <table className="grid">
            <thead><tr><th>Task</th><th>Expert</th><th>Status</th><th className="num">Recorded</th></tr></thead>
            <tbody>
              {sessions?.map((s) => (
                <tr key={s.id} onClick={() => nav(`/map/${s.id}`)}>
                  <td><span className="mi-task">{sessionTitle(s)}</span>{s.kind === "teach" && <span className="pill">training</span>}</td>
                  <td className="muted">{s.participant.displayName}</td>
                  <td><span className="mi-status"><i className={s.status === "ended" || s.status === "processed" ? "" : "live"} />{s.status}</span></td>
                  <td className="num muted">{when(s.createdAt)}</td>
                </tr>
              ))}
              {sessions?.length === 0 && <tr><td colSpan={4} className="muted">No sessions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
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
