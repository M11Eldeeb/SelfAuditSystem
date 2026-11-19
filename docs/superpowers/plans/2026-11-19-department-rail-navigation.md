# Department rail navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the docked desktop sidebar (>= 1280 px) with a black icon rail organised by department, for every role, with KPIs split into one page per dashboard.

**Architecture:** A pure module (`src/lib/rail.ts`) turns the links each area layout already passes to `NavBar` into a department model; a client component (`src/components/rail/rail.tsx`) renders it inside `NavBar` (desktop only) with a CSS-measured gliding marker and click-open sub-menu panels. KPI entries come from a small server-safe helper; `KpiDashboard` switches tab on a window event so the dashboard stays instant.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind 4, Node's built-in test runner for the pure modules (no new dependency).

**Spec:** `docs/superpowers/specs/2026-11-19-department-rail-navigation-design.md`

## Global Constraints

- Desktop only: the rail replaces the `xl` (1280 px) docked sidebar; below 1280 px the top bar, drawer, "Arrange" mode and look are unchanged.
- Access never widens: the rail only re-presents the `links` an area layout passes to `NavBar` (plus the KPI entries derived from the same role).
- Rail order: Query, KPIs, Service, Warranty, Technical, Quality, Parts, Complaints; Feedback at the bottom.
- Departments: Service = Major Service Indicators, Open WIPs, Courtesy Cars, Customer Queue; Warranty = Audits, Warranty Room, Technician Claims, Rejected Claims, Reconciliation, Documents, AMS, Sub-Dealer Analytics; Technical = Technical Inquiries & Verification Codes, AMS, Documents; Quality = Quality Control; Parts = VOR Part Query; Complaints and Query are top-level.
- A department with one entry and no dashboard is a plain link; an unmapped link is a top-level rail button.
- Rail: 4.5 rem wide black (#111111) rounded rail, 0.75 rem from the edges, 2.75 rem buttons, white active marker, label tooltip sliding out 4 px, panel fade/slide 160 ms, `prefers-reduced-motion` = no motion.
- No Technical dashboard yet. Quality Control inner pages stay as their own page tabs.

## Review Focus

- A role with only a few links (technician, reviewer, QC, advisor): rail shows them all, none lost (unmapped links become top-level buttons).
- A link that is active but sits inside a closed panel: its department button carries the marker.
- The same link in two departments (AMS, Documents): active in both, listed in both, no duplicate React keys.
- `?tab=` KPI entries: active only while the page has that tab; re-click on the same dashboard page switches instantly with no server round trip.
- External link (AMS): opens in a new tab, never marks anything active.

---

### Task 1: Department model (`src/lib/rail.ts`)

**Files:**
- Create: `src/lib/rail.ts`, `scripts/rail.test.mjs`

**Interfaces:**
- Produces:
  - `type RailDept = "service" | "warranty" | "technical" | "quality" | "parts"`
  - `type RailLink = { href: string; label: string; title?: string; match?: string[]; badge?: string; external?: boolean; bottom?: boolean; group?: string }`
  - `type RailKpi = RailLink & { dept: RailDept | "kpi-other" }`
  - `type RailEntry = { kind: "link"; key: string; label: string; link: RailLink } | { kind: "menu"; key: string; label: string; icon: string; pages: RailLink[]; dashboards: RailKpi[] }`
  - `type RailModel = { top: RailEntry[]; bottom: RailLink[] }`
  - `departmentsOf(link: RailLink): RailDept[] | "query" | "complaints" | "dashboard" | null`
  - `buildRail(links: RailLink[], kpis: RailKpi[]): RailModel`
  - `railActiveKey(model: RailModel, activeHref: string | undefined): string | null`

- [ ] **Step 1: Write the failing test** `scripts/rail.test.mjs` (run with `node --test scripts/rail.test.mjs`, imports `../src/lib/rail.ts`). Tests, by name and assertion:
  - `officer menu`: feeding the admin layout's current officer links (Dashboard, MSI, Query, Audits, Warranty Room, AMS, Sub-Dealer, Reconciliation, Technician Claims, Rejected Claims, Technical Inquiries, Documents, Complaints, VOR, Open WIPs, Courtesy Cars, Quality Control, Customer queue, Feedbacks(bottom)) gives top keys in order `["query","kpis","service","warranty","technical","quality","parts","complaints"]`; `service.pages` hrefs are exactly the MSI, Open WIPs, Courtesy Cars, `/queue` ones; `warranty.pages` contain Documents and AMS; `technical.pages` contain Technical Inquiries, Documents, AMS; `parts` and `quality` are `kind: "link"` (single page, no dashboards); `complaints` and `query` are `kind: "link"`; `bottom` has the Feedbacks link.
  - `dashboards`: with kpis `[{href:"/admin/dashboard?tab=cycle",label:"Cycle Times & SLA",dept:"warranty"},{href:"/admin/dashboard?tab=quality",label:"Quality Dashboard",dept:"quality"}]`, `warranty.dashboards` has the first, `quality` becomes a `menu` (page + dashboard), and the `kpis` menu lists both (grouped by dept via its `dashboards`).
  - `technician`: links `[{href:"/technician",label:"My claims"},{href:"/technician/new",label:"New claim"},{href:"/technician/feedback",label:"Feedback",bottom:true}]` give two top `link` entries and one bottom link (nothing dropped).
  - `qc`: `/qc` and `/qc/new` fall in the `quality` department (one menu with two pages).
  - `railActiveKey`: on `/admin/documents` returns `"warranty"` (first department listing it); with `activeHref` equal to a KPI entry's href returns `"kpis"`; an external href returns `null`.
- [ ] **Step 2: Run it** `node --test scripts/rail.test.mjs` - Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/lib/rail.ts` with no imports. `departmentsOf` decides from the path's final segment(s) and the `external` AMS (`href === "https://portal.smil.com"` -> warranty + technical): `/msi`, `/open-wips`, `/courtesy-cars`, exact `/queue` -> service; `/audits`, exact `/audit` (and its `match`), `/warranty-room`, `/technician-claims`, `/rejected-claims`, `/reconciliation`, `/sub-dealer` -> warranty; `/documents` -> warranty + technical; `/technical-inquiries`, `/verification-codes` -> technical; `/quality-control`, `/qc`, `/qc/new` -> quality; `/vor-parts` -> parts; `/query` -> "query"; `/complaints` -> "complaints"; a path ending `/dashboard` -> "dashboard"; anything else null. `buildRail`: drop `dashboard` links when `kpis` is non-empty (else turn them into one KPI entry `dept: "warranty"`), keep the fixed key order, a one-page/no-dashboard department is a `link` entry, `kpis` is a `menu` whose `dashboards` are all KPI entries, unmapped links become top `link` entries (key = href) after Complaints, `bottom` links go to `bottom`.
- [ ] **Step 4: Run** `node --test scripts/rail.test.mjs` - Expected: all pass.
- [ ] **Step 5: Commit** `git add src/lib/rail.ts scripts/rail.test.mjs && git commit -m "Rail: department model and its tests"`

### Task 2: KPI entries per role (`src/lib/rail-kpis.ts`)

**Files:**
- Create: `src/lib/rail-kpis.ts`; extend `scripts/rail.test.mjs`

**Interfaces:**
- Consumes: `tabsFor`, `tabLabel` from `src/components/dashboard/tabs.ts`; `RailKpi` from Task 1.
- Produces: `kpiLinks(o: { base: string; isOfficer: boolean; manager?: boolean; national?: boolean; quality?: boolean; subDealer?: boolean; extra?: RailKpi[] }): RailKpi[]`

- [ ] **Step 1: Failing test** in `scripts/rail.test.mjs` (imports `../src/lib/rail-kpis.ts`; `tabs.ts` has no imports so it loads under Node): officer `{base:"/admin/dashboard",isOfficer:true,quality:true}` -> hrefs `/admin/dashboard?tab=overview|cycle|financials|warranty|trends` with `dept:"warranty"` and `?tab=quality` with `dept:"quality"`; manager `{manager:true,isOfficer:true,subDealer:true}` -> overview, audits, subdealer; advisor `{base:"/advisor/dashboard",isOfficer:false}` -> overview, cycle, financials, warranty (no quality); `extra` entries are appended.
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement** `kpiLinks` from `tabsFor(isOfficer, !!manager, !!national)` filtered by `quality` / `subDealer` flags the way `KpiDashboard` filters them, `title` = tab title, `dept` = `"quality"` for the quality tab else `"warranty"`.
- [ ] **Step 4: Run** - Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "Rail: KPI entries per role"`

### Task 3: The rail component and its styling

**Files:**
- Create: `src/components/rail/rail.tsx`
- Modify: `src/components/nav-icons.tsx` (export `iconPath(key: string): string`), `src/components/nav-bar.tsx`, `src/app/globals.css`

**Interfaces:**
- Consumes: `buildRail`, `railActiveKey`, `RailLink`, `RailKpi`, `RailModel` (Task 1); `activeHrefFor` result and `links`, `kpis`, `brand` from `NavBar`.
- Produces: `Rail({ links, kpis, activeHref, pathname }: { links: RailLink[]; kpis: RailKpi[]; activeHref: string | undefined; pathname: string }): JSX.Element` (client). `NavBar` gains an optional prop `kpis?: RailKpi[]`.

- [ ] **Step 1: Implement `Rail`**: `<aside class="app-rail hidden xl:flex">`; logo link; one `<button>` (menu) or `<Link>` (link) per entry with `NavIcon`-style icon from `iconPath` (query, dashboard, wrench, shield, gear, quality, box, complaints; unmapped links use `NavIcon`); one absolutely positioned marker moved with `transform: translateY` to the active button measured in `useLayoutEffect` (no transition on first placement; the active button shows its own white background until the marker is placed); tooltip label; dot when an entry or its pages carry a `badge`; clicking a menu opens a panel (`role="dialog"` not needed - `aria-expanded` on the button) listing pages, then a "Dashboards" heading and the dashboards (KPIs menu: one heading per department); closes on pathname/search change, outside `pointerdown`, Escape; hovering/focusing a menu button calls `router.prefetch` for its hrefs once; external links open in a new tab.
- [ ] **Step 2: CSS** in `globals.css`: `.app-rail`, `.rail-item`, `.rail-marker`, `.rail-tip`, `.rail-panel` with the Spec values; `@media (min-width:1280px)`: `html:has(.app-rail){--sidebar-w:5.75rem}` and `:has(> .app-rail){padding-left:5.75rem}`; remove the old `.app-sidebar` rules and the `[data-sidebar="closed"]` desktop hiding; hide `.app-topbar-brand` at `xl`; `prefers-reduced-motion` and `print` rules.
- [ ] **Step 3: `NavBar`**: replace the `<aside class="app-sidebar ...xl:flex">` with `<Rail .../>`; hide the top bar's menu button at `xl` (`xl:hidden`); keep everything below `xl` byte-for-byte (drawer, `organizeBar`, layout state). Rename the injected queue link label to `Customer Queue`.
- [ ] **Step 4: Verify** `npx tsc --noEmit` (no new errors in `src/components/rail`, `nav-bar.tsx`) and `npx eslint src/components/rail src/components/nav-bar.tsx src/lib/rail.ts` - Expected: clean.
- [ ] **Step 5: Commit** `git commit -m "Rail: desktop department rail replaces the docked sidebar"`

### Task 4: Wire every area layout

**Files:**
- Modify: `src/app/admin/layout.tsx`, `src/app/audit/layout.tsx`, `src/app/workshop/layout.tsx`, `src/app/advisor/layout.tsx`

**Interfaces:**
- Consumes: `kpiLinks` (Task 2), `NavBar` prop `kpis`.

- [ ] **Step 1:** in each layout that has a dashboard link pass `kpis={kpiLinks({...})}` with that role's flags: admin officer `{base:"/admin/dashboard",isOfficer:true,quality:true}` plus `extra` = Audits (`/admin/audits`, warranty), Sub-Dealer Analytics (`/admin/sub-dealer`, warranty), Major Service Indicators (`/admin/msi`, dept service); manager and national manager from their tab flags (national adds Sub-Dealer page; manager `subDealer:true`); audit area branch admin `{base:"/audit/dashboard",isOfficer:false,quality:true}`, service manager `{manager:true,subDealer:<branchHasSubDealer>}`; workshop `quality:true`; advisor none. Add MSI as a `dept:"service"` entry wherever the role has the MSI link. Layouts without a dashboard (technician, reviewer, qc, technical, analyst, queue, ...) pass nothing.
- [ ] **Step 2: Verify** `npx tsc --noEmit` and eslint on the four layouts - Expected: clean.
- [ ] **Step 3: Commit** `git commit -m "Rail: KPI entries from every area layout"`

### Task 5: One dashboard per page

**Files:**
- Modify: `src/components/dashboard/kpi-dashboard.tsx`, `src/components/rail/rail.tsx`

**Interfaces:**
- Produces: window event `"kpi-tab"` with `detail: DashboardTab` (the rail dispatches, `KpiDashboard` listens).

- [ ] **Step 1:** in `KpiDashboard` add `xl:hidden` to the section `<nav aria-label="Dashboard sections">` (the tab bar stays on phones and tablets) and an effect that on `"kpi-tab"` calls `setTab(id)` when `id` is one of its `tabs`.
- [ ] **Step 2:** in `Rail`, a KPI entry whose path equals the current pathname gets an `onClick` that `preventDefault()`s, dispatches `"kpi-tab"`, `history.replaceState` to the same URL with `tab` replaced (other params kept) and closes the panel; otherwise a normal `Link`.
- [ ] **Step 3: Verify** `npx tsc --noEmit`, eslint on both files - Expected: clean.
- [ ] **Step 4: Commit** `git commit -m "Dashboards: one per page from the rail, tab bar kept below 1280 px"`

### Task 6: Verify and ship

- [ ] **Step 1:** `node --test scripts/rail.test.mjs` (pass), `npx tsc --noEmit` (only the known missing-module errors), `npx eslint src` on touched files (clean).
- [ ] **Step 2:** read the finished `Rail` once against the Review Focus list (active-in-closed-panel, duplicate keys for AMS / Documents, external link).
- [ ] **Step 3:** `git pull --rebase`, `git push`, then tell the officer what to look at after the deploy.
