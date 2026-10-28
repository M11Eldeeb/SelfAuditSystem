"use client";

import { useCallback, useEffect, useState } from "react";
import { getComplaintsData, getInternalComplaints, type ComplaintsData, type InternalData } from "@/app/actions/complaints";
import { CarLoaderCard } from "@/components/spinner";
import { MocComplaints } from "./moc-complaints";
import { InternalComplaints } from "./internal-complaints";

/** Reports > Complaints: MOC / SAIC / CRM complaints (monthly e-mail) and internal complaints (Google Sheet). */
export function ComplaintsView() {
  const [tab, setTab] = useState<"moc" | "internal">("moc");
  const [moc, setMoc] = useState<ComplaintsData | null>(null);
  const [internal, setInternal] = useState<InternalData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMoc = useCallback(() => {
    getComplaintsData()
      .then(setMoc)
      .catch(() => setError("Could not load the complaints."));
  }, []);
  useEffect(() => {
    queueMicrotask(loadMoc);
  }, [loadMoc]);
  useEffect(() => {
    if (tab !== "internal" || internal) return;
    getInternalComplaints()
      .then(setInternal)
      .catch(() => setError("Could not load the internal complaints."));
  }, [tab, internal]);

  const scope = moc?.scope ?? internal?.scope;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-[#6e6e73]">Reports</p>
          <h1 className="text-2xl font-bold tracking-tight text-[#1d1d1f]">Complaints</h1>
          <p className="mt-0.5 text-[14px] text-[#6e6e73]">{scope && scope !== "all" ? `${scope} only.` : "All branches."} Spot where complaints come from and what to fix first.</p>
        </div>
        <div className="inline-flex rounded-xl bg-[#f5f5f7] p-1 text-sm font-semibold ring-1 ring-black/[0.05]" role="tablist">
          {(
            [
              ["moc", "MOC · SAIC · CRM"],
              ["internal", "Internal"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-lg px-4 py-1.5 ${tab === k ? "bg-white text-[#1d1d1f] shadow-sm" : "text-[#6e6e73] hover:text-[#1d1d1f]"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {tab === "moc" ? (
        moc ? (
          <MocComplaints data={moc} onReload={loadMoc} />
        ) : (
          <CarLoaderCard height="h-96" label="Loading complaints…" />
        )
      ) : internal ? (
        <InternalComplaints data={internal} />
      ) : (
        <CarLoaderCard height="h-96" label="Reading the internal complaints sheet…" />
      )}
    </div>
  );
}
