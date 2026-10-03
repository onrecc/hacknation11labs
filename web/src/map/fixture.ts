/**
 * The demo fixture bundled into the app: /map/demo works with no Firestore, no Storage, no API.
 * It is the safety net for the live demo and the video (MAP-PLAN.md §5.6).
 */
import type { Event, Session, WorkMap } from "@shared/schema";
import sessionJson from "../../../fixtures/demo-session/session.json";
import workmapJson from "../../../fixtures/demo-session/expected_workmap.json";
import eventsRaw from "../../../fixtures/demo-session/events.jsonl?raw";

const frameUrls = import.meta.glob("../../../fixtures/demo-session/frames/*.svg", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const byFrameId = new Map(Object.entries(frameUrls).map(([path, url]) => [path.split("/").pop()!.replace(/\.svg$/, ""), url]));

export const DEMO_ID = "demo";

export function loadFixture(): { session: Session; events: Event[]; workmap: WorkMap } {
  return {
    session: sessionJson as unknown as Session,
    events: eventsRaw.trim().split("\n").map((l) => JSON.parse(l) as Event),
    workmap: workmapJson as unknown as WorkMap,
  };
}

export const fixtureFrameUrl = (_sessionId: string, frameId: string): Promise<string | null> => Promise.resolve(byFrameId.get(frameId) ?? null);
