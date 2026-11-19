"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getTicketView, type TicketView } from "@/app/actions/queue-public";
import { MODE_LABEL, serviceText } from "@/lib/queue/core";
import { QIcon } from "./icons";
import { clockText } from "@/lib/queue/hours";
import { PublicShell } from "./public-shell";
import {
  announceTurn,
  enablePush,
  needsHomeScreen,
  resubscribeIfAllowed,
  showTurnNotification,
  unlockAudio,
  unlockSpeech,
  usePolling,
  useQueueLang,
  type PushStatus,
} from "./alerts";

const REPEAT_MS = 20000;
const MAX_REPEATS = 4;

/** The customer's ticket: place in line, and a full-screen alert (sound, voice, notification) when called. */
export function TicketTracker({ initial, vapidKey }: { initial: TicketView; vapidKey: string }) {
  const { lang, toggle, t, dir } = useQueueLang();
  const [view, setView] = useState(initial);
  const [soundOn, setSoundOn] = useState(false);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [alerting, setAlerting] = useState(false);
  // The call already alerted (served_at changes each time the ticket is called again). Opening the page while called
  // shows the alert once too.
  const announced = useRef<string | null>(null);
  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  const tk = view.ticket;

  const alertIfCalled = useCallback((v: TicketView) => {
    const x = v.ticket;
    if (x.status === "called" && x.served_at && announced.current !== x.served_at) {
      announced.current = x.served_at;
      setAlerting(true);
      void announceTurn(x.advisor_name);
      showTurnNotification(x.advisor_name, x.ticket_number ?? "", langRef.current);
    }
  }, []);

  const refresh = useCallback(async () => {
    const v = await getTicketView(initial.ticket.id);
    if (!v) return;
    setView(v);
    alertIfCalled(v);
  }, [initial.ticket.id, alertIfCalled]);
  const live = tk.status === "waiting" || tk.status === "called" || tk.status === "in_service" || tk.status === "held";
  usePolling(refresh, 4000, live);
  useEffect(() => {
    const first = setTimeout(() => alertIfCalled(initial), 0);
    return () => clearTimeout(first);
  }, [initial, alertIfCalled]);

  // While the alert is up: repeat every 20 s (4 times) and flash the tab title.
  const calledNow = tk.status === "called";
  useEffect(() => {
    if (!alerting || !calledNow) return;
    let n = 0;
    const rep = setInterval(() => {
      if (++n > MAX_REPEATS) return clearInterval(rep);
      void announceTurn(tk.advisor_name);
    }, REPEAT_MS);
    const title = document.title;
    let flip = false;
    const flash = setInterval(() => {
      flip = !flip;
      document.title = flip ? (lang === "ar" ? "🔔 حان دورك!" : "🔔 It's your turn!") : title;
    }, 1000);
    return () => {
      clearInterval(rep);
      clearInterval(flash);
      document.title = title;
    };
  }, [alerting, calledNow, tk.advisor_name, lang]);

  // A phone that already allowed alerts is linked to this ticket without asking.
  useEffect(() => {
    void resubscribeIfAllowed(initial.ticket.id, vapidKey).then((ok) => ok && setPush("on"));
  }, [initial.ticket.id, vapidKey]);

  // Any first tap unlocks the sound.
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      unlockSpeech();
    };
    document.addEventListener("touchstart", unlock, { once: true });
    document.addEventListener("click", unlock, { once: true });
    return () => {
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("click", unlock);
    };
  }, []);

  // Keeps the screen on while waiting (where the phone allows), so the alert comes on time.
  useEffect(() => {
    if (!soundOn || (tk.status !== "waiting" && tk.status !== "called")) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (k: "screen") => Promise<{ release: () => Promise<void> }> } };
    if (!nav.wakeLock) return;
    let lock: { release: () => Promise<void> } | null = null;
    let stop = false;
    const take = () =>
      nav.wakeLock!
        .request("screen")
        .then((l) => {
          if (stop) void l.release();
          else lock = l;
        })
        .catch(() => {});
    void take();
    const onVis = () => document.visibilityState === "visible" && void take();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop = true;
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => {});
    };
  }, [soundOn, tk.status]);

  async function turnOnAlerts() {
    unlockAudio();
    unlockSpeech();
    setSoundOn(true);
    try {
      navigator.vibrate?.(80);
    } catch {
      // ignore
    }
    if (!needsHomeScreen()) setPush(await enablePush(initial.ticket.id, vapidKey));
  }

  function ok() {
    setAlerting(false);
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // ignore
    }
  }

  const branchName = lang === "ar" && view.branch.name_ar ? view.branch.name_ar : view.branch.name;
  const called = tk.status === "called";
  const inService = tk.status === "in_service";
  const done = tk.status === "completed" || tk.status === "no_show" || tk.status === "cancelled";
  const held = tk.status === "held";
  const position = view.position;
  const progress = position != null ? Math.max(0, 1 - Math.min(position - 1, 8) / 8) : 1;
  const advisorLine = tk.advisor_name ? t(`${tk.advisor_name} is ready for you.`, `${tk.advisor_name} بانتظارك.`) : t("An advisor is ready for you.", "أحد المستشارين بانتظارك.");

  return (
    <PublicShell
      title={branchName}
      subtitle={
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t("Live", "مباشر")}
        </span>
      }
      lang={lang}
      dir={dir}
      onToggle={toggle}
    >
      {!soundOn && !done && (
        <button type="button" onClick={turnOnAlerts} className="w-full border-b border-brand/20 bg-brand/10 px-5 py-3 text-sm font-semibold text-brand">
          <span className="inline-flex items-center gap-2">
            <QIcon name="bell" className="h-4 w-4" /> {t("Tap to turn on sound and alerts for your turn", "اضغط لتفعيل الصوت والتنبيه عند حلول دورك")}
          </span>
        </button>
      )}
      {soundOn && !done && needsHomeScreen() && (
        <p className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-center text-xs text-amber-800">
          {t(
            "iPhone: keep this page open to hear your turn. For alerts with the phone locked, tap Share › Add to Home Screen, then open it from there.",
            "آيفون: أبقِ هذه الصفحة مفتوحة لسماع دورك. للتنبيه والهاتف مقفل: مشاركة › إضافة إلى الشاشة الرئيسية ثم افتحها من هناك."
          )}
        </p>
      )}
      {push && !done && (
        <p className={`border-b px-5 py-2 text-center text-xs ${push === "on" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-amber-100 bg-amber-50 text-amber-800"}`}>
          {push === "on"
            ? t("✓ Alerts are on - we'll notify you when it's your turn.", "✓ التنبيهات مفعّلة — سننبهك عند حلول دورك.")
            : push === "denied"
            ? t("Notifications are blocked on this phone. Keep this page open to hear your turn.", "الإشعارات محظورة على هذا الهاتف. أبقِ الصفحة مفتوحة لسماع دورك.")
            : t("Alerts could not be turned on here. Keep this page open to hear your turn.", "تعذر تفعيل التنبيهات هنا. أبقِ الصفحة مفتوحة لسماع دورك.")}
        </p>
      )}

      {alerting && called && (
        <div role="alertdialog" aria-live="assertive" dir={dir} className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-brand to-brand-dark p-8 text-center">
          <div className="animate-bounce text-6xl">🔔</div>
          <p className="text-sm uppercase tracking-widest text-white/80">{t("It's your turn", "حان دورك")}</p>
          <p className="text-6xl font-bold text-white">{tk.ticket_number}</p>
          <p className="text-2xl font-semibold text-white">{t("Please proceed now", "يرجى التوجه الآن")}</p>
          <p className="text-white/85">{advisorLine}</p>
          <button type="button" onClick={ok} className="mt-6 w-full max-w-xs rounded-full bg-white py-4 text-lg font-bold text-brand shadow-lg">
            {t("OK, I'm on my way", "حسناً، أنا قادم")}
          </button>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-6 p-5">
        {view.breakUntil && (tk.status === "waiting" || tk.status === "held") && (
          <p className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-amber-900 ring-1 ring-amber-200">
            <QIcon name="info" className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              {t(`It's break time. We start serving again at ${clockText(view.breakUntil, lang)} - your place in line is kept.`, `وقت الاستراحة الآن. نستأنف الخدمة الساعة ${clockText(view.breakUntil, lang)} - مكانك في الطابور محفوظ.`)}
            </span>
          </p>
        )}
        {/* The ticket: a paper ticket stub - the number on top, the tear line, then where the customer stands. */}
        <section className="relative overflow-hidden rounded-[28px] bg-white shadow-[0_18px_40px_-20px_rgba(0,0,0,0.35)] ring-1 ring-black/5">
          <div className="px-6 pb-6 pt-7 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">{t("Your ticket", "تذكرتك")}</p>
            <p className="mt-1 text-[64px] font-black leading-none tracking-tight text-neutral-900 tabular-nums" dir="ltr">
              {tk.ticket_number}
            </p>
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-700">
              {tk.service_mode === "appointment" && <QIcon name="calendar" className="h-4 w-4" />}
              {tk.service_mode === "appointment" ? `${t(MODE_LABEL.appointment[0], MODE_LABEL.appointment[1])} · ${serviceText(tk, lang)}` : serviceText(tk, lang)}
            </p>
          </div>
          <div className="relative" aria-hidden="true">
            <span className="absolute -start-3 -top-3 h-6 w-6 rounded-full bg-neutral-100" />
            <span className="absolute -end-3 -top-3 h-6 w-6 rounded-full bg-neutral-100" />
            <div className="mx-6 border-t-2 border-dashed border-neutral-200" />
          </div>
          <div className="px-6 pb-6 pt-5">
            {tk.status === "waiting" && position != null && (
              <div className="flex items-end justify-between gap-4">
                {position - 1 === 0 ? (
                  <div>
                    <p className="text-sm text-neutral-500">{t("Almost there", "اقترب دورك")}</p>
                    <p className="text-3xl font-bold leading-tight text-neutral-900">{t("You're next", "أنت التالي")}</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-neutral-500">{t("People ahead of you", "عملاء قبلك")}</p>
                    <p className="text-5xl font-bold leading-tight text-neutral-900 tabular-nums">{position - 1}</p>
                  </div>
                )}
                <div className="text-end">
                  <p className="text-sm text-neutral-500">{t("About", "حوالي")}</p>
                  <p className="text-2xl font-semibold text-neutral-900 tabular-nums">
                    {view.etaMinutes ?? ((position - 1) * 6 || 1)} <span className="text-base font-medium text-neutral-500">{t("min", "دقيقة")}</span>
                  </p>
                </div>
              </div>
            )}
            {tk.status === "waiting" && position != null && (
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full rounded-full bg-brand transition-[width] duration-1000" style={{ width: `${Math.max(6, progress * 100)}%` }} />
              </div>
            )}
            {called && (
              <div className="text-center">
                <p className="text-2xl font-bold text-brand">{t("Please proceed now", "يرجى التوجه الآن")}</p>
                <p className="mt-1 text-neutral-700">{advisorLine}</p>
              </div>
            )}
            {inService && <p className="text-center text-lg font-semibold text-neutral-900">{t("You're being served", "جاري خدمتك الآن")}</p>}
            {held && (
              <div className="text-center">
                <p className="text-lg font-semibold text-neutral-900">{t("Your ticket is on hold", "تذكرتك معلّقة")}</p>
                <p className="mt-1 text-sm text-neutral-600">
                  {t("When you are ready, open Find my ticket to rejoin ahead of new arrivals (within 24 hours).", "عندما تكون جاهزاً، افتح البحث عن تذكرتي لإعادة الانضمام قبل الوافدين الجدد (خلال 24 ساعة).")}
                </p>
              </div>
            )}
            {done && (
              <div className="flex flex-col items-center gap-2 text-center">
                <span className={`flex h-12 w-12 items-center justify-center rounded-full ${tk.status === "completed" ? "bg-emerald-50 text-emerald-600" : "bg-neutral-100 text-neutral-600"}`}>
                  <QIcon name={tk.status === "completed" ? "check" : "info"} className="h-6 w-6" />
                </span>
                <p className="text-lg font-semibold text-neutral-900">{tk.status === "completed" ? t("Service complete", "اكتملت الخدمة") : t("This ticket is closed", "هذه التذكرة مغلقة")}</p>
                <p className="text-sm text-neutral-600">{t("Thank you for visiting MG.", "شكراً لزيارتكم إم جي.")}</p>
              </div>
            )}
          </div>
        </section>

        <p className="mt-auto pt-4 text-center text-xs text-neutral-500">
          {t("Closed this page? Find it again with your mobile number:", "أغلقت الصفحة؟ ابحث عنها برقم جوالك:")}{" "}
          <Link href="/q/find" className="font-medium text-brand underline">
            {t("Find my ticket", "البحث عن تذكرتي")}
          </Link>
        </p>
      </div>
    </PublicShell>
  );
}
