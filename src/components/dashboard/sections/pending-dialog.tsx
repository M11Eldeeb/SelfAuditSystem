"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Card, fmtInt } from "@/components/dashboard/ui";

/**
 * The manager's Pending tasks card: the number of open tasks (a branch's self audit is ONE task, its scrap evidence is
 * ONE task) - click it and a pop-up shows the detail per branch.
 */
export function PendingTasksCard({
  total,
  selfAudit,
  evidence,
  children,
}: {
  total: number;
  selfAudit: number;
  evidence: number;
  /** The detail shown in the pop-up. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Pending tasks: ${total} open. Show the details`}
        className="group block text-left md:col-span-2 xl:col-span-2"
      >
        <Card className="flex h-full flex-col justify-between gap-3 transition group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-[#c4121a]/40">
          <div className="text-[15px] font-semibold text-[#1d1d1f]">Pending tasks</div>
          <div className="flex items-baseline gap-1.5">
            <span className={`font-display text-[2.25rem] leading-none font-bold ${total ? "text-[#c4121a]" : "text-[#1d1d1f]"}`}>{fmtInt(total)}</span>
            <span className="text-[13px] text-[#6e6e73]">open</span>
          </div>
          <div className="divide-y divide-black/[0.06] text-[13px]">
            <div className="flex justify-between py-1.5">
              <span className="text-neutral-700">Self audit</span>
              <span className="font-semibold tabular-nums text-[#1d1d1f]">{selfAudit}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-neutral-700">Scrap evidence</span>
              <span className="font-semibold tabular-nums text-[#1d1d1f]">{evidence}</span>
            </div>
          </div>
          <div className="text-[12px] font-semibold text-[#c4121a] group-hover:underline">Show details →</div>
        </Card>
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Pending tasks">
            <button type="button" tabIndex={-1} aria-label="Close" onClick={() => setOpen(false)} className="fixed inset-0 bg-black/40" />
            <div className="relative z-10 w-full max-w-4xl">
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full bg-white px-3.5 py-1.5 text-[13px] font-semibold text-[#1d1d1f] shadow-md ring-1 ring-black/10 hover:bg-[#f5f5f7]"
                >
                  Close
                </button>
              </div>
              {children}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
