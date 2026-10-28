import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { ViewOnlyBanner } from "@/components/view-only-banner";
import { getNotifications } from "@/lib/notifications";
import { getRejectedClaimsAccess } from "@/lib/rejected-claims-server";
import { inquiriesBadge } from "@/lib/technical-inquiries-server";
import { techClaimsWaiting } from "@/lib/tech-claims/server";
import { MyAuditsTabs } from "./my-audits-tabs";

const BRANCH_ADMIN_LINKS = [
  { href: "/audit/dashboard", label: "Dashboard" },
  // Audits, Results and the Audit Schedule are tabs inside My Audits.
  { href: "/audit", label: "My Audits", match: ["/audit/results", "/audit/audit-schedule"] },
  { href: "/audit/warranty-room", label: "Warranty Room" },
  { href: "/audit/technician-claims", label: "Technician Claims" },
  { href: "/audit/rejected-claims", label: "Rejected Claims" },
  { href: "/audit/technical-inquiries", label: "Technical Inquiries & Verification Codes" },
  { href: "/audit/documents", label: "Warranty and Technical Documents" },
  { href: "/audit/complaints", label: "Complaints" },
  { href: "/audit/feedback", label: "Feedback" },
];

export default async function AuditLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("branch_admin");
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
