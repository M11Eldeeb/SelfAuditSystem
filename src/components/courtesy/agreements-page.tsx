import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteOrigin } from "@/lib/site-origin";
import { COURTESY_BUCKET, agreementsTable, availableCars, courtesyStaff, type Agreement } from "@/lib/courtesy/agreements-server";
import { STATUS_LABEL, fuelLabel, nowMs, type AgreementStatus } from "@/lib/courtesy/agreements";
import { CourtesyView } from "@/components/courtesy/courtesy-view";
import { CustomerLink, CancelButton, ReturnForm } from "@/components/courtesy/agreement-actions";
import { HandoverForm } from "@/components/courtesy/handover-form";
import { DamageDiagram } from "@/components/courtesy/damage-diagram";
import { CourtesyDashboard, VehiclesTab } from "@/components/courtesy/fleet-pages";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }) : "—");
const TONE: Record<AgreementStatus, string> = {
  requested: "bg-amber-50 text-amber-800",
  open: "bg-blue-50 text-blue-800",
  closed: "bg-emerald-50 text-emerald-800",
  cancelled: "bg-neutral-100 text-neutral-600",
};
const Pill = ({ s }: { s: AgreementStatus }) => <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE[s]}`}>{STATUS_LABEL[s]}</span>;

/** Courtesy Cars: the agreements made in the portal (default) and the fleet sheet. */
/** Courtesy Cars: dashboard, agreements (with an advisor's own loans), the fleet in the portal, and the sheet. */
export async function CourtesyCarsPage({ base, tab, status, f }: { base: string; tab?: string; status?: string; f?: string }) {
  const s = await courtesyStaff();
  const advisor = s.user.role === "service_advisor" || (s.user.role === "queue_user" && s.user.queue_role !== "manager");
  const current = tab === "fleet" || tab === "vehicles" || tab === "dashboard" || tab === "agreements" ? tab : advisor ? "agreements" : "dashboard";
  const tabs = (
    <nav className="flex gap-0.5 rounded-[12px] bg-[#e9e9ec] p-[3px]" aria-label="Courtesy cars">
      {[
        { id: "dashboard", label: "Dashboard" },
        { id: "agreements", label: "Agreements" },
        { id: "vehicles", label: "Vehicles" },
        { id: "fleet", label: "Sheet" },
      ].map((t) => (
        <Link key={t.id} href={`${base}?tab=${t.id}`} aria-current={t.id === current ? "page" : undefined} className={`flex-1 rounded-[9px] px-3 py-1.5 text-center text-sm font-semibold ${t.id === current ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:bg-white/50"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
  return (
    <div className={`${current === "fleet" ? "" : "mx-auto max-w-6xl"} space-y-4`}>
      <div className="mx-auto max-w-xl">{tabs}</div>
      {current === "fleet" && <CourtesyView />}
      {current === "dashboard" && <CourtesyDashboard base={base} />}
      {current === "vehicles" && <VehiclesTab base={base} filter={f} />}
      {current === "agreements" && <AgreementsList base={base} status={status ?? (advisor ? "mine" : undefined)} />}
    </div>
  );
}

async function AgreementsList({ base, status }: { base: string; status?: string }) {
  const s = await courtesyStaff();
  const admin = createAdminClient();
  let q = agreementsTable().select("id, ref, branch_id, status, customer_name, phone, advisor_id, advisor_name, handed_over_by, vehicle_id, vehicle_label, wip_no, mileage_out, requested_at, handed_over_at, expires_at, returned_at").order("requested_at", { ascending: false }).limit(300);
  if (s.branchId) q = q.eq("branch_id", s.branchId);
  const [{ data, error }, { data: branches }] = await Promise.all([q, admin.from("self_audit_branches").select("id, name, queue_code").order("name")]);
  const rows = (data ?? []) as Pick<Agreement, "id" | "ref" | "branch_id" | "status" | "customer_name" | "phone" | "advisor_id" | "advisor_name" | "handed_over_by" | "vehicle_id" | "vehicle_label" | "wip_no" | "mileage_out" | "requested_at" | "handed_over_at" | "expires_at" | "returned_at">[];
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const origin = await siteOrigin();
  const own = (branches ?? []).find((b) => b.id === s.branchId);
  const isAdvisor = s.user.role === "service_advisor" || s.user.role === "queue_user";
  const counts = { requested: 0, open: 0, closed: 0, cancelled: 0 } as Record<AgreementStatus, number>;
  rows.forEach((r) => counts[r.status]++);
  const now = nowMs();
  const isMine = (r: (typeof rows)[number]) => (r.advisor_id === s.user.id || r.handed_over_by === s.user.id) && (r.status === "open" || r.status === "requested");
  const mineCount = rows.filter(isMine).length;
  const mine = status === "mine";
  const filter = (["requested", "open", "closed", "cancelled"] as const).includes(status as AgreementStatus) ? (status as AgreementStatus) : null;
  const shown = mine ? rows.filter(isMine) : filter ? rows.filter((r) => r.status === filter) : rows.filter((r) => r.status === "requested" || r.status === "open");

  return (
    <>
      {error && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">The agreements are not available yet - the database update (0195) is not applied.</p>}
      {own?.queue_code ? (
        <CustomerLink url={`${origin}/cc/${own.queue_code}`} myUrl={isAdvisor || s.user.queue_role === "advisor" ? `${origin}/cc/${own.queue_code}?a=${s.user.id}` : null} posterUrl={`/api/courtesy/poster/${own.queue_code}`} />
      ) : (
        !s.branchId && (
          <details className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
            <summary className="cursor-pointer font-bold text-neutral-900">Customer links of the branches</summary>
            <ul className="mt-2 space-y-1 text-sm">
              {(branches ?? [])
                .filter((b) => b.queue_code)
                .map((b) => (
                  <li key={b.id} className="flex gap-2">
                    <span className="w-40 shrink-0 font-medium">{b.name}</span>
                    <span className="truncate font-mono text-xs text-neutral-600" dir="ltr">{`${origin}/cc/${b.queue_code}`}</span>
                    <a href={`/api/courtesy/poster/${b.queue_code}`} target="_blank" rel="noreferrer" className="ml-auto shrink-0 text-xs font-semibold text-brand hover:underline">
                      QR poster
                    </a>
                  </li>
                ))}
            </ul>
          </details>
        )
      )}

      <div className="flex flex-wrap gap-1.5">
        {[
          { id: "mine", label: `My loans (${mineCount})` },
          { id: "", label: `Active (${counts.requested + counts.open})` },
          { id: "requested", label: `Waiting for the car (${counts.requested})` },
          { id: "open", label: `With the customer (${counts.open})` },
          { id: "closed", label: `Returned (${counts.closed})` },
          { id: "cancelled", label: `Cancelled (${counts.cancelled})` },
        ].map((t) => (
          <Link key={t.id} href={`${base}?tab=agreements${t.id ? `&status=${t.id}` : "&status=all"}`} className={`rounded-full px-3 py-1 text-[13px] font-semibold ring-1 ${(mine ? "mine" : (filter ?? "")) === t.id ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white text-neutral-800 ring-black/10 hover:bg-neutral-50"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-neutral-200/70">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-neutral-50 text-left text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
            <tr>
              <th className="px-3 py-2">Ref</th>
              <th className="px-3 py-2">Customer</th>
              {!s.branchId && <th className="px-3 py-2">Branch</th>}
              <th className="px-3 py-2">Advisor</th>
              <th className="px-3 py-2">Car</th>
              <th className="px-3 py-2">WIP</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Out for</th>
              <th className="px-3 py-2">Expiry</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {shown.map((r) => {
              const late = r.status === "open" && r.expires_at && new Date(r.expires_at).getTime() < now;
              return (
                <tr key={r.id} className="hover:bg-neutral-50">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`${base}/${r.id}`} className="font-semibold text-brand hover:underline">
                      {r.ref}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.customer_name}</div>
                    <div className="text-xs text-neutral-500" dir="ltr">{r.phone}</div>
                  </td>
                  {!s.branchId && <td className="px-3 py-2">{branchName.get(r.branch_id) ?? "—"}</td>}
                  <td className="px-3 py-2">{r.advisor_name ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.vehicle_id ? <Link href={`${base}/vehicle/${r.vehicle_id}`} className="text-brand hover:underline">{r.vehicle_label}</Link> : (r.vehicle_label ?? "—")}</td>
                  <td className="px-3 py-2">{r.wip_no ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Pill s={r.status} />
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums">{r.status === "open" && r.handed_over_at ? `${Math.max(0, Math.floor((now - new Date(r.handed_over_at).getTime()) / 86_400_000))} d` : "—"}</td>
                  <td className={`px-3 py-2 text-xs ${late ? "font-bold text-red-700" : ""}`}>{r.expires_at ? `${fmt(r.expires_at)}${late ? ` - ${Math.ceil((now - new Date(r.expires_at).getTime()) / 86_400_000)} d overdue` : r.status === "open" ? ` (${Math.max(0, Math.ceil((new Date(r.expires_at).getTime() - now) / 86_400_000))} d left)` : ""}` : "—"}</td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-neutral-500">
                  Nothing here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

const signed = async (path: string | null) => {
  if (!path) return null;
  const { data } = await createAdminClient().storage.from(COURTESY_BUCKET).createSignedUrl(path, 900);
  return data?.signedUrl ?? null;
};

/** One agreement: the customer's details, then the handover form (waiting), or the handover and the return. */
export async function CourtesyAgreementPage({ id, base }: { id: string; base: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const s = await courtesyStaff();
  const { data } = await agreementsTable().select("*").eq("id", id).maybeSingle();
  const a = data as Agreement | null;
  if (!a || (s.branchId && a.branch_id !== s.branchId)) notFound();
  const { data: branch } = await createAdminClient().from("self_audit_branches").select("name").eq("id", a.branch_id).maybeSingle();
  const [customerSign, advisorSign, license, photos] = await Promise.all([signed(a.customer_signature), signed(a.advisor_signature), signed(a.license_photo), Promise.all(a.photos.map(signed))]);
  const fleet = a.status === "requested" && s.canEdit ? await availableCars(a.branch_id) : null;
  const defaultExpiry = new Date(nowMs() + 3 * 3_600_000 + 7 * 86_400_000).toISOString().slice(0, 16);
  const row = (l: string, v: React.ReactNode) => (
    <div>
      <dt className="text-xs text-neutral-500">{l}</dt>
      <dd className="font-medium text-neutral-900">{v ?? "—"}</dd>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={base} className="text-sm text-neutral-500 hover:text-neutral-800">
            ← Courtesy cars
          </Link>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">
            Courtesy car agreement <span className="font-mono">{a.ref}</span>
          </h1>
          <p className="text-sm text-neutral-500">
            {branch?.name} · requested {fmt(a.requested_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill s={a.status} />
          {a.status !== "requested" && a.status !== "cancelled" && (
            <a href={`/api/courtesy/${a.id}/pdf`} target="_blank" rel="noreferrer" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
              Agreement PDF
            </a>
          )}
          {a.status === "requested" && s.canEdit && <CancelButton id={a.id} />}
        </div>
      </div>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
        <h2 className="mb-3 font-bold text-neutral-900">Customer</h2>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          {row("Name", a.customer_name)}
          {row("Mobile", <span dir="ltr">{a.phone}</span>)}
          {row("ID / Iqama", <span dir="ltr">{a.id_number}</span>)}
          {row("Date of birth", new Date(`${a.birth_date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }))}
          {row("Nationality", a.nationality)}
          {row("Service advisor", a.advisor_name)}
          {row("Terms accepted", fmt(a.terms_accepted_at))}
          {row("Form language", a.lang === "ar" ? "Arabic" : "English")}
        </dl>
        <div className="mt-3 flex flex-wrap gap-4">
          {customerSign && (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={customerSign} alt="Customer signature" className="h-20 rounded-lg bg-neutral-50 ring-1 ring-black/10" />
              <figcaption className="text-xs text-neutral-500">Customer signature</figcaption>
            </figure>
          )}
          {license && (
            <a href={license} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={license} alt="Driving licence" className="h-20 rounded-lg object-cover ring-1 ring-black/10" />
              <span className="block text-xs text-neutral-500">Driving licence</span>
            </a>
          )}
        </div>
      </section>

      {a.status === "requested" && s.canEdit && fleet && <HandoverForm id={a.id} cars={fleet.cars} carsError={fleet.error} defaultExpiry={defaultExpiry} />}

      {a.status !== "requested" && a.status !== "cancelled" && (
        <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
          <h2 className="font-bold text-neutral-900">Courtesy car</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {row("Car", a.vehicle_label)}
            {row("WIP", a.wip_no)}
            {row("Handed over", `${fmt(a.handed_over_at)} by ${a.handed_over_by_name ?? "—"}`)}
            {row("Mileage out", a.mileage_out != null ? `${a.mileage_out.toLocaleString("en-US")} km` : null)}
            {row("Fuel out", fuelLabel(a.fuel_out))}
            {row("Agreement expiry", fmt(a.expires_at))}
            {a.status === "closed" && row("Returned", `${fmt(a.returned_at)} by ${a.returned_by_name ?? "—"}`)}
            {a.status === "closed" && row("Mileage in", a.mileage_in != null ? `${a.mileage_in.toLocaleString("en-US")} km (${((a.mileage_in ?? 0) - (a.mileage_out ?? 0)).toLocaleString("en-US")} km driven)` : null)}
            {a.status === "closed" && row("Fuel in", fuelLabel(a.fuel_in))}
          </dl>
          {a.notes && <p className="rounded-lg bg-neutral-50 px-3 py-2 text-sm whitespace-pre-wrap">{a.notes}</p>}
          {a.return_note && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm whitespace-pre-wrap">Return: {a.return_note}</p>}
          <DamageDiagram marks={a.damages ?? []} />
          {a.damages?.length === 0 && <p className="text-xs text-neutral-500">No damage marked at checkout.</p>}
          {photos.some(Boolean) && (
            <div className="flex flex-wrap gap-2">
              {photos.map(
                (u, i) =>
                  u && (
                    <a key={i} href={u} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`Car photo ${i + 1}`} className="h-24 w-32 rounded-lg object-cover ring-1 ring-black/10" />
                    </a>
                  ),
              )}
            </div>
          )}
          {advisorSign && (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={advisorSign} alt="Advisor signature" className="h-20 rounded-lg bg-neutral-50 ring-1 ring-black/10" />
              <figcaption className="text-xs text-neutral-500">Authorized MG signatory - {a.handed_over_by_name}</figcaption>
            </figure>
          )}
        </section>
      )}

      {a.status === "open" && s.canEdit && <ReturnForm id={a.id} mileageOut={a.mileage_out} />}
    </div>
  );
}
