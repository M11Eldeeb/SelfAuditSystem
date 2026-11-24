import type { ReactNode } from "react";
import { homePathFor } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import type { NavLink } from "@/components/nav-menu";
import { requireQueueAccess, queueBranches } from "@/lib/queue/server";
import { isReception } from "@/lib/reception";
import { portalNavFor } from "@/lib/portal-nav";
import { QUEUE_GROUP } from "@/lib/rail";

/**
 * The customer queue's staff area (moved from the MG Queue app). Branch people see their branch's desks; head office
 * (warranty officers, national managers, managers, queue managers without a branch) see every branch.
 * People who also work in the portal keep their own portal menu here, with the queue's pages as one "Customer Queue" folder.
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
  links.push({ href: "/queue/appointments", label: "Appointments" });
  links.push({ href: "/queue/team", label: "Team" });
  if (a.admin) links.push({ href: "/queue/admin", label: "Queue admin" });

  // Inside the portal: the person's own menu and the queue as one folder.
  const portal = a.user.role === "queue_user" ? null : await portalNavFor(a.user);
  if (portal) {
    const queue = links.map((l) => ({ ...l, group: QUEUE_GROUP }));
    return (
      <div className="app-shell-bg flex min-h-screen flex-col">
        <NavBar
          user={a.user}
          links={[...portal.links.filter((l) => !l.bottom), ...queue, ...portal.links.filter((l) => l.bottom)]}
          notifications={portal.notifications}
          roleDetail={portal.roleDetail}
          kpis={portal.kpis}
          home={homePathFor(a.user.role)}
        />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
      </div>
    );
  }

  // The reception team (queue-only service advisors and reception managers) also use the service advisor's pages.
  if (isReception(a.user))
    links.push(
      { href: "/advisor/msi", label: "Major Service Indicators" },
      { href: "/advisor/complaints", label: "Complaints" },
      { href: "/advisor/open-wips", label: "Open WIPs" },
      { href: "/advisor/vor-parts", label: "VOR Part Query" },
      { href: "/advisor/courtesy-cars", label: "Courtesy Cars" },
      { href: "/advisor/query", label: "Query" }
    );
  if (a.user.role !== "queue_user") links.push({ href: homePathFor(a.user.role), label: "Back to portal", bottom: true });
  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={a.user} links={links} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
