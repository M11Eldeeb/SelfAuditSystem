"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getTicketView, type TicketView } from "@/app/actions/queue-public";
import { MODE_LABEL, serviceText } from "@/lib/queue/core";
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
  const C = 2 * Math.PI * 70;
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
          🔔 {t("Tap to turn on sound and alerts for your turn", "اضغط لتفعيل الصوت والتنبيه عند حلول دورك")}
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
        <div className="flex items-center justify-between px-1">
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-500">{t("Ticket", "رقم التذكرة")}</p>
            <p className="text-3xl font-bold text-neutral-900">{tk.ticket_number}</p>
          </div>
          <div className="text-end">
            <p className="text-xs uppercase tracking-wide text-neutral-500">{t("Service", "الخدمة")}</p>
            <p className="font-medium text-neutral-900">{tk.service_mode === "appointment" ? t(MODE_LABEL.appointment[0], MODE_LABEL.appointment[1]) : serviceText(tk, lang)}</p>
          </div>
        </div>

        {!done && !held && (
          <section className="flex flex-col items-center py-4">
            <div className="relative h-56 w-56">
              <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
                <circle cx="80" cy="80" r="70" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="10" />
                <circle cx="80" cy="80" r="70" fill="none" stroke="var(--brand)" strokeWidth="10" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} style={{ transition: "stroke-dashoffset 1s ease" }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-5xl font-bold text-neutral-900">{called || inService ? "•" : position != null ? position - 1 : "—"}</span>
                <span className="mt-1 text-sm text-neutral-500">{called ? t("being called", "يتم استدعاؤك") : inService ? t("being served", "قيد الخدمة") : t("people ahead of you", "عملاء قبلك")}</span>
              </div>
            </div>
          </section>
        )}

        {called && (
          <div className="animate-pulse rounded-2xl bg-gradient-to-br from-brand to-brand-dark p-6 text-center">
            <p className="mb-2 text-xs uppercase tracking-widest text-white/80">{t("You're being called", "حان دورك الآن")}</p>
            <p className="mb-1 text-2xl font-bold text-white">{t("Please proceed now", "يرجى التوجه الآن")}</p>
            <p className="text-sm text-white/85">{advisorLine}</p>
          </div>
        )}
        {inService && <div className="rounded-2xl bg-white p-6 text-center font-semibold text-neutral-900 shadow-sm">{t("You're being served", "جاري خدمتك الآن")}</div>}
        {held && (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
            <p className="font-semibold text-neutral-900">{t("Your ticket is on hold", "تذكرتك معلّقة")}</p>
            <p className="mt-1 text-sm text-neutral-500">
              {t("When you are ready, open Find my ticket to rejoin ahead of new arrivals (within 24 hours).", "عندما تكون جاهزاً، افتح البحث عن تذكرتي لإعادة الانضمام قبل الوافدين الجدد (خلال 24 ساعة).")}
            </p>
          </div>
        )}
        {done && (
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-white p-8 text-center shadow-sm">
            <span className="text-3xl">{tk.status === "completed" ? "✅" : "ℹ️"}</span>
            <p className="font-semibold text-neutral-900">{tk.status === "completed" ? t("Service complete", "اكتملت الخدمة") : t("This ticket is closed", "هذه التذكرة مغلقة")}</p>
            <p className="text-sm text-neutral-500">{t("Thank you for visiting MG.", "شكراً لزيارتكم إم جي.")}</p>
          </div>
        )}
        {tk.status === "waiting" && position != null && (
          <div className="mx-auto flex items-center gap-3 rounded-full border border-black/5 bg-white px-5 py-3 shadow-sm">
            <span className="text-brand">⏱</span>
            <div>
              <p className="text-xs text-neutral-500">{t("Estimated wait", "الانتظار المتوقع")}</p>
              <p className="font-semibold text-neutral-900">
                ~{(position - 1) * 6 || 1} {t("minutes", "دقيقة")}
              </p>
            </div>
          </div>
        )}

        <p className="mt-auto pt-4 text-center text-xs text-neutral-400">
          {t("Closed this page? Find it again with your mobile number:", "أغلقت الصفحة؟ ابحث عنها برقم جوالك:")}{" "}
          <Link href="/q/find" className="font-medium text-brand underline">
            {t("Find my ticket", "البحث عن تذكرتي")}
          </Link>
        </p>
      </div>
    </PublicShell>
  );
}
