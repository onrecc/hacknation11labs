/**
 * Which training module a learner gets first. Pure, so the ordering is testable:
 *   1. the learner's own department,
 *   2. maps an expert pinned as featured (Work Map head `featured: true`), so a newer test recording never
 *      silently replaces the polished module,
 *   3. newest first (the bundled demo map is dated in the future, so it ranks as oldest).
 */

export interface ModuleHead {
  updatedAt: string;
  featured?: boolean;
}

export interface RankableModule {
  head: ModuleHead;
  full: { task: { domain: string } };
}

/** Newest first; maps dated in the future (fixtures) rank as oldest. */
export const recency = (h: ModuleHead, now: number = Date.now()): number => {
  const t = Date.parse(h.updatedAt);
  return Number.isNaN(t) || t > now ? 0 : t;
};

/** A new array, best default first. */
export function rankModules<T extends RankableModule>(items: readonly T[], department: string, now: number = Date.now()): T[] {
  const mine = (x: T) => Number(x.full.task.domain === department);
  const pinned = (x: T) => Number(x.head.featured === true);
  return [...items].sort((a, b) => mine(b) - mine(a) || pinned(b) - pinned(a) || recency(b.head, now) - recency(a.head, now));
}
