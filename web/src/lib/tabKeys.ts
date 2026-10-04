/** Keyboard rules for tab lists and clickable table rows (WAI-ARIA authoring practices). */
import type { KeyboardEvent } from "react";

/** Index of the tab to focus after `key`, or null when the key isn't a tab-list key. */
export function nextTabIndex(count: number, current: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight": return (current + 1) % count;
    case "ArrowLeft": return (current - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

/** Keys that open a focused row, like clicking it. */
export const activatesRow = (key: string): boolean => key === "Enter" || key === " ";

/** Props that make a `<tr>` reachable with Tab and openable with Enter/Space, besides the mouse. */
export function rowLink(open: () => void): { tabIndex: 0; className: string; onClick: () => void; onKeyDown: (e: KeyboardEvent) => void } {
  return {
    tabIndex: 0,
    className: "row-link",
    onClick: open,
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget || !activatesRow(e.key)) return;
      e.preventDefault();
      open();
    },
  };
}
