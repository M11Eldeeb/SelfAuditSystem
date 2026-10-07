"use client";

import { Component, type ReactNode } from "react";

/**
 * Keeps one failed dashboard section (e.g. the trends tab timing out) from
 * taking the whole page down - shows a retry card in its place instead.
 */
export class SectionErrorBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-white p-10 text-center ring-1 ring-[#dce9ff]/60">
        <p className="text-sm font-semibold text-[#0b1c30]">This section couldn&apos;t load - the database was busy.</p>
        <button
          type="button"
          onClick={() => {
            this.setState({ failed: false });
            this.props.onRetry();
          }}
          className="rounded-lg bg-[#c4121a] px-4 py-1.5 text-sm font-bold text-white transition hover:bg-[#9a000d]"
        >
          Retry
        </button>
      </div>
    );
  }
}
