/** Deploys firestore.rules + storage.rules via the Firebase Rules API using the service account. */
import { readFileSync } from "node:fs";
import { applicationDefault } from "firebase-admin/app";

const P = process.env.FIREBASE_PROJECT_ID ?? "hacknation11labs";
const token = (await applicationDefault().getAccessToken()).access_token;
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const base = `https://firebaserules.googleapis.com/v1/projects/${P}`;

for (const [file, release] of [["firestore.rules", "cloud.firestore"], ["storage.rules", `firebase.storage/${P}.firebasestorage.app`]] as const) {
  const content = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const rs = await fetch(`${base}/rulesets`, { method: "POST", headers: H, body: JSON.stringify({ source: { files: [{ name: file, content }] } }) });
  const ruleset = (await rs.json()) as { name?: string; error?: { message: string } };
  if (!ruleset.name) throw new Error(`${file}: ${ruleset.error?.message}`);
  const r = await fetch(`${base}/releases/${release}`, { method: "PATCH", headers: H, body: JSON.stringify({ release: { name: `projects/${P}/releases/${release}`, rulesetName: ruleset.name } }) });
  console.log(`${file} → ${release}: ${r.status}`);
}
