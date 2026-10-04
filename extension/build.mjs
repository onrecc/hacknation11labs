// Builds the extension for Chrome (dist/chrome) and Firefox (dist/firefox) from one source, plus the
// embeddable same-origin script for the web app (web/public/apprentice-embed.js).
//   npm run build -w extension            → load dist/chrome (chrome://extensions → Load unpacked)
//                                            or dist/firefox (about:debugging → This Firefox → Load Temporary Add-on → manifest.json)
//   npm run package -w extension          → also dist/protege-chrome.zip and dist/protege-firefox.zip, copied to
//                                            web/public/ so My day offers them as the "Install the extension" download
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
        strict_min_version: "140.0",
        data_collection_permissions: { required: ["websiteActivity", "websiteContent"] },
      },
      gecko_android: { strict_min_version: "142.0" },
    },
  },
};

const builds = [];
for (const [name, manifest] of Object.entries(targets)) {
  const out = `dist/${name}`;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  // the Protégé mark (icon.svg, same as the app's nav logo) at the sizes browsers ask for
  mkdirSync(`${out}/icons`, { recursive: true });
  for (const px of [16, 32, 48, 128]) copyFileSync(`icons/icon-${px}.png`, `${out}/icons/icon-${px}.png`);
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
    rmSync(`dist/protege-${name}.zip`, { force: true });
    execFileSync("zip", ["-qr", `../protege-${name}.zip`, "."], { cwd: `dist/${name}` });
    copyFileSync(`dist/protege-${name}.zip`, `../web/public/protege-${name}.zip`);
    console.log(`packaged dist/protege-${name}.zip (+ web/public/)`);
  }
}
