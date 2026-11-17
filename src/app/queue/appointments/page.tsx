import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { queueBranches, requireQueueAccess } from "@/lib/queue/server";
import { saudiDate } from "@/lib/queue/core";
import { AppointmentsImport } from "@/components/queue/appointments-import";

const DAY = 24 * 3600_000;

/**
 * The day's appointments from the DMS sheet (by branch, by time), with who has arrived (joined the queue as that
 * appointment). Warranty officers also upload the sheet or read the newest e-mail here.
 */
export default async function QueueAppointmentsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const a = await requireQueueAccess();
  const sp = await searchParams;
  const today = saudiDate(new Date().toISOString());
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today;
  const shift = (d: number) => saudiDate(new Date(new Date(`${date}T12:00:00+03:00`).getTime() + d * DAY).toISOString());
  const admin = createAdminClient();
  const branches = await queueBranches();
  const mine = a.allBranches ? branches : branches.filter((b) => b.id === a.branchId);
  const ids = mine.map((b) => b.id);
  const [{ data: appts }, { data: imports }] = await Promise.all([
    ids.length
      ? admin.from("self_audit_queue_appointments").select("*").in("branch_id", ids).eq("appt_date", date).order("appt_time", { nullsFirst: false })
      : Promise.resolve({ data: [] as never[] }),
    a.admin
      ? admin.from("self_audit_queue_appointment_imports").select("source, file_name, subject, received_at, rows, imported_at").order("imported_at", { ascending: false }).limit(5)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const list = appts ?? [];
  const { data: arrived } = list.length
    ? await admin.from("self_audit_queue_tickets").select("appointment_id, ticket_number, status").in("appointment_id", list.map((x) => x.id))
    : { data: [] as { appointment_id: string | null; ticket_number: string | null; status: string }[] };
  const ticketOf = new Map((arrived ?? []).map((t) => [t.appointment_id, t]));
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" }) : "—");
  const dayLabel = new Date(`${date}T12:00:00+03:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Appointments</h1>
          <p className="text-sm text-neutral-500">From the DMS appointments sheet. A customer who joins as Appointment is matched by mobile, or by WIP number; another day or not found joins as a walk-in.</p>
        </div>
        {a.admin && !a.user.viewOnly && <AppointmentsImport />}
      </div>

      {a.admin && (imports ?? []).length > 0 && (
        <div className="rounded-2xl bg-white p-3 text-xs text-neutral-600 shadow-sm ring-1 ring-neutral-200/70">
          <span className="font-semibold text-neutral-800">Last imports: </span>
          {(imports ?? []).map((i, n) => (
            <span key={n}>
              {n > 0 && " · "}
              {i.source === "mail" ? "e-mail" : "upload"} {i.file_name ?? ""} ({i.rows}) {when(i.imported_at)}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/queue/appointments?date=${shift(-1)}`} className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm">
          ‹ Previous day
        </Link>
        <span className="font-semibold text-neutral-900">{dayLabel}</span>
        <Link href={`/queue/appointments?date=${shift(1)}`} className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm">
          Next day ›
        </Link>
        {date !== today && (
          <Link href="/queue/appointments" className="text-sm font-medium text-brand hover:underline">
            Today
          </Link>
        )}
        <span className="text-sm text-neutral-500">
          {list.length} appointments · {list.filter((x) => ticketOf.has(x.id)).length} arrived
        </span>
      </div>

      {mine.map((b) => {
        const rows = list.filter((x) => x.branch_id === b.id);
        if (!rows.length) return null;
        return (
          <section key={b.id} className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200/70">
            <h2 className="px-4 pt-3 font-semibold text-neutral-900">
              {b.name} <span className="text-sm font-normal text-neutral-500">· {rows.length}</span>
            </h2>
            <table className="mt-2 w-full min-w-[760px] text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  {["Time", "WIP", "Customer", "Mobile", "VIN", "Description", "Advisor", "Arrived"].map((h) => (
                    <th key={h} className="px-3 py-2 text-start font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((x) => {
                  const t = ticketOf.get(x.id);
                  return (
                    <tr key={x.id}>
                      <td className="px-3 py-2 font-semibold tabular-nums">{x.appt_time ? x.appt_time.slice(0, 5) : "—"}</td>
                      <td className="px-3 py-2 tabular-nums">{x.wip_no}</td>
                      <td className="px-3 py-2">{x.customer_name ?? "—"}</td>
                      <td className="px-3 py-2 tabular-nums" dir="ltr">
                        {x.mobile ?? "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{x.vin ?? "—"}</td>
                      <td className="px-3 py-2 text-neutral-600">{x.description ?? "—"}</td>
                      <td className="px-3 py-2 text-neutral-600">{x.service_reception ?? "—"}</td>
                      <td className="px-3 py-2">{t ? <span className="text-emerald-700">✓ {t.ticket_number}</span> : <span className="text-neutral-400">Not yet</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
      {list.length === 0 && <p className="rounded-2xl bg-white p-6 text-center text-sm text-neutral-500 shadow-sm ring-1 ring-neutral-200/70">No appointments for this day.</p>}
    </div>
  );
}
