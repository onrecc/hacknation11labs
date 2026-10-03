/**
 * Live debrief / teach-back panel for the expert's side panel (drop-in for CapturePage):
 *   {debrief && <DebriefPanel s={debrief} sessionId={hub.session.id} />}
 * Shows the gap meter counting down (how the debrief knows it's done) and the teach-back parts ticking off.
 */
import { Link } from "react-router-dom";
import type { DebriefStatus } from "./debrief";
import "./map.css";

const STAGE: Record<DebriefStatus["stage"], string> = {
  planning: "Finding what I still don't understand…",
  asking: "Debrief",
  extracting: "Building the Work Map…",
  teachback: "Teach-back",
  confirmed: "Work Map confirmed",
  error: "Something went wrong",
};

export function DebriefPanel({ s, sessionId }: { s: DebriefStatus; sessionId?: string }) {
  return (
    <div className="card debrief-panel wm" style={{ padding: "0.8rem 1rem", maxWidth: "none" }}>
      <div className="kicker">{STAGE[s.stage]}{s.workMapVersion ? ` · Work Map v${s.workMapVersion}` : ""}</div>
      {(s.stage === "asking" || s.stage === "planning" || s.stage === "extracting") && (
        <>
          <div className="meter">
            <div className={`meter-n ${s.gapsOpen === 0 ? "zero" : ""}`}>{s.gapsOpen}</div>
            <div>open gaps that matter<br /><span className="muted small">ends at 0, when you say you're done, or after 8 questions</span></div>
          </div>
          {s.stage === "asking" && <p className="gap-q">“{s.detail}”</p>}
          {s.gaps && (
            <ul className="debrief-gaps">
              {s.gaps.map((g) => (
                <li key={g.id} className={`${g.status} ${s.stage === "asking" && g.proposedQuestion === s.detail ? "now" : ""}`}>
                  <span>{g.status === "resolved" ? "✓" : g.status === "asked" ? "…" : g.status === "wont_fix" ? "–" : "○"}</span>
                  <span>{g.proposedQuestion}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {(s.stage === "teachback" || s.stage === "confirmed") && (
        <>
          {s.segment && <blockquote className="wq big"><p>{s.segment.text}</p><footer>Is that right?</footer></blockquote>}
          {s.segments && (
            <ul className="debrief-gaps">
              {s.segments.map((x, i) => (
                <li key={x.id} className={x.id === s.segment?.id ? "now" : ""}>
                  <span>{x.verdict === "confirmed" ? "✓" : x.verdict === "corrected" ? "✎" : x.verdict === "unclear" ? "?" : "○"}</span>
                  <span>Part {i + 1}: {x.text.length > 90 ? x.text.slice(0, 87) + "…" : x.text}</span>
                </li>
              ))}
            </ul>
          )}
          {s.stage === "confirmed" && <p className="tb-final confirmed">✓ {s.detail}</p>}
        </>
      )}
      {s.stage === "error" && <p className="error">{s.detail}</p>}
      {sessionId && (s.stage === "confirmed" || s.stage === "teachback") && <p><Link to={`/map/${sessionId}`}>Open the Work Map →</Link></p>}
      {s.problems?.length ? <details><summary className="muted small">{s.problems.length} evidence notes (claims dropped or downgraded)</summary><ul className="small">{s.problems.map((p) => <li key={p}>{p}</li>)}</ul></details> : null}
    </div>
  );
}
