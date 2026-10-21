import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";

/** Technicians: submit warranty claims (VIN, work order, end of repair, photos / videos / PDF) and follow them. */
export default async function TechnicianLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("technician");
  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} links={[{ href: "/technician", label: "My claims" }, { href: "/technician/new", label: "Submit claim" }]} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
