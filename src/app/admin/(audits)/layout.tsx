import type { ReactNode } from "react";
import { AuditsNav } from "./audits-nav";

/**
 * Shared frame for the Audits tab: the Overview, the Self Audit and Internal
 * Audit folders and their results. A route group, so the URLs stay as they were.
 */
export default function AuditsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AuditsNav />
      {children}
    </>
  );
}
