/** Origins of the Protégé web app. Only these may act as the hub (status, screenshots) or get the "app" relay role. */
export const APP_ORIGINS: readonly string[] = [
  "https://hacknation11labs.web.app",
  "https://hacknation11labs.firebaseapp.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

/** True when `url` (a full URL or an origin) belongs to the Protégé web app. */
export function isAppOrigin(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    return APP_ORIGINS.includes(new URL(url).origin);
  } catch {
    return false;
  }
}
