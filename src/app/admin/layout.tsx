import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { ViewOnlyBanner } from "@/components/view-only-banner";
import { getNotifications } from "@/lib/notifications";
import { inquiriesBadge } from "@/lib/technical-inquiries-server";
import { AMS_LINK } from "@/lib/site";
import { feedbackLink } from "@/lib/feedback-server";

const ADMIN_LINKS = [
  { href: "/admin/dashboard", label: "Dashboard", group: "Warranty" },
  { href: "/admin/query", label: "Query", group: "Warranty" },
  {
    // Overview, Self Audit, Internal Audit and their results are one tab.
    href: "/admin/audits",
    label: "Audits",
    match: ["/admin/cycles", "/admin/internal-audit", "/admin/results", "/admin/review"],
    group: "Warranty",
  },
  { href: "/admin/warranty-room", label: "Warranty Room", group: "Warranty" },
  { ...AMS_LINK, group: "Warranty" },
  { href: "/admin/sub-dealer", label: "Sub-Dealer Analytics", group: "Warranty" },
  { href: "/admin/reconciliation", label: "Reconciliation", group: "Warranty" },
  { href: "/admin/technician-claims", label: "Technician Claims", group: "Warranty" },
  { href: "/admin/rejected-claims", label: "Rejected Claims", group: "Warranty" },
  { href: "/admin/technical-inquiries", label: "Technical Inquiries & Verification Codes", group: "Warranty" },
  { href: "/admin/documents", label: "Warranty and Technical Documents", group: "Warranty" },
  { href: "/admin/complaints", label: "Complaints" },
  { href: "/admin/vor-parts", label: "VOR Part Query" },
  { href: "/admin/open-wips", label: "Open WIPs" },
  { href: "/admin/courtesy-cars", label: "Courtesy Cars" },
  { href: "/admin/quality-control", label: "Quality Control" },
  { href: "/admin/feedbacks", label: "Feedbacks", bottom: true },
];

/** The manager (every branch, view only) sees what matters to a manager: the dashboard and a few working pages. */
const MANAGER_LINKS = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/complaints", label: "Complaints" },
  { href: "/admin/vor-parts", label: "VOR Part Query" },
  { href: "/admin/open-wips", label: "Open WIPs" },
  { href: "/admin/courtesy-cars", label: "Courtesy Cars" },
  { href: "/admin/feedbacks", label: "Feedbacks", bottom: true },
];

/** The national manager (every branch, view only): the officer's dashboard and a shorter menu. */
const NATIONAL_LINKS = [
  { href: "/admin/dashboard", label: "Warranty", title: "Warranty Dashboard", group: "Dashboards" },
  { href: "/admin/dashboard?tab=quality", label: "Quality", title: "Quality Dashboard", group: "Dashboards" },
  { href: "/admin/sub-dealer", label: "Sub-Dealer", title: "Sub-Dealer Dashboard", group: "Dashboards" },
  { href: "/admin/query", label: "Query" },
  { href: "/admin/open-wips", label: "Open WIPs" },
  { href: "/admin/complaints", label: "Complaints" },
  { href: "/admin/courtesy-cars", label: "Courtesy Cars" },
  { href: "/admin/documents", label: "Warranty and Technical Documents" },
  { ...AMS_LINK },
  { href: "/admin/feedbacks", label: "Feedbacks", bottom: true },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("officer");
  if (user.managerKind) {
    const feedback = await feedbackLink(user.id, "/admin/my-feedback", "Send feedback");
    return (
      <div className="app-shell-bg flex min-h-screen flex-col">
        <NavBar user={user} links={[...(user.managerKind === "national_manager" ? NATIONAL_LINKS : MANAGER_LINKS), feedback]} />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      </div>
    );
  }
  const [notifications, inquiryBadge] = await Promise.all([getNotifications(user), inquiriesBadge(user)]);
  // The Technical Inquiries tab carries the number of cases waiting for the technical team.
  const links = ADMIN_LINKS.map((l) => (l.href === "/admin/technical-inquiries" ? { ...l, badge: inquiryBadge } : l));
  // A technical team member with view-all access keeps a way back to his own pages (where he can act).
  if (user.viewOnly) links.push({ href: "/technical/technical-inquiries", label: "My technical pages" });

  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} links={links} notifications={notifications} />
      {user.viewOnly && <ViewOnlyBanner />}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
