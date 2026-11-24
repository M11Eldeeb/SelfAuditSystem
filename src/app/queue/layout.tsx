import type { ReactNode } from "react";
import { homePathFor } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import type { NavLink } from "@/components/nav-menu";
import { requireQueueAccess, queueBranches } from "@/lib/queue/server";
import { portalNavFor, queueLinks } from "@/lib/portal-nav";

/**
 * The customer queue's staff area (moved from the MG Queue app). Branch people see their branch's desks; head office
 * (warranty officers, national managers, managers, queue managers without a branch) see every branch.
 * People who also work in the portal (and the reception team) keep their own portal menu here: the queue's pages are the
 * "Customer Queue" folder inside Service. Spare parts staff only have the queue's menu.
 */
export default async function QueueLayout({ children }: { children: ReactNode }) {
  const a = await requireQueueAccess();
  const portal = await portalNavFor(a.user);
  if (portal)
    return (
      <div className="app-shell-bg flex min-h-screen flex-col">
        <NavBar user={a.user} links={portal.links} notifications={portal.notifications} roleDetail={portal.roleDetail} kpis={portal.kpis} home={homePathFor(a.user.role)} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
      </div>
    );
  const links: NavLink[] = queueLinks(a, await queueBranches()).map((l) => ({ ...l, group: undefined }));
  // Someone with a portal area of their own that has no place for the queue (e.g. a technician with queue access).
  if (a.user.role !== "queue_user") links.push({ href: homePathFor(a.user.role), label: "Back to portal", bottom: true });
  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={a.user} links={links} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
