/**
 * Which app a department works in, and the practice guidance for it (P1-2). Accounts payable works in MiniERP,
 * procurement in ProcureX. Pure: tested in workApp.test.ts.
 */

export interface WorkApp {
  readonly name: string;
  readonly url: string;
}

export const MINIERP: WorkApp = { name: "MiniERP", url: "/erp" };
export const PROCUREX: WorkApp = { name: "ProcureX", url: "/demo/procurex.html" };

const BY_DEPARTMENT: Readonly<Record<string, WorkApp>> = { accounts_payable: MINIERP, procurement: PROCUREX };

/** The app for a department / Work Map domain; MiniERP when unknown. */
export function appFor(department: string): WorkApp {
  return BY_DEPARTMENT[department] ?? MINIERP;
}

/** The app's URL with `mode=capture|teach` appended. */
export function appUrl(app: WorkApp, mode: "capture" | "teach"): string {
  return `${app.url}${app.url.includes("?") ? "&" : "?"}mode=${mode}`;
}

const HINTS: Readonly<Record<string, string>> = {
  accounts_payable: "Try INV-4490 (€7,200 equipment, new supplier): leave cost center 4711 and press Approve. Then INV-4494 (Brno spare parts): press Approve without a second approver.",
  procurement: "Try purchase request PR-20931 in ProcureX (€7,200 hydraulic press tooling, Gerätebau Schmidt): leave GL account 6100 · Opex and press Submit for approval.",
};

/** What to try first in the module's app. */
export function practiceHint(domain: string): string {
  const app = appFor(domain);
  return `${HINTS[domain] ?? HINTS.accounts_payable} Works the same on any website: the extension holds Save/Approve-like clicks in ${app.name} until Ada has checked them against the expert's guardrails.`;
}

/** "Practice next" opens MiniERP's teach invoices, so it only applies to modules that run in MiniERP. */
export function practiceCases<T>(domain: string, cases: readonly T[]): readonly T[] {
  return appFor(domain) === MINIERP ? cases : [];
}
