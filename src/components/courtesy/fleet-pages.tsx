import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { agreementsTable, courtesyStaff, type Agreement } from "@/lib/courtesy/agreements-server";
import { canManageFleet, canRequestTransfer, eventsTable, loadFleet, syncFleet, transfersTable, vehiclesTable, type FleetRow } from "@/lib/courtesy/fleet-server";
import { CONDITIONS, EVENT_LABEL, ON_LOAN, TRANSFER_LABEL, conditionOf, serviceState, type TransferStatus, type Vehicle } from "@/lib/courtesy/fleet";
import { STATUS_LABEL, nowMs } from "@/lib/courtesy/agreements";
import { VehicleActions } from "@/components/courtesy/fleet-actions";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }) : "—");
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Riyadh" }) : "—");
const km = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("en-US")} km`);

/** The car's state as one chip: on loan, or its condition; with an icon and a word (never colour alone). */
export function StateChip({ row }: { row: Pick<FleetRow, "condition" | "loan"> }) {
  const s = row.loan ? ON_LOAN : conditionOf(row.condition);
  const icon = row.loan ? "↗" : row.condition === "available" ? "✓" : row.condition === "accident" ? "!" : row.condition === "maintenance" ? "🔧" : "‖";
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap" style={{ backgroundColor: s.soft, color: s.color }}>
      <span aria-hidden="true">{icon}</span>
      {s.label}
    </span>
  );
}

function ServiceChip({ s }: { s: ReturnType<typeof serviceState> }) {
  if (s.state === "unknown") return <span className="text-xs text-neutral-400">no mileage yet</span>;
  if (s.state === "ok") return <span className="text-xs text-neutral-600">{km(s.nextKm)} · {s.left?.toLocaleString("en-US")} left</span>;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${s.state === "due" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
      {s.state === "due" ? `! Service due (${Math.abs(s.left ?? 0).toLocaleString("en-US")} km over)` : `Service soon (${s.left?.toLocaleString("en-US")} km)`}
    </span>
  );
}

// ---------------------------------------------------------------- Vehicles

const FILTERS: { id: string; label: string; test: (r: FleetRow) => boolean }[] = [
  { id: "", label: "All", test: () => true },
  { id: "on_loan", label: "On loan", test: (r) => !!r.loan },
  { id: "available", label: "Available", test: (r) => !r.loan && r.condition === "available" },
  { id: "maintenance", label: "Maintenance", test: (r) => r.condition === "maintenance" },
  { id: "accident", label: "Accident", test: (r) => r.condition === "accident" },
  { id: "on_hold", label: "On hold", test: (r) => r.condition === "on_hold" },
  { id: "out_of_service", label: "Out of service", test: (r) => r.condition === "out_of_service" },
  { id: "service", label: "Service due / soon", test: (r) => r.service.state === "due" || r.service.state === "soon" },
  { id: "transfer", label: "Transfers", test: (r) => !!r.transfer },
];

export async function VehiclesTab({ base, filter }: { base: string; filter?: string }) {
  const s = await courtesyStaff();
  const sync = await syncFleet();
  const { rows, branches } = await loadFleet(s.branchId);
  const f = FILTERS.find((x) => x.id === (filter ?? "")) ?? FILTERS[0];
  const shown = rows.filter(f.test);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const manage = canManageFleet(s.user);
  const request = canRequestTransfer(s.user);
  return (
    <div className="space-y-3">
      {sync.error && rows.length === 0 && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">The courtesy cars sheet could not be read ({sync.error}). Cars handed over in the portal appear here.</p>}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((x) => (
          <Link key={x.id} href={`${base}?tab=vehicles${x.id ? `&f=${x.id}` : ""}`} className={`rounded-full px-3 py-1 text-[13px] font-semibold ring-1 ${x.id === f.id ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white text-neutral-800 ring-black/10 hover:bg-neutral-50"}`}>
            {x.label} ({rows.filter(x.test).length})
          </Link>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-neutral-200/70">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-neutral-50 text-left text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
            <tr>
              <th className="px-3 py-2">Car</th>
              {!s.branchId && <th className="px-3 py-2">Branch</th>}
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">With / note</th>
              <th className="px-3 py-2">Mileage</th>
              <th className="px-3 py-2">Next service</th>
              <th className="px-3 py-2">{manage || request ? "Actions" : ""}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {shown.map((r) => (
              <tr key={r.id} className="align-top hover:bg-neutral-50">
                <td className="px-3 py-2">
                  <Link href={`${base}/vehicle/${r.id}`} className="font-semibold text-brand hover:underline">
                    {r.plate}
                  </Link>
                  <div className="text-xs text-neutral-500">{[r.model, r.vin].filter(Boolean).join(" · ")}</div>
                </td>
                {!s.branchId && <td className="px-3 py-2">{r.branchName ?? "—"}</td>}
                <td className="px-3 py-2">
                  <StateChip row={r} />
                  {r.transfer && (
                    <div className="mt-1 text-xs font-semibold text-blue-800">
                      ⇄ {TRANSFER_LABEL[r.transfer.status]} → {branchName.get(r.transfer.to_branch)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.loan ? (
                    <>
                      <div className="font-medium text-neutral-900">{r.loan.customer_name}</div>
                      <div className="text-neutral-500">
                        {r.loan.advisor_name} · since {day(r.loan.handed_over_at)}
                        {r.loan.expires_at && new Date(r.loan.expires_at).getTime() < nowMs() ? <b className="ml-1 text-red-700">overdue</b> : ` · until ${day(r.loan.expires_at)}`}
                      </div>
                    </>
                  ) : (
                    <span className="text-neutral-600">{r.condition_note ?? ""}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{km(r.km)}</td>
                <td className="px-3 py-2">
                  <ServiceChip s={r.service} />
                </td>
                <td className="px-3 py-2">
                  {(manage || request) && (
                    <VehicleActions vehicle={{ id: r.id, condition: r.condition, km: r.km, branch_id: r.branch_id }} branches={branches} canManage={manage && (!s.branchId || r.branch_id === s.branchId || r.transfer?.to_branch === s.branchId)} canRequest={request} canNote={false} transfer={r.transfer} myBranchId={s.branchId} compact />
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-neutral-500">
                  No car here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-500">Cars come from the courtesy cars sheet the first time they are seen; their branch, condition, mileage and service are then kept here. Service every 10,000 km - &quot;soon&quot; within 1,000 km.</p>
    </div>
  );
}

// ---------------------------------------------------------------- One car and its history

export async function VehiclePage({ id, base }: { id: string; base: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const s = await courtesyStaff();
  const { data } = await vehiclesTable().select("*").eq("id", id).maybeSingle();
  const v = data as Vehicle | null;
  if (!v) notFound();
  const [{ data: events }, { data: agreements }, { data: transfers }, { data: branches }] = await Promise.all([
    eventsTable().select("*").eq("vehicle_id", id).order("created_at", { ascending: false }).limit(300),
    agreementsTable().select("id, ref, status, customer_name, advisor_name, handed_over_at, returned_at, mileage_out, mileage_in, wip_no, expires_at").or(`vehicle_id.eq.${id},vehicle_plate.eq."${v.plate.replace(/"/g, "")}"`).order("requested_at", { ascending: false }).limit(200),
    transfersTable().select("*").eq("vehicle_id", id).order("requested_at", { ascending: false }),
    createAdminClient().from("self_audit_branches").select("id, name").order("name"),
  ]);
  const openTransfer = ((transfers ?? []) as { id: string; status: TransferStatus; from_branch: string; to_branch: string }[]).find((t) => t.status === "requested" || t.status === "sent") ?? null;
  if (s.branchId && v.branch_id !== s.branchId && openTransfer?.to_branch !== s.branchId) notFound();
  const name = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const ags = (agreements ?? []) as Pick<Agreement, "id" | "ref" | "status" | "customer_name" | "advisor_name" | "handed_over_at" | "returned_at" | "mileage_out" | "mileage_in" | "wip_no" | "expires_at">[];
  const loan = ags.find((a) => a.status === "open") ?? null;
  const sv = serviceState(v);
  const driven = ags.reduce((n, a) => n + (a.mileage_in != null && a.mileage_out != null ? a.mileage_in - a.mileage_out : 0), 0);
  const loanDays = ags.reduce((n, a) => n + (a.handed_over_at ? ((a.returned_at ? new Date(a.returned_at).getTime() : nowMs()) - new Date(a.handed_over_at).getTime()) / 86_400_000 : 0), 0);
  const manage = canManageFleet(s.user) && (!s.branchId || v.branch_id === s.branchId || openTransfer?.to_branch === s.branchId);
  const evs = (events ?? []) as { id: string; kind: string; body: string | null; km: number | null; agreement_id: string | null; from_branch: string | null; to_branch: string | null; by_name: string | null; created_at: string }[];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <Link href={`${base}?tab=vehicles`} className="text-sm text-neutral-500 hover:text-neutral-800">
          ← Vehicles
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">{v.plate}</h1>
          <StateChip row={{ condition: v.condition, loan: loan ? ({} as FleetRow["loan"]) : null }} />
        </div>
        <p className="text-sm text-neutral-500">{[v.model, v.vin, v.branch_id ? name.get(v.branch_id) : null].filter(Boolean).join(" · ")}</p>
      </div>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { l: "Mileage", v: km(v.km) },
          { l: "Next service", v: sv.nextKm ? km(sv.nextKm) : "—", n: sv.state === "due" ? `due - ${Math.abs(sv.left ?? 0).toLocaleString("en-US")} km over` : sv.state === "soon" ? `soon - ${sv.left?.toLocaleString("en-US")} km left` : sv.left != null ? `${sv.left.toLocaleString("en-US")} km left` : undefined, bad: sv.state === "due", warn: sv.state === "soon" },
          { l: "Loans", v: String(ags.filter((a) => a.handed_over_at).length), n: `${Math.round(loanDays)} days on loan` },
          { l: "Driven by customers", v: km(driven) },
        ].map((t) => (
          <div key={t.l} className="rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-neutral-200/70">
            <div className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">{t.l}</div>
            <div className={`text-lg font-bold ${t.bad ? "text-red-700" : t.warn ? "text-amber-700" : "text-neutral-900"}`}>{t.v}</div>
            {t.n && <div className="text-xs text-neutral-500">{t.n}</div>}
          </div>
        ))}
      </section>

      {loan && (
        <section className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900 ring-1 ring-blue-100">
          On loan to <b>{loan.customer_name}</b> ({loan.advisor_name}) since {fmt(loan.handed_over_at)}, until {fmt(loan.expires_at)} ·{" "}
          <Link href={`${base}/${loan.id}`} className="font-semibold underline">
            {loan.ref}
          </Link>
        </section>
      )}
      {v.condition !== "available" && v.condition_note && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {conditionOf(v.condition).label}: {v.condition_note} <span className="text-amber-700">({fmt(v.condition_at)})</span>
        </p>
      )}

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
        <VehicleActions vehicle={{ id: v.id, condition: v.condition, km: v.km, branch_id: v.branch_id }} branches={(branches ?? []).filter((b) => b.id)} canManage={manage} canRequest={canRequestTransfer(s.user)} canNote={s.canEdit || canRequestTransfer(s.user)} transfer={openTransfer} myBranchId={s.branchId} />
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
        <h2 className="mb-3 font-bold text-neutral-900">History</h2>
        <ol className="space-y-3">
          {evs.map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-neutral-400" aria-hidden="true" />
              <div className="min-w-0">
                <div>
                  <b>{EVENT_LABEL[e.kind] ?? e.kind}</b>
                  {e.from_branch && e.to_branch && (
                    <span className="text-neutral-600">
                      {" "}
                      {name.get(e.from_branch)} → {name.get(e.to_branch)}
                    </span>
                  )}
                  {e.km != null && <span className="text-neutral-600"> · {km(e.km)}</span>}
                </div>
                {e.body && <div className="text-neutral-700">{e.body}</div>}
                <div className="text-xs text-neutral-500">
                  {fmt(e.created_at)}
                  {e.by_name ? ` · ${e.by_name}` : ""}
                  {e.agreement_id && (
                    <>
                      {" · "}
                      <Link href={`${base}/${e.agreement_id}`} className="text-brand hover:underline">
                        agreement
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
          {evs.length === 0 && <li className="text-sm text-neutral-500">No history yet.</li>}
        </ol>
      </section>

      {ags.length > 0 && (
        <section className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-neutral-200/70">
          <h2 className="px-4 pt-3 font-bold text-neutral-900">Agreements</h2>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
              <tr>
                <th className="px-4 py-2">Ref</th>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Out</th>
                <th className="px-4 py-2">Back</th>
                <th className="px-4 py-2">Km</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {ags.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link href={`${base}/${a.id}`} className="text-brand hover:underline">
                      {a.ref}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{a.customer_name}</td>
                  <td className="px-4 py-2 text-xs">{fmt(a.handed_over_at)}</td>
                  <td className="px-4 py-2 text-xs">{fmt(a.returned_at)}</td>
                  <td className="px-4 py-2 text-xs">{a.mileage_in != null && a.mileage_out != null ? km(a.mileage_in - a.mileage_out) : "—"}</td>
                  <td className="px-4 py-2 text-xs">{STATUS_LABEL[a.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Dashboard

export async function CourtesyDashboard({ base }: { base: string }) {
  const s = await courtesyStaff();
  await syncFleet();
  const { rows, branches } = await loadFleet(s.branchId);
  let aq = agreementsTable().select("id, ref, branch_id, status, customer_name, advisor_name, handed_over_at, returned_at, expires_at, vehicle_label").gte("requested_at", new Date(nowMs() - 200 * 86_400_000).toISOString());
  if (s.branchId) aq = aq.eq("branch_id", s.branchId);
  const { data } = await aq;
  const ags = (data ?? []) as Pick<Agreement, "id" | "ref" | "branch_id" | "status" | "customer_name" | "advisor_name" | "handed_over_at" | "returned_at" | "expires_at" | "vehicle_label">[];
  const now = nowMs();
  const onLoan = rows.filter((r) => r.loan).length;
  const usable = rows.filter((r) => r.condition !== "out_of_service").length;
  const overdue = ags.filter((a) => a.status === "open" && a.expires_at && new Date(a.expires_at).getTime() < now);
  const service = rows.filter((r) => r.service.state === "due" || r.service.state === "soon").sort((a, b) => (a.service.left ?? 0) - (b.service.left ?? 0));
  const transfers = rows.filter((r) => r.transfer);
  const closed90 = ags.filter((a) => a.status === "closed" && a.returned_at && a.handed_over_at && new Date(a.returned_at).getTime() > now - 90 * 86_400_000);
  const avgDays = closed90.length ? closed90.reduce((n, a) => n + (new Date(a.returned_at!).getTime() - new Date(a.handed_over_at!).getTime()) / 86_400_000, 0) / closed90.length : null;
  const monthKey = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3_600_000).toISOString().slice(0, 7);
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now + 3 * 3_600_000);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - (5 - i));
    return d.toISOString().slice(0, 7);
  });
  const perMonth = months.map((m) => ({ m, n: ags.filter((a) => a.handed_over_at && monthKey(a.handed_over_at) === m).length }));
  const maxMonth = Math.max(1, ...perMonth.map((x) => x.n));
  const thisMonth = perMonth.at(-1)?.n ?? 0;
  const parts = [{ id: "loan", label: ON_LOAN.label, color: ON_LOAN.color, test: (r: FleetRow) => !!r.loan }, ...CONDITIONS.map((c) => ({ id: c.id, label: c.label, color: c.color, test: (r: FleetRow) => !r.loan && r.condition === c.id }))];
  const byBranch = (s.branchId ? branches.filter((b) => b.id === s.branchId) : branches).map((b) => ({ b, cars: rows.filter((r) => r.branch_id === b.id) })).filter((x) => x.cars.length);
  const maxCars = Math.max(1, ...byBranch.map((x) => x.cars.length));
  const tile = (l: string, v: string, n?: string, tone?: "bad" | "warn" | "good", href?: string) => {
    const body = (
      <div className="h-full rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-neutral-200/70 hover:ring-neutral-300">
        <div className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">{l}</div>
        <div className={`text-2xl font-bold tabular-nums ${tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : tone === "good" ? "text-emerald-700" : "text-neutral-900"}`}>{v}</div>
        {n && <div className="text-xs text-neutral-500">{n}</div>}
      </div>
    );
    return href ? (
      <Link key={l} href={href}>
        {body}
      </Link>
    ) : (
      <div key={l}>{body}</div>
    );
  };
  const v = `${base}?tab=vehicles&f=`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tile("Fleet", String(rows.length), `${usable} in service`, undefined, `${base}?tab=vehicles`)}
        {tile("On loan", String(onLoan), usable ? `${Math.round((onLoan / usable) * 100)}% of the usable fleet` : undefined, undefined, `${v}on_loan`)}
        {tile("Available", String(rows.filter((r) => !r.loan && r.condition === "available" && !r.transfer).length), "ready to hand over", "good", `${v}available`)}
        {tile("Not usable", String(rows.filter((r) => !r.loan && ["accident", "maintenance", "on_hold"].includes(r.condition)).length), `${rows.filter((r) => r.condition === "accident").length} accident · ${rows.filter((r) => r.condition === "maintenance").length} maintenance · ${rows.filter((r) => r.condition === "on_hold").length} on hold`, "warn", `${v}maintenance`)}
        {tile("Overdue loans", String(overdue.length), "past the agreement expiry", overdue.length ? "bad" : "good", `${base}?status=open`)}
        {tile("Service due / soon", String(service.length), `${service.filter((r) => r.service.state === "due").length} due now`, service.some((r) => r.service.state === "due") ? "bad" : service.length ? "warn" : "good", `${v}service`)}
        {tile("Loans this month", String(thisMonth), avgDays != null ? `average loan ${avgDays.toFixed(1)} days (90 days)` : undefined)}
        {tile("Transfers open", String(transfers.length), undefined, transfers.length ? "warn" : undefined, `${v}transfer`)}
      </div>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
        <h2 className="font-bold text-neutral-900">Fleet by branch</h2>
        <div className="mt-1 mb-3 flex flex-wrap gap-3 text-xs text-neutral-600">
          {parts.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
              {p.label}
            </span>
          ))}
        </div>
        <div className="space-y-2">
          {byBranch.map(({ b, cars }) => (
            <div key={b.id} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3 text-sm">
              <span className="truncate font-medium">{b.name}</span>
              <div className="flex h-5 gap-[2px]" style={{ width: `${(cars.length / maxCars) * 100}%` }}>
                {parts.map((p) => {
                  const n = cars.filter(p.test).length;
                  return n ? <div key={p.id} title={`${p.label}: ${n}`} className="flex h-full items-center justify-center rounded-[3px] text-[10px] font-bold text-white" style={{ flexGrow: n, backgroundColor: p.color }}>{n}</div> : null;
                })}
              </div>
              <span className="text-right text-xs text-neutral-500 tabular-nums">{cars.length}</span>
            </div>
          ))}
          {byBranch.length === 0 && <p className="text-sm text-neutral-500">No cars yet.</p>}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
          <h2 className="font-bold text-neutral-900">Cars handed over per month</h2>
          <div className="mt-3 flex h-32 items-end gap-2">
            {perMonth.map((x) => (
              <div key={x.m} className="flex flex-1 flex-col items-center justify-end" title={`${x.m}: ${x.n}`}>
                <span className="mb-0.5 text-xs font-semibold text-neutral-700 tabular-nums">{x.n}</span>
                <div className="w-full rounded-t-[4px] bg-[#3a3a3c]" style={{ height: `${Math.max(2, (x.n / maxMonth) * 100)}px` }} />
                <span className="mt-1 text-[10px] text-neutral-500">{new Date(`${x.m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
          <h2 className="font-bold text-neutral-900">Overdue loans</h2>
          <ul className="mt-2 divide-y divide-neutral-100 text-sm">
            {overdue.slice(0, 10).map((a) => (
              <li key={a.id} className="flex justify-between gap-3 py-1.5">
                <Link href={`${base}/${a.id}`} className="truncate text-brand hover:underline">
                  {a.vehicle_label ?? a.ref} - {a.customer_name}
                </Link>
                <span className="shrink-0 text-xs font-bold text-red-700">{Math.ceil((now - new Date(a.expires_at!).getTime()) / 86_400_000)} d late</span>
              </li>
            ))}
            {overdue.length === 0 && <li className="py-2 text-neutral-500">✓ None.</li>}
          </ul>
        </section>
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
          <h2 className="font-bold text-neutral-900">Service due / soon (every 10,000 km)</h2>
          <ul className="mt-2 divide-y divide-neutral-100 text-sm">
            {service.slice(0, 10).map((r) => (
              <li key={r.id} className="flex justify-between gap-3 py-1.5">
                <Link href={`${base}/vehicle/${r.id}`} className="truncate text-brand hover:underline">
                  {r.plate} {r.model ? `· ${r.model}` : ""} {!s.branchId && r.branchName ? `· ${r.branchName}` : ""}
                </Link>
                <ServiceChip s={r.service} />
              </li>
            ))}
            {service.length === 0 && <li className="py-2 text-neutral-500">✓ None.</li>}
          </ul>
        </section>
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
          <h2 className="font-bold text-neutral-900">Transfers</h2>
          <ul className="mt-2 divide-y divide-neutral-100 text-sm">
            {transfers.map((r) => (
              <li key={r.id} className="flex justify-between gap-3 py-1.5">
                <Link href={`${base}/vehicle/${r.id}`} className="truncate text-brand hover:underline">
                  {r.plate}: {branches.find((b) => b.id === r.transfer!.from_branch)?.name} → {branches.find((b) => b.id === r.transfer!.to_branch)?.name}
                </Link>
                <span className="shrink-0 text-xs font-semibold text-blue-800">{TRANSFER_LABEL[r.transfer!.status]}</span>
              </li>
            ))}
            {transfers.length === 0 && <li className="py-2 text-neutral-500">None open.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
