import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";

const BRANCH_ADMIN_LINKS = [{ href: "/audit", label: "My Audits" }];

export default async function AuditLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("branch_admin");

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <NavBar user={user} links={BRANCH_ADMIN_LINKS} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
