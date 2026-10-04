/** Top-level error boundary: a render crash shows a recoverable message instead of a white screen (React logs it). */
import { Component, type ReactNode } from "react";
import { errorMessage } from "./toast";
import "./feedback.css";

interface Props {
  readonly children: ReactNode;
}
interface State {
  readonly error: unknown;
  readonly failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page narrow crash" role="alert">
        <h1>Something broke on this page</h1>
        <p className="error">{errorMessage(this.state.error)}</p>
        <p className="muted">Your recordings are saved as you go. Reload to try again, or start over from the login page.</p>
        <div className="btns">
          <button className="primary" onClick={() => location.reload()}>Reload</button>
          <a className="btn-link" href="/login">Go to login</a>
          <a className="btn-link" href="/map/demo">Open the demo Work Map</a>
        </div>
      </div>
    );
  }
}
