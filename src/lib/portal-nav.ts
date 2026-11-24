import "server-only";
import type { CurrentUser } from "@/lib/auth";
import type { NavLink } from "@/components/nav-menu";
import type { RailKpi } from "@/lib/rail";
import { getNotifications } from "@/lib/notifications";
import { inquiriesBadge } from "@/lib/technical-inquiries-server";
import { AMS_LINK } from "@/lib/site";
import { feedbackLink } from "@/lib/feedback-server";
import { kpiLinks } from "@/lib/rail-kpis";
import { tabsFor } from "@/components/dashboard/tabs";
import { getRejectedClaimsAccess } from "@/lib/rejected-claims-server";
import { techClaimsWaiting } from "@/lib/tech-claims/server";
import { createClient } from "@/lib/supabase/server";
import { branchHasSubDealer } from "@/lib/dashboard/sub-dealer-access";
import { isReception } from "@/lib/reception";

/**
 * The portal menu of each area (the links, the dashboards and the bell), in one place: the area layouts use it, and so does the
 * customer queue, which shows the person's own portal menu with the queue's pages as one folder (no "Back to portal").
 */
export type PortalNav = {
  links: NavLink[];
  kpis: RailKpi[];
  notifications?: Awaited<ReturnType<typeof getNotifications>>;
  roleDetail?: string;
};

const ADMIN_LINKS: NavLink[] = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/msi", label: "Major Service Indicators" },
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
const MANAGER_LINKS: NavLink[] = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/msi", label: "Major Service Indicators" },
  { href: "/admin/complaints", label: "Complaints" },
  { href: "/admin/vor-parts", label: "VOR Part Query" },
  { href: "/admin/open-wips", label: "Open WIPs" },
  { href: "/admin/courtesy-cars", label: "Courtesy Cars" },
];

/** The national manager (every branch, view only): the officer's dashboard and a shorter menu. */
const NATIONAL_LINKS: NavLink[] = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/msi", label: "Major Service Indicators" },
  { href: "/admin/query", label: "Query" },
  { href: "/admin/open-wips", label: "Open WIPs" },
  { href: "/admin/complaints", label: "Complaints" },
  { href: "/admin/courtesy-cars", label: "Courtesy Cars" },
  { href: "/admin/documents", label: "Warranty and Technical Documents" },
  { ...AMS_LINK },
];

// The dashboards: each dashboard tab is its own page; Audits, Sub-Dealer Analytics and Major Service Indicators are pages too.
const AUDITS_KPI = { href: "/admin/audits", label: "Audits", dept: "warranty" as const };
const SUB_DEALER_KPI = { href: "/admin/sub-dealer", label: "Sub-Dealer Analytics", dept: "warranty" as const };
const MSI_KPI = { href: "/admin/msi", label: "Major Service Indicators", dept: "service" as const };
const INQUIRY_REPORTS_KPI = { href: "/admin/technical-inquiries/reports", label: "Technical Inquiries & Verification Codes", dept: "technical" as const };

/** The warranty officer, the manager and the national manager (the /admin area); `user` as requireRole("officer") gives it. */
export async function adminNav(user: CurrentUser): Promise<PortalNav> {
  if (user.managerKind === "manager" || user.managerKind === "national_manager") {
    const feedback = await feedbackLink(user.id, "/admin/my-feedback");
    const national = user.managerKind === "national_manager";
    return {
      links: [...(national ? NATIONAL_LINKS : MANAGER_LINKS), feedback],
      kpis: national
        ? kpiLinks({ base: "/admin/dashboard", tabs: tabsFor(true, false, true), quality: true, extra: [SUB_DEALER_KPI, MSI_KPI] })
        : kpiLinks({ base: "/admin/dashboard", tabs: tabsFor(true, true), subDealer: true, extra: [MSI_KPI] }),
    };
  }
  const [notifications, inquiryBadge] = await Promise.all([getNotifications(user), inquiriesBadge(user)]);
  // The Technical Inquiries tab carries the number of cases waiting for the technical team.
  const links = ADMIN_LINKS.map((l) => (l.href === "/admin/technical-inquiries" ? { ...l, badge: inquiryBadge } : l));
  // A technical team member with view-all access keeps a way back to his own pages (where he can act).
  if (user.viewOnly) links.push({ href: "/technical/technical-inquiries", label: "My technical pages" });
  return {
    links,
    notifications,
    kpis: kpiLinks({ base: "/admin/dashboard", tabs: tabsFor(true, false), quality: true, extra: [AUDITS_KPI, SUB_DEALER_KPI, MSI_KPI, INQUIRY_REPORTS_KPI] }),
  };
}

const BRANCH_ADMIN_LINKS: NavLink[] = [
  { href: "/audit/dashboard", label: "Dashboard" },
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
const SERVICE_MANAGER_LINKS: NavLink[] = [
  { href: "/audit/dashboard", label: "Dashboard" },
  { href: "/audit/msi", label: "Major Service Indicators" },
  { href: "/audit/query", label: "Query" },
  { href: "/audit/complaints", label: "Complaints" },
  { href: "/audit/vor-parts", label: "VOR Part Query" },
  { href: "/audit/open-wips", label: "Open WIPs" },
  { href: "/audit/courtesy-cars", label: "Courtesy Cars" },
  { href: "/audit/feedback", label: "Feedback", bottom: true },
];

/** The branch admin and the service manager (the /audit area); `user` as requireRole("branch_admin") gives it. */
export async function auditNav(user: CurrentUser): Promise<PortalNav> {
  if (user.managerKind === "service_manager") {
    const supabase = await createClient();
    const [notifications, { data: branch }, subDealer] = await Promise.all([
      getNotifications(user),
      supabase.from("self_audit_branches").select("name").eq("id", user.branch_id!).maybeSingle(),
      branchHasSubDealer(supabase, user.branch_id),
    ]);
    return {
      links: SERVICE_MANAGER_LINKS,
      notifications,
      roleDetail: branch?.name,
      kpis: kpiLinks({ base: "/audit/dashboard", tabs: tabsFor(false, true), subDealer, extra: [{ href: "/audit/msi", label: "Major Service Indicators", dept: "service" }] }),
    };
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
  return { links, notifications, kpis: kpiLinks({ base: "/audit/dashboard", tabs: tabsFor(false, false), quality: true }) };
}

/** The service advisor: his branch's dashboard (read only), Complaints, VOR Part Query, Open WIPs and Courtesy Cars. */
const ADVISOR_LINKS: NavLink[] = [
  { href: "/advisor/dashboard", label: "Dashboard" },
  { href: "/advisor/msi", label: "Major Service Indicators" },
  { href: "/advisor/complaints", label: "Complaints" },
  { href: "/advisor/vor-parts", label: "VOR Part Query" },
  { href: "/advisor/open-wips", label: "Open WIPs" },
  { href: "/advisor/courtesy-cars", label: "Courtesy Cars" },
];

/** The service advisor area; the reception team of the customer queue uses the same pages (and Query) - see lib/reception. */
export async function advisorNav(user: CurrentUser): Promise<PortalNav> {
  const [feedback, notifications] = await Promise.all([feedbackLink(user.id, "/advisor/feedback"), getNotifications(user)]);
  // The reception team (customer queue): the same pages without the branch dashboard, plus Query.
  const reception = isReception(user);
  const links = reception ? [...ADVISOR_LINKS.filter((l) => l.href !== "/advisor/dashboard"), { href: "/advisor/query", label: "Query" }] : ADVISOR_LINKS;
  return {
    links: [...links, feedback],
    notifications,
    kpis: reception ? [] : kpiLinks({ base: "/advisor/dashboard", tabs: tabsFor(false, false), extra: [{ href: "/advisor/msi", label: "Major Service Indicators", dept: "service" }] }),
  };
}

/**
 * The person's own portal menu from their account (as the customer queue sees it), or null when their portal area has no
 * place for the queue (they keep the queue's own menu).
 */
export async function portalNavFor(user: CurrentUser): Promise<PortalNav | null> {
  if (user.role === "officer") return adminNav(user);
  if (user.role === "manager" || user.role === "national_manager") return adminNav({ ...user, role: "officer", viewOnly: true, managerKind: user.role });
  if (user.role === "service_manager") return auditNav({ ...user, role: "branch_admin", viewOnly: true, managerKind: "service_manager" });
  if (user.role === "branch_admin") return auditNav(user);
  if (user.role === "service_advisor") return advisorNav(user);
  return null;
}
