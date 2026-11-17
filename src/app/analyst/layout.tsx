import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { feedbackLink } from "@/lib/feedback-server";

/** The data analyst: the Sub-Dealer Analytics page and nothing else (plus Feedback to the warranty team, as every role has). */
const LINKS = [{ href: "/analyst/sub-dealer", label: "Sub-Dealer Analytics" }];

export default async function AnalystLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("data_analyst");
  const feedback = await feedbackLink(user.id, "/analyst/feedback");
  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} links={[...LINKS, feedback]} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
