import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[PayPilot] Unhandled UI error", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-dvh grid grid-cols-1 place-items-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted mt-2">PayPilot hit an unexpected error. No financial action was taken. Reload to continue.</p>
          <pre className="mt-4 text-left text-xs text-faint whitespace-pre-wrap rounded-lg border border-line bg-surface p-3 max-h-40 overflow-auto">{this.state.error.message}</pre>
          <button className="mt-4 h-9 px-4 rounded-lg bg-accent text-black text-sm font-semibold" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
