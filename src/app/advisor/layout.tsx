import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";

/** The service advisor: his branch's dashboard (read only), Complaints, VOR Part Query, Open WIPs and Courtesy Cars. */
const LINKS = [
  { href: "/advisor/dashboard", label: "Dashboard" },
  { href: "/advisor/complaints", label: "Complaints" },
  { href: "/advisor/vor-parts", label: "VOR Part Query" },
  { href: "/advisor/open-wips", label: "Open WIPs" },
  { href: "/advisor/courtesy-cars", label: "Courtesy Cars" },
];

export default async function AdvisorLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("service_advisor");
  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} links={LINKS} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
