import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { getNotifications } from "@/lib/notifications";

const ADMIN_LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/cycles", label: "Self Audit" },
  { href: "/admin/internal-audit", label: "Internal Audit" },
  { href: "/admin/warranty-room", label: "Warranty Room" },
  { href: "/admin/part-returns", label: "Part Return" },
  { href: "/admin/results", label: "Results" },
  { href: "/admin/feedbacks", label: "Feedbacks" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("officer");
  const notifications = await getNotifications(user);

  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} links={ADMIN_LINKS} notifications={notifications} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
