"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { getDisplayView, type DisplayCall } from "@/app/actions/queue-public";
import { playChime, speak, unlockAudio, unlockSpeech, usePolling, wait } from "./alerts";

const FLASH_MS = 9000;
const callKey = (c: DisplayCall) => `${c.id}:${c.served_at ?? ""}`;
/** "A-012" -> "A 0 1 2", so the voice reads each character. */
const spoken = (n: string | null) => String(n ?? "").replace(/[-_]/g, " ").split("").join(" ").replace(/\s+/g, " ").trim();

async function announce(c: DisplayCall) {
  playChime();
  await wait(2200);
  const n = spoken(c.ticket_number);
  await speak(c.advisor_name ? `Ticket ${n}, please go to ${c.advisor_name}.` : `Ticket ${n}, please go to the service desk.`, "en-US");
  await speak(c.advisor_name ? `التذكرة ${n}، الرجاء التوجه إلى ${c.advisor_name}.` : `التذكرة ${n}، الرجاء التوجه إلى مكتب الخدمة.`, "ar-SA");
}

/** The branch TV: the ticket being called (big), the latest calls and how many wait; each new call is chimed and spoken. */
export function TvDisplay({ branch }: { branch: { id: string; name: string; name_ar: string | null } }) {
  const [calls, setCalls] = useState<DisplayCall[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [flash, setFlash] = useState<DisplayCall | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [clock, setClock] = useState("");
  const seen = useRef<Set<string> | null>(null);
  const pending = useRef<DisplayCall[]>([]);
  const speaking = useRef(false);
  const soundRef = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async () => {
    if (speaking.current) return;
    speaking.current = true;
    while (pending.current.length) {
      const c = pending.current.shift()!;
      setFlash(c);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
      if (soundRef.current) {
        await announce(c);
        await wait(800);
      } else await wait(4000);
    }
    speaking.current = false;
  }, []);

  const load = useCallback(async () => {
    const v = await getDisplayView(branch.id);
    if (!v) return;
    setCalls(v.calls);
    setWaiting(v.waiting);
    if (seen.current === null) {
      seen.current = new Set(v.calls.map(callKey)); // first load: nothing announced
      return;
    }
    const fresh = v.calls.filter((c) => c.status === "called" && !seen.current!.has(callKey(c))).reverse();
    v.calls.forEach((c) => seen.current!.add(callKey(c)));
    if (fresh.length) {
      pending.current.push(...fresh);
      void run();
    }
  }, [branch.id, run]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [load]);
  usePolling(load, 3000);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }));
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, []);

  // Keeps the TV awake while the page is open (where supported).
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (k: "screen") => Promise<{ release: () => Promise<void> }> } };
    let lock: { release: () => Promise<void> } | null = null;
    const take = () => {
      if (nav.wakeLock && document.visibilityState === "visible")
        nav.wakeLock
          .request("screen")
          .then((l) => (lock = l))
          .catch(() => {});
    };
    take();
    document.addEventListener("visibilitychange", take);
    return () => {
      document.removeEventListener("visibilitychange", take);
      void lock?.release().catch(() => {});
    };
  }, []);

  function startSound() {
    unlockAudio();
    unlockSpeech();
    soundRef.current = true;
    setSoundOn(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  const current = calls.find((c) => c.status === "called") ?? calls[0] ?? null;
  const history = calls.filter((c) => c.id !== current?.id);

  return (
    <main dir="ltr" className="flex min-h-screen select-none flex-col overflow-hidden bg-[#0b0b0d] text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-[3vw] py-[2vh]">
        <div className="flex items-center gap-[1.5vw]">
          <Image src="/mg-logo.png" alt="MG" width={80} height={80} className="h-[7vh] w-[7vh] rounded-xl bg-white object-contain p-1" />
          <div>
            <div className="text-[2.6vh] font-bold">{branch.name}</div>
            {branch.name_ar && (
              <div className="text-[2.6vh] text-white/70" dir="rtl">
                {branch.name_ar}
              </div>
            )}
          </div>
        </div>
        <div className="text-[5vh] font-bold tabular-nums">{clock}</div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-[2vw] p-[3vw] lg:grid-cols-3">
        <section className="flex flex-col items-center justify-center rounded-3xl bg-brand p-[3vw] text-center lg:col-span-2">
          <div className="text-[3.5vh] font-semibold opacity-90">
            Now serving · <span dir="rtl">يتم الآن خدمة</span>
          </div>
          {current ? (
            <>
              <div className="my-[2vh] text-[22vh] font-black leading-none tabular-nums">{current.ticket_number}</div>
              <div className="text-[5vh] font-bold">{current.advisor_name ?? (current.parts ? "Parts counter" : "Service desk")}</div>
              <div className="mt-[1vh] text-[3vh] opacity-90" dir="rtl">
                {current.advisor_name ? `الرجاء التوجه إلى ${current.advisor_name}` : current.parts ? "الرجاء التوجه إلى قطع الغيار" : "الرجاء التوجه إلى مكتب الخدمة"}
              </div>
            </>
          ) : (
            <div className="my-[6vh] text-[5vh] font-semibold opacity-90">
              Welcome · <span dir="rtl">أهلاً بكم</span>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-[2vw]">
          <div className="flex-1 rounded-3xl border border-white/10 bg-white/5 p-[2vw]">
            <div className="mb-[1.5vh] text-[2.6vh] font-semibold text-white/70">
              Recent calls · <span dir="rtl">آخر الاستدعاءات</span>
            </div>
            {history.length === 0 ? (
              <div className="text-[2.6vh] text-white/40">—</div>
            ) : (
              <ul className="space-y-[1.2vh]">
                {history.map((c) => (
                  <li key={c.id} className="flex items-center justify-between rounded-2xl bg-white/5 px-[1.5vw] py-[1.2vh]">
                    <span className="text-[4.5vh] font-black tabular-nums">{c.ticket_number}</span>
                    <span className="ml-[1vw] truncate text-[2.6vh] text-white/80">{c.advisor_name ?? "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-[2vw] text-center">
            <div className="text-[2.6vh] text-white/70">
              Waiting · <span dir="rtl">في الانتظار</span>
            </div>
            <div className="text-[9vh] font-black leading-tight tabular-nums">{waiting}</div>
          </div>
        </section>
      </div>

      {flash && (
        <div className="fixed inset-0 z-40 flex animate-pulse flex-col items-center justify-center bg-brand text-center">
          <div className="text-[5vh] font-bold">
            Ticket · <span dir="rtl">التذكرة</span>
          </div>
          <div className="my-[2vh] text-[30vh] font-black leading-none tabular-nums">{flash.ticket_number}</div>
          <div className="text-[6vh] font-bold">→ {flash.advisor_name ?? (flash.parts ? "Parts counter" : "Service desk")}</div>
          <div className="mt-[1vh] text-[4vh]" dir="rtl">
            {flash.advisor_name ? `الرجاء التوجه إلى ${flash.advisor_name}` : "الرجاء التوجه إلى مكتب الخدمة"}
          </div>
        </div>
      )}

      {!soundOn && (
        <button
          type="button"
          onClick={startSound}
          className="fixed bottom-[3vh] left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-white px-[2vw] py-[1.5vh] text-[2.6vh] font-bold text-black shadow-2xl"
        >
          🔊 Tap to start sound · <span dir="rtl">اضغط لتشغيل الصوت</span>
        </button>
      )}
    </main>
  );
}
