import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { getNotifications } from "@/lib/notifications";
import { getRejectedClaimsAccess } from "@/lib/rejected-claims-server";

const BRANCH_ADMIN_LINKS = [
  { href: "/audit/dashboard", label: "Dashboard" },
  { href: "/audit", label: "My Audits" },
  { href: "/audit/results", label: "Results" },
  { href: "/audit/warranty-room", label: "Warranty Room" },
  { href: "/audit/part-returns", label: "Part Return" },
  { href: "/audit/rejected-claims", label: "Rejected Claims" },
  { href: "/audit/feedback", label: "Feedback" },
];

export default async function AuditLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("branch_admin");
  const [notifications, diaryAccess] = await Promise.all([getNotifications(user), getRejectedClaimsAccess(user)]);
  // Until the diary is unlocked for branch admins its tab carries a "Soon" tag.
  const links = BRANCH_ADMIN_LINKS.map((l) => (l.href === "/audit/rejected-claims" && diaryAccess !== "full" ? { ...l, badge: "Soon" } : l));

  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} links={links} notifications={notifications} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
