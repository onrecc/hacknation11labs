// Bundles the extension into extension/dist (load it via chrome://extensions → "Load unpacked" → extension/dist).
import { build, context } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });
copyFileSync("manifest.json", "dist/manifest.json");
copyFileSync("icon.png", "dist/icon.png");
const opts = {
  entryPoints: { background: "src/background.ts", content: "src/content.ts" },
  bundle: true, outdir: "dist", format: "esm", target: "chrome120", sourcemap: "inline", logLevel: "info",
};
if (watch) await (await context(opts)).watch();
else await build(opts);
