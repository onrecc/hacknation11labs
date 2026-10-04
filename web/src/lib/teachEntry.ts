/**
 * The Work Map's way into training (P1-2): only new hires open confirmed maps in Teach; experts preview a
 * confirmed map as a new hire, or debrief an unconfirmed one. Pure: tested in teachEntry.test.ts.
 */
import type { WorkMap } from "@shared/schema";

export type UserRole = "expert" | "practicer";

export interface TeachEntry {
  readonly label: string;
  readonly to: string;
  readonly primary: boolean;
  readonly title?: string;
}

export interface TeachEntryInput {
  /** null when nobody is logged in (the /map/demo page) */
  readonly role: UserRole | null;
  readonly status: WorkMap["status"];
  readonly workMapId: string;
}

export function teachEntry({ role, status, workMapId }: TeachEntryInput): TeachEntry | null {
  const learn = `/learn?map=${encodeURIComponent(workMapId)}`;
  const confirmed = status === "confirmed";
  if (role === "expert") {
    return confirmed
      ? { label: "Preview as new hire", to: `${learn}&preview=1`, primary: false, title: "See the training module exactly as a new hire gets it" }
      : { label: "Debrief", to: "/day", primary: true, title: "Not confirmed yet: debrief the task from My day so Ada can explain it back to you" };
  }
  return confirmed ? { label: "Open in Teach", to: learn, primary: true } : null;
}

/** Route guard: the page's role, or an expert previewing the training page (`?preview=1`). */
export function mayOpen(userRole: UserRole, required: UserRole | undefined, search: string): boolean {
  if (!required || userRole === required) return true;
  return required === "practicer" && userRole === "expert" && new URLSearchParams(search).get("preview") === "1";
}
