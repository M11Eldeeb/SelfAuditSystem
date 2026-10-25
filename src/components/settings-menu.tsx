"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTheme, type ThemeChoice } from "@/components/theme";

const THEME_OPTIONS: { value: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Light",
    icon: (
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3L6 14M14 6l1.3-1.3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M16.5 11.6A6.6 6.6 0 018.4 3.5a6.6 6.6 0 108.1 8.1z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    value: "system",
    label: "System",
    icon: (
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 17h6M10 13.5V17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

/**
 * Gear button in the top bar. Opens a popover with the theme switch and, per
 * role, the account/admin links that used to crowd the tab row.
 */
export function SettingsMenu({ links }: { links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Settings"
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex h-9 w-9 items-center justify-center rounded-lg transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
          open ? "bg-neutral-900/[0.07] text-neutral-900" : "text-neutral-600 hover:bg-neutral-900/[0.05] hover:text-neutral-900"
        }`}
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className={`transition-transform duration-500 ease-out motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
        >
          <path
            d="M10.3 3.3h3.4l.5 2.3a7 7 0 011.7 1l2.2-.8 1.7 3-1.7 1.5a7 7 0 010 2l1.7 1.5-1.7 3-2.2-.8a7 7 0 01-1.7 1l-.5 2.3h-3.4l-.5-2.3a7 7 0 01-1.7-1l-2.2.8-1.7-3 1.7-1.5a7 7 0 010-2L4.2 9.8l1.7-3 2.2.8a7 7 0 011.7-1l.5-2.3z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>

      <div
        role="menu"
        aria-label="Settings"
        inert={!open}
        className={`theme-follow absolute right-0 z-50 mt-2 w-64 origin-top-right rounded-xl border border-neutral-200 bg-white p-2 text-neutral-900 shadow-xl shadow-black/20 transition duration-200 ease-out motion-reduce:transition-none ${
          open ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-1 scale-95 opacity-0"
        }`}
      >
        <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">Appearance</p>
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-lg bg-neutral-100 p-1">
          {THEME_OPTIONS.map((o) => {
            const selected = theme === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTheme(o.value)}
                className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${
                  selected ? "bg-white text-neutral-900 shadow-sm ring-1 ring-black/5" : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                {o.icon}
                {o.label}
              </button>
            );
          })}
        </div>

        {links.length > 0 && <div className="my-2 h-px bg-neutral-100" />}
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-2.5 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
          >
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
