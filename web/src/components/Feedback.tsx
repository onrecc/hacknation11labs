/** Shared feedback UI: the app-wide error toasts from toast.ts (bottom right; Retry + Dismiss) and list skeletons. */
import { useSyncExternalStore, type ReactElement } from "react";
import { toast } from "./toast";
import "./feedback.css";

export function Toasts(): ReactElement {
  const { store } = toast;
  const items = useSyncExternalStore(store.subscribe, store.snapshot);
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className="toast" role="alert">
          <span className="toast-msg">{t.message}</span>
          {t.retry && <button className="small" onClick={() => void store.retry(t.id)}>Retry</button>}
          <button className="link" aria-label="Dismiss" onClick={() => store.dismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

interface SkeletonProps {
  readonly lines?: number;
}

/** Placeholder block while a list loads (null = loading). */
export function Skeleton({ lines = 2 }: SkeletonProps): ReactElement {
  return (
    <div className="skel" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skel-line" />)}
    </div>
  );
}
