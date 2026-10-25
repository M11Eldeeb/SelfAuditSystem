"use client";

import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/** Motion is decoration here: with Reduce Motion on, nothing moves and every number shows at once. */
const FULL_MOTION = "(prefers-reduced-motion: no-preference)";

/**
 * A number that counts up from 0 when it first appears (and again when it changes), keeping its formatting:
 * "1,234", "12.5%", "SAR 3.4K"... Text without a number is shown as is.
 */
export function CountText({ value, className }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useGSAP(
    () => {
      const el = ref.current;
      const m = value.match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
      if (!el || !m) return;
      const [, prefix, num, suffix] = m;
      const target = Number(num.replace(/,/g, ""));
      if (!Number.isFinite(target) || target === 0) return;
      const decimals = (num.split(".")[1] ?? "").length;
      const grouped = num.includes(",") || Math.abs(target) >= 10000;
      const mm = gsap.matchMedia();
      mm.add(FULL_MOTION, () => {
        const counter = { v: 0 };
        gsap.to(counter, {
          v: target,
          duration: 0.9,
          ease: "power3.out",
          onUpdate: () => {
            const text = counter.v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });
            el.textContent = `${prefix}${text}${suffix}`;
          },
          onComplete: () => {
            el.textContent = value;
          },
        });
        return () => {
          el.textContent = value;
        };
      });
      return () => mm.revert();
    },
    { dependencies: [value], revertOnUpdate: true }
  );
  return (
    <span ref={ref} className={className}>
      {value}
    </span>
  );
}

/**
 * The dashboard's content: when the tab changes, its panels rise in one after another (short, transform + opacity
 * only). `animKey` is what changes between tabs.
 */
export function Reveal({ animKey, children, className }: { animKey: string; children: ReactNode; className?: string }) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(FULL_MOTION, () => {
        const items = gsap.utils.toArray<HTMLElement>(scope.current?.children ?? []);
        gsap.from(items, { y: 14, autoAlpha: 0, duration: 0.45, ease: "power2.out", stagger: 0.06, clearProps: "transform,opacity,visibility" });
      });
      return () => mm.revert();
    },
    { scope, dependencies: [animKey], revertOnUpdate: true }
  );
  return (
    <div ref={scope} className={className}>
      {children}
    </div>
  );
}
