/** Two small nav dots, AI and Voice, re-checked every minute and when the tab comes back into view. */
import { useEffect, useState } from "react";
import { apiHealth } from "../lib/api";
import { HEALTH_RECHECK_MS, healthView, type Health, type HealthDot } from "../lib/health";

export function HealthDots() {
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const check = () => apiHealth().then((h) => alive && setHealth(h), () => alive && setHealth(null));
    const onVisible = () => document.visibilityState === "visible" && void check();
    void check();
    const timer = setInterval(() => document.visibilityState === "visible" && void check(), HEALTH_RECHECK_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const v = healthView(health);
  return (
    <span className="health-group" role="status" aria-label={`${v.ai.title}. ${v.voice.title}.`}>
      <Dot d={v.ai} />
      <Dot d={v.voice} />
    </span>
  );
}

function Dot({ d }: { d: HealthDot }) {
  return <span className={`health ${d.tone}`} title={d.title} aria-hidden="true"><i />{d.label}</span>;
}
