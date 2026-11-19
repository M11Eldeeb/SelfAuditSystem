"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { checkExistingTicket, joinQueue, knownCustomerName, lookupAppointment, rejoinHeldTicket, type AppointmentInfo } from "@/app/actions/queue-public";
import { MODE_LABEL, WIP_LABEL, saudiDate, type ServiceMode, type WipServiceType } from "@/lib/queue/core";
import { PublicShell, Spinner } from "./public-shell";
import { useQueueLang } from "./alerts";
import { QIcon, type QIconName } from "./icons";
import { receivingText, type Receiving } from "@/lib/queue/hours";

const WIPS: { value: WipServiceType; icon: QIconName }[] = [
  { value: "quick_service", icon: "quick" },
  { value: "general_repair", icon: "repair" },
  { value: "vehicle_delivery", icon: "car" },
];
const MODES: { value: ServiceMode; icon: QIconName }[] = [
  { value: "walk_in", icon: "walkin" },
  { value: "appointment", icon: "calendar" },
  { value: "inquiry", icon: "question" },
  { value: "spare_parts", icon: "parts" },
];

type Step = "mobile" | "name" | "service" | "review" | "edit";

const field = "h-14 w-full rounded-2xl bg-white px-4 text-lg text-neutral-900 outline-none ring-1 ring-black/10 focus:ring-2 focus:ring-brand";
const primary = "flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-4 text-lg font-semibold text-white shadow-[0_8px_24px_-8px_rgba(196,18,26,0.55)] transition active:scale-[0.99] disabled:bg-neutral-300 disabled:shadow-none";
// The step's buttons: a bar kept at the bottom of the screen (no scrolling to reach Continue / Join / Back).
const actions = "sticky bottom-0 z-10 -mx-5 mt-auto space-y-2 border-t border-black/5 bg-neutral-100/95 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur";
const secondary = "w-full rounded-2xl bg-white py-3.5 text-base font-semibold text-neutral-800 ring-1 ring-black/10 transition active:scale-[0.99]";

/** Quick Service and General Repair can go together; vehicle delivery is on its own. */
function toggleService(list: WipServiceType[], s: WipServiceType): WipServiceType[] {
  if (s === "vehicle_delivery") return list.includes(s) ? [] : [s];
  const rest = list.filter((x) => x !== "vehicle_delivery");
  return rest.includes(s) ? rest.filter((x) => x !== s) : [...rest, s];
}

/**
 * Joining the queue at the branch, made for a phone or a kiosk: the mobile first (9 digits, 5XXXXXXXX). A known
 * customer (appointment today, an appointment another day, or a ticket before) goes straight to the details to
 * confirm - Join, or Edit to change the name / service or add a note (the advisor sees what was changed or added).
 * A new customer answers the name and the service, one per screen.
 */
export function JoinForm({ branch, receiving }: { branch: { id: string; name: string; name_ar: string | null; status: "open" | "paused" | "closed" }; receiving: Receiving }) {
  const router = useRouter();
  const { lang, toggle, t, dir } = useQueueLang();
  const [step, setStep] = useState<Step>("mobile");
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<ServiceMode | null>(null);
  const [services, setServices] = useState<WipServiceType[]>([]);
  const [note, setNote] = useState("");
  const [wipNumber, setWipNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ type: "active" | "held"; id: string; ticketNumber: string } | null>(null);
  const [appt, setAppt] = useState<AppointmentInfo | null>(null); // today's appointment
  const [sheet, setSheet] = useState<AppointmentInfo | null>(null); // what the sheet said (today or another day)
  const [askWip, setAskWip] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const branchName = lang === "ar" && branch.name_ar ? branch.name_ar : branch.name;
  // Closed now: look again every minute, so the page opens by itself when receiving starts.
  useEffect(() => {
    if (receiving.open) return;
    const id = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(id);
  }, [receiving.open, router]);
  const validMobile = /^5\d{8}$/.test(mobile);
  const needsWip = mode === "appointment" || mode === "walk_in";
  const locale = lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB";
  const day = (d: string) => new Date(`${d}T12:00:00+03:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Riyadh" });
  const clock = (hm: string | null) => (hm ? new Date(`2000-01-01T${hm}:00`).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) : null);
  const label = (pair: [string, string]) => t(pair[0], pair[1]);
  const servicesText = (list: WipServiceType[]) => list.map((s) => label(WIP_LABEL[s])).join(" + ");
  const otherDayNotice = (a: AppointmentInfo) =>
    t(
      `Your appointment is on ${day(a.date)}${a.time ? ` at ${clock(a.time)}` : ""}. Today you will be served as a walk-in.`,
      `موعدك يوم ${day(a.date)}${a.time ? ` الساعة ${clock(a.time)}` : ""}. سيتم خدمتك اليوم بدون موعد.`
    );

  if (branch.status !== "open" || !receiving.open) {
    return (
      <PublicShell title={branchName} subtitle={t("After-Sales Service Center", "مركز خدمة ما بعد البيع")} lang={lang} dir={dir} onToggle={toggle}>
        <div className="m-5 flex flex-col items-center gap-3 rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-700">
            <QIcon name="info" className="h-7 w-7" />
          </span>
          <p className="text-lg font-semibold text-neutral-900">
            {branch.status !== "open" ? t("The queue is not taking new customers right now.", "الطابور لا يستقبل عملاء جدد حالياً.") : receivingText(receiving, lang)}
          </p>
          <p className="text-neutral-600">{t("Please ask at the reception desk.", "يرجى السؤال في الاستقبال.")}</p>
          <Link href="/q/find" className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-700">
            <QIcon name="ticket" className="h-4 w-4 text-brand" />
            {t("Already have a ticket?", "لديك تذكرة؟")} <span className="text-brand underline underline-offset-2">{t("Find it", "ابحث عنها")}</span>
          </Link>
        </div>
      </PublicShell>
    );
  }

  /** Back to the first screen with everything cleared (another mobile number). */
  function restart() {
    setMobile("");
    setName("");
    setMode(null);
    setServices([]);
    setNote("");
    setWipNumber("");
    setAppt(null);
    setSheet(null);
    setAskWip(false);
    setNotice(null);
    setError(null);
    setStep("mobile");
  }

  /** Fills in what the sheet says and goes to the last step. */
  function fromSheet(a: AppointmentInfo, today: boolean) {
    setSheet(a);
    if (a.name) setName((n) => n || a.name!);
    setServices(a.services);
    if (today) {
      setAppt(a);
      setMode("appointment");
      setNotice(null);
    } else {
      setAppt(null);
      setMode("walk_in");
      setNotice(otherDayNotice(a));
    }
    setStep(a.name ? "review" : "name");
  }

  async function afterMobile() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const [found, match, known] = await Promise.all([checkExistingTicket(branch.id, mobile), lookupAppointment(branch.id, mobile), knownCustomerName(mobile)]);
    setBusy(false);
    if (known) setName((n) => n || known);
    if (match.status !== "none") setSheet(match);
    if (found) {
      setExisting(found);
      return;
    }
    proceed(match, known);
  }

  function proceed(match: Awaited<ReturnType<typeof lookupAppointment>>, known: string | null) {
    if (match.status === "today") return fromSheet(match, true);
    if (match.status === "other_day") return fromSheet(match, false);
    setStep(known ? "service" : "name");
  }

  async function findByWip() {
    setBusy(true);
    const m = await lookupAppointment(branch.id, mobile, wipNumber);
    setBusy(false);
    setAskWip(false);
    if (m.status === "today") return fromSheet(m, true);
    setMode("walk_in");
    if (m.status === "other_day") {
      setSheet(m);
      setServices(m.services);
      setNotice(otherDayNotice(m));
    } else setNotice(t("We could not find an appointment for this mobile or WIP number. You will be served as a walk-in.", "لم نجد موعداً بهذا الجوال أو رقم WIP. سيتم خدمتك بدون موعد."));
  }

  async function submit() {
    if (!mode) return;
    setBusy(true);
    setError(null);
    const r = await joinQueue({ branchId: branch.id, name, mobile, mode, services: needsWip ? services : [], wipNumber: appt?.wip ?? wipNumber, note });
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

  const choice = (on: boolean) =>
    `rounded-2xl bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 transition active:scale-[0.99] ${on ? "ring-2 ring-brand" : "ring-black/[0.08]"}`;
  const back = (to: Step) => (
    <button type="button" onClick={() => setStep(to)} className="w-full py-1 text-sm font-semibold text-neutral-500">
      {lang === "ar" ? "→" : "←"} {t("Back", "رجوع")}
    </button>
  );
  const steps: Step[] = sheet && sheet.name ? ["mobile", "review"] : ["mobile", "name", "service", "review"];
  const dot = step === "edit" ? "review" : step;

  const serviceButtons = (
    <div className="flex flex-col gap-2.5">
      <span className="font-semibold text-neutral-700">{t("What do you need? (one or more)", "ما الخدمة المطلوبة؟ (واحدة أو أكثر)")}</span>
      {WIPS.map((w) => {
        const on = services.includes(w.value);
        return (
          <button key={w.value} type="button" onClick={() => setServices((l) => toggleService(l, w.value))} className={`${choice(on)} flex min-h-16 items-center gap-3 px-3 py-2.5 text-start text-base font-medium`}>
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${on ? "bg-brand text-white" : "bg-neutral-100 text-neutral-700"}`}>
              <QIcon name={w.icon} className="h-5 w-5" />
            </span>
            <span className="flex-1">{label(WIP_LABEL[w.value])}</span>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-brand bg-brand text-white" : "border-black/15"}`}>{on && <QIcon name="check" className="h-3.5 w-3.5" />}</span>
          </button>
        );
      })}
    </div>
  );

  const modeButtons = (allowAppointment: boolean) => (
    <div className="grid grid-cols-2 gap-3">
      {MODES.filter((m) => allowAppointment || m.value !== "appointment").map((m) => (
        <button
          key={m.value}
          type="button"
          onClick={() => {
            setNotice(null);
            setMode(m.value);
            if (m.value === "inquiry" || m.value === "spare_parts") setServices([]);
            setAskWip(m.value === "appointment");
          }}
          className={`${choice(mode === m.value)} flex flex-col items-start gap-3 p-4 text-start`}
        >
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${mode === m.value ? "bg-brand text-white" : "bg-neutral-100 text-neutral-700"}`}>
            <QIcon name={m.icon} className="h-5 w-5" />
          </span>
          <span className="font-semibold">{label(MODE_LABEL[m.value])}</span>
        </button>
      ))}
    </div>
  );

  return (
    <PublicShell title={branchName} subtitle={t("After-Sales Service Center", "مركز خدمة ما بعد البيع")} lang={lang} dir={dir} onToggle={toggle}>
      <div className="flex items-center gap-2 px-5 pt-5">
        {steps.map((s) => (
          <span key={s} className={`h-2 rounded-full transition-all ${s === dot ? "w-8 bg-brand" : "w-2 bg-black/15"}`} />
        ))}
      </div>

      <form className="flex flex-1 flex-col gap-5 px-5 pt-5" onSubmit={(e) => e.preventDefault()}>
        {step === "mobile" && (
          <>
            <Title sub={t("We use it to find your appointment and tell you when it's your turn.", "نستخدمه لإيجاد موعدك وتنبيهك عند حلول دورك.")}>{t("Your mobile number", "رقم جوالك")}</Title>
            <div className="flex h-20 items-center rounded-2xl bg-white px-5 ring-1 ring-black/10 transition focus-within:ring-2 focus-within:ring-brand" dir="ltr">
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
            <p className={`-mt-2 text-sm ${mobile && !mobile.startsWith("5") ? "text-amber-700" : "text-neutral-500"}`}>
              {mobile && !mobile.startsWith("5") ? t("Saudi mobiles start with 5.", "أرقام الجوال السعودية تبدأ بـ 5.") : t(`${mobile.length} of 9 digits`, `${mobile.length} من 9 أرقام`)}
            </p>
            <p className="rounded-2xl bg-white/70 p-3 text-xs leading-relaxed text-neutral-500 ring-1 ring-black/5">
              {t(
                "By continuing, you agree that your name, mobile number and visit details are used by MG and its service partners and systems to manage your visit and send you queue notifications.",
                "بالمتابعة، أنت توافق على استخدام اسمك ورقم جوالك وبيانات زيارتك من قبل إم جي وشركائها ومزوّدي الأنظمة لإدارة زيارتك وإرسال تنبيهات الدور."
              )}
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className={actions}>
              <button type="button" disabled={!validMobile || busy} onClick={afterMobile} className={primary}>
                {busy && <Spinner />} {t("Continue", "متابعة")}
              </button>
              <Link href="/q/find" className="mx-auto flex w-fit items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-black/5">
                <QIcon name="ticket" className="h-4 w-4 text-brand" />
                {t("Already have a ticket?", "لديك تذكرة؟")} <span className="text-brand underline underline-offset-2">{t("Find it", "ابحث عنها")}</span>
              </Link>
            </div>
          </>
        )}

        {step === "name" && (
          <>
            <Title>{t("Your name", "اسمك")}</Title>
            {notice && <Notice text={notice} />}
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep(sheet ? "review" : "service")} autoComplete="name" autoFocus maxLength={80} className={field} />
            <div className={actions}>
              <button type="button" disabled={!name.trim()} onClick={() => setStep(sheet ? "review" : "service")} className={primary}>
                {t("Continue", "متابعة")}
              </button>
              <button type="button" onClick={restart} className="w-full py-1 text-sm font-semibold text-neutral-500">
                {lang === "ar" ? "→" : "←"} {t("Change mobile number", "تغيير رقم الجوال")}
              </button>
            </div>
          </>
        )}

        {step === "service" && (
          <>
            <Title>{t("How can we help?", "كيف نخدمك؟")}</Title>
            {notice && <Notice text={notice} />}
            {modeButtons(true)}
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
            {needsWip && !askWip && serviceButtons}
            <div className={actions}>
              <button type="button" disabled={!mode || (needsWip && !services.length) || (mode === "appointment" && askWip)} onClick={() => setStep("review")} className={primary}>
                {t("Continue", "متابعة")}
              </button>
              {back("name")}
            </div>
          </>
        )}

        {step === "review" && mode && (
          <>
            <Title>{name ? t(`Welcome, ${name}`, `أهلاً ${name}`) : t("All correct?", "هل البيانات صحيحة؟")}</Title>
            {notice && <Notice text={notice} />}
            <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
              {appt && (
                <div className="bg-emerald-600 px-5 py-3.5 text-white">
                  <p className="text-sm font-medium opacity-90">✓ {t("Your appointment today", "موعدك اليوم")}</p>
                  <p className="text-3xl font-bold">{clock(appt.time) ?? day(appt.date)}</p>
                </div>
              )}
              <dl className="divide-y divide-black/5 px-5">
                <Line label={t("Name", "الاسم")} value={name.trim()} />
                <Line label={t("Mobile", "الجوال")} value={`+966 ${mobile}`} ltr />
                {sheet && (sheet.model || sheet.vinTail) && <Line label={t("Vehicle", "المركبة")} value={`${sheet.model ?? "MG"}${sheet.vinTail ? ` · …${sheet.vinTail}` : ""}`} ltr />}
                <Line label={t("Visit", "الزيارة")} value={label(MODE_LABEL[mode])} />
                {needsWip && services.length > 0 && <Line label={t("Service", "الخدمة")} value={servicesText(services)} />}
                {appt && /^\d/.test(appt.wip) && <Line label={t("WIP number", "رقم WIP")} value={appt.wip} ltr />}
                {note.trim() && <Line label={t("Your note", "ملاحظتك")} value={note.trim()} />}
              </dl>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className={actions}>
              <button type="button" disabled={busy || !name.trim() || (needsWip && !services.length)} onClick={submit} className={primary}>
                {busy && <Spinner />} {busy ? t("Joining…", "جارِ الانضمام…") : t("Confirm and join", "تأكيد والانضمام")}
              </button>
              <button type="button" onClick={() => setStep("edit")} className={secondary}>
                <span className="inline-flex items-center justify-center gap-2">
                  <QIcon name="edit" className="h-4 w-4" /> {t("Edit or add a note", "تعديل أو إضافة ملاحظة")}
                </span>
              </button>
              <button type="button" onClick={restart} className="w-full py-1 text-sm font-semibold text-neutral-500">
                {lang === "ar" ? "→" : "←"} {t("Change mobile number", "تغيير رقم الجوال")}
              </button>
            </div>
          </>
        )}

        {step === "edit" && mode && (
          <>
            <Title sub={t("Your advisor will see what you change or add.", "سيرى المستشار ما تغيّره أو تضيفه.")}>{t("Edit", "تعديل")}</Title>
            <label className="block">
              <span className="mb-1 block font-semibold text-neutral-700">{t("Name", "الاسم")}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} className={field} />
            </label>
            {!appt && modeButtons(false)}
            {needsWip && serviceButtons}
            <label className="block">
              <span className="mb-1 block font-semibold text-neutral-700">{t("Anything to add for your advisor? (optional)", "هل تريد إضافة شيء للمستشار؟ (اختياري)")}</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                rows={3}
                placeholder={t("e.g. a noise from the front, also check the AC", "مثال: صوت من الأمام، فحص المكيف أيضاً")}
                className="w-full rounded-2xl bg-white p-4 text-base text-neutral-900 outline-none ring-1 ring-black/10 focus:ring-2 focus:ring-brand"
              />
            </label>
            {appt && (
              <button
                type="button"
                onClick={() => {
                  setAppt(null);
                  setMode("walk_in");
                  setNotice(null);
                }}
                className="text-start text-sm font-semibold text-neutral-500 underline"
              >
                {t("Not my car - continue without the appointment", "ليست سيارتي - المتابعة بدون الموعد")}
              </button>
            )}
            <div className={actions}>
              <button type="button" disabled={!name.trim() || (needsWip && !services.length)} onClick={() => setStep("review")} className={primary}>
                {t("Done", "تم")}
              </button>
            </div>
          </>
        )}
      </form>

      {existing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" role="dialog" aria-modal="true">
          <div className="flex w-full max-w-sm flex-col items-center gap-2 rounded-3xl bg-white p-6 text-center" dir={dir}>
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
              <QIcon name="ticket" className="h-7 w-7" />
            </span>
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
                  proceed(sheet ? { status: sheet.date === saudiDate(new Date().toISOString()) ? "today" : "other_day", ...sheet } : { status: "none" }, name || null);
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
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="shrink-0 text-neutral-500">{label}</dt>
      <dd className="text-end font-semibold text-neutral-900" dir={ltr ? "ltr" : undefined}>
        {value}
      </dd>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <p className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-amber-900 ring-1 ring-amber-200">
      <QIcon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
      <span>{text}</span>
    </p>
  );
}
