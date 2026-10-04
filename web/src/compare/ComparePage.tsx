/** /compare: two experts, one task. Pick two confirmed Work Maps of the same kind of work, see where they differ. */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Comparison, WorkMap } from "@shared/schema";
import { signedIn } from "../lib/firebase";
import { listComparisons, listWorkMaps, loadWorkMap } from "../lib/sessions";
import { useUser } from "../lib/users";
import { compareMaps } from "./compare";
import { toast } from "../components/toast";
import { Skeleton } from "../components/Feedback";

const KIND: Record<string, string> = { same: "Same", different: "Different", only_a: "Only", only_b: "Only" };
const VERDICT: Record<string, string> = { both_valid: "Both valid", a_is_the_rule: "Team rule", b_is_the_rule: "Team rule", escalate: "Needs a decision" };

export default function ComparePage() {
  const user = useUser()!;
  const [maps, setMaps] = useState<WorkMap[] | null>(null); // null = loading
  const [pick, setPick] = useState<[string, string]>(["", ""]);
  const [list, setList] = useState<Comparison[]>([]);
  const [open, setOpen] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);

  const load = (): void => void signedIn().then(async () => {
    const heads = (await listWorkMaps()).filter((m) => m.status === "confirmed");
    const full = (await Promise.all(heads.map((h) => loadWorkMap(h.id)))).filter((m): m is WorkMap => !!m && m.steps.length > 0);
    setMaps(full);
    // default pair: newest map per expert in my department, two different experts
    const mine = full.filter((m) => m.task.domain === user.department).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const first = mine[0];
    const second = mine.find((m) => first && m.expert.displayName !== first.expert.displayName);
    if (first && second) setPick([first.id, second.id]);
    const cs = await listComparisons();
    setList(cs);
    if (cs[0]) setOpen(cs[0]);
  }).catch((e: unknown) => toast.error(e, load, "Couldn't load Work Maps"));
  useEffect(load, [user.department]); // eslint-disable-line react-hooks/exhaustive-deps

  const a = maps?.find((m) => m.id === pick[0]);
  const b = maps?.find((m) => m.id === pick[1]);
  const valid = a && b && a.expert.displayName !== b.expert.displayName;

  async function run() {
    if (!a || !b) return;
    setBusy(true);
    try {
      const c = await compareMaps(a, b);
      setList((l) => [c, ...l]);
      setOpen(c);
    } catch (e) {
      toast.error(e, () => void run(), "Comparison failed");
    } finally {
      setBusy(false);
    }
  }

  const label = (m: WorkMap) => `${m.task.title} · ${m.expert.displayName} · v${m.version}`;
  const sorted = useMemo(() => (open ? [...open.items].sort((x, y) => rank(x) - rank(y)) : []), [open]);

  return (
    <div className="page">
      <h1>Two experts, one task</h1>
      <p className="muted">Ada compares how two experts do the same work, asks each of them why where they differ, and turns the answers into a team rule a new hire can follow.</p>
      {maps === null ? <div className="card"><Skeleton lines={3} /></div> : <div className="card form">
        <label>Expert A<select value={pick[0]} onChange={(e) => setPick([e.target.value, pick[1]])}><option value="">Choose…</option>{maps.map((m) => <option key={m.id} value={m.id}>{label(m)}</option>)}</select></label>
        <label>Expert B<select value={pick[1]} onChange={(e) => setPick([pick[0], e.target.value])}><option value="">Choose…</option>{maps.map((m) => <option key={m.id} value={m.id}>{label(m)}</option>)}</select></label>
        {a && b && !valid && <p className="error small wide">Pick maps from two different experts.</p>}
        <button className="primary" disabled={!valid || busy} onClick={run}>{busy ? "Comparing… (about a minute)" : "Compare"}</button>
      </div>}

      {list.length > 1 && (
        <div className="btns">{list.map((c) => <button key={c.id} className={open?.id === c.id ? "primary" : ""} onClick={() => setOpen(c)}>{c.experts[0].name} vs {c.experts[1].name} · {c.createdAt.slice(0, 16).replace("T", " ")}</button>)}</div>
      )}

      {open && (
        <div className="card compare">
          <h2>{open.experts[0].name} vs {open.experts[1].name}</h2>
          <p>{open.summary}</p>
          <p className="muted small">
            <Link to={`/map/${maps?.find((m) => m.id === open.workMapIds[0])?.sourceSessionIds[0] ?? ""}`}>{open.experts[0].name}'s Work Map</Link> ·{" "}
            <Link to={`/map/${maps?.find((m) => m.id === open.workMapIds[1])?.sourceSessionIds[0] ?? ""}`}>{open.experts[1].name}'s Work Map</Link>
          </p>
          <table className="grid cmp">
            <thead><tr><th>Topic</th><th>{open.experts[0].name}</th><th>{open.experts[1].name}</th><th>Outcome</th></tr></thead>
            <tbody>
              {sorted.map((it) => (
                <tr key={it.id} className={`k-${it.kind} s-${it.severity}`}>
                  <td><b>{it.topic}</b><div className="small"><span className={`badge ${it.kind}`}>{it.kind === "only_a" ? `Only ${open.experts[0].name}` : it.kind === "only_b" ? `Only ${open.experts[1].name}` : KIND[it.kind]}</span>{it.severity === "important" && <span className="badge important">important</span>}</div></td>
                  <Side says={it.a?.says} q={it.questions.a} ans={it.answers.a?.text} />
                  <Side says={it.b?.says} q={it.questions.b} ans={it.answers.b?.text} />
                  <td>{it.resolution ? <><b>{VERDICT[it.resolution.verdict]}</b><div className="small">{it.resolution.note}</div>{it.resolution.condition && <div className="muted small">When: {it.resolution.condition}</div>}</> : it.kind === "same" ? <span className="muted small">Agree</span> : <span className="muted small">Waiting for answers</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Experts see Ada's questions on their <b>My day</b> page and can answer by voice or typing.</p>
        </div>
      )}
      {!open && maps !== null && maps.length < 2 && <p className="muted">Needs two confirmed Work Maps of the same kind of work from different experts.</p>}
    </div>
  );
}

function Side({ says, q, ans }: { says?: string; q?: string; ans?: string }) {
  return (
    <td>
      {says ? <div>{says}</div> : <div className="muted">no rule</div>}
      {q && <div className="small muted">Ada asks: “{q}”</div>}
      {ans && <blockquote className="quote small">“{ans}”</blockquote>}
    </td>
  );
}

const rank = (it: Comparison["items"][number]) => (it.kind === "same" ? 2 : 0) + (it.severity === "important" ? 0 : 1);
