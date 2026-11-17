"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { checkExistingTicket, joinQueue, rejoinHeldTicket } from "@/app/actions/queue-public";
import { MODE_LABEL, WIP_LABEL, type ServiceMode, type WipServiceType } from "@/lib/queue/core";
import { PublicShell, Spinner } from "./public-shell";
import { useQueueLang } from "./alerts";

const WIPS: { value: WipServiceType; icon: string }[] = [
  { value: "general_repair", icon: "🔧" },
  { value: "quick_service", icon: "⚡" },
  { value: "vehicle_delivery", icon: "🚗" },
];
const MODES: { value: ServiceMode; icon: string }[] = [
  { value: "appointment", icon: "📅" },
  { value: "walk_in", icon: "🎫" },
  { value: "inquiry", icon: "❓" },
  { value: "spare_parts", icon: "🧰" },
];

const field = "h-14 w-full rounded-xl border border-black/10 bg-white px-4 text-base text-neutral-900 outline-none focus:border-brand";

/** Joining the queue at the branch: mobile and name, the service, a check, then the ticket page. */
export function JoinForm({ branch }: { branch: { id: string; name: string; name_ar: string | null; status: "open" | "paused" | "closed" } }) {
  const router = useRouter();
  const { lang, toggle, t, dir } = useQueueLang();
  const [step, setStep] = useState(1);
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<ServiceMode | null>(null);
  const [wip, setWip] = useState<WipServiceType | null>(null);
  const [wipNumber, setWipNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ type: "active" | "held"; id: string; ticketNumber: string } | null>(null);

  const branchName = lang === "ar" && branch.name_ar ? branch.name_ar : branch.name;
  const needsWip = mode === "appointment" || mode === "walk_in";
  const validMobile = /^0?5\d{8}$/.test(mobile);
  const step2Done = !!mode && (!needsWip || !!wip) && (mode !== "appointment" || !!wipNumber.trim());

  if (branch.status !== "open") {
    return (
      <PublicShell title={branchName} subtitle={t("After-Sales Service Center", "مركز خدمة ما بعد البيع")} lang={lang} dir={dir} onToggle={toggle}>
        <div className="m-5 rounded-2xl bg-white p-8 text-center shadow-sm">
          <p className="text-3xl">⏸️</p>
          <p className="mt-2 font-semibold text-neutral-900">{t("The queue is not taking new customers right now.", "الطابور لا يستقبل عملاء جدد حالياً.")}</p>
          <p className="mt-1 text-sm text-neutral-500">{t("Please ask at the reception desk.", "يرجى السؤال في الاستقبال.")}</p>
        </div>
      </PublicShell>
    );
  }

  async function next1() {
    setBusy(true);
    setError(null);
    const found = await checkExistingTicket(branch.id, mobile);
    setBusy(false);
    if (found) setExisting(found);
    else setStep(2);
  }

  async function submit() {
    if (!mode) return;
    setBusy(true);
    setError(null);
    const r = await joinQueue({ branchId: branch.id, name, mobile, mode, wip, wipNumber });
    if (r.id) router.push(`/q/t/${r.id}`);
    else {
      setBusy(false);
      setError(r.error ?? t("Something went wrong.", "حدث خطأ."));
    }
  }

  async function rejoin(id: string) {
    setBusy(true);
    const r = await rejoinHeldTicket(id);
    if (r.ok) router.push(`/q/t/${id}`);
    else {
      setBusy(false);
      setExisting(null);
      setError(r.error ?? null);
    }
  }

  const choice = (on: boolean) => `rounded-xl border bg-white text-neutral-900 transition-colors ${on ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-black/10"}`;

  return (
    <PublicShell title={branchName} subtitle={t("After-Sales Service Center", "مركز خدمة ما بعد البيع")} lang={lang} dir={dir} onToggle={toggle}>
      <div className="flex items-center gap-2 px-5 pt-5">
        {[1, 2, 3].map((n) => (
          <span key={n} className={`h-2 rounded-full transition-all ${n === step ? "w-6 bg-brand" : "w-2 bg-black/15"}`} />
        ))}
      </div>

      <form className="flex flex-1 flex-col gap-5 p-5" onSubmit={(e) => e.preventDefault()}>
        {step === 1 && (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">{t("Mobile number", "رقم الجوال")}</span>
              <div className="flex h-14 items-center rounded-xl border border-black/10 bg-white px-4 focus-within:border-brand" dir="ltr">
                <span className="text-neutral-500">+966</span>
                <span className="mx-3 h-6 w-px bg-black/10" />
                <input
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="5X XXX XXXX"
                  className="flex-1 bg-transparent text-base text-neutral-900 outline-none"
                />
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">{t("Your name", "الاسم")}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} className={field} />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="button"
              disabled={!validMobile || !name.trim() || busy}
              onClick={next1}
              className="mt-auto flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 py-4 font-bold text-white disabled:opacity-40"
            >
              {busy && <Spinner />} {t("Continue", "متابعة")}
            </button>
            <Link href="/q/find" className="py-1 text-center text-sm font-medium text-brand">
              {t("Already have a ticket? Find it", "لديك تذكرة؟ ابحث عنها")}
            </Link>
          </>
        )}

        {step === 2 && (
          <>
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t("Service", "نوع الخدمة")}</span>
            <div className="grid grid-cols-2 gap-3">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => {
                    setMode(m.value);
                    if (m.value === "inquiry" || m.value === "spare_parts") setWip(null);
                  }}
                  className={`${choice(mode === m.value)} flex flex-col items-center gap-2 p-4`}
                >
                  <span className="text-2xl">{m.icon}</span>
                  <span className="text-sm font-semibold">{t(MODE_LABEL[m.value][0], MODE_LABEL[m.value][1])}</span>
                </button>
              ))}
            </div>
            {needsWip && (
              <div className="flex flex-col gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t("What do you need?", "ما الخدمة المطلوبة؟")}</span>
                {WIPS.map((w) => (
                  <button key={w.value} type="button" onClick={() => setWip(w.value)} className={`${choice(wip === w.value)} flex min-h-14 items-center gap-3 px-4 py-3 text-start`}>
                    <span>{w.icon}</span>
                    <span>{t(WIP_LABEL[w.value][0], WIP_LABEL[w.value][1])}</span>
                  </button>
                ))}
              </div>
            )}
            {mode === "appointment" && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">{t("WIP number", "رقم WIP")}</span>
                <input value={wipNumber} onChange={(e) => setWipNumber(e.target.value.slice(0, 30))} dir="ltr" inputMode="numeric" className={field} />
              </label>
            )}
            <div className="mt-auto flex gap-3">
              <button type="button" onClick={() => setStep(1)} className="rounded-xl border border-black/15 bg-white px-5 py-4 font-semibold text-neutral-800">
                {t("Back", "رجوع")}
              </button>
              <button type="button" disabled={!step2Done} onClick={() => setStep(3)} className="flex-1 rounded-xl bg-neutral-900 py-4 font-bold text-white disabled:opacity-40">
                {t("Continue", "متابعة")}
              </button>
            </div>
          </>
        )}

        {step === 3 && mode && (
          <>
            <div className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t("Check your details", "مراجعة")}</p>
              <Row label={t("Name", "الاسم")} value={name.trim()} />
              <Row label={t("Mobile", "الجوال")} value={`+966 ${mobile.replace(/^0/, "")}`} ltr />
              <Row label={t("Service", "الخدمة")} value={t(MODE_LABEL[mode][0], MODE_LABEL[mode][1])} />
              {wip && <Row label={t("For", "الخدمة المطلوبة")} value={t(WIP_LABEL[wip][0], WIP_LABEL[wip][1])} />}
              {mode === "appointment" && <Row label={t("WIP number", "رقم WIP")} value={wipNumber} ltr />}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="mt-auto flex gap-3">
              <button type="button" onClick={() => setStep(2)} className="rounded-xl border border-black/15 bg-white px-5 py-4 font-semibold text-neutral-800">
                {t("Back", "رجوع")}
              </button>
              <button type="button" disabled={busy} onClick={submit} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-4 font-bold text-white disabled:opacity-40">
                {busy && <Spinner />} {busy ? t("Joining…", "جارِ الانضمام…") : t("Join the queue", "انضم إلى الطابور")}
              </button>
            </div>
          </>
        )}
      </form>

      {existing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" role="dialog" aria-modal="true">
          <div className="flex w-full max-w-sm flex-col items-center gap-2 rounded-2xl bg-white p-6 text-center" dir={dir}>
            <span className="text-3xl">{existing.type === "held" ? "👋" : "⚠️"}</span>
            <p className="font-semibold text-neutral-900">
              {existing.type === "held" ? t("You have a ticket on hold", "لديك تذكرة معلّقة") : t("You already have a ticket", "لديك تذكرة نشطة بالفعل")}
            </p>
            <p className="text-sm text-neutral-500">
              {existing.type === "held"
                ? t(
                    `Ticket ${existing.ticketNumber} was called earlier. Rejoin and you are seen before new arrivals - or make a new ticket for a different visit.`,
                    `تم استدعاء التذكرة ${existing.ticketNumber} سابقاً. أعد الانضمام وسيتم استقبالك قبل الوافدين الجدد — أو أنشئ تذكرة جديدة لزيارة مختلفة.`
                  )
                : t(
                    `Ticket ${existing.ticketNumber} is already in this queue for this number.`,
                    `التذكرة ${existing.ticketNumber} موجودة بالفعل في هذا الطابور لهذا الرقم.`
                  )}
            </p>
            <div className="mt-3 flex w-full flex-col gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => (existing.type === "held" ? rejoin(existing.id) : router.push(`/q/t/${existing.id}`))}
                className="w-full rounded-xl bg-brand py-3.5 font-bold text-white disabled:opacity-50"
              >
                {existing.type === "held" ? t("Rejoin the queue", "إعادة الانضمام للطابور") : t("Open my ticket", "عرض تذكرتي")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExisting(null);
                  setStep(2);
                }}
                className="w-full rounded-xl border border-black/15 py-3.5 font-semibold text-neutral-800"
              >
                {t("Make a new ticket", "إنشاء تذكرة جديدة")}
              </button>
            </div>
          </div>
        </div>
      )}
    </PublicShell>
  );
}

function Row({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="font-medium text-neutral-900" dir={ltr ? "ltr" : undefined}>
        {value}
      </span>
    </div>
  );
}
