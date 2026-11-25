import { requireTechnician } from "@/lib/tech-claims/access";
import type { ReactNode } from "react";
import { homePathFor } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { getTechLang } from "@/lib/i18n/tech-server";
import { techT } from "@/lib/i18n/tech";
import { LangSwitch } from "@/components/tech-claims/lang-switch";
import { ClaimOutbox } from "@/components/tech-claims/claim-outbox";
import { getNotifications } from "@/lib/notifications";
import { feedbackLink } from "@/lib/feedback-server";

/** Technicians: submit warranty claims (VIN, work order, end of repair, evidence) and follow them - English or Arabic. */
export default async function TechnicianLayout({ children }: { children: ReactNode }) {
  const user = await requireTechnician();
  const [lang, notifications, feedback] = await Promise.all([getTechLang(), getNotifications(user), feedbackLink(user.id, "/technician/feedback")]);
  const t = techT(lang);
  return (
    <div className="app-shell-bg flex min-h-screen flex-col">
      <NavBar user={user} notifications={notifications} links={[{ href: "/technician", label: t.myClaims }, { href: "/technician/new", label: t.newClaim }, { href: "/technician/add-evidence", label: t.addEvidence }, feedback, ...(user.role !== "technician" ? [{ href: homePathFor(user.role), label: "Back to my portal", bottom: true }] : [])]} />
      <main dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 py-6">
        <div className="flex justify-end">
          <LangSwitch lang={lang} />
        </div>
        <ClaimOutbox lang={lang} who={user.full_name ?? user.email} />
        {children}
      </main>
    </div>
  );
}
