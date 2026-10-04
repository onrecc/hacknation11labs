/**
 * Cloud Functions entry (2nd gen). Deploy from an account with Functions + Secret Manager rights:
 *   firebase functions:secrets:set CLAUDE_KEY
 *   firebase functions:secrets:set ELEVENLABS_API_KEY
 *   npm run deploy -w functions
 * Locally, tools/src/dev-api.ts serves the same handlers on http://localhost:8787.
 */
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { handle, HttpError, isBinary } from "./handlers";

initializeApp();
const CLAUDE_KEY = defineSecret("CLAUDE_KEY");
const ELEVENLABS_API_KEY = defineSecret("ELEVENLABS_API_KEY");

export const api = onRequest(
  { region: "europe-west1", cors: true, secrets: [CLAUDE_KEY, ELEVENLABS_API_KEY], timeoutSeconds: 300, memory: "512MiB" },
  async (req, res) => {
    try {
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (!req.path.endsWith("/health")) await getAuth().verifyIdToken(token);
      const out = await handle(req.path, req.body);
      if (isBinary(out)) res.type(out.contentType).send(Buffer.from(out.binary));
      else res.json(out);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : (err as { code?: string }).code?.startsWith("auth/") ? 401 : 500;
      res.status(status).json({ error: (err as Error).message });
    }
  },
);
