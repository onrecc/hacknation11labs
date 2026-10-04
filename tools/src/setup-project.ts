// One-time project setup via the service account: registers the web app (prints its public config)
// and enables anonymous sign-in. Idempotent.
import { readFileSync, writeFileSync } from "node:fs";
import { applicationDefault } from "firebase-admin/app";

const P = process.env.FIREBASE_PROJECT_ID!;
const token = (await applicationDefault().getAccessToken()).access_token;
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const api = async (method: string, url: string, body?: unknown) => {
  const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 1. web app
let apps = (await api("GET", `https://firebase.googleapis.com/v1beta1/projects/${P}/webApps`)).body.apps ?? [];
if (!apps.length) {
  const op = await api("POST", `https://firebase.googleapis.com/v1beta1/projects/${P}/webApps`, { displayName: "apprentice-web" });
  console.log("create web app:", op.status);
  for (let i = 0; i < 20 && !apps.length; i++) {
    await sleep(2000);
    apps = (await api("GET", `https://firebase.googleapis.com/v1beta1/projects/${P}/webApps`)).body.apps ?? [];
  }
}
const cfg = await api("GET", `https://firebase.googleapis.com/v1beta1/projects/${P}/webApps/${apps[0].appId}/config`);
// web config → web/.env.local (gitignored). Firebase browser keys are not secret, but they stay out of the repo.
const { projectId, appId, storageBucket, apiKey, authDomain, messagingSenderId } = cfg.body;
const envPath = new URL("../../web/.env.local", import.meta.url);
let existing = "";
try { existing = readFileSync(envPath, "utf8"); } catch { /* new file */ }
const kept = existing.split("\n").filter((l) => l && !l.startsWith("VITE_FIREBASE_"));
writeFileSync(envPath, [...kept, `VITE_FIREBASE_API_KEY=${apiKey}`, `VITE_FIREBASE_AUTH_DOMAIN=${authDomain}`, `VITE_FIREBASE_PROJECT_ID=${projectId}`,
  `VITE_FIREBASE_STORAGE_BUCKET=${storageBucket}`, `VITE_FIREBASE_MESSAGING_SENDER_ID=${messagingSenderId}`, `VITE_FIREBASE_APP_ID=${appId}`].join("\n") + "\n");
console.log("wrote web/.env.local (gitignored)");

// 2. auth: enable Identity Toolkit + anonymous sign-in
const init = await api("POST", `https://identitytoolkit.googleapis.com/v2/projects/${P}/identityPlatform:initializeAuth`);
console.log("initializeAuth:", init.status, init.body.error?.message ?? "");
const patch = await api("PATCH", `https://identitytoolkit.googleapis.com/admin/v2/projects/${P}/config?updateMask=signIn.anonymous.enabled`,
  { signIn: { anonymous: { enabled: true } } });
console.log("anonymous sign-in:", patch.status, patch.body.error?.message ?? JSON.stringify(patch.body.signIn?.anonymous));
