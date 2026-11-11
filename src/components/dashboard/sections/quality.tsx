"use client";

import { use } from "react";
import Link from "next/link";
import type { QcAnalysis } from "@/lib/qc/server";
import { QcAnalysisView } from "@/components/qc/qc-analysis";

/** Quality Dashboard tab: the quality control KPIs for the dashboard's months and branches (QCs recorded in those months). */
export function QualitySection({ quality, recordsHref, showBranches }: { quality: Promise<QcAnalysis>; recordsHref: string; showBranches: boolean }) {
  const a = use(quality);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-500">Quality control tests recorded in the months picked above.</p>
        <Link href={recordsHref} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-neutral-800 shadow-sm ring-1 ring-black/10 hover:bg-neutral-50">
          QC records ›
        </Link>
      </div>
      <QcAnalysisView a={a} showBranches={showBranches} />
    </div>
  );
}
