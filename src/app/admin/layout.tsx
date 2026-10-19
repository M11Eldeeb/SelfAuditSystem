import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { getNotifications } from "@/lib/notifications";
import { inquiriesBadge } from "@/lib/technical-inquiries-server";

const ADMIN_LINKS = [
  { href: "/admin/dashboard", label: "Dashboard" },
  {
    // Overview, Self Audit, Internal Audit and their results are one tab.
    href: "/admin/audits",
    label: "Audits",
    match: ["/admin/cycles", "/admin/internal-audit", "/admin/results", "/admin/review"],
  },
  { href: "/admin/warranty-room", label: "Warranty Room" },
  { href: "/admin/part-returns", label: "Part Return" },
  { href: "/admin/rejected-claims", label: "Rejected Claims" },
  { href: "/admin/technical-inquiries", label: "Technical Inquiries & Verification Codes" },
  { href: "/admin/feedbacks", label: "Feedbacks" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("officer");
  const [notifications, inquiryBadge] = await Promise.all([getNotifications(user), inquiriesBadge(user)]);
  // The Technical Inquiries tab carries the number of cases waiting for the technical team.
  const links = ADMIN_LINKS.map((l) => (l.href === "/admin/technical-inquiries" ? { ...l, badge: inquiryBadge } : l));

  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} links={links} notifications={notifications} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
