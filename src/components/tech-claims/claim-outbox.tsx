"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { techT, type Lang } from "@/lib/i18n/tech";
import { deleteEntry, finishEntry, isFree, listEntries, type OutEntry, type Progress } from "./outbox";

const linkFor = (e: OutEntry) => e.href ?? (!e.claimId ? "/technician/new" : e.evidenceOnly ? `/technician/add-evidence?claim=${e.claimId}` : `/technician/${e.claimId}`);

/**
 * On every technician page: finishes claims whose page was closed after Submit / Save (stamping, resuming the uploads,
 * then sending the claim), and points to an unsent claim whose files are still on the phone.
 */
export function ClaimOutbox({ lang, who }: { lang: Lang; who: string }) {
  const t = techT(lang);
  const router = useRouter();
  const [drafts, setDrafts] = useState<OutEntry[]>([]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [sent, setSent] = useState(false);
  const running = useRef(false);

  const cycle = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const all = (await listEntries()).filter((e) => e.who === who);
      // After 5 failed tries the claim is shown with Continue / Discard instead of being tried again and again.
      const stuck = (e: OutEntry) => !!e.submit && (e.tries ?? 0) >= 5;
      setDrafts(all.filter((e) => (!e.submit || stuck(e)) && e.items.length > 0 && isFree(e)));
      for (const e of all.filter((x) => x.submit && !stuck(x) && isFree(x))) {
        const ok = await finishEntry(e.id, (p) => setProgress((cur) => ({ ...cur, [p.id]: p })));
        if (ok) {
          setProgress((cur) => {
            const next = { ...cur };
            delete next[e.id];
            return next;
          });
          setSent(true);
          router.refresh();
        }
      }
    } finally {
      running.current = false;
    }
  }, [who, router]);

  useEffect(() => {
    // A moment's wait so an open claim form takes its own claim first.
    const first = setTimeout(() => void cycle(), 4000);
    const every = setInterval(() => void cycle(), 30_000);
    const online = () => void cycle();
    window.addEventListener("online", online);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      window.removeEventListener("online", online);
    };
  }, [cycle]);

  const list = Object.values(progress);
  if (!list.length && !drafts.length && !sent) return null;
  return (
    <div className="space-y-2">
      {list.map((p) => (
        <div key={p.id} className={`rounded-xl px-4 py-3 text-sm ${p.failed ? "bg-amber-50 text-amber-900" : "bg-blue-50 text-blue-900"}`}>
          {p.failed ? t.bgFailed(p.wo) : t.bgSending(p.wo, p.done, p.total)}
        </div>
      ))}
      {sent && !list.length && <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{t.bgSent}</div>}
      {drafts.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>{t.bgDraft(d.fields.workOrder, d.items.length)}</span>
          <span className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm(t.bgDiscardConfirm)) return;
                await deleteEntry(d);
                setDrafts((cur) => cur.filter((x) => x.id !== d.id));
              }}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800"
            >
              {t.bgDiscard}
            </button>
            <Link href={linkFor(d)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white">
              {t.bgContinue}
            </Link>
          </span>
        </div>
      ))}
    </div>
  );
}
