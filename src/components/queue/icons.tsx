// The customer queue's icons: one line style (1.8 stroke, round caps), sized by the text next to them.

const P = {
  walkin: "M12 5.5a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5zM9.5 21l1.5-6 2 2v5M15 11.5l-2.5-3.5-3.5 1.5-1.5 3.5M12.5 8l1.5 4 3 1.5",
  calendar: "M4 6.5h16v13H4zM4 10.5h16M8.5 4v4M15.5 4v4M8 14h2.5M13.5 14H16M8 17h2.5",
  question: "M12 21a9 9 0 100-18 9 9 0 000 18zM9.6 9.4a2.5 2.5 0 114.2 1.9c-.9.7-1.8 1.3-1.8 2.7M12 17.2h.01",
  parts: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  quick: "M13 2.5L5 13.5h6l-1 8 8-11h-6z",
  repair: "M14.7 6.3a4 4 0 00-5.3 5.3l-5.6 5.6a1.8 1.8 0 002.5 2.5l5.6-5.6a4 4 0 005.3-5.3l-2.6 2.6-2.4-.5-.5-2.4z",
  car: "M5 16.5h14M3.5 16.5V13l2-5h13l2 5v3.5h-2M6.5 16.5v2M17.5 16.5v2M7 13h.01M17 13h.01M5.5 11h13",
  ticket: "M3.5 7.5h17v3a1.75 1.75 0 000 3.5v3h-17v-3a1.75 1.75 0 000-3.5zM14.5 7.5v10",
  check: "M5 12.5l4.5 4.5L19 7.5",
  phone: "M8 2.5h8a1 1 0 011 1v17a1 1 0 01-1 1H8a1 1 0 01-1-1v-17a1 1 0 011-1zM11 18.5h2",
  bell: "M6 16.5V11a6 6 0 1112 0v5.5l1.5 2h-15zM10 20.5a2 2 0 004 0",
  info: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5.5M12 7.5h.01",
  edit: "M4 20h4.5L19 9.5 14.5 5 4 15.5zM13 6.5l4.5 4.5",
} as const;

export type QIconName = keyof typeof P;

export function QIcon({ name, className = "h-6 w-6" }: { name: QIconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={P[name]} />
    </svg>
  );
}
