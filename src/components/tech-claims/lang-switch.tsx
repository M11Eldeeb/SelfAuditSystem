"use client";

import { useRouter } from "next/navigation";
import type { Lang } from "@/lib/i18n/tech";
import { setTechLang } from "@/app/actions/lang";

/** English / العربية for the technician screens (kept for a year in a cookie). */
export function LangSwitch({ lang }: { lang: Lang }) {
  const router = useRouter();
  const set = async (l: Lang) => {
    await setTechLang(l);
    router.refresh();
  };
  return (
    <div className="inline-flex rounded-xl bg-neutral-900/[0.05] p-0.5 text-[13px] font-medium" role="group" aria-label="Language">
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
          aria-pressed={lang === l}
          onClick={() => void set(l)}
          className={`rounded-lg px-3 py-1 transition ${lang === l ? "bg-[var(--surface)] text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
