import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";

const ADMIN_LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/claims", label: "Claims" },
  { href: "/admin/cycles", label: "Audit Cycles" },
  { href: "/admin/review", label: "Review" },
  { href: "/admin/results", label: "Results" },
  { href: "/admin/branches", label: "Branches & Users" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("officer");

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <NavBar user={user} links={ADMIN_LINKS} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
