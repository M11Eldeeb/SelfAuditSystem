"use client";

import { useState, useTransition } from "react";
import { searchVor, type VorField, type VorResult } from "@/app/actions/vor";
import { fmtDate } from "@/components/dashboard/ui";
import { CarLoader } from "@/components/spinner";
import { Glyph } from "@/components/ui/glyph";

const FIELDS: { key: VorField; label: string; placeholder: string }[] = [
  { key: "any", label: "Any", placeholder: "Part number, WIP, DCS PO, CI or DN number" },
  { key: "part", label: "Part number", placeholder: "e.g. 10587654" },
  { key: "wip", label: "Branch WIP", placeholder: "e.g. 123456" },
  { key: "dcs", label: "DCS purchase order", placeholder: "DCS PO number" },
  { key: "ci", label: "CI number", placeholder: "Commercial invoice number" },
  { key: "dn", label: "DN number", placeholder: "Delivery note number" },
];

/** The key details shown on top of each result, in this order (only the ones the file has). */
const KEY: { col: keyof VorResult["cols"]; label: string }[] = [
  { col: "part", label: "Part number" },
  { col: "description", label: "Description" },
  { col: "qty", label: "Order qty" },
  { col: "orderDate", label: "Order placed" },
  { col: "eta", label: "ETA for PDC" },
  { col: "autoline", label: "Autoline PO" },
  { col: "wip", label: "Branch WIP" },
  { col: "dcs", label: "DCS PO" },
  { col: "ci", label: "CI number" },
  { col: "dn", label: "DN number" },
  { col: "status", label: "Status" },
];

/** VOR Part Query: type a number, see every matching line of the VOR tracker. */
export function VorQuery() {
  const [field, setField] = useState<VorField>("any");
  const [q, setQ] = useState("");
  const [result, setResult] = useState<VorResult | null>(null);
  const [open, setOpen] = useState<number | null>(0);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      const r = await searchVor(q, field);
      setResult(r);
      setOpen(r.rows.length === 1 ? 0 : null);
    });

  const placeholder = FIELDS.find((f) => f.key === field)?.placeholder ?? "";
  const keyCols = result ? KEY.filter((k) => result.cols[k.col] >= 0) : [];
  const keyIdx = new Set(keyCols.map((k) => result!.cols[k.col]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#1d1d1f]">VOR Part Query</h1>
        <p className="mt-0.5 text-[14px] text-[#6e6e73]">Find a vehicle-off-road part order by part number, branch WIP, DCS purchase order, CI or DN number.</p>
      </div>

      <form
        className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-black/[0.05]"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <div className="flex flex-wrap gap-1 rounded-lg bg-neutral-900/[0.05] p-0.5 text-[12px] font-medium" role="group" aria-label="Search by">
          {FIELDS.map((f) => (
            <button key={f.key} type="button" aria-pressed={field === f.key} onClick={() => setField(f.key)} className={`rounded-md px-2.5 py-1 ${field === f.key ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoFocus inputMode="search" className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2.5 font-mono text-[15px]" aria-label="Number to find" />
          <button type="submit" disabled={pending || q.trim().length < 3} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-[14px] font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
            <Glyph name="search" /> Search
          </button>
        </div>
      </form>

      {pending ? (
        <div className="flex h-40 items-center justify-center rounded-2xl bg-white ring-1 ring-black/[0.05]">
          <CarLoader label="Searching the VOR file…" />
        </div>
      ) : result?.error ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{result.error}</p>
      ) : result ? (
        <div className="space-y-3">
          <p className="px-1 text-[13px] text-[#6e6e73]">
            {result.total === 0 ? "No matching line." : `${result.total} matching line${result.total === 1 ? "" : "s"}${result.total > result.rows.length ? ` (first ${result.rows.length} shown)` : ""}.`} From {result.file.name}
            {result.file.modifiedTime ? `, updated ${fmtDate(result.file.modifiedTime)}` : ""}.
          </p>
          {result.rows.map((r, i) => {
            const isOpen = open === i;
            const extra = result.headers.map((h, j) => ({ h, v: r[j] ?? "", j })).filter((x) => x.v && !keyIdx.has(x.j));
            return (
              <div key={i} className="rounded-2xl bg-white ring-1 ring-black/[0.05]">
                <button type="button" onClick={() => setOpen(isOpen ? null : i)} className="block w-full p-4 text-left" aria-expanded={isOpen}>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-4">
                    {keyCols.map((k) => (
                      <div key={k.col} className={k.col === "description" ? "col-span-2" : ""}>
                        <div className="text-[11px] font-medium text-[#8e8e93]">{k.label}</div>
                        <div className={`text-[14px] ${k.col === "part" ? "font-mono font-semibold" : "font-medium"} text-[#1d1d1f]`}>{r[result.cols[k.col]] || "—"}</div>
                      </div>
                    ))}
                  </div>
                  {extra.length > 0 && <div className="mt-3 text-[12px] font-medium text-[#6e6e73]">{isOpen ? "Hide details" : `All details (${extra.length} more) ›`}</div>}
                </button>
                {isOpen && extra.length > 0 && (
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-neutral-100 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
                    {extra.map((x) => (
                      <div key={x.j}>
                        <dt className="text-[11px] text-[#8e8e93]">{x.h}</dt>
                        <dd className="text-[13px] text-[#1d1d1f]">{x.v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
