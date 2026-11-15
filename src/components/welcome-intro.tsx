"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/**
 * Opening the portal (GSAP, about 3 s): the MG badge pops in with a red ring pulsing out behind it, "Welcome to" rises
 * letter by letter, "MG Warranty" is drawn stroke by stroke and filled, a red line sweeps out under it with a shine,
 * "Jiad Modern Motors" settles in, and the sheet lifts away. A tap skips it.
 * Once per browser session and never with Reduce Motion (WELCOME_INIT_SCRIPT adds "no-welcome" to <html>, which hides
 * the sheet). The pieces start hidden in CSS, so nothing flashes before the script runs; if the script never runs, a CSS
 * fallback fades the sheet out after a few seconds.
 */
const KICKER = "Welcome to";

export function WelcomeIntro() {
  const root = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);

  useGSAP(
    () => {
      const el = root.current;
      if (!el || document.documentElement.classList.contains("no-welcome")) return;
      el.style.animation = "none"; // the script runs: the CSS fallback is not needed

      const word = el.querySelector<SVGTextElement>(".wi-word text");
      const length = word?.getComputedTextLength?.() ? word.getComputedTextLength() * 2.2 : 900;

      const tl = gsap.timeline({ defaults: { ease: "power3.out" }, onComplete: () => setGone(true) });
      tl.set(".wi-word text", { strokeDasharray: length, strokeDashoffset: length })
        .fromTo(".wi-glow", { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.9 }, 0)
        .fromTo(".wi-logo", { scale: 0.55, rotation: -10, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.8, ease: "back.out(1.7)" }, 0.1)
        .fromTo(".wi-ring", { scale: 0.7, opacity: 0.55 }, { scale: 2.4, opacity: 0, duration: 1.1, ease: "power2.out" }, 0.35)
        .fromTo(".wi-letter", { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.5, stagger: 0.035 }, 0.55)
        .to(".wi-word text", { strokeDashoffset: 0, duration: 1.1, ease: "power2.inOut" }, 0.8)
        .to(".wi-word text", { fillOpacity: 1, strokeOpacity: 0, duration: 0.45, ease: "power1.out" }, 1.65)
        .fromTo(".wi-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.6 }, 1.85)
        .fromTo(".wi-shine", { xPercent: -120 }, { xPercent: 220, duration: 0.7, ease: "power2.inOut" }, 2.15)
        .fromTo(".wi-sub", { opacity: 0, letterSpacing: "0.6em" }, { opacity: 1, letterSpacing: "0.32em", duration: 0.7 }, 2.0)
        .to(".wi-stack", { y: -24, scale: 0.97, opacity: 0, duration: 0.5, ease: "power2.in" }, 2.85)
        .to(el, { yPercent: -100, duration: 0.65, ease: "power4.inOut" }, 3.0);
    },
    { scope: root }
  );

  // A tap skips straight to the end.
  const skip = (e: React.MouseEvent<HTMLDivElement>) => {
    gsap.killTweensOf(e.currentTarget);
    gsap.to(e.currentTarget, { opacity: 0, duration: 0.3, onComplete: () => setGone(true) });
  };

  if (gone) return null;
  return (
    <div ref={root} className="welcome-intro" aria-hidden="true" onClick={skip}>
      <div className="wi-stack">
        <div className="wi-badge">
          <span className="wi-glow" />
          <span className="wi-ring" />
          <Image src="/mg-logo.png" alt="" width={1037} height={1024} priority className="wi-logo" />
        </div>
        <p className="wi-kicker">
          {KICKER.split("").map((c, i) => (
            <span key={i} className="wi-letter">
              {c === " " ? " " : c}
            </span>
          ))}
        </p>
        <svg className="wi-word" viewBox="0 0 720 110" role="presentation">
          <text x="360" y="84" textAnchor="middle">
            MG Warranty
          </text>
        </svg>
        <span className="wi-rule">
          <span className="wi-shine" />
        </span>
        <p className="wi-sub">Jiad Modern Motors</p>
      </div>
    </div>
  );
}
