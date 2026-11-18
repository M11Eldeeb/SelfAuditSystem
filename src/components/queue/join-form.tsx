"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { checkExistingTicket, joinQueue, lookupAppointment, rejoinHeldTicket, type AppointmentInfo } from "@/app/actions/queue-public";
import { MODE_LABEL, WIP_LABEL, type ServiceMode, type WipServiceType } from "@/lib/queue/core";
import { PublicShell, Spinner } from "./public-shell";
import { useQueueLang } from "./alerts";

const WIPS: { value: WipServiceType; icon: string }[] = [
  { value: "quick_service", icon: "⚡" },
  { value: "general_repair", icon: "🔧" },
  { value: "vehicle_delivery", icon: "🚗" },
];
const MODES: { value: ServiceMode; icon: string }[] = [
  { value: "walk_in", icon: "🎫" },
  { value: "appointment", icon: "📅" },
  { value: "inquiry", icon: "❓" },
  { value: "spare_parts", icon: "🧰" },
];

type Step = "mobile" | "confirm" | "name" | "service" | "review";

const field = "h-16 w-full rounded-2xl border-2 border-black/10 bg-white px-4 text-xl text-neutral-900 outline-none focus:border-brand";
const primary = "flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-5 text-lg font-bold text-white shadow-[0_6px_20px_rgba(196,18,26,0.25)] disabled:opacity-40";
const secondary = "w-full rounded-2xl border-2 border-black/10 bg-white py-4 text-base font-semibold text-neutral-800";

/**
 * Joining the queue at the branch, made for a phone or a kiosk: the mobile first (9 digits, 5XXXXXXXX). With an
 * appointment today in the DMS sheet the customer only confirms (name, time, vehicle, service) and joins; otherwise the
 * name and the service are asked. An appointment on another day is shown, and the customer joins as a walk-in.
 */
export function JoinForm({ branch }: { branch: { id: string; name: string; name_ar: string | null; status: "open" | "paused" | "closed" } }) {
  const router = useRouter();
  const { lang, toggle, t, dir } = useQueueLang();
  const [step, setStep] = useState<Step>("mobile");
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<ServiceMode | null>(null);
  const [wip, setWip] = useState<WipServiceType | null>(null);
  const [wipNumber, setWipNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ type: "active" | "held"; id: string; ticketNumber: string } | null>(null);
  const [appt, setAppt] = useState<AppointmentInfo | null>(null); // today's appointment
  const [askWip, setAskWip] = useState(false); // chose Appointment but none found by mobile
  const [notice, setNotice] = useState<string | null>(null); // another day / not found: joins as a walk-in

  const branchName = lang === "ar" && branch.name_ar ? branch.name_ar : branch.name;
  const validMobile = /^5\d{8}$/.test(mobile);
  const needsWip = mode === "appointment" || mode === "walk_in";
  const locale = lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB";
  const day = (d: string) => new Date(`${d}T12:00:00+03:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Riyadh" });
  const clock = (hm: string | null) => (hm ? new Date(`2000-01-01T${hm}:00`).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) : null);
  const label = (pair: [string, string]) => t(pair[0], pair[1]);
  const otherDayNotice = (a: AppointmentInfo) =>
    t(
      `Your appointment is on ${day(a.date)}${a.time ? ` at ${clock(a.time)}` : ""}. Today you will be served as a walk-in.`,
      `موعدك يوم ${day(a.date)}${a.time ? ` الساعة ${clock(a.time)}` : ""}. سيتم خدمتك اليوم بدون موعد.`
    );

  if (branch.status !== "open") {
    return (
      <PublicShell title={branchName} subtitle={t("After-Sales Service Center", "مركز خدمة ما بعد البيع")} lang={lang} dir={dir} onToggle={toggle}>
        <div className="m-5 rounded-3xl bg-white p-8 text-center shadow-sm">
          <p className="text-4xl">⏸️</p>
          <p className="mt-3 text-lg font-semibold text-neutral-900">{t("The queue is not taking new customers right now.", "الطابور لا يستقبل عملاء جدد حالياً.")}</p>
          <p className="mt-1 text-neutral-500">{t("Please ask at the reception desk.", "يرجى السؤال في الاستقبال.")}</p>
        </div>
      </PublicShell>
    );
  }

  function toConfirm(a: AppointmentInfo) {
    setAppt(a);
    setMode("appointment");
    setWip(a.service);
    if (a.name && !name) setName(a.name);
    setStep("confirm");
  }

  /** After the mobile: an active / held ticket? an appointment today? */
  async function afterMobile() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const [found, match] = await Promise.all([checkExistingTicket(branch.id, mobile), lookupAppointment(branch.id, mobile)]);
    setBusy(false);
    if (match.status !== "none" && match.name && !name) setName(match.name);
    if (found) {
      setExisting(found);
      if (match.status === "today") setAppt(match);
      return;
    }
    if (match.status === "today") return toConfirm(match);
    if (match.status === "other_day") setNotice(otherDayNotice(match));
    setStep("name");
  }

  async function findByWip() {
    setBusy(true);
    const m = await lookupAppointment(branch.id, mobile, wipNumber);
    setBusy(false);
    setAskWip(false);
    if (m.status === "today") return toConfirm(m);
    setMode("walk_in");
    setNotice(m.status === "other_day" ? otherDayNotice(m) : t("We could not find an appointment for this mobile or WIP number. You will be served as a walk-in.", "لم نجد موعداً بهذا الجوال أو رقم WIP. سيتم خدمتك بدون موعد."));
  }

  async function submit() {
    if (!mode) return;
    setBusy(true);
    setError(null);
    const r = await joinQueue({ branchId: branch.id, name, mobile, mode, wip, wipNumber: appt?.wip ?? wipNumber });
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

  const choice = (on: boolean) => `rounded-2xl border-2 bg-white text-neutral-900 transition-colors ${on ? "border-brand bg-brand/5" : "border-black/10"}`;
  const steps: Step[] = appt ? ["mobile", "confirm"] : ["mobile", "name", "service", "review"];
  const back = (to: Step) => (
    <button type="button" onClick={() => setStep(to)} className="w-full py-1 text-sm font-semibold text-neutral-500">
      {lang === "ar" ? "→" : "←"} {t("Back", "رجوع")}
    </button>
  );

  return (
    <PublicShell title={branchName} subtitle={t("After-Sales Service Center", "مركز خدمة ما بعد البيع")} lang={lang} dir={dir} onToggle={toggle}>
      <div className="flex items-center gap-2 px-5 pt-5">
        {steps.map((s) => (
          <span key={s} className={`h-2 rounded-full transition-all ${s === step ? "w-8 bg-brand" : "w-2 bg-black/15"}`} />
        ))}
      </div>

      <form className="flex flex-1 flex-col gap-6 p-5" onSubmit={(e) => e.preventDefault()}>
        {step === "mobile" && (
          <>
            <Title sub={t("We use it to find your appointment and tell you when it's your turn.", "نستخدمه لإيجاد موعدك وتنبيهك عند حلول دورك.")}>{t("Your mobile number", "رقم جوالك")}</Title>
            <div className="flex h-20 items-center rounded-2xl border-2 border-black/10 bg-white px-5 focus-within:border-brand" dir="ltr">
              <span className="text-xl text-neutral-500">+966</span>
              <span className="mx-4 h-8 w-px bg-black/10" />
              <input
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9))}
                onKeyDown={(e) => e.key === "Enter" && validMobile && !busy && afterMobile()}
                inputMode="numeric"
                autoComplete="tel-national"
                autoFocus
                placeholder="5XXXXXXXX"
                aria-label={t("Mobile number, 9 digits", "رقم الجوال، 9 أرقام")}
                className="min-w-0 flex-1 bg-transparent text-3xl font-semibold tracking-[0.15em] text-neutral-900 outline-none placeholder:text-neutral-300"
              />
            </div>
            <p className={`-mt-3 text-sm ${mobile && !mobile.startsWith("5") ? "text-amber-700" : "text-neutral-400"}`}>
              {mobile && !mobile.startsWith("5") ? t("Saudi mobiles start with 5.", "أرقام الجوال السعودية تبدأ بـ 5.") : t(`${mobile.length} of 9 digits`, `${mobile.length} من 9 أرقام`)}
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="mt-auto space-y-3">
              <button type="button" disabled={!validMobile || busy} onClick={afterMobile} className={primary}>
                {busy && <Spinner />} {t("Continue", "متابعة")}
              </button>
              <Link href="/q/find" className="block py-1 text-center text-sm font-medium text-brand">
                {t("Already have a ticket? Find it", "لديك تذكرة؟ ابحث عنها")}
              </Link>
            </div>
          </>
        )}

        {step === "confirm" && appt && (
          <>
            <Title>{name ? t(`Welcome, ${name}`, `أهلاً ${name}`) : t("Welcome", "أهلاً بك")}</Title>
            <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
              <div className="bg-emerald-600 px-5 py-4 text-white">
                <p className="text-sm font-medium opacity-90">✓ {t("Your appointment today", "موعدك اليوم")}</p>
                <p className="text-3xl font-bold">{clock(appt.time) ?? day(appt.date)}</p>
              </div>
              <dl className="divide-y divide-black/5 px-5">
                <Line label={t("Vehicle", "المركبة")} value={appt.model ?? t("Your MG", "سيارتك MG")} />
                {appt.vinTail && <Line label={t("Chassis (VIN) ends with", "رقم الهيكل ينتهي بـ")} value={`…${appt.vinTail}`} ltr />}
                <Line label={t("Service", "الخدمة")} value={label(WIP_LABEL[wip ?? appt.service])} />
                {appt.description && <Line label={t("Booked for", "سبب الموعد")} value={appt.description} />}
                <Line label={t("WIP number", "رقم WIP")} value={appt.wip} ltr />
                <Line label={t("Mobile", "الجوال")} value={`+966 ${mobile}`} ltr />
              </dl>
            </div>
            <p className="-mt-2 text-center text-sm text-neutral-500">{t("Is this your car? Tap Join and you're in the line.", "هل هذه سيارتك؟ اضغط انضم وستكون في الطابور.")}</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="mt-auto space-y-3">
              <button type="button" disabled={busy} onClick={submit} className={primary}>
                {busy && <Spinner />} {busy ? t("Joining…", "جارِ الانضمام…") : t("Join the queue", "انضم إلى الطابور")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAppt(null);
                  setMode("walk_in");
                  setStep("name");
                }}
                className={secondary}
              >
                {t("Not my car / change", "ليست سيارتي / تعديل")}
              </button>
            </div>
          </>
        )}

        {step === "name" && (
          <>
            <Title>{t("Your name", "اسمك")}</Title>
            {notice && <Notice text={notice} />}
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep("service")} autoComplete="name" autoFocus maxLength={80} className={field} />
            <div className="mt-auto space-y-3">
              <button type="button" disabled={!name.trim()} onClick={() => setStep("service")} className={primary}>
                {t("Continue", "متابعة")}
              </button>
              {back("mobile")}
            </div>
          </>
        )}

        {step === "service" && (
          <>
            <Title>{t("How can we help?", "كيف نخدمك؟")}</Title>
            {notice && <Notice text={notice} />}
            <div className="grid grid-cols-2 gap-3">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    setMode(m.value);
                    if (m.value === "inquiry" || m.value === "spare_parts") setWip(null);
                    setAskWip(m.value === "appointment");
                  }}
                  className={`${choice(mode === m.value)} flex flex-col items-center gap-2 p-5`}
                >
                  <span className="text-3xl">{m.icon}</span>
                  <span className="font-semibold">{label(MODE_LABEL[m.value])}</span>
                </button>
              ))}
            </div>
            {mode === "appointment" && askWip && (
              <div className="space-y-2 rounded-2xl bg-white p-4 ring-1 ring-black/5">
                <p className="text-sm text-neutral-600">{t("We could not find an appointment for your mobile. Type the WIP number of your appointment.", "لم نجد موعداً لجوالك. اكتب رقم WIP الخاص بموعدك.")}</p>
                <div className="flex gap-2">
                  <input value={wipNumber} onChange={(e) => setWipNumber(e.target.value.replace(/\D/g, "").slice(0, 12))} dir="ltr" inputMode="numeric" placeholder="WIP" className={field} />
                  <button type="button" disabled={!wipNumber || busy} onClick={findByWip} className="shrink-0 rounded-2xl bg-neutral-900 px-6 text-lg font-semibold text-white disabled:opacity-40">
                    {busy ? <Spinner /> : t("Find", "بحث")}
                  </button>
                </div>
              </div>
            )}
            {needsWip && !askWip && (
              <div className="flex flex-col gap-3">
                <span className="font-semibold text-neutral-700">{t("What do you need?", "ما الخدمة المطلوبة؟")}</span>
                {WIPS.map((w) => (
                  <button key={w.value} type="button" onClick={() => setWip(w.value)} className={`${choice(wip === w.value)} flex min-h-16 items-center gap-3 px-5 py-3 text-start text-lg`}>
                    <span className="text-2xl">{w.icon}</span>
                    <span>{label(WIP_LABEL[w.value])}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-auto space-y-3">
              <button type="button" disabled={!mode || (needsWip && !wip) || (mode === "appointment" && askWip)} onClick={() => setStep("review")} className={primary}>
                {t("Continue", "متابعة")}
              </button>
              {back("name")}
            </div>
          </>
        )}

        {step === "review" && mode && (
          <>
            <Title>{t("All correct?", "هل البيانات صحيحة؟")}</Title>
            <div className="rounded-3xl bg-white px-5 shadow-sm ring-1 ring-black/5">
              <dl className="divide-y divide-black/5">
                <Line label={t("Name", "الاسم")} value={name.trim()} />
                <Line label={t("Mobile", "الجوال")} value={`+966 ${mobile}`} ltr />
                <Line label={t("Visit", "الزيارة")} value={label(MODE_LABEL[mode])} />
                {wip && needsWip && <Line label={t("Service", "الخدمة")} value={label(WIP_LABEL[wip])} />}
              </dl>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="mt-auto space-y-3">
              <button type="button" disabled={busy} onClick={submit} className={primary}>
                {busy && <Spinner />} {busy ? t("Joining…", "جارِ الانضمام…") : t("Join the queue", "انضم إلى الطابور")}
              </button>
              {back("service")}
            </div>
          </>
        )}
      </form>

      {existing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" role="dialog" aria-modal="true">
          <div className="flex w-full max-w-sm flex-col items-center gap-2 rounded-3xl bg-white p-6 text-center" dir={dir}>
            <span className="text-4xl">{existing.type === "held" ? "👋" : "🎫"}</span>
            <p className="text-lg font-semibold text-neutral-900">
              {existing.type === "held" ? t("You have a ticket on hold", "لديك تذكرة معلّقة") : t("You already have a ticket", "لديك تذكرة بالفعل")}
            </p>
            <p className="text-sm text-neutral-500">
              {existing.type === "held"
                ? t(`Ticket ${existing.ticketNumber} was called earlier. Rejoin and you are seen before new arrivals.`, `تم استدعاء التذكرة ${existing.ticketNumber} سابقاً. أعد الانضمام وسيتم استقبالك قبل الوافدين الجدد.`)
                : t(`Ticket ${existing.ticketNumber} is already in the line for this number.`, `التذكرة ${existing.ticketNumber} موجودة بالفعل في الطابور لهذا الرقم.`)}
            </p>
            <div className="mt-3 flex w-full flex-col gap-2">
              <button type="button" disabled={busy} onClick={() => (existing.type === "held" ? rejoin(existing.id) : router.push(`/q/t/${existing.id}`))} className={primary}>
                {existing.type === "held" ? t("Rejoin the queue", "إعادة الانضمام للطابور") : t("Open my ticket", "عرض تذكرتي")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExisting(null);
                  if (appt) toConfirm(appt);
                  else setStep("name");
                }}
                className={secondary}
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

function Title({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-neutral-900">{children}</h1>
      {sub && <p className="mt-1 text-neutral-500">{sub}</p>}
    </div>
  );
}

function Line({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-end font-semibold text-neutral-900" dir={ltr ? "ltr" : undefined}>
        {value}
      </dd>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">ℹ️ {text}</p>;
}
