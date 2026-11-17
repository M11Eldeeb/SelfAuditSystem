import type { ReactNode } from "react";
import { homePathFor } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import type { NavLink } from "@/components/nav-menu";
import { requireQueueAccess, queueBranches } from "@/lib/queue/server";

/**
 * The customer queue's staff area (moved from the MG Queue app). Branch people see their branch's desks; head office
 * (warranty officers, national managers, managers, queue managers without a branch) see every branch.
 */
export default async function QueueLayout({ children }: { children: ReactNode }) {
  const a = await requireQueueAccess();
  const links: NavLink[] = [];
  if (a.allBranches) {
    links.push({ href: "/queue", label: "Queue overview" });
  } else {
    const branch = (await queueBranches()).find((b) => b.id === a.branchId);
    if (branch) {
      const base = `/queue/${branch.queue_code}`;
      if (a.role !== "parts_advisor") links.push({ href: base, label: "Service desk" });
      if (a.role !== "advisor") links.push({ href: `${base}/parts`, label: "Spare parts desk" });
      links.push({ href: `${base}/analytics`, label: "Queue analytics" });
      if (a.role === "manager") {
        links.push({ href: `${base}/customers`, label: "Customers" });
        links.push({ href: `${base}/settings`, label: "Queue settings" });
        links.push({ href: `/q/display/${branch.queue_code}`, label: "TV display" });
      }
    }
  }
  links.push({ href: "/queue/team", label: "Team" });
  if (a.admin) links.push({ href: "/queue/admin", label: "Queue admin" });
  if (a.user.role !== "queue_user") links.push({ href: homePathFor(a.user.role), label: "Back to portal", bottom: true });
  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={a.user} links={links} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
