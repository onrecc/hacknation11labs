/** Work Map tabs: the full ARIA tab pattern (roving tabindex, arrow keys / Home / End, one tabpanel "wm-panel"). */
import { useRef, type KeyboardEvent } from "react";
import { nextTabIndex } from "../lib/tabKeys";

export type Tab = "map" | "rules" | "debrief" | "export";

const TABS: ReadonlyArray<readonly [Tab, string]> = [["map", "Steps"], ["rules", "Rules"], ["debrief", "Debrief"], ["export", "Export"]];

export function WmTabs({ tab, onTab, rules }: { tab: Tab; onTab: (t: Tab) => void; rules: number }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const next = nextTabIndex(TABS.length, i, e.key);
    if (next === null) return;
    e.preventDefault();
    onTab(TABS[next][0]);
    refs.current[next]?.focus();
  };
  return (
    <nav className="wm-tabs" role="tablist" aria-label="Work Map sections">
      {TABS.map(([k, l], i) => (
        <button key={k} ref={(el) => void (refs.current[i] = el)} id={`wm-tab-${k}`} role="tab" aria-selected={tab === k} aria-controls="wm-panel"
          tabIndex={tab === k ? 0 : -1} className={tab === k ? "on" : ""} onClick={() => onTab(k)} onKeyDown={(e) => onKeyDown(e, i)}>
          {l}
          {k === "rules" && <span className="count">{rules}</span>}
        </button>
      ))}
    </nav>
  );
}
