"use client";

import { useEffect } from "react";

/** Adds .is-scrolling to <html> while anything is being scrolled (see globals.css). */
export function ScrollActivity() {
  useEffect(() => {
    const root = document.documentElement;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      root.classList.add("is-scrolling");
      clearTimeout(timer);
      timer = setTimeout(() => root.classList.remove("is-scrolling"), 900);
    };
    // Capture phase: scroll events don't bubble, this catches inner panels too.
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      clearTimeout(timer);
    };
  }, []);
  return null;
}
