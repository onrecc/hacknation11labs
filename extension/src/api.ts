/**
 * Cross-browser WebExtension API: Firefox exposes promise-based `browser.*`, Chrome `chrome.*` (promises in MV3).
 * Everything in the extension goes through `ext` so one codebase runs on both.
 */
export const ext: typeof chrome = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome;
