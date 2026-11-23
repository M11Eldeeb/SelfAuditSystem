import type { ReactNode } from "react";
import { requireAdvisorArea, isReception } from "@/lib/reception";
import { NavBar } from "@/components/nav-bar";
import { feedbackLink } from "@/lib/feedback-server";
import { getNotifications } from "@/lib/notifications";
import { kpiLinks } from "@/lib/rail-kpis";
import { tabsFor } from "@/components/dashboard/tabs";

/** The service advisor: his branch's dashboard (read only), Complaints, VOR Part Query, Open WIPs and Courtesy Cars. The reception team of
 * the customer queue uses the same pages (and Query) - see lib/reception. */
const LINKS = [
  { href: "/advisor/dashboard", label: "Dashboard" },
  { href: "/advisor/msi", label: "Major Service Indicators" },
  { href: "/advisor/complaints", label: "Complaints" },
  { href: "/advisor/vor-parts", label: "VOR Part Query" },
  { href: "/advisor/open-wips", label: "Open WIPs" },
  { href: "/advisor/courtesy-cars", label: "Courtesy Cars" },
];

export default async function AdvisorLayout({ children }: { children: ReactNode }) {
  const user = await requireAdvisorArea();
  const [feedback, notifications] = await Promise.all([feedbackLink(user.id, "/advisor/feedback"), getNotifications(user)]);
  // The reception team (customer queue): the same pages without the branch dashboard, plus Query.
  const links = isReception(user) ? [...LINKS.filter((l) => l.href !== "/advisor/dashboard"), { href: "/advisor/query", label: "Query" }] : LINKS;
  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} notifications={notifications} links={[...links, feedback]} kpis={isReception(user) ? [] : kpiLinks({ base: "/advisor/dashboard", tabs: tabsFor(false, false), extra: [{ href: "/advisor/msi", label: "Major Service Indicators", dept: "service" }] })} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
