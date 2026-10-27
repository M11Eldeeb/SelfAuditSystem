"use client";

import { useOptimistic, useTransition } from "react";
import type { Lang } from "@/lib/i18n/tech";
import { setTechLang } from "@/app/actions/lang";

/**
 * English / العربية for the technician screens (kept for a year in a cookie). The tapped language lights up at once;
 * setting the cookie re-renders the page in the same round trip (no second refresh).
 */
export function LangSwitch({ lang }: { lang: Lang }) {
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(lang);
  const set = (l: Lang) => {
    if (l === shown) return;
    startTransition(async () => {
      setShown(l);
      await setTechLang(l);
    });
  };
  return (
    <div className={`inline-flex rounded-xl bg-neutral-900/[0.05] p-0.5 text-[13px] font-medium transition-opacity ${pending ? "opacity-70" : ""}`} role="group" aria-label="Language" aria-busy={pending}>
      {(
        [
          ["en", "English"],
          ["ar", "العربية"],
        ] as const
      ).map(([l, label]) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={shown === l}
          onClick={() => set(l)}
          className={`min-h-9 rounded-lg px-3.5 py-1 transition active:scale-95 ${shown === l ? "bg-[var(--surface)] text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
