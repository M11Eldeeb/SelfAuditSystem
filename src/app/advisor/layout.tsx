import type { ReactNode } from "react";
import { requireAdvisorArea } from "@/lib/reception";
import { NavBar } from "@/components/nav-bar";
import { advisorNav } from "@/lib/portal-nav";

/** The service advisor and the reception team of the customer queue: the menu is in lib/portal-nav. */
export default async function AdvisorLayout({ children }: { children: ReactNode }) {
  const user = await requireAdvisorArea();
  const nav = await advisorNav(user);
  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} notifications={nav.notifications} links={nav.links} kpis={nav.kpis} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
