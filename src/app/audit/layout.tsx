import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { ViewOnlyBanner } from "@/components/view-only-banner";
import { MyAuditsTabs } from "./my-audits-tabs";
import { auditNav } from "@/lib/portal-nav";

/** The branch admin and the service manager: the menus are in lib/portal-nav (the customer queue shows the same menu). */
export default async function AuditLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("branch_admin");
  const nav = await auditNav(user);
  if (user.managerKind === "service_manager")
    return (
      <div className="app-shell-bg flex min-h-screen flex-col">
        <NavBar user={user} links={nav.links} notifications={nav.notifications} roleDetail={nav.roleDetail} kpis={nav.kpis} />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
      </div>
    );
  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} links={nav.links} notifications={nav.notifications} kpis={nav.kpis} />
      {user.viewOnly && <ViewOnlyBanner />}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <MyAuditsTabs />
        {children}
      </main>
    </div>
  );
}
