/** "● Recording · Ada listening · Extension connected", with the technical details in a closed Diagnostics section. */
import type { ReactNode } from "react";
import type { HubState } from "./hub";
import { statusLine } from "./statusLine";

interface SessionStatusProps {
  s: HubState;
  ended?: boolean;
  /** extra diagnostics (session id, write stats) */
  children?: ReactNode;
}

export function SessionStatus({ s, ended, children }: SessionStatusProps) {
  const line = statusLine({ ...s, ended });
  return (
    <div className="session-status">
      <p className={`status-line ${line.tone}`} role="status"><i aria-hidden="true" />{line.text}</p>
      <details className="diagnostics">
        <summary>Diagnostics</summary>
        <div className="status-row">
          <span className="pill">phase: {s.phase}</span>
          <span className="pill">voice: {s.voice}{s.voiceStatus ? ` (${s.voiceStatus})` : ""}</span>
          <span className="pill">stt: {s.stt}</span>
          <span className="pill">frames from: {s.frameSource}</span>
          <span className="pill">frames: {s.frames}</span>
          <span className={`pill ${s.extension ? "ok" : ""}`}>extension: {s.extension ? "connected" : "not detected"}</span>
        </div>
        {children}
      </details>
    </div>
  );
}
