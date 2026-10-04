/**
 * /teach: tutor panel. Pick a confirmed Work Map → start a teach session → Ada (ElevenAgents tutor) watches the
 * new hire in their work app (MiniERP, ProcureX or any site with the extension), predicts, nudges, blocks before save, explains in the
 * expert's words with their screen moment. Logic lives in tutor.ts; this file is UI.
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Event, MasteryReport, WorkMap } from "@shared/schema";
import { createSession, listWorkMaps, loadWorkMap, type WorkMapHead } from "../lib/sessions";
import { signedIn } from "../lib/firebase";
import agents from "../lib/elevenlabs.json";
import { CaptureHub } from "../capture/hub";
import { REDACTION_CONFIG } from "../capture/redaction";
import { SessionStatus } from "../capture/SessionStatus";
import { EventFeed, useStore } from "../components/ui";
import { Tutor, type TutorCard } from "./tutor";
import { personOf, useUser } from "../lib/users";
import { rankModules } from "./modules";
import { MasteryCard } from "./MasteryCard";
import { JudgeLegend } from "../components/JudgeMarker";
import { appFor, appUrl, practiceCases, practiceHint } from "../lib/workApp";
import type { PracticeCase } from "./mastery";
import { SEED } from "../erp/data";
import { toast } from "../components/toast";
import { Skeleton } from "../components/Feedback";
import { facts } from "../erp/ErpPage";

/** MiniERP's teach-only invoices: what "Practice next" can open. */
const PRACTICE: PracticeCase[] = SEED.filter((r) => r.set === "teach").map((r) => ({ key: r.key, label: r.supplier, facts: facts(r) }));


export default function TeachPage() {
  const [wm, setWm] = useState<WorkMap | null>(null);
  const [hub, setHub] = useState<CaptureHub | null>(null);
  const [cards, setCards] = useState<TutorCard[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [report, setReport] = useState<MasteryReport | null>(null);
  const user = useUser()!;
  const learner = user.short;
  const [params] = useSearchParams();
  const wanted = params.get("map"); // "Open in Training" / "Preview as new hire" from a Work Map
  const preview = user.role === "expert"; // the route guard only lets experts in with ?preview=1
  const [modules, setModules] = useState<Array<WorkMapHead & { expert: string; domain: string; steps: number; guardrails: number }> | null>(null); // null = loading
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<"running" | "finishing" | "closed" | "restarting">("running");
  const finishing = useRef(false); // double-click guard: state updates are async
  const tutor = useRef<Tutor | null>(null);
  const state = useStore(hub, () => hub?.state ?? null);

  // modules = confirmed Work Maps; own department first, then featured, then newest (modules.ts), picked automatically
  const loadModules = (): void => void signedIn().then(async () => {
    const list = await listWorkMaps();
    const loaded = rankModules((await Promise.all(list.filter((x) => x.status === "confirmed").map(async (m) => ({ head: m, full: await loadWorkMap(m.id) }))))
      .filter((x): x is { head: WorkMapHead; full: WorkMap } => !!x.full && x.full.guardrails.length > 0), user.department);
    setModules(loaded.map(({ head, full }) => ({ ...head, expert: full.expert.displayName, domain: full.task.domain, steps: full.steps.length, guardrails: full.guardrails.length })));
    const pick = loaded.find((x) => x.head.id === wanted) ?? loaded[0];
    if (pick) setWm(pick.full);
  }).catch((e: unknown) => toast.error(e, loadModules, "Couldn't load training modules"));
  useEffect(loadModules, [user.department, wanted]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!hub) return;
    const t = setInterval(() => setEvents([...hub.events]), 700);
    return () => clearInterval(t);
  }, [hub]);

  async function start() {
    if (!wm) return;
    try {
      const session = await createSession({
        kind: "teach", workMapId: wm.id,
        participant: personOf(user),
        task: wm.task,
        consent: { recordingAccepted: true, acceptedAt: new Date().toISOString(), retention: "hackathon demo" },
        config: { frameIntervalMs: 1000, visionModel: "off", agentId: agents.tutorAgentId, agentLlm: agents.llm, sttModel: "scribe_v2_realtime", promptVersions: { tutor: "v1" }, redaction: REDACTION_CONFIG, questionBudgetPer10Min: 0 },
      });
      const t = new Tutor(wm, (c) => setCards((cs) => [c, ...cs].slice(0, 6)));
      const h = new CaptureHub(session, { writer: "teach", vision: false, voice: t.voiceOptions(agents.tutorAgentId, learner) });
      t.attach(h);
      tutor.current = t;
      setHub(h);
      setReport(null);
      setCards([]);
      finishing.current = false;
      setPhase("running");
      // one start (also for "Practice next"); one greeting line before the work starts
      const greeting = `Hi ${learner}, I'm Ada. Work as usual; I'll step in if something needs ${wm.expert.displayName.split(" ")[0]}'s eye.`;
      await h.startListening(greeting).catch((e: unknown) => toast.error(e, () => h.startListening(greeting), "Couldn't start Ada's voice"));
    } catch (e) {
      toast.error(e, () => void start(), "Couldn't start the practice session");
      setPhase((p) => (p === "restarting" ? "closed" : p)); // a failed "Practice next" leaves the report usable
    }
  }

  async function finish() {
    if (!hub || !tutor.current || finishing.current) return;
    finishing.current = true;
    setPhase("finishing");
    try {
      setReport(await tutor.current.report());
      tutor.current.detach();
      await hub.close();
      setPhase("closed");
    } catch (e) {
      toast.error(e, () => void finish(), "Couldn't finish the session");
      finishing.current = false;
      setPhase("running");
    }
  }

  /** "Practice next": a fresh teach session on that case. The tab opens now (user gesture), then navigates. */
  async function practice(c: PracticeCase) {
    setPhase("restarting");
    const w = window.open("", "minierp");
    await start();
    const url = `/erp?mode=teach&case=${encodeURIComponent(c.key)}`;
    if (w) w.location.href = url;
    else window.open(url, "minierp");
  }
  function pickModule(id: string) {
    if (!id) return setWm(null);
    loadWorkMap(id).then(setWm).catch((e: unknown) => toast.error(e, () => pickModule(id), "Couldn't load that module"));
  }
  const live = phase === "running";
  const domain = wm?.task.domain ?? user.department;
  const app = appFor(domain);

  if (!hub || !state)
    return (
      <div className="page narrow">
        <h1>{preview ? "Preview as new hire" : `Hi ${learner}, ready to practice?`}</h1>
        <JudgeLegend />
        {preview && <p className="card muted small">You're an expert previewing training: this is exactly what a new hire sees. Practising here starts a teach session under your name.</p>}
        <p className="muted">{user.title} · {user.departmentLabel}. Ada, your ElevenLabs tutor, watches you work a real case and coaches you with what the experts taught her: their rules, in their own words.</p>
        <div className="card form">
          <label className="wide">Training module
            <select value={wm?.id ?? ""} disabled={!modules?.length} onChange={(e) => pickModule(e.target.value)}>
              <option value="">Choose…</option>
              {modules?.map((m) => <option key={m.id} value={m.id}>{m.featured ? "★ " : ""}{m.title ?? m.id} · by {m.expert}{m.domain === user.department ? "" : ` (${m.domain.replace("_", " ")})`}</option>)}
            </select>
          </label>
          {modules === null && <div className="wide"><Skeleton lines={1} /></div>}
          {modules?.length === 0 && <p className="muted small wide">No training modules yet: there are no confirmed Work Maps with guardrails. An expert needs to record and debrief a task first.</p>}
          {wm && <p className="muted small wide">{wm.steps.length} steps · {wm.guardrails.length} guardrails ({wm.guardrails.filter((g) => g.condition).length} machine-checkable) · expert {wm.expert.displayName} · {wm.status} · you practise in {app.name}</p>}
          {wm && wm.status !== "confirmed" && <p className="error small wide">This map isn't confirmed by the expert yet (docs/teach.md rule 1).</p>}
          <button className="primary" disabled={!wm} onClick={start}>Start practising with Ada</button>
        </div>
      </div>
    );

  const s = state;
  return (
    <div className="page split">
      <section>
        <h1>Training</h1>
        <JudgeLegend />
        <SessionStatus s={s}><p className="muted small mono">{hub.session.id}</p></SessionStatus>
        <div className="btns">
          <button disabled={!live} onClick={() => window.open(appUrl(app, "teach"), "minierp")}>Open {app.name}</button>
          <button disabled={!live} onClick={() => void finish()}>{phase === "finishing" ? "Finishing…" : phase === "closed" ? "Session closed" : "Finish → mastery report"}</button>
        </div>
        <div className="row">
          <input disabled={!live} placeholder={`Type as ${learner} (fallback when there's no mic)`} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && typed && (hub.typeUtterance(typed), setTyped(""))} />
          <button disabled={!live} onClick={() => typed && (hub.typeUtterance(typed), setTyped(""))}>Send</button>
        </div>
        {!s.extension && <p className="error">MiniERP works without any install. To get Ada's coaching on any other website, add the browser extension from <code>extension/dist</code> (Chrome or Firefox).</p>}
        <p className="muted small">{practiceHint(domain)}</p>
        {cards.map((c, i) => <Card key={i} c={c} />)}
        {report && wm && (
          <MasteryCard report={report} wm={wm} learner={learner} cases={practiceCases(domain, PRACTICE)} caughtOn={tutor.current?.caughtOn ?? new Map()}
            {...(phase === "closed" ? { onPractice: (c: PracticeCase) => void practice(c) } : {})} />
        )}
      </section>
      <section>
        <h3>Training session log</h3>
        <EventFeed events={events} />
      </section>
    </div>
  );
}

function Card({ c }: { c: TutorCard }) {
  return (
    <div className={`card intervention ${c.tone}`} role={c.tone === "block" ? "alert" : undefined}>
      {c.label && <span className="muted small">{c.label}</span>}
      <h3>{c.title}</h3>
      <p>{c.text}</p>
      {c.provenance && <p className="muted small">{c.provenance}</p>}
      {c.quote && <blockquote className="quote">“{c.quote.text}” <span className="muted">· {c.quote.who} · {c.quote.when}</span></blockquote>}
      {c.imageUrl && (
        <div className="frame">
          <img src={c.imageUrl} alt={c.quote ? `${c.quote.who}'s screen at ${c.quote.when}` : "The expert's screen at this moment"} />
          {c.bbox && <div className="bbox" style={{ left: `${c.bbox.x * 100}%`, top: `${c.bbox.y * 100}%`, width: `${c.bbox.w * 100}%`, height: `${c.bbox.h * 100}%` }} />}
        </div>
      )}
    </div>
  );
}
