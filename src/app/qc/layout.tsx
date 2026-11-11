import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";

/** The branch's quality controller: records a QC per vehicle, tests failed ones again, and follows the QC analysis. */
export default async function QcLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("quality_controller");
  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar
        user={user}
        links={[
          { href: "/qc", label: "QC records", match: ["/qc/analysis"] },
          { href: "/qc/new", label: "New QC" },
        ]}
      />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
