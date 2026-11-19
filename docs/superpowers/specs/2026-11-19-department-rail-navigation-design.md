# Department rail navigation (desktop) - design

Date: 2026-11-19. Requested by the warranty officer. Status: awaiting approval.

## Intent and why

The warranty portal's desktop menu is one long flat list in a wide sidebar, and every dashboard is a tab on one page. The
Sub-Dealer Warranty Desk (the officer's other site) has a black rounded icon rail: it is quick, it stays on screen while pages
change, its labels slide out on hover and a white marker glides from one button to the next. The officer wants that same
navigation on the portal, organised by department so people find things by the part of the business they work in, and with the
dashboards split into one page per dashboard instead of tabs on a single page.

## Goals

- On desktop (the width where the docked sidebar shows today, 1280 px and up), replace the docked sidebar with a left icon rail
  that looks and moves like the Desk's (`warranty-app/app/globals.css`, `.rail*`; `components/Sidebar.js`).
- Every role gets the rail, with only the entries that role already has access to. The rail is a new way to show the links each
  area's layout already hands to `NavBar`; it grants nothing new.
- Department layout, top to bottom: **Query**, **KPIs**, **Service**, **Warranty**, **Technical**, **Quality**, **Parts**,
  **Complaints**; **Feedback** at the bottom.
- **KPIs** opens a sub-menu with every dashboard the person can see, grouped by department; each opens as its own page.
- The page-level feel is fast: the rail does not rebuild or flash when the page changes, and the next page's links are prefetched.

## Non-goals

- No change below 1280 px: the top bar, the phone / tablet drawer, its "Arrange" mode and its look stay exactly as they are.
- No new permissions, roles or pages. No Technical dashboard yet (a follow-up: a dashboard of technical inquiries and
  verification codes).
- The top bar on desktop (page title, notifications, settings, sign out) stays as it is.

## Anti-goals (a failure even if it "works")

- A person sees an entry they cannot open, or loses one they could open before.
- The marker or panels stutter, or a page change feels slower than today.
- Phone or tablet users notice any difference.

## Layout and behaviour

Rail, top to bottom (each only when the role has at least one page for it):

| Rail button | Opens | Contents (officer-type accounts) |
|---|---|---|
| Logo | home of the role | |
| Query | the page | Query |
| KPIs | sub-menu | every dashboard, under department headings (below) |
| Service | sub-menu | Major Service Indicators, Open WIPs, Courtesy Cars, Customer Queue, + its dashboards |
| Warranty | sub-menu | Audits, Warranty Room, Technician Claims, Rejected Claims, Reconciliation, Documents, AMS, Sub-Dealer Analytics, + its dashboards |
| Technical | sub-menu | Technical Inquiries & Verification Codes, AMS, Documents (a Technical dashboard later) |
| Quality | sub-menu | Quality Control, + the Quality dashboard |
| Parts | the page | VOR Part Query |
| Complaints | the page | Complaints (a top-level button, not under Service) |
| Feedback (bottom) | the page | Feedback / Feedbacks inbox |

- A department with exactly one entry and no dashboard is a plain link, not a sub-menu (Parts, Query, Complaints).
- A link that fits no department (for example a technician's "New claim", the queue area's own pages) is a top-level rail
  button, so every role's own pages are always reachable.
- AMS and Documents appear under both Warranty and Technical (the same page, listed twice).
- Sub-menu: clicking a department opens a panel beside the rail listing its pages (and its dashboards under a "Dashboards"
  heading), the current page marked. It closes on navigating, on a click outside, and on Escape. Hovering a button shows its
  label sliding out, as on the Desk. Everything is reachable with the keyboard (buttons with `aria-expanded`, focus moves into the
  panel, Escape returns it).
- Red dot / count on a button where an entry carries a badge today (technical inquiries waiting, claims waiting, unread
  feedback), also shown beside that entry in its panel.

### KPIs and the dashboard split

KPIs lists, per department heading, the dashboards the role can open. For the officer: Warranty - Overview, Cycle Times & SLA,
Claims & Financials, Warranty Room, Trends & Repeats, Audits, Sub-Dealer; Quality - Quality Dashboard; Service - Major Service
Indicators; Technical and Parts - nothing yet (their headings do not show). Each entry opens a page that shows only that
dashboard (`/admin/dashboard?tab=<id>` etc.), without the tab bar, with the dashboard's own title. The same dashboards are also
listed inside their department's panel. The tab bar stays on phones and tablets (below 1280 px) so nothing changes there.
Other roles list what they have: for example the branch admin's and service manager's own Dashboard, the advisor's Dashboard
and Major Service Indicators.

### Motion (copied from the Desk)

- Black rounded rail, 4.5 rem wide, 0.75 rem from the edges; 2.75 rem round-square buttons; white active marker.
- The white marker is one element that slides (transform + 260 ms spring-like easing) to the active button; no flash on change.
- Label tooltips slide out 4 px; sub-menu panel fades and slides 8 px in 160 ms.
- Respects `prefers-reduced-motion` (no slide, instant).

## Constraints

- Next.js 16 App Router (read `node_modules/next/dist/docs/` first, per `AGENTS.md`); Tailwind 4; no animation library is installed.
- The rail is part of `NavBar` (`src/components/nav-bar.tsx`), which every area layout mounts with its own `links`; a layout stays
  mounted while the person moves inside the area, which is what keeps the rail (and the marker) alive between pages.
- Pages already size themselves with `var(--sidebar-w)`; it becomes the rail's width on desktop.
- Local dev server is blocked here: verification is `tsc`, `eslint`, a component-level check of the department mapping, and
  the officer looking at it after the deploy.

## Approaches considered

1. **Rail inside `NavBar`, departments tagged by a mapping from each link (chosen - my call).** Reuses the links every layout
   already computes (so access stays exactly as is), persists across pages within an area, needs no extra data fetch.
2. A separate rail mounted in the root layout that fetches the user on the client, like the Desk's `AppRail`. Rejected: an extra
   round trip and an empty-rail flash on every full load, and it would have to rebuild each role's link set on the client.
3. Using `framer-motion` for the gliding marker, as the Desk does. Rejected: a new dependency and bundle weight for something a
   measured `transform` transition does identically.

Scope chosen by the officer: the rail for every role, desktop only (not "officer accounts only").

## Decided by the officer

- Departments and their pages as in the table above; Complaints is its own top-level button; Customer Queue is under Service.
- Sub-Dealer Analytics under Warranty and under KPIs; AMS and Documents under both Warranty and Technical.
- The Technical dashboard (for technical inquiries and verification codes) is a later follow-up.
- Rail for every role, only with what that role can access; phones and tablets keep their current look.

## My calls (please check)

- Sub-menus open on click; hover only shows the label.
- The top bar stays on desktop with the bell, settings and sign out (the Desk puts the account at the bottom of the rail).
- On desktop the "Arrange the menu" mode and the hide-sidebar button go away (the departments are fixed); both stay in the
  phone / tablet drawer.
- A dashboard without an obvious department goes to the department of its role: branch admin / service manager Dashboard under
  Warranty, service advisor and workshop dashboards under Service.
- Quality Control's inner pages (records, new QC, analysis) stay inside its own page tabs, as today.
- Below the rail's first button the order is as listed above, Complaints last before the bottom group.

## Left to the builder

- Icon shapes for each department (inline SVG like `nav-icons.tsx`), exact spacing and the badge dot styling.
- The mapping function from a link (href suffix) to its department, with a test table for every role's current links.
- How to make a dashboard URL render one dashboard with no tab bar on desktop and the tab bar on small screens without loading
  the other tabs' data.
- Prefetching department links when the button is hovered or focused.
