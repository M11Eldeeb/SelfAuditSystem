import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { ViewOnlyBanner } from "@/components/view-only-banner";
import { getNotifications } from "@/lib/notifications";
import { getRejectedClaimsAccess } from "@/lib/rejected-claims-server";
import { inquiriesBadge } from "@/lib/technical-inquiries-server";
import { AMS_LINK } from "@/lib/site";
import { techClaimsWaiting } from "@/lib/tech-claims/server";
import { createClient } from "@/lib/supabase/server";
import { MyAuditsTabs } from "./my-audits-tabs";

const BRANCH_ADMIN_LINKS = [
  { href: "/audit/dashboard", label: "Dashboard", group: "Warranty" },
  { href: "/audit/query", label: "Query", group: "Warranty" },
  // Audits, Results and the Audit Schedule are tabs inside My Audits.
  { href: "/audit", label: "My Audits", match: ["/audit/results", "/audit/audit-schedule"], group: "Warranty" },
  { href: "/audit/warranty-room", label: "Warranty Room", group: "Warranty" },
  { ...AMS_LINK, group: "Warranty" },
  { href: "/audit/technician-claims", label: "Technician Claims", group: "Warranty" },
  { href: "/audit/rejected-claims", label: "Rejected Claims", group: "Warranty" },
  { href: "/audit/technical-inquiries", label: "Technical Inquiries & Verification Codes", group: "Warranty" },
  { href: "/audit/documents", label: "Warranty and Technical Documents", group: "Warranty" },
  { href: "/audit/complaints", label: "Complaints" },
  { href: "/audit/vor-parts", label: "VOR Part Query" },
  { href: "/audit/open-wips", label: "Open WIPs" },
  { href: "/audit/courtesy-cars", label: "Courtesy Cars" },
  { href: "/audit/quality-control", label: "Quality Control" },
  { href: "/audit/feedback", label: "Feedback", bottom: true },
];

/** The service manager (his own branch, view only) sees what matters to a manager: the dashboard and a few working pages. */
const SERVICE_MANAGER_LINKS = [
  { href: "/audit/dashboard", label: "Dashboard" },
  { href: "/audit/complaints", label: "Complaints" },
  { href: "/audit/vor-parts", label: "VOR Part Query" },
  { href: "/audit/open-wips", label: "Open WIPs" },
  { href: "/audit/courtesy-cars", label: "Courtesy Cars" },
  { href: "/audit/feedback", label: "Feedback", bottom: true },
];

export default async function AuditLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("branch_admin");
  if (user.managerKind === "service_manager") {
    const [notifications, { data: branch }] = await Promise.all([getNotifications(user), (await createClient()).from("self_audit_branches").select("name").eq("id", user.branch_id!).maybeSingle()]);
    return (
      <div className="app-shell-bg flex min-h-screen flex-col">
        <NavBar user={user} links={SERVICE_MANAGER_LINKS} notifications={notifications} roleDetail={branch?.name} />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
      </div>
    );
  }
  const [notifications, diaryAccess, inquiryBadge, claimsWaiting] = await Promise.all([getNotifications(user), getRejectedClaimsAccess(user), inquiriesBadge(user), techClaimsWaiting(user)]);
  // Until the diary is unlocked for branch admins its tab carries a "Soon" tag.
  const links = BRANCH_ADMIN_LINKS.map((l) =>
    l.href === "/audit/rejected-claims" && diaryAccess !== "full"
      ? { ...l, badge: "Soon" }
      : l.href === "/audit/technical-inquiries"
        ? { ...l, badge: inquiryBadge } // "Soon" while locked, otherwise the number of cases waiting for this workshop's reply
        : l.href === "/audit/technician-claims" && claimsWaiting
          ? { ...l, badge: String(claimsWaiting) } // technician claims waiting for review
          : l
  );

  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} links={links} notifications={notifications} />
      {user.viewOnly && <ViewOnlyBanner />}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <MyAuditsTabs />
        {children}
      </main>
    </div>
  );
}
