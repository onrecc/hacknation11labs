/**
 * Local stand-in for the `api` Cloud Function: same handlers, keys from .env.local.
 *   npm run api            → http://localhost:8787  (web uses VITE_API_BASE=http://localhost:8787)
 * Verifies Firebase ID tokens like production (DEV_API_NOAUTH=1 to skip).
 */
import { createServer } from "node:http";
import { getAuth } from "firebase-admin/auth";
import "./admin";
import { handle, HttpError, isBinary } from "../../functions/src/handlers";

const port = Number(process.env.DEV_API_PORT ?? 8787);
createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return void res.end();
  const t0 = Date.now();
  try {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (!path.endsWith("/health") && process.env.DEV_API_NOAUTH !== "1") {
      await getAuth().verifyIdToken((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    }
    let raw = "";
    for await (const c of req) raw += c;
    const out = await handle(path, raw ? JSON.parse(raw) : {});
    if (isBinary(out)) {
      res.setHeader("Content-Type", out.contentType);
      res.end(Buffer.from(out.binary));
    } else {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(out));
    }
    console.log(`${req.method} ${path} ${(JSON.parse(raw || "{}") as { task?: string }).task ?? ""} ${Date.now() - t0}ms`);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : (err as { code?: string }).code?.startsWith("auth/") ? 401 : 500;
    res.statusCode = status;
    res.end(JSON.stringify({ error: (err as Error).message }));
    console.error(`${req.url} → ${status} ${(err as Error).message}`);
  }
}).listen(port, () => console.log(`dev api on http://localhost:${port} (LLM: ${process.env.LLM_MOCK === "1" || !(process.env.CLAUDE_KEY ?? process.env.ANTHROPIC_API_KEY) ? "mock" : "claude"}, voice: ${process.env.ELEVENLABS_API_KEY ? "elevenlabs" : "browser"})`));
