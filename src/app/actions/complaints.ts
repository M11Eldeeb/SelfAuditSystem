"use server";

import { requireAnyViewer, requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { importLatestComplaintsReport, type ComplaintsImportResult } from "@/lib/complaints/import";
import { loadInternalComplaints } from "@/lib/complaints/internal";
import { JIAD_DEALER_CODE_SUFFIX_MAP } from "@/lib/parse-claims";

/** One complaint as the page needs it (no customer names or phone numbers). */
export type Complaint = {
  source: string;
  no: string | null;
  created: string | null;
  status: string | null;
  resolved: string | null;
  category: string;
  subcategory: string;
  vin: string | null;
  valid: boolean | null;
  branch: string;
  advisor: string | null;
};
export type ComplaintsData = {
  complaints: Complaint[];
  lastImport: { fileName: string | null; subject: string | null; receivedAt: string | null; importedAt: string; rows: number } | null;
  /** Officers see every branch; a warranty admin only their own. */
  scope: "all" | string;
  canRefresh: boolean;
  today: string;
};

/** "N/A", "-" and blanks are no name. */
const cleanName = (v: string | null) => (v && !/^(n\/?a|-+|none|null)$/i.test(v.trim()) ? v.trim() : null);
const today = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

async function branchNames() {
  const { data } = await createAdminClient().from("self_audit_branches").select("id, name, code");
  const byId = new Map((data ?? []).map((b) => [b.id, b.name]));
  const byDealer = new Map<string, string>();
  for (const [dealer, code] of Object.entries(JIAD_DEALER_CODE_SUFFIX_MAP)) {
    const b = (data ?? []).find((x) => x.code?.toUpperCase() === code);
    if (b) byDealer.set(dealer, b.name);
  }
  return { byId, byDealer, own: (id: string | null) => (id ? (byId.get(id) ?? null) : null) };
}

/** MOC / SAIC / CRM complaints from the monthly e-mail. */
export async function getComplaintsData(): Promise<ComplaintsData> {
  const user = await requireAnyViewer(["officer", "branch_admin"]);
  const admin = createAdminClient();
  const names = await branchNames();
  const rows: Complaint[] = [];
  // 1,000 rows per request (the API's limit); the file holds a few thousand.
  for (let from = 0; ; from += 1000) {
    let q = admin
      .from("self_audit_complaints")
      .select("source, complaint_no, created_on, status, resolved_on, category, subcategory, vin, validity, branch_id, branch_label, service_advisor")
      .order("created_on", { ascending: true })
      .range(from, from + 999);
    if (user.role !== "officer") q = q.eq("branch_id", user.branch_id ?? "00000000-0000-0000-0000-000000000000");
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const v = (r.validity ?? "").trim().toLowerCase();
      rows.push({
        source: r.source,
        no: r.complaint_no,
        created: r.created_on,
        status: r.status,
        resolved: r.resolved_on,
        category: r.category?.trim() || "Not set",
        subcategory: r.subcategory?.trim() || "Not set",
        vin: r.vin,
        valid: v === "valid" ? true : v === "not valid" || v === "invalid" ? false : null,
        branch: (r.branch_id && names.byId.get(r.branch_id)) || r.branch_label || "No branch",
        advisor: cleanName(r.service_advisor),
      });
    }
    if ((data ?? []).length < 1000) break;
  }
  const { data: last } = await admin.from("self_audit_complaint_imports").select("file_name, subject, received_at, imported_at, rows").order("imported_at", { ascending: false }).limit(1).maybeSingle();
  return {
    complaints: rows,
    lastImport: last ? { fileName: last.file_name, subject: last.subject, receivedAt: last.received_at, importedAt: last.imported_at, rows: last.rows } : null,
    scope: user.role === "officer" ? "all" : (names.own(user.branch_id) ?? "Your branch"),
    canRefresh: user.role === "officer" && !user.viewOnly,
    today: today(),
  };
}

/** Officers: read the newest complaints e-mail now (`force` re-reads the same e-mail). */
export async function refreshComplaints(force = false): Promise<ComplaintsImportResult> {
  const officer = await requireRole("officer");
  return importLatestComplaintsReport({ force, userId: officer.id });
}

export type InternalComplaint = { date: string | null; branch: string; category: string | null; status: string | null };
export type InternalData = { rows: InternalComplaint[]; columns: { date: string | null; branch: string | null; category: string | null; status: string | null }; scope: "all" | string; error?: string; today: string };

/** Internal complaints from their Google Sheet: counted per branch and date. */
export async function getInternalComplaints(): Promise<InternalData> {
  const user = await requireAnyViewer(["officer", "branch_admin"]);
  const names = await branchNames();
  const own = user.role === "officer" ? null : names.own(user.branch_id);
  const scope = user.role === "officer" ? "all" : (own ?? "Your branch");
  try {
    const sheet = await loadInternalComplaints();
    const rows = sheet.rows
      .map((r) => ({ date: r.date, branch: (r.code && names.byDealer.get(r.code)) || (r.code ?? "No branch"), category: r.category, status: r.status }))
      .filter((r) => !own || r.branch === own);
    return { rows, columns: sheet.columns, scope, today: today() };
  } catch (e) {
    return { rows: [], columns: { date: null, branch: null, category: null, status: null }, scope, today: today(), error: e instanceof Error ? e.message : "Could not read the internal complaints sheet." };
  }
}
