"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { vehicleQuery } from "@/app/actions/query";
import type { QueryResult, QuerySection } from "@/lib/query/vehicle";
import { NavIcon } from "@/components/nav-icons";

// One search box; the answer is a page of cards, one per source (claims, complaints, VOR, courtesy cars, ...).

/** The menu icon of each source (picked by the address the icon set knows). */
const ICON_HREF: Record<string, string> = {
  "open-wip": "/open-wips",
  claims: "/results",
  complaints: "/complaints",
  vor: "/vor-parts",
  courtesy: "/courtesy",
  rejected: "/rejected",
  "technician-claims": "/technician-claims",
  inquiries: "/inquiries",
  quality: "/quality-control",
  invoicing: "/finance",
  scrap: "/warranty-room",
  "sub-dealer": "/sub-dealer",
};

const STAT_TONE = { good: "bg-emerald-50 text-emerald-800 ring-emerald-200", bad: "bg-red-50 text-red-700 ring-red-200", warn: "bg-amber-50 text-amber-800 ring-amber-200" } as const;

function SectionCard({ s }: { s: QuerySection }) {
  const n = s.rows.length;
  return (
    <section id={`q-${s.key}`} className={`scroll-mt-24 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ${n ? "ring-neutral-200" : "ring-neutral-100"}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${n ? "bg-brand/10 text-brand" : "bg-neutral-100 text-neutral-400"}`}>
            <NavIcon href={ICON_HREF[s.key] ?? "/"} label={s.title} size={18} />
          </span>
          <div>
            <h2 className={`text-sm font-bold ${n ? "text-neutral-900" : "text-neutral-500"}`}>{s.title}</h2>
            <p className="text-xs text-neutral-500">{n ? `${n} ${n === 1 ? s.noun[0] : s.noun[1]}` : `No ${s.noun[1]}`}</p>
          </div>
        </div>
        {s.stats && (
          <div className="flex flex-wrap gap-1.5">
            {s.stats.map((st) => (
              <span key={st.label} className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${st.tone ? STAT_TONE[st.tone] : "bg-neutral-50 text-neutral-700 ring-neutral-200"}`}>
                {st.label}: {st.value}
              </span>
            ))}
          </div>
        )}
      </header>
      {n > 0 ? (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-neutral-50 text-left text-xs text-neutral-500">
              <tr>
                {s.columns.map((c) => (
                  <th key={c} className="px-3 py-2 font-medium whitespace-nowrap">
                    {c}
                  </th>
                ))}
                {s.links && <th className="w-8" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {s.rows.map((r, i) => (
                <tr key={i} className="hover:bg-neutral-50">
                  {r.map((v, j) => (
                    <td key={j} className={`px-3 py-2 align-top ${j === 0 ? "font-semibold whitespace-nowrap text-neutral-900" : "text-neutral-700"}`}>
                      {v ?? <span className="text-neutral-300">—</span>}
                    </td>
                  ))}
                  {s.links && (
                    <td className="px-2 py-2 text-right">
                      {s.links[i] && (
                        <Link href={s.links[i]!} className="rounded-lg px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10">
                          Open ›
                        </Link>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {s.note && <p className="px-4 py-2.5 text-xs text-neutral-500">{s.note}</p>}
    </section>
  );
}

export function QueryView({ initialQuery, initialBranch }: { initialQuery: string; initialBranch: string | null }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function run(text: string, branch: string | null = null) {
    const t = text.trim();
    if (!t) return;
    const params = new URLSearchParams({ q: t });
    if (branch) params.set("branch", branch);
    router.replace(`?${params.toString()}`, { scroll: false });
    start(async () => setResult(await vehicleQuery(t, branch)));
  }

  useEffect(() => {
    if (initialQuery) run(initialQuery, initialBranch);
    else inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const found = result?.sections.filter((s) => s.rows.length) ?? [];
  const empty = result?.sections.filter((s) => !s.rows.length) ?? [];

  return (
    <div className="relative left-1/2 w-[min(84rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2 space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight text-neutral-900">Query</h1>
        <p className="text-sm text-neutral-500">One search for everything about a job or a vehicle - WIP number, VIN, plate, or a claim number (WSA…, TC-…, QC-…, TI-…).</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(q);
        }}
        className="flex gap-2"
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. 40988, HER-40988, LSJA24U32NS018200, 4987BBR"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-2xl border border-neutral-300 bg-white px-4 py-3 text-base shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
        />
        <button disabled={pending} className="rounded-2xl bg-brand px-6 text-sm font-bold text-white shadow-sm hover:bg-brand-dark disabled:opacity-60">
          {pending ? "Searching…" : "Search"}
        </button>
      </form>

      {result?.error && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">{result.error}</p>}

      {result?.chooseBranch && (
        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200">
          <p className="text-sm font-semibold text-neutral-900">{result.understood} exists in more than one branch - which one?</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {result.chooseBranch.map((b) => (
              <button key={b.id} type="button" onClick={() => run(result.query, b.id)} className="rounded-xl bg-neutral-50 p-3 text-left ring-1 ring-neutral-200 hover:bg-brand/5 hover:ring-brand/40">
                <div className="font-semibold text-neutral-900">{b.name}</div>
                <div className="mt-0.5 text-xs text-neutral-500">Found in: {b.seenIn.join(", ")}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {result && !result.error && !result.chooseBranch && (
        <>
          <div className="space-y-3 rounded-2xl bg-neutral-900 p-4 text-white shadow-sm">
            <div className="text-xs font-semibold tracking-wide text-white/60 uppercase">{result.understood || result.query}</div>
            {result.vehicle && result.vehicle.length > 0 && (
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {result.vehicle.map((v) => (
                  <div key={v.label}>
                    <div className="text-[11px] text-white/50">{v.label}</div>
                    <div className="font-mono text-sm font-semibold">{v.value}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {result.sections.map((s) => (
                <a
                  key={s.key}
                  href={`#q-${s.key}`}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${s.rows.length ? "bg-white text-neutral-900 hover:bg-white/90" : "bg-white/10 text-white/50"}`}
                >
                  {s.title} {s.rows.length ? `· ${s.rows.length}` : ""}
                </a>
              ))}
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {found.map((s) => (
              <SectionCard key={s.key} s={s} />
            ))}
          </div>
          {empty.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {empty.map((s) => (
                <SectionCard key={s.key} s={s} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
