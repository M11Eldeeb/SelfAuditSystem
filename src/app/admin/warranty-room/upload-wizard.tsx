"use client";

import { useState } from "react";
import Link from "next/link";
import { ClaimsUploadForm } from "./claims-upload-form";
import { SupplierPartsUploadForm } from "./supplier-parts-upload-form";

type Branch = { id: string; name: string; code: string };

type Stats = {
  claimsCount: number;
  claimPartsCount: number;
  scrapRequestsCount: number;
  scrapReadyCount: number;
  supplierCollectionsCount: number;
};

type LastSynced = {
  claimsData: string | null;
  supplierParts: string | null;
};

const STEP_LABELS = ["All claims data", "Supplier parts"];

function LastSyncedNote({ at }: { at: string | null }) {
  return (
    <p className="text-xs text-neutral-400">
      Last synced: {at ? new Date(at).toLocaleString() : "never"}
    </p>
  );
}

/**
 * Only the active step's upload form is ever mounted - the officer asked for
 * this after almost uploading a file into the wrong section: with all file
 * inputs visible at once, it's easy to click the wrong one. Completing a
 * step (or explicitly skipping it) advances to the next; a completed step
 * can be reopened to redo it, but its form isn't rendered until then.
 *
 * The checkmarks start seeded from real data (stats), not just this
 * session's in-memory progress - a step whose table already has rows shows
 * done from the moment the page loads. Without this, a checkmark only ever
 * appeared if you watched the upload finish in the same page load: navigate
 * away and back (or the upload finishes just as you happen to reload) and a
 * perfectly successful upload looked exactly like nothing happened at all.
 */
function initialCompleted(stats: Stats): Set<number> {
  const done = new Set<number>();
  if (stats.claimsCount > 0) done.add(1);
  if (stats.supplierCollectionsCount > 0) done.add(2);
  return done;
}

export function UploadWizard({
  branches,
  stats,
  lastSynced,
}: {
  branches: Branch[];
  stats: Stats;
  lastSynced: LastSynced;
}) {
  const [step, setStep] = useState(1);
  const [completed, setCompleted] = useState<Set<number>>(() => initialCompleted(stats));
  const [maxReached, setMaxReached] = useState(() => {
    const done = initialCompleted(stats);
    return done.size > 0 ? Math.max(...done) : 1;
  });

  function advance(n: number) {
    const next = Math.min(n + 1, 2);
    setStep(next);
    setMaxReached((prev) => Math.max(prev, next));
  }

  function markDone(n: number) {
    setCompleted((prev) => new Set(prev).add(n));
    if (n < 2) advance(n);
  }

  function skip(n: number) {
    if (n < 2) advance(n);
  }

  // Only a step already reached (completed, skipped, or the current one) can
  // be jumped to directly - stops the exact mistake this wizard exists to
  // prevent: clicking ahead into a step you haven't gotten to yet.
  function goTo(n: number) {
    if (n <= maxReached) setStep(n);
  }

  return (
    <section className="space-y-4 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs font-medium">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const isDone = completed.has(n);
          const isActive = step === n;
          const isReachable = n <= maxReached;
          return (
            <li key={n} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => goTo(n)}
                disabled={!isReachable}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 transition ${
                  isActive
                    ? "bg-brand text-white"
                    : isDone
                      ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      : isReachable
                        ? "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                        : "cursor-not-allowed bg-neutral-50 text-neutral-300"
                }`}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                    isActive ? "bg-white/25" : isDone ? "bg-emerald-600 text-white" : "bg-neutral-300 text-white"
                  }`}
                >
                  {isDone ? "✓" : n}
                </span>
                {label}
              </button>
              {n < 2 && <span className="text-neutral-300">→</span>}
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-neutral-900">1. All claims data</h2>
          <LastSyncedNote at={lastSynced.claimsData} />
          <ClaimsUploadForm branches={branches} onUploaded={() => markDone(1)} />
          <div className="flex items-center justify-between">
            <p className="text-xs text-neutral-500">
              {stats.claimPartsCount} part detail row(s) on file &middot; {stats.scrapRequestsCount} claim(s)
              flagged to scrap &middot;{" "}
              <Link href="/admin/warranty-room/scrap" className="text-brand hover:underline">
                {stats.scrapReadyCount} destruction video(s) ready to download →
              </Link>
            </p>
            <button type="button" onClick={() => skip(1)} className="text-xs font-medium text-neutral-500 hover:text-neutral-800">
              Skip this step →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-neutral-900">2. Supplier parts</h2>
          <LastSyncedNote at={lastSynced.supplierParts} />
          <SupplierPartsUploadForm branches={branches} onUploaded={() => markDone(2)} />
          <p className="text-xs text-neutral-500">
            <Link href="/admin/warranty-room/supplier-parts" className="text-brand hover:underline">
              {stats.supplierCollectionsCount} supplier collection(s) on file →
            </Link>
          </p>
        </div>
      )}

      {completed.size === 2 && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Both uploads done for this round. Click either step above to redo it if needed.
        </p>
      )}
    </section>
  );
}
