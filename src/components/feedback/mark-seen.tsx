"use client";

import { useEffect } from "react";

/**
 * Marks a thread as read once it is actually opened in the browser. Done from
 * an effect instead of during render so a prefetch of the page can't clear the
 * notification before anyone has looked at it. Tells the bell to recount.
 */
export function MarkSeen({ action }: { action: () => Promise<unknown> }) {
  useEffect(() => {
    void action().then(() => window.dispatchEvent(new Event("notifications:refresh")));
  }, [action]);
  return null;
}
