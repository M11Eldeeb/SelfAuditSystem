import type { ReactNode } from "react";

// Re-mounted on every top-level section switch, which replays the enter
// animation (see .page-enter in globals.css).
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
