import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { ViewOnlyBanner } from "@/components/view-only-banner";
import { adminNav } from "@/lib/portal-nav";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("officer");
  // The menus of the officer, the manager and the national manager: lib/portal-nav (the customer queue shows the same menu).
  const nav = await adminNav(user);
  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} links={nav.links} notifications={nav.notifications} kpis={nav.kpis} />
      {user.viewOnly && !user.managerKind && <ViewOnlyBanner />}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
