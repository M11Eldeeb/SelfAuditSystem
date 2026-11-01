import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { techClaimsWaiting } from "@/lib/tech-claims/server";

/** Technician claims reviewer: one tab - the technician claims of his branch. */
export default async function ReviewerLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("claims_reviewer");
  const waiting = await techClaimsWaiting(user);
  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} links={[{ href: "/reviewer/technician-claims", label: "Technician Claims", badge: waiting ? String(waiting) : undefined }]} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
