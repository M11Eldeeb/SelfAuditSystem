// Menu icons: one simple line style (1.6 stroke, 20 px), matched to the sidebar text. Picked from the link's address.

const P: Record<string, string> = {
  dashboard: "M3.5 3.5h5v6h-5zM11.5 3.5h5v3.5h-5zM11.5 10h5v6.5h-5zM3.5 12.5h5v4h-5z",
  audits: "M7 3.5h6M7.5 2.5h5v2h-5zM5 3.5H4.5v14h11v-14H15M7 10l2 2 4-4",
  results: "M4 16.5V9M8.5 16.5V4M13 16.5v-5M17 16.5H3",
  schedule: "M3.5 5.5h13v11h-13zM3.5 8.5h13M7 3.5v3M13 3.5v3M6.5 11.5h2M11.5 11.5h2M6.5 14h2",
  room: "M3 6.5l7-3.5 7 3.5v8l-7 3.5-7-3.5zM3 6.5l7 3.5 7-3.5M10 10v8",
  returns: "M7.5 5.5L4 9l3.5 3.5M4 9h8.5a3.5 3.5 0 010 7H9",
  rejected: "M10 17a7 7 0 100-14 7 7 0 000 14zM7.5 7.5l5 5M12.5 7.5l-5 5",
  inquiries: "M4 4.5h12v8.5H9l-3.5 3v-3H4zM7 8h6M7 10.5h4",
  documents: "M2.5 5.5a1 1 0 011-1h4l1.5 2h7.5a1 1 0 011 1v8a1 1 0 01-1 1h-13a1 1 0 01-1-1z",
  feedback: "M3.5 4.5h13v9h-6l-4 3v-3h-3zM7 9h.01M10 9h.01M13 9h.01",
  wrench: "M12.5 3.5a3.5 3.5 0 00-3.2 4.9L3.8 13.9a1.4 1.4 0 002 2l5.5-5.5a3.5 3.5 0 004.9-3.2l-2 2-2-.5-.5-2z",
  list: "M7.5 5.5h9M7.5 10h9M7.5 14.5h9M4 5.5h.01M4 10h.01M4 14.5h.01",
  plus: "M10 4v12M4 10h12",
  money: "M3 5.5h14v9H3zM10 12a2 2 0 100-4 2 2 0 000 4zM5.5 8v4M14.5 8v4",
  code: "M10 3.5l1.6 3.3 3.6.5-2.6 2.5.6 3.6L10 11.7l-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z",
  home: "M3.5 9L10 3.5 16.5 9v7.5h-13z",
};

function keyFor(href: string, label: string): string {
  const h = href.toLowerCase();
  const l = label.toLowerCase();
  if (l.startsWith("submit")) return "plus";
  if (h === "/technician" || l === "my claims") return "list";
  if (h.includes("dashboard")) return "dashboard";
  if (h.includes("schedule")) return "schedule";
  if (h.includes("results")) return "results";
  if (h.includes("technician-claims")) return "wrench";
  if (h.includes("warranty-room")) return "room";
  if (h.includes("part-returns")) return "returns";
  if (h.includes("rejected")) return "rejected";
  if (h.includes("inquir") || h.includes("verification")) return "inquiries";
  if (h.includes("documents")) return "documents";
  if (h.includes("feedback")) return "feedback";
  if (h.includes("finance")) return "money";
  if (h.includes("audit") || h === "/audit") return "audits";
  if (h.startsWith("/technical")) return "code";
  return "home";
}

export function NavIcon({ href, label }: { href: string; label: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 opacity-90">
      <path d={P[keyFor(href, label)]} />
    </svg>
  );
}
