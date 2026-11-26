import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { feedbackLink } from "@/lib/feedback-server";

/**
 * The quality supervisor: the Quality Dashboard and the QC reports of every branch - he exports them (PDF / Excel, the
 * list marks the ones exported already) and comments on them. Plus Feedback to the warranty team, as every role has.
 */
export default async function QsLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("quality_supervisor");
  const feedback = await feedbackLink(user.id, "/qs/feedback");
  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar
        user={user}
        links={[
          { href: "/qs", label: "Quality Dashboard" },
          { href: "/qs/reports", label: "QC reports" },
          feedback,
        ]}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
