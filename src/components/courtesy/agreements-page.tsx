import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteOrigin } from "@/lib/site-origin";
import { COURTESY_BUCKET, agreementsTable, availableCars, courtesyStaff, type Agreement } from "@/lib/courtesy/agreements-server";
import { STATUS_LABEL, fuelLabel, nowMs, type AgreementStatus } from "@/lib/courtesy/agreements";
import { SearchBox } from "@/components/courtesy/search-box";
import { SheetSearch } from "@/components/courtesy/sheet-search";
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
  const current = tab === "vehicles" || tab === "dashboard" || tab === "agreements" ? tab : advisor ? "agreements" : "dashboard";
  const tabs = (
    <nav className="flex gap-0.5 rounded-[12px] bg-[#e9e9ec] p-[3px]" aria-label="Courtesy cars">
      {[
        { id: "dashboard", label: "Dashboard" },
        { id: "agreements", label: "Agreements" },
        { id: "vehicles", label: "Vehicles" },
      ].map((t) => (
        <Link key={t.id} href={`${base}?tab=${t.id}`} aria-current={t.id === current ? "page" : undefined} className={`flex-1 rounded-[9px] px-3 py-1.5 text-center text-sm font-semibold ${t.id === current ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:bg-white/50"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="mx-auto max-w-md">{tabs}</div>
      {current === "dashboard" && <CourtesyDashboard base={base} />}
      {current === "vehicles" && <VehiclesTab base={base} filter={f} />}
      {current === "agreements" && <AgreementsList base={base} status={status ?? (advisor ? "mine" : undefined)} />}
    </div>
  );
}

type Row = Pick<Agreement, "id" | "ref" | "branch_id" | "status" | "customer_name" | "phone" | "advisor_id" | "advisor_name" | "handed_over_by" | "vehicle_id" | "vehicle_label" | "wip_no" | "mileage_out" | "requested_at" | "handed_over_at" | "expires_at" | "returned_at">;

const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d`;
};

/**
 * The advisor's working list: customers waiting for a car (hand it over), cars out (with how long and how long left -
 * return them), the other application's open agreements while both run, then the history. One search box over all.
 * "Mine" (the default for an advisor) keeps only his own customers.
 */
async function AgreementsList({ base, status }: { base: string; status?: string }) {
  const s = await courtesyStaff();
  const admin = createAdminClient();
  let q = agreementsTable().select("id, ref, branch_id, status, customer_name, phone, advisor_id, advisor_name, handed_over_by, vehicle_id, vehicle_label, wip_no, mileage_out, requested_at, handed_over_at, expires_at, returned_at").order("requested_at", { ascending: false }).limit(400);
  if (s.branchId) q = q.eq("branch_id", s.branchId);
  const [{ data, error }, { data: branches }] = await Promise.all([q, admin.from("self_audit_branches").select("id, name, queue_code").order("name")]);
  const all = (data ?? []) as Row[];
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const origin = await siteOrigin();
  const own = (branches ?? []).find((b) => b.id === s.branchId);
  const isMine = (r: Row) => r.advisor_id === s.user.id || r.handed_over_by === s.user.id;
  const mine = status === "mine";
  // Another advisor's car (on leave, off today): any advisor of the branch can receive it back.
  const others = status === "others";
  const rows = mine ? all.filter(isMine) : others ? all.filter((r) => r.status === "open" && !isMine(r)) : all;
  const now = nowMs();
  const waiting = rows.filter((r) => r.status === "requested").sort((a, b) => a.requested_at.localeCompare(b.requested_at));
  const out = rows.filter((r) => r.status === "open").sort((a, b) => (a.expires_at ?? "").localeCompare(b.expires_at ?? ""));
  const history = rows.filter((r) => r.status === "closed" || r.status === "cancelled");
  const q2 = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" ");
  const myLink = own?.queue_code ? `${origin}/cc/${own.queue_code}?a=${s.user.id}` : null;

  return (
    <>
      {error && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">The agreements are not available yet - the database update (0196) is not applied.</p>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchBox target="cc-list" placeholder="Search customer, mobile, plate, WIP or reference" />
        </div>
        <div className="flex gap-0.5 rounded-[12px] bg-[#e9e9ec] p-[3px]">
          {[
            { id: "mine", label: "Mine" },
            { id: "all", label: s.branchId ? "Whole branch" : "All branches" },
          ].map((t) => (
            <Link key={t.id} href={`${base}?tab=agreements&status=${t.id}`} className={`rounded-[9px] px-3 py-1.5 text-sm font-semibold ${(mine ? "mine" : others ? "" : "all") === t.id ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:bg-white/50"}`}>
              {t.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`${base}?tab=agreements&status=others`} className={`rounded-xl border px-3 py-2.5 text-sm font-semibold shadow-sm ${others ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50"}`}>
          Return another advisor&apos;s car
        </Link>
        <SheetSearch />
      </div>
      {others && <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900">Cars of the other advisors of {s.branchId ? "your branch" : "every branch"} - open one and receive it back when its advisor is away.</p>}

      <div id="cc-list" className="space-y-5">
        {!others && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-base font-bold text-neutral-900">
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs text-white">{waiting.length}</span>
            Waiting for a car
          </h2>
          {waiting.length === 0 && <p className="rounded-xl bg-white px-4 py-3 text-sm text-neutral-500 shadow-sm ring-1 ring-neutral-200/70">No customer waiting. Send the customer link (below) or show the QR poster at reception.</p>}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {waiting.map((r) => (
              <Link key={r.id} href={`${base}/${r.id}`} data-q={q2(r.customer_name, r.phone, r.ref, r.advisor_name)} className="group flex flex-col gap-2 rounded-xl bg-white p-4 shadow-sm ring-1 ring-amber-200 transition hover:shadow-md hover:ring-amber-400">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-bold text-neutral-900">{r.customer_name}</div>
                    <div className="text-xs text-neutral-500" dir="ltr">{r.phone}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">waiting {ago(r.requested_at, now)}</span>
                </div>
                <div className="text-xs text-neutral-600">
                  {r.advisor_name}
                  {!s.branchId && ` · ${branchName.get(r.branch_id)}`} · <span className="font-mono">{r.ref}</span>
                </div>
                <span className="mt-auto rounded-lg bg-brand py-2 text-center text-sm font-bold text-white group-hover:bg-brand-dark">Hand over a car →</span>
              </Link>
            ))}
          </div>
        </section>
        )}

        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-base font-bold text-neutral-900">
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs text-white">{out.length}</span>
            Cars out with customers
          </h2>
          {out.length === 0 && <p className="rounded-xl bg-white px-4 py-3 text-sm text-neutral-500 shadow-sm ring-1 ring-neutral-200/70">No car out.</p>}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {out.map((r) => {
              const start = r.handed_over_at ? new Date(r.handed_over_at).getTime() : now;
              const end = r.expires_at ? new Date(r.expires_at).getTime() : now;
              const late = end < now;
              const daysLeft = Math.ceil((end - now) / 86_400_000);
              const share = Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start)));
              return (
                <Link key={r.id} href={`${base}/${r.id}`} data-q={q2(r.customer_name, r.phone, r.ref, r.vehicle_label, r.wip_no, r.advisor_name)} className={`group flex flex-col gap-2 rounded-xl bg-white p-4 shadow-sm ring-1 transition hover:shadow-md ${late ? "ring-red-300 hover:ring-red-500" : "ring-neutral-200 hover:ring-neutral-400"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-bold text-neutral-900">{r.vehicle_label ?? "—"}</div>
                      <div className="truncate text-sm text-neutral-700">
                        {r.customer_name} <span className="text-xs text-neutral-500" dir="ltr">{r.phone}</span>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${late ? "bg-red-50 text-red-700" : daysLeft <= 1 ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-800"}`}>
                      {late ? `! ${Math.ceil((now - end) / 86_400_000)} d overdue` : `${daysLeft} d left`}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100" title="Time used of the agreement">
                    <div className="h-full rounded-full" style={{ width: `${share * 100}%`, backgroundColor: late ? "#d70015" : share > 0.8 ? "#b45309" : "#1d4ed8" }} />
                  </div>
                  <div className="text-xs text-neutral-600">
                    Out {ago(r.handed_over_at ?? r.requested_at, now)} · WIP {r.wip_no ?? "—"} · {r.mileage_out != null ? `${r.mileage_out.toLocaleString("en-US")} km out` : ""}
                    <br />
                    {r.advisor_name}
                    {!s.branchId && ` · ${branchName.get(r.branch_id)}`}
                  </div>
                  <span className="mt-auto rounded-lg bg-neutral-900 py-2 text-center text-sm font-bold text-white group-hover:bg-black">Return the car →</span>
                </Link>
              );
            })}
          </div>
        </section>

        {!others && (
        <section className="space-y-2">
          <h2 className="text-base font-bold text-neutral-900">History</h2>
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-neutral-200/70">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-neutral-50 text-left text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
                <tr>
                  <th className="px-3 py-2">Ref</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Car</th>
                  <th className="px-3 py-2">Advisor</th>
                  <th className="px-3 py-2">Out</th>
                  <th className="px-3 py-2">Back</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {history.map((r) => (
                  <tr key={r.id} data-q={q2(r.customer_name, r.phone, r.ref, r.vehicle_label, r.wip_no, r.advisor_name)} className="hover:bg-neutral-50">
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link href={`${base}/${r.id}`} className="font-semibold text-brand hover:underline">
                        {r.ref}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{r.customer_name}</td>
                    <td className="px-3 py-2 text-xs">{r.vehicle_id ? <Link href={`${base}/vehicle/${r.vehicle_id}`} className="text-brand hover:underline">{r.vehicle_label}</Link> : (r.vehicle_label ?? "—")}</td>
                    <td className="px-3 py-2 text-xs">{r.advisor_name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{fmt(r.handed_over_at)}</td>
                    <td className="px-3 py-2 text-xs">{fmt(r.returned_at)}</td>
                    <td className="px-3 py-2">
                      <Pill s={r.status} />
                    </td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-neutral-500">
                      Nothing yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        )}
      </div>

      {own?.queue_code ? (
        <CustomerLink url={`${origin}/cc/${own.queue_code}`} myUrl={myLink} posterUrl={`/api/courtesy/poster/${own.queue_code}`} />
      ) : (
        !s.branchId && (
          <details className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
            <summary className="cursor-pointer font-bold text-neutral-900">Customer links and QR posters of the branches</summary>
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
  const [customerSign, advisorSign, license, photos, returnPhotos] = await Promise.all([signed(a.customer_signature), signed(a.advisor_signature), signed(a.license_photo), Promise.all(a.photos.map(signed)), Promise.all((a.return_photos ?? []).map(signed))]);
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
          {row("Customer's car", a.customer_plate || a.customer_vin ? <span dir="ltr">{[a.customer_plate, a.customer_vin].filter(Boolean).join(" · ")}</span> : null)}
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
          {a.drive_folder_out && <a href={`https://drive.google.com/drive/folders/${a.drive_folder_out}`} target="_blank" rel="noreferrer" className="block text-sm font-semibold text-brand hover:underline">Handover photos in Google Drive</a>}
          {advisorSign && (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={advisorSign} alt="Advisor signature" className="h-20 rounded-lg bg-neutral-50 ring-1 ring-black/10" />
              <figcaption className="text-xs text-neutral-500">Authorized MG signatory - {a.handed_over_by_name}</figcaption>
            </figure>
          )}
        </section>
      )}

      {a.status === "closed" && ((a.return_damages ?? []).length > 0 || (a.return_photos ?? []).length > 0) && (
        <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
          <h2 className="font-bold text-neutral-900">At return</h2>
          {(a.return_damages ?? []).length > 0 ? <DamageDiagram marks={a.return_damages} /> : <p className="text-xs text-neutral-500">No new damage marked at return.</p>}
          {returnPhotos.some(Boolean) && (
            <div className="flex flex-wrap gap-2">
              {returnPhotos.map(
                (u, i) =>
                  u && (
                    <a key={i} href={u} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`Return photo ${i + 1}`} className="h-24 w-32 rounded-lg object-cover ring-1 ring-black/10" />
                    </a>
                  ),
              )}
            </div>
          )}
          {a.drive_folder_in && <a href={`https://drive.google.com/drive/folders/${a.drive_folder_in}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand hover:underline">Return photos in Google Drive</a>}
        </section>
      )}

      {a.status === "open" && s.canEdit && <ReturnForm id={a.id} mileageOut={a.mileage_out} outMarks={a.damages ?? []} />}
    </div>
  );
}
