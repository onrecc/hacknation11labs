// Builds the extension for Chrome (dist/chrome) and Firefox (dist/firefox) from one source, plus the
// embeddable same-origin script for the web app (web/public/apprentice-embed.js).
//   npm run build -w extension            → load dist/chrome (chrome://extensions → Load unpacked)
//                                            or dist/firefox (about:debugging → This Firefox → Load Temporary Add-on → manifest.json)
//   npm run package -w extension          → also dist/ai-apprentice-chrome.zip and dist/ai-apprentice-firefox.zip
import { build, context } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const watch = process.argv.includes("--watch");
const base = JSON.parse(readFileSync("manifest.base.json", "utf8"));
const targets = {
  // Chrome: background service worker
  chrome: { ...base, background: { service_worker: "background.js" } },
  // Firefox: background scripts (no MV3 service workers), an add-on id, and the data-collection declaration
  firefox: {
    ...base,
    background: { scripts: ["background.js"] },
    browser_specific_settings: {
      gecko: {
        id: "ai-apprentice@hack-nation.dev",
        strict_min_version: "128.0",
        data_collection_permissions: { required: ["websiteActivity", "websiteContent"] },
      },
    },
  },
};

const builds = [];
for (const [name, manifest] of Object.entries(targets)) {
  const out = `dist/${name}`;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  copyFileSync("icon.png", `${out}/icon.png`);
  builds.push({
    entryPoints: { background: "src/background.ts", content: "src/content.ts" },
    bundle: true, outdir: out, format: "iife", target: name === "firefox" ? "firefox128" : "chrome120", logLevel: "info",
  });
}
// embeddable build for same-origin apps (served by the web app at /apprentice-embed.js)
builds.push({ entryPoints: ["src/embed.ts"], bundle: true, outfile: "../web/public/apprentice-embed.js", format: "iife", target: "es2022", logLevel: "info" });

if (watch) for (const b of builds) await (await context(b)).watch();
else for (const b of builds) await build(b);

if (process.argv.includes("--package")) {
  for (const name of Object.keys(targets)) {
    rmSync(`dist/ai-apprentice-${name}.zip`, { force: true });
    execFileSync("zip", ["-qr", `../ai-apprentice-${name}.zip`, "."], { cwd: `dist/${name}` });
    console.log(`packaged dist/ai-apprentice-${name}.zip`);
  }
}
