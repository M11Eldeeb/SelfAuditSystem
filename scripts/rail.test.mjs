// Run: node --test scripts/rail.test.mjs   (Node strips the TypeScript types of the imported modules)
import test from "node:test";
import assert from "node:assert/strict";
import { buildRail, railActiveKey, departmentsOf } from "../src/lib/rail.ts";
import { kpiLinks } from "../src/lib/rail-kpis.ts";
import { tabsFor } from "../src/components/dashboard/tabs.ts";

const AMS = { href: "https://portal.smil.com", label: "AMS (SAIC Portal)", external: true };
const OFFICER = [
  { href: "/admin/dashboard", label: "Dashboard", group: "Warranty" },
  { href: "/admin/msi", label: "Major Service Indicators" },
  { href: "/admin/query", label: "Query", group: "Warranty" },
  { href: "/admin/audits", label: "Audits", match: ["/admin/cycles", "/admin/internal-audit", "/admin/results", "/admin/review"], group: "Warranty" },
  { href: "/admin/warranty-room", label: "Warranty Room", group: "Warranty" },
  { ...AMS, group: "Warranty" },
  { href: "/admin/sub-dealer", label: "Sub-Dealer Analytics", group: "Warranty" },
  { href: "/admin/reconciliation", label: "Reconciliation", group: "Warranty" },
  { href: "/admin/technician-claims", label: "Technician Claims", group: "Warranty" },
  { href: "/admin/rejected-claims", label: "Rejected Claims", group: "Warranty" },
  { href: "/admin/technical-inquiries", label: "Technical Inquiries & Verification Codes", group: "Warranty" },
  { href: "/admin/documents", label: "Warranty and Technical Documents", group: "Warranty" },
  { href: "/admin/complaints", label: "Complaints" },
  { href: "/admin/vor-parts", label: "VOR Part Query" },
  { href: "/admin/open-wips", label: "Open WIPs" },
  { href: "/admin/courtesy-cars", label: "Courtesy Cars" },
  { href: "/admin/quality-control", label: "Quality Control" },
  { href: "/queue", label: "Customer Queue" },
  { href: "/admin/feedbacks", label: "Feedbacks", bottom: true },
];
const hrefs = (list) => list.map((l) => l.href);

test("officer menu: departments in the agreed order with the agreed pages", () => {
  const m = buildRail(OFFICER, []);
  assert.deepEqual(m.top.map((e) => e.key), ["query", "kpis", "service", "warranty", "technical", "quality", "parts", "complaints"]);
  const by = Object.fromEntries(m.top.map((e) => [e.key, e]));
  assert.deepEqual(hrefs(by.service.pages).sort(), ["/admin/courtesy-cars", "/admin/msi", "/admin/open-wips", "/queue"]);
  assert.ok(hrefs(by.warranty.pages).includes("/admin/documents"));
  assert.ok(hrefs(by.warranty.pages).includes(AMS.href));
  assert.ok(hrefs(by.warranty.pages).includes("/admin/sub-dealer"));
  assert.ok(hrefs(by.warranty.pages).includes("/admin/audits"));
  assert.deepEqual(hrefs(by.technical.pages).sort(), [AMS.href, "/admin/documents", "/admin/technical-inquiries"].sort());
  for (const k of ["query", "parts", "quality", "complaints"]) assert.equal(by[k].kind, "link", `${k} is a plain link`);
  assert.equal(by.parts.link.href, "/admin/vor-parts");
  assert.deepEqual(hrefs(m.bottom), ["/admin/feedbacks"]);
});

test("the Dashboard link is replaced by one Dashboard entry holding the KPI pages", () => {
  const kpis = [
    { href: "/admin/dashboard?tab=cycle", label: "Cycle Times & SLA", dept: "warranty" },
    { href: "/admin/dashboard?tab=quality", label: "Quality Dashboard", dept: "quality" },
  ];
  const m = buildRail(OFFICER, kpis);
  const by = Object.fromEntries(m.top.map((e) => [e.key, e]));
  // One "Dashboard" entry holds every dashboard; the departments list only their pages.
  assert.equal(by.kpis.label, "Dashboard");
  assert.deepEqual(hrefs(by.warranty.dashboards), []);
  assert.equal(by.quality.kind, "link");
  assert.deepEqual(hrefs(by.kpis.dashboards), hrefs(kpis));
  for (const e of m.top) if (e.kind === "link") assert.notEqual(e.link.href, "/admin/dashboard");
});

test("a role without KPI entries still gets its Dashboard link under KPIs", () => {
  const m = buildRail([{ href: "/audit/dashboard", label: "Dashboard" }, { href: "/audit/vor-parts", label: "VOR Part Query" }], []);
  const kpis = m.top.find((e) => e.key === "kpis");
  assert.deepEqual(hrefs(kpis.dashboards), ["/audit/dashboard"]);
});

test("a technician loses nothing: unmapped links are top-level buttons", () => {
  const m = buildRail([{ href: "/technician", label: "My claims" }, { href: "/technician/new", label: "New claim" }, { href: "/technician/feedback", label: "Feedback", bottom: true }], []);
  assert.deepEqual(m.top.map((e) => e.link?.href), ["/technician", "/technician/new"]);
  assert.deepEqual(hrefs(m.bottom), ["/technician/feedback"]);
});

test("the quality controller's pages share the Quality department", () => {
  const m = buildRail([{ href: "/qc", label: "QC records", match: ["/qc/analysis"] }, { href: "/qc/new", label: "New QC" }], []);
  assert.equal(m.top.length, 1);
  assert.equal(m.top[0].key, "quality");
  assert.equal(m.top[0].kind, "menu");
  assert.deepEqual(hrefs(m.top[0].pages), ["/qc", "/qc/new"]);
});

test("departmentsOf", () => {
  assert.deepEqual(departmentsOf({ href: "/admin/documents", label: "d" }), ["warranty", "technical"]);
  assert.deepEqual(departmentsOf(AMS), ["warranty", "technical"]);
  assert.equal(departmentsOf({ href: "/admin/query", label: "q" }), "query");
  assert.equal(departmentsOf({ href: "/advisor/complaints", label: "c" }), "complaints");
  assert.equal(departmentsOf({ href: "/audit/dashboard", label: "d" }), "dashboard");
  assert.equal(departmentsOf({ href: "/technician/new", label: "n" }), null);
});

test("railActiveKey", () => {
  const kpis = [{ href: "/admin/dashboard?tab=cycle", label: "Cycle", dept: "warranty" }];
  const m = buildRail(OFFICER, kpis);
  assert.equal(railActiveKey(m, "/admin/documents"), "warranty");
  assert.equal(railActiveKey(m, "/admin/dashboard?tab=cycle"), "kpis");
  assert.equal(railActiveKey(m, "/admin/vor-parts"), "parts");
  assert.equal(railActiveKey(m, "/admin/feedbacks"), "bottom:/admin/feedbacks");
  assert.equal(railActiveKey(m, AMS.href), null);
  assert.equal(railActiveKey(m, undefined), null);
});

test("kpiLinks per role", () => {
  const officer = kpiLinks({ base: "/admin/dashboard", tabs: tabsFor(true, false), quality: true });
  assert.deepEqual(hrefs(officer), ["/admin/dashboard?tab=quality", "/admin/dashboard?tab=overview", "/admin/dashboard?tab=cycle", "/admin/dashboard?tab=financials", "/admin/dashboard?tab=warranty", "/admin/dashboard?tab=trends"]);
  assert.equal(officer.find((l) => l.href.endsWith("quality")).dept, "quality");
  assert.equal(officer.find((l) => l.href.endsWith("cycle")).dept, "warranty");
  const manager = kpiLinks({ base: "/admin/dashboard", tabs: tabsFor(true, true), subDealer: true });
  assert.deepEqual(hrefs(manager), ["/admin/dashboard?tab=overview", "/admin/dashboard?tab=audits", "/admin/dashboard?tab=subdealer"]);
  const advisor = kpiLinks({ base: "/advisor/dashboard", tabs: tabsFor(false, false) });
  assert.deepEqual(hrefs(advisor), ["/advisor/dashboard?tab=overview", "/advisor/dashboard?tab=cycle", "/advisor/dashboard?tab=financials", "/advisor/dashboard?tab=warranty"]);
  const extra = kpiLinks({ base: "/admin/dashboard", tabs: tabsFor(true, false), extra: [{ href: "/admin/msi", label: "MSI", dept: "service" }] });
  assert.equal(extra.at(-1).href, "/admin/msi");
});

test("the customer queue's pages are one folder after Service", () => {
  const m = buildRail([...OFFICER.filter((l) => l.href !== "/queue"), { href: "/queue", label: "Queue overview", group: "Customer Queue" }, { href: "/queue/team", label: "Team", group: "Customer Queue" }], []);
  const keys = m.top.map((e) => e.key);
  assert.equal(keys[keys.indexOf("service") + 1], "queue");
  const q = m.top.find((e) => e.key === "queue");
  assert.deepEqual(hrefs(q.pages), ["/queue", "/queue/team"]);
  assert.equal(railActiveKey(m, "/queue/team"), "queue");
});
