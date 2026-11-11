import Link from "next/link";
import type { ReactNode } from "react";
import type { QcDetail, QcSummary } from "@/lib/qc/server";
import { purposeLabel, repairTypeLabel } from "@/lib/qc/constants";
import { fmtDateTime } from "@/components/tech-claims/status";
import { TechClaimFileGallery } from "@/components/tech-claims/file-gallery";

export function QcStatusPill({ status, attempts }: { status: "failed" | "passed"; attempts?: number }) {
  return status === "passed" ? (
    <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-emerald-800">Passed{attempts && attempts > 1 ? ` (test ${attempts})` : ""}</span>
  ) : (
    <span className="inline-block rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-red-700">Failed - waiting for retest</span>
  );
}

/** QC sub-tabs: records and analysis. */
export function QcTabs({ base, active, newHref }: { base: string; active: "list" | "analysis"; newHref?: string }) {
  const tab = (href: string, on: boolean, text: string) => (
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${on ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>
      {text}
    </Link>
  );
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-1">
        {tab(base, active === "list", "QC records")}
        {tab(`${base}/analysis`, active === "analysis", "Analysis")}
      </div>
      {newHref && (
        <Link href={newHref} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
          + New QC
        </Link>
      )}
    </div>
  );
}

export function QcList({
  base,
  rows,
  tabs,
  active,
  q,
  showBranch,
  extraParams = {},
}: {
  base: string;
  rows: QcSummary[];
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  q?: string;
  showBranch?: boolean;
  extraParams?: Record<string, string>;
}) {
  const href = (status: string) => {
    const p = new URLSearchParams({ ...extraParams, status });
    if (q) p.set("q", q);
    return `${base}?${p.toString()}`;
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link key={t.key} href={href(t.key)} className={`rounded-full px-3 py-1.5 text-sm font-medium ${active === t.key ? "bg-brand text-white" : "bg-white text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50"}`}>
            {t.label}
            {t.count != null && <span className="ms-1.5 opacity-80">{t.count}</span>}
          </Link>
        ))}
      </div>
      <form action={base} className="flex gap-2">
        {Object.entries({ ...extraParams, status: active }).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input name="q" defaultValue={q} placeholder="Search WIP, QC no. or model" className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none" />
        <button className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">Search</button>
      </form>
      {rows.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-neutral-500 shadow-sm ring-1 ring-neutral-200/70">No QC records.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`${base}/${r.id}`} className="block rounded-xl bg-white p-3 shadow-sm ring-1 ring-neutral-200/70 hover:ring-brand/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-neutral-900">{r.qcNo}</span>
                    <span className="text-sm text-neutral-600">WIP {r.wip}</span>
                    <span className="text-xs text-neutral-500">{purposeLabel(r.purpose)}</span>
                  </div>
                  <QcStatusPill status={r.status} attempts={r.attempts} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
                  {r.model && <span>{r.model}</span>}
                  {r.technicians.length > 0 && <span>{r.technicians.join(", ")}</span>}
                  {showBranch && <span>{r.branch}</span>}
                  <span>{r.attempts} test{r.attempts > 1 ? "s" : ""}</span>
                  <span>{fmtDateTime(r.updatedAt)}</span>
                </div>
                {r.status === "failed" && r.lastComment && <p className="mt-2 line-clamp-2 rounded-lg bg-red-50/60 px-2.5 py-1.5 text-xs text-red-900">{r.lastComment}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rows.length >= 300 && <p className="text-xs text-neutral-500">Showing the latest 300 - search to find older ones.</p>}
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="grid grid-cols-[9rem_1fr] gap-2 py-1.5 text-sm">
    <dt className="text-neutral-500">{k}</dt>
    <dd className="whitespace-pre-wrap text-neutral-900">{v || "—"}</dd>
  </div>
);

/** One QC: its tests (every comment, newest last), the details (folded), the files - and the retest form when given. */
export function QcDetailView({ qc, back, retest }: { qc: QcDetail; back: string; retest?: ReactNode }) {
  const filesOf = (testId: string | null) => qc.files.filter((f) => f.testId === testId);
  const loose = qc.files.filter((f) => !f.testId || !qc.tests.some((t) => t.id === f.testId));
  const last = qc.tests[qc.tests.length - 1];
  return (
    <div className="space-y-4">
      <Link href={back} className="text-sm text-neutral-500 hover:text-brand">
        ‹ Back
      </Link>
      <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              {qc.qc_no} · WIP {qc.wip_no}
            </h1>
            <p className="text-sm text-neutral-500">
              {purposeLabel(qc.purpose)} · {qc.model ?? "—"} · {qc.branch}
            </p>
          </div>
          <QcStatusPill status={qc.status} attempts={qc.attempts} />
        </div>
        {qc.status === "failed" && last?.comment && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900 ring-1 ring-red-200">
            <div className="text-xs font-semibold text-red-700">Last note to the workshop (test {last.attempt})</div>
            <p className="whitespace-pre-wrap">{last.comment}</p>
          </div>
        )}
        <details className="group mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-brand select-none">
            <span className="group-open:hidden">Show details</span>
            <span className="hidden group-open:inline">Hide details</span>
          </summary>
          <dl className="mt-2 divide-y divide-neutral-100">
            <Row k="WIP number" v={qc.wip_no} />
            <Row k="Odometer IN" v={qc.odometer_in != null ? `${qc.odometer_in.toLocaleString("en-US")} km` : null} />
            <Row k="Final odometer" v={qc.final_odometer != null ? `${qc.final_odometer.toLocaleString("en-US")} km` : null} />
            <Row k="Purpose" v={purposeLabel(qc.purpose)} />
            <Row k="Vehicle model" v={qc.model} />
            <Row k="Repair type" v={repairTypeLabel(qc.repair_type)} />
            <Row k="Team leader" v={qc.team_leader} />
            <Row k="Service advisor" v={qc.service_advisor} />
            <Row k="Replaced parts" v={qc.replaced_parts} />
            <Row k="Defect description" v={qc.defect_description} />
            <Row k="Quality controller" v={qc.controller_name} />
            <Row k="Recorded" v={fmtDateTime(qc.created_at)} />
          </dl>
        </details>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-bold text-neutral-900">Tests</h2>
        <ol className="space-y-2">
          {qc.tests.map((t) => (
            <li key={t.id} className={`rounded-xl bg-white p-3 shadow-sm ring-1 ${t.result === "pass" ? "ring-emerald-200" : "ring-red-200"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-neutral-900">
                  Test {t.attempt} · <span className={t.result === "pass" ? "text-emerald-700" : "text-red-700"}>{t.result === "pass" ? "Pass" : "Fail"}</span>
                </div>
                <div className="text-xs text-neutral-500">
                  {t.by ?? "—"} · {fmtDateTime(t.at)}
                </div>
              </div>
              <div className="mt-1 text-xs text-neutral-600">Technician(s): {t.technicians.map((x) => x.name).join(", ") || "—"}</div>
              {t.finalOdometer != null && <div className="text-xs text-neutral-600">Final odometer: {t.finalOdometer.toLocaleString("en-US")} km</div>}
              {t.comment && <p className="mt-2 text-sm whitespace-pre-wrap text-neutral-800">{t.comment}</p>}
              {filesOf(t.id).length > 0 && (
                <div className="mt-3">
                  <TechClaimFileGallery base="/api/qc/file" files={filesOf(t.id).map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size }))} />
                </div>
              )}
            </li>
          ))}
        </ol>
        {loose.length > 0 && <TechClaimFileGallery base="/api/qc/file" files={loose.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size }))} />}
      </div>
      {retest}
    </div>
  );
}
