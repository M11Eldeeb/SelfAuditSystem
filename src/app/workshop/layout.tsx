import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { inquiriesBadge } from "@/lib/technical-inquiries-server";

/** The workshop supervisor and the team leader: their only tab is Technical Inquiries. */
export default async function WorkshopLayout({ children }: { children: ReactNode }) {
  const user = await requireAnyRole(["workshop_supervisor", "team_leader"]);
  const badge = await inquiriesBadge(user);

  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} links={[{ href: "/workshop/technical-inquiries", label: "Technical Inquiries", badge }]} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
