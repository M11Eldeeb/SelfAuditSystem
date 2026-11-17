"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { findTicketsByMobile, rejoinHeldTicket } from "@/app/actions/queue-public";
import { PublicShell, Spinner } from "./public-shell";
import { useQueueLang } from "./alerts";

type Found = Awaited<ReturnType<typeof findTicketsByMobile>>;

/** Finds the customer's ticket again by mobile; a held ticket (last 24 hours) can be put back in the queue. */
export function FindTicket() {
  const router = useRouter();
  const { lang, toggle, t, dir } = useQueueLang();
  const [mobile, setMobile] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setBusy("search");
    setError(null);
    const r = await findTicketsByMobile(mobile);
    setBusy(null);
    if (r.error) return setError(r.error);
    if (r.active.length === 1 && r.held.length === 0) return router.push(`/q/t/${r.active[0].id}`);
    setFound(r);
  }

  async function rejoin(id: string) {
    setBusy(id);
    const r = await rejoinHeldTicket(id);
    if (r.ok) router.push(`/q/t/${id}`);
    else {
      setBusy(null);
      setError(r.error ?? null);
    }
  }

  const branchName = (x: { branch: string; branch_ar: string | null }) => (lang === "ar" && x.branch_ar ? x.branch_ar : x.branch);

  return (
    <PublicShell title={t("Find my ticket", "البحث عن تذكرتي")} subtitle={t("MG Service Queue", "طابور خدمة MG")} lang={lang} dir={dir} onToggle={toggle}>
      <div className="flex flex-1 flex-col gap-5 p-5">
        <p className="text-sm text-neutral-600">{t("Enter the mobile number you joined with.", "أدخل رقم الجوال الذي سجّلت به.")}</p>
        <div className="flex h-14 items-center rounded-xl border border-black/10 bg-white px-4 focus-within:border-brand" dir="ltr">
          <span className="text-neutral-500">+966</span>
          <span className="mx-3 h-6 w-px bg-black/10" />
          <input
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
            onKeyDown={(e) => e.key === "Enter" && search()}
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="5X XXX XXXX"
            className="flex-1 bg-transparent text-base text-neutral-900 outline-none"
          />
        </div>
        <button type="button" onClick={search} disabled={!mobile || !!busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-4 font-bold text-white disabled:opacity-40">
          {busy === "search" && <Spinner />} {t("Find my ticket", "ابحث عن تذكرتي")}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {found && found.active.length === 0 && found.held.length === 0 && (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
            <p className="text-3xl">🔍</p>
            <p className="font-semibold text-neutral-900">{t("No ticket in the queue for this number", "لا توجد تذكرة في الطابور لهذا الرقم")}</p>
            <p className="mt-1 text-sm text-neutral-500">{t("To join, scan the QR code at the branch.", "للانضمام، امسح رمز QR في الفرع.")}</p>
          </div>
        )}
        {found?.held.map((h) => (
          <div key={h.id} className="flex flex-col items-center gap-2 rounded-2xl border-2 border-brand/20 bg-white p-5 text-center shadow-sm">
            <span className="text-3xl">👋</span>
            <p className="font-semibold text-neutral-900">{t("Welcome back!", "مرحباً بعودتك!")}</p>
            <p className="text-sm text-neutral-500">
              {t(`Ticket ${h.ticket_number} at ${branchName(h)} is on hold. Rejoin now, ahead of new arrivals.`, `التذكرة ${h.ticket_number} في ${branchName(h)} معلّقة. أعد الانضمام الآن قبل الوافدين الجدد.`)}
            </p>
            <button type="button" onClick={() => rejoin(h.id)} disabled={!!busy} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3.5 font-bold text-white disabled:opacity-50">
              {busy === h.id && <Spinner />} {t("Rejoin the queue", "إعادة الانضمام للطابور")}
            </button>
          </div>
        ))}
        {found && found.active.length > 0 && (found.active.length > 1 || found.held.length > 0) && (
          <div className="flex flex-col gap-2">
            {found.active.map((a) => (
              <button key={a.id} type="button" onClick={() => router.push(`/q/t/${a.id}`)} className="flex items-center justify-between rounded-2xl bg-white p-4 text-start shadow-sm">
                <span className="font-bold text-neutral-900">{a.ticket_number}</span>
                <span className="text-sm text-neutral-500">{branchName(a)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  );
}
