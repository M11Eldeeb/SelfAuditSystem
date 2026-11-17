"use client";

import Image from "next/image";
import type { ReactNode } from "react";

/** The customer pages' frame: phone width, the branch (or page) name, and the English / Arabic switch. */
export function PublicShell({
  title,
  subtitle,
  lang,
  dir,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  lang: "en" | "ar";
  dir: "ltr" | "rtl";
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <main dir={dir} lang={lang} className="flex min-h-screen flex-col items-center bg-neutral-100">
      <div className="flex min-h-screen w-full max-w-md flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-black/5 bg-white/85 px-4 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-3">
            <Image src="/mg-logo.png" alt="MG" width={36} height={36} className="h-9 w-9 shrink-0 rounded object-contain" />
            <div className="min-w-0">
              <p className="truncate font-bold leading-tight text-neutral-900">{title}</p>
              {subtitle && <div className="truncate text-xs text-neutral-500">{subtitle}</div>}
            </div>
          </div>
          <button
            type="button"
            aria-label="Language"
            onClick={onToggle}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/5 text-sm font-semibold text-neutral-800 hover:bg-black/10"
          >
            {lang === "en" ? "ع" : "EN"}
          </button>
        </header>
        {children}
      </div>
    </main>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
      style={{ width: size, height: size }}
    />
  );
}
