import "server-only";
import ExcelJS from "exceljs";
import { createAdminClient } from "@/lib/supabase/admin";
import { purposeLabel, repairTypeLabel } from "./constants";
import type { QcDetail } from "./server";

// The QC reports as an Excel workbook (the quality supervisor's export; kept apart so the QC pages do not load exceljs).

const ksa = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }) : "";
const STATUS = { passed: "Passed", failed: "Rework - waiting for retest", closed: "Closed as failed" } as const;
const RESULT = { pass: "Pass", fail: "Rework", close: "Closed as failed" } as const;

type CheckRow = Omit<QcDetail, "branch" | "tests" | "files">;

function styleHeader(ws: ExcelJS.Worksheet) {
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16191D" } };
  head.alignment = { vertical: "middle" };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

const checkCells = (c: CheckRow, branch: string) => ({
  qcNo: c.qc_no,
  wip: c.wip_no,
  branch,
  status: STATUS[c.status as keyof typeof STATUS] ?? c.status,
  tests: c.attempts,
  purpose: purposeLabel(c.purpose),
  repairType: repairTypeLabel(c.repair_type),
  model: c.model ?? "",
  vin: c.vin ?? "",
  odometerIn: c.odometer_in ?? "",
  finalOdometer: c.final_odometer ?? "",
  teamLeader: c.team_leader ?? "",
  serviceAdvisor: c.service_advisor ?? "",
  controller: c.controller_name ?? "",
  replacedParts: c.replaced_parts ?? "",
  defect: c.defect_description ?? "",
  created: ksa(c.created_at),
  passed: ksa(c.passed_at),
  closed: ksa(c.closed_at),
  whys: (c.rca_whys ?? []).map((w, i) => `${i + 1}. ${w}`).join("\n"),
  rootCause: c.rca_root_cause ?? "",
  solution: c.rca_solution ?? "",
  assigned: c.rca_assigned_name ?? "",
});

const CHECK_COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "QC no.", key: "qcNo", width: 14 },
  { header: "WIP", key: "wip", width: 9 },
  { header: "Branch", key: "branch", width: 18 },
  { header: "Status", key: "status", width: 26 },
  { header: "Tests", key: "tests", width: 7 },
  { header: "Purpose", key: "purpose", width: 16 },
  { header: "Repair type", key: "repairType", width: 18 },
  { header: "Model", key: "model", width: 14 },
  { header: "VIN", key: "vin", width: 20 },
  { header: "Odometer in", key: "odometerIn", width: 12 },
  { header: "Final odometer", key: "finalOdometer", width: 14 },
  { header: "Team leader", key: "teamLeader", width: 18 },
  { header: "Service advisor", key: "serviceAdvisor", width: 18 },
  { header: "Quality controller", key: "controller", width: 20 },
  { header: "Technicians (last test)", key: "technicians", width: 28 },
  { header: "Last note", key: "lastNote", width: 40 },
  { header: "Replaced parts", key: "replacedParts", width: 28 },
  { header: "Defect description", key: "defect", width: 28 },
  { header: "QC submitted", key: "created", width: 18 },
  { header: "Passed", key: "passed", width: 18 },
  { header: "Closed as failed", key: "closed", width: 18 },
  { header: "5 Whys", key: "whys", width: 40 },
  { header: "Root cause", key: "rootCause", width: 30 },
  { header: "Solution", key: "solution", width: 30 },
  { header: "Assigned to", key: "assigned", width: 20 },
  { header: "QC comments", key: "comments", width: 40 },
];

const TEST_COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "QC no.", key: "qcNo", width: 14 },
  { header: "WIP", key: "wip", width: 9 },
  { header: "Branch", key: "branch", width: 18 },
  { header: "Test", key: "attempt", width: 6 },
  { header: "Date", key: "at", width: 18 },
  { header: "Result", key: "result", width: 16 },
  { header: "Technicians", key: "technicians", width: 30 },
  { header: "Note", key: "comment", width: 50 },
  { header: "Final odometer", key: "finalOdometer", width: 14 },
  { header: "Tested by", key: "by", width: 20 },
];

/** The QC reports as one workbook: a row per QC, every test, and the comments. */
export async function qcWorkbook(checkIds: string[]): Promise<Buffer> {
  const admin = createAdminClient();
  const checks: CheckRow[] = [];
  const tests: { check_id: string; attempt_no: number; result: string; comment: string | null; technicians: unknown; final_odometer: number | null; tested_by_name: string | null; created_at: string }[] = [];
  const comments: { check_id: string; author_name: string | null; body: string; created_at: string }[] = [];
  for (let i = 0; i < checkIds.length; i += 200) {
    const ids = checkIds.slice(i, i + 200);
    const [{ data: c }, { data: t }, { data: m }] = await Promise.all([
      admin.from("self_audit_qc_checks").select("*").in("id", ids),
      admin.from("self_audit_qc_tests").select("check_id, attempt_no, result, comment, technicians, final_odometer, tested_by_name, created_at").in("check_id", ids).order("attempt_no"),
      admin.from("self_audit_qc_comments").select("check_id, author_name, body, created_at").in("check_id", ids).order("created_at"),
    ]);
    checks.push(...((c ?? []) as CheckRow[]));
    tests.push(...(t ?? []));
    comments.push(...(m ?? []));
  }
  const { data: branches } = await admin.from("self_audit_branches").select("id, name");
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const order = new Map(checkIds.map((id, i) => [id, i]));
  checks.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => (x && typeof x === "object" && "name" in x ? String((x as { name: unknown }).name) : "")).filter(Boolean).join(", ") : "");

  const wb = new ExcelJS.Workbook();
  wb.creator = "MG Warranty portal";
  const ws = wb.addWorksheet("QC reports");
  ws.columns = CHECK_COLUMNS;
  for (const c of checks) {
    const own = tests.filter((t) => t.check_id === c.id);
    const last = own[own.length - 1];
    const notes = comments.filter((m) => m.check_id === c.id).map((m) => `${m.author_name ?? "—"} (${ksa(m.created_at)}): ${m.body}`);
    ws.addRow({ ...checkCells(c, branchName.get(c.branch_id) ?? ""), technicians: names(last?.technicians), lastNote: last?.comment ?? "", comments: notes.join("\n") });
  }
  ws.eachRow((row) => (row.alignment = { vertical: "top", wrapText: true }));
  styleHeader(ws);

  const wt = wb.addWorksheet("Tests");
  wt.columns = TEST_COLUMNS;
  const byId = new Map(checks.map((c) => [c.id, c]));
  for (const t of tests) {
    const c = byId.get(t.check_id);
    if (!c) continue;
    wt.addRow({ qcNo: c.qc_no, wip: c.wip_no, branch: branchName.get(c.branch_id) ?? "", attempt: t.attempt_no, at: ksa(t.created_at), result: RESULT[t.result as keyof typeof RESULT] ?? t.result, technicians: names(t.technicians), comment: t.comment ?? "", finalOdometer: t.final_odometer ?? "", by: t.tested_by_name ?? "" });
  }
  wt.eachRow((row) => (row.alignment = { vertical: "top", wrapText: true }));
  styleHeader(wt);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
