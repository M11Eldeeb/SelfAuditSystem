import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";

const FINANCE_LINKS = [{ href: "/finance", label: "Outstanding Claims" }];

export default async function FinanceLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("finance");

  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} links={FINANCE_LINKS} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
