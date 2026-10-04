/**
 * Step 2 of the expert's day, right after "Start my work day": open the work app (works as is, it carries the
 * embed script) or install the browser extension so Ada follows the work on any website.
 */
import { useEffect, useState } from "react";
import type { WorkApp } from "../lib/workApp";

/** The extension's content script marks every page it runs on (also before a hub exists). */
export function useExtensionPresent(): boolean {
  const has = () => !!document.documentElement.dataset.apprenticeExt;
  const [present, setPresent] = useState(has);
  useEffect(() => {
    if (present) return;
    const t = setInterval(() => has() && setPresent(true), 1000);
    return () => clearInterval(t);
  }, [present]);
  return present;
}

interface WorkSetupProps {
  app: WorkApp;
  extension: boolean;
  onOpen: () => void;
  onShare: () => void;
  /** Continuing a day that already has work: ending it right here must be possible. */
  onEndDay?: () => void;
}

export function WorkSetup({ app, extension, onOpen, onShare, onEndDay }: WorkSetupProps) {
  const [install, setInstall] = useState(false);
  return (
    <section className="card setup" aria-label="Open your work">
      <h2>Ada is listening. Now open your work.</h2>
      <p className="muted">Work as usual; Ada only asks when you pause. Come back to this tab when you finish a task or your day.</p>
      {extension ? (
        <>
          <p className="ok-line">✓ Browser extension connected: Ada follows you on any website.</p>
          <div className="btns">
            <button className="primary big" onClick={onOpen}>Open {app.name} ↗</button>
            <span className="muted small">or switch to any tab you work in</span>
          </div>
        </>
      ) : (
        <>
          <div className="choices">
            <div className="choice">
              <b>Work in {app.name}</b>
              <p className="muted small">Works right away. Nothing to install.</p>
              <button className="primary big" onClick={onOpen}>Open {app.name} ↗</button>
            </div>
            <div className="choice">
              <b>Work on another website?</b>
              <p className="muted small">Install the Protégé browser extension and Ada follows you on any site. About two minutes.</p>
              <button className="big" aria-expanded={install} onClick={() => setInstall(!install)}>Install the extension</button>
            </div>
          </div>
          {install && <InstallSteps />}
        </>
      )}
      <p className="muted small setup-alt">
        Neither? <button className="link" onClick={onShare}>Share your screen instead</button>
        {onEndDay && <> · Done for today? <button className="link" onClick={onEndDay}>End my day</button></>}
      </p>
    </section>
  );
}

function InstallSteps() {
  const ua = navigator.userAgent;
  const firefox = /firefox/i.test(ua);
  const page = firefox ? "about:debugging#/runtime/this-firefox" : /Edg\//.test(ua) ? "edge://extensions" : "chrome://extensions";
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard?.writeText(page).then(() => setCopied(true), () => {});
  return (
    <ol className="install-steps">
      <li>
        <a className="btnlink" href={`/protege-${firefox ? "firefox" : "chrome"}.zip`} download>Download the extension</a>
        {firefox ? "" : " and unzip it."}
      </li>
      <li>
        Open <code>{page}</code> in a new tab <button className="small" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        {firefox
          ? <>, click <b>Load Temporary Add-on…</b> and pick the downloaded file.</>
          : <>, turn on <b>Developer mode</b>, click <b>Load unpacked</b> and pick the unzipped folder.</>}
      </li>
      <li>
        Back here, press <button className="primary small" onClick={() => location.reload()}>I've installed it</button>
        <span className="muted small"> The page reloads; press the big button again and your day carries on.</span>
      </li>
    </ol>
  );
}
