import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { getTechLang } from "@/lib/i18n/tech-server";
import { techT } from "@/lib/i18n/tech";
import { LangSwitch } from "@/components/tech-claims/lang-switch";

/** Technicians: submit warranty claims (VIN, work order, end of repair, evidence) and follow them - English or Arabic. */
export default async function TechnicianLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("technician");
  const lang = await getTechLang();
  const t = techT(lang);
  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} links={[{ href: "/technician", label: t.myClaims }, { href: "/technician/new", label: t.newClaim }]} />
      <main dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 py-6">
        <div className="flex justify-end">
          <LangSwitch lang={lang} />
        </div>
        {children}
      </main>
    </div>
  );
}
