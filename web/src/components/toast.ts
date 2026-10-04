/**
 * App-wide error toasts with an optional Retry. One small pattern for "an action failed":
 *   toast.error(e, () => load(), "Couldn't load Work Maps")   // from any handler; <Toasts /> renders them
 * Pure store (no React) so it is unit-tested; Feedback.tsx renders it.
 */

export const MAX_TOASTS = 3;

export interface ToastInput {
  readonly message: string;
  /** Shown as a "Retry" button: dismisses the toast, then runs this. */
  readonly retry?: () => unknown;
}

export interface Toast extends ToastInput {
  readonly id: number;
}

export interface ToastStore {
  show(t: ToastInput): number;
  dismiss(id: number): void;
  retry(id: number): Promise<void>;
  subscribe(fn: () => void): () => void;
  snapshot(): readonly Toast[];
}

export function createToastStore(): ToastStore {
  let items: readonly Toast[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const set = (next: readonly Toast[]): void => {
    items = next;
    listeners.forEach((fn) => fn());
  };
  return {
    show(t) {
      const id = nextId++;
      set([...items.filter((x) => x.message !== t.message), { ...t, id }].slice(-MAX_TOASTS));
      return id;
    },
    dismiss(id) {
      if (items.some((x) => x.id === id)) set(items.filter((x) => x.id !== id));
    },
    async retry(id) {
      const t = items.find((x) => x.id === id);
      if (!t) return;
      set(items.filter((x) => x.id !== id));
      try {
        await t.retry?.();
      } catch {
        this.show({ message: t.message, ...(t.retry ? { retry: t.retry } : {}) }); // failed again: offer it again
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    snapshot: () => items,
  };
}

const FALLBACK = "Something went wrong.";

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || FALLBACK;
  if (typeof e === "string" && e) return e;
  return FALLBACK;
}

const store = createToastStore();

export const toast = {
  store,
  /** Show a failure; `retry` re-runs the action. `context` prefixes the message ("Couldn't load Work Maps: …"). */
  error(e: unknown, retry?: () => unknown, context?: string): number {
    const msg = errorMessage(e);
    return store.show({ message: context ? `${context}: ${msg}` : msg, ...(retry ? { retry } : {}) });
  },
};
