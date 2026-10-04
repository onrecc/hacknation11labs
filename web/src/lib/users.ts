/**
 * Fake login: six fixed profiles (fictional). No passwords: picking a profile is the "login".
 * Firebase anonymous auth still runs underneath for the security rules.
 * The role decides what you see: experts record their workday, practicers train on experts' Work Maps.
 */
import { useSyncExternalStore } from "react";
import type { Person } from "@shared/schema";

export type Role = "expert" | "practicer";

export interface User {
  id: string;
  name: string;
  short: string;
  role: Role;
  title: string;
  department: "accounts_payable" | "procurement";
  departmentLabel: string;
  yearsInRole: number;
  color: string;
  /** Where this person's daily work happens (opened from the workday / training page). */
  app: { name: string; url: string };
}

const MINIERP = { name: "MiniERP", url: "/erp" };
const PROCUREX = { name: "ProcureX", url: "/demo/procurex.html" };

export const USERS: User[] = [
  { id: "u_sabine", name: "Sabine Keller", short: "Sabine", role: "expert", title: "Senior accounts payable specialist", department: "accounts_payable", departmentLabel: "Accounts payable", yearsInRole: 24, color: "#1f3a5f", app: MINIERP },
  { id: "u_ilse", name: "Ilse Wagner", short: "Ilse", role: "expert", title: "AP team lead", department: "accounts_payable", departmentLabel: "Accounts payable", yearsInRole: 17, color: "#5b3a7a", app: MINIERP },
  { id: "u_juergen", name: "Jürgen Brandt", short: "Jürgen", role: "expert", title: "Senior buyer", department: "procurement", departmentLabel: "Procurement", yearsInRole: 21, color: "#7a3e1d", app: PROCUREX },
  { id: "u_lena", name: "Lena Vogt", short: "Lena", role: "practicer", title: "AP clerk (new)", department: "accounts_payable", departmentLabel: "Accounts payable", yearsInRole: 0, color: "#2e6b5e", app: MINIERP },
  { id: "u_aylin", name: "Aylin Demir", short: "Aylin", role: "practicer", title: "AP trainee", department: "accounts_payable", departmentLabel: "Accounts payable", yearsInRole: 0, color: "#a0522d", app: MINIERP },
  { id: "u_tim", name: "Tim Berger", short: "Tim", role: "practicer", title: "Junior buyer (new)", department: "procurement", departmentLabel: "Procurement", yearsInRole: 0, color: "#3b6fb6", app: PROCUREX },
];

export const homeFor = (u: User) => (u.role === "expert" ? "/day" : "/learn");

/** The session participant for this user. */
export const personOf = (u: User): Person => ({
  id: u.id, displayName: u.name, role: u.title, language: "en-US", yearsInRole: u.yearsInRole, department: u.department,
});

// ───────────── current user (per browser) ─────────────
const KEY = "apprentice.user";
const listeners = new Set<() => void>();
let current: User | null = (() => {
  try {
    return USERS.find((u) => u.id === localStorage.getItem(KEY)) ?? null;
  } catch {
    return null;
  }
})();

export function login(id: string) {
  current = USERS.find((u) => u.id === id) ?? null;
  try {
    if (current) localStorage.setItem(KEY, current.id);
  } catch { /* private mode: in-memory only */ }
  listeners.forEach((l) => l());
}

export function logout() {
  current = null;
  try {
    localStorage.removeItem(KEY);
  } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export const getUser = () => current;

export function useUser(): User | null {
  return useSyncExternalStore((fn) => (listeners.add(fn), () => void listeners.delete(fn)), getUser);
}
