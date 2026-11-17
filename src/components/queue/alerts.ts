"use client";

// Customer queue, in the browser: the call chime (made on the fly, no sound file), the spoken call in English and
// Arabic, the phone's own notification, and the push subscription for the "your turn" alert. Phones block sound until
// a tap, so unlockAudio() / unlockSpeech() run on the first tap.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { saveQueuePush } from "@/app/actions/queue-public";
import type { Lang } from "@/lib/queue/core";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const A = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!A) return null;
  ctx ??= new A();
  return ctx;
}

export function unlockAudio() {
  const a = audio();
  if (a?.state === "suspended") a.resume().catch(() => {});
}

export function unlockSpeech() {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance("");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    // ignore
  }
}

/** Three ding-dongs and a vibration. */
export function playChime() {
  try {
    const a = audio();
    if (a) {
      if (a.state === "suspended") a.resume().catch(() => {});
      const now = a.currentTime;
      for (let round = 0; round < 3; round++)
        [880, 1108.73].forEach((freq, i) => {
          const osc = a.createOscillator();
          const gain = a.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          const start = now + round * 0.6 + i * 0.22;
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.6, start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
          osc.connect(gain).connect(a.destination);
          osc.start(start);
          osc.stop(start + 0.45);
        });
    }
  } catch {
    // sound is a nice-to-have
  }
  try {
    navigator.vibrate?.([400, 150, 400, 150, 400]);
  } catch {
    // ignore
  }
}

/** Speaks one sentence; resolves when done (or after 12 s - some TV browsers never say they are done). */
export function speak(text: string, lang: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (!("speechSynthesis" in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 0.9;
      const timer = setTimeout(resolve, 12000);
      u.onend = u.onerror = () => {
        clearTimeout(timer);
        resolve();
      };
      window.speechSynthesis.speak(u);
    } catch {
      resolve();
    }
  });
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** On the customer's phone: chime, then "please proceed now" in English and Arabic. */
export async function announceTurn(advisor: string | null) {
  playChime();
  await wait(2200);
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // ignore
  }
  await speak(advisor ? `Please proceed now. ${advisor} is ready for you.` : "Please proceed now. We are ready for you.", "en-US");
  await speak(advisor ? `الرجاء التوجه الآن. ${advisor} بانتظارك.` : "الرجاء التوجه الآن. نحن بانتظارك.", "ar-SA");
}

export function showTurnNotification(advisor: string | null, ticketNumber: string, lang: Lang) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification(lang === "ar" ? "حان دورك!" : "It's your turn!", {
      body: lang === "ar" ? `الرجاء التوجه الآن${advisor ? ` — ${advisor} بانتظارك` : ""}. التذكرة ${ticketNumber}.` : `Please proceed now${advisor ? ` — ${advisor} is ready for you` : ""}. Ticket ${ticketNumber}.`,
      icon: "/app-icon-192.png",
      tag: "queue-call",
      requireInteraction: true,
    });
  } catch {
    // not available here
  }
}

// ---------- push ("your turn" while the page is closed) ----------

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const isIOS = () =>
  typeof navigator !== "undefined" && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
const isStandalone = () => (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
/** iPhone: web push only from a Home Screen app (iOS 16.4+), not a Safari tab. */
export const needsHomeScreen = () => isIOS() && !isStandalone();

export type PushStatus = "on" | "denied" | "unsupported" | "error";

function keyBytes(base64: string) {
  const b = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function subscribe(ticketId: string, publicKey: string): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker.register("/queue-sw.js");
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
    return (await saveQueuePush(ticketId, sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } })).ok;
  } catch {
    return false;
  }
}

/** Asks for permission (must run straight from a tap - iPhones refuse otherwise) and subscribes this phone to the ticket. */
export async function enablePush(ticketId: string, publicKey: string): Promise<PushStatus> {
  if (!publicKey || !pushSupported()) return "unsupported";
  let perm = Notification.permission;
  if (perm === "default") {
    try {
      perm = await Notification.requestPermission();
    } catch {
      return "error";
    }
  }
  if (perm !== "granted") return "denied";
  return (await subscribe(ticketId, publicKey)) ? "on" : "error";
}

/** Already allowed on this phone (a returning customer): linked to the new ticket without asking. */
export async function resubscribeIfAllowed(ticketId: string, publicKey: string) {
  if (!publicKey || !pushSupported() || Notification.permission !== "granted") return false;
  return subscribe(ticketId, publicKey);
}

// ---------- language ----------

const KEY = "mg_queue_lang";
const listeners = new Set<() => void>();
function readLang(): Lang {
  try {
    return localStorage.getItem(KEY) === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

/** English / Arabic for the queue pages, remembered on this device. */
export function useQueueLang() {
  const lang = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readLang,
    () => "en" as Lang
  );
  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem(KEY, l);
    } catch {
      // ignore
    }
    listeners.forEach((f) => f());
  }, []);
  const t = useCallback((en: string, ar: string) => (lang === "ar" ? ar : en), [lang]);
  return { lang, setLang, toggle: () => setLang(lang === "ar" ? "en" : "ar"), t, dir: lang === "ar" ? ("rtl" as const) : ("ltr" as const) };
}

/** Re-runs `fn` every `ms` and when the tab comes back to the front (phones pause background tabs). */
export function usePolling(fn: () => void, ms: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(fn, ms);
    const onVis = () => document.visibilityState === "visible" && fn();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fn, ms, enabled]);
}
