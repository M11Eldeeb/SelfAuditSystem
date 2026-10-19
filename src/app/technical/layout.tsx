import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { inquiriesBadge } from "@/lib/technical-inquiries-server";

export default async function TechnicalLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("technical");
  const badge = await inquiriesBadge(user);

  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} links={[{ href: "/technical/technical-inquiries", label: "Technical Inquiries & Verification Codes", badge }]} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
