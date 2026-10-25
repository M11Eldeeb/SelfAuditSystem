// One line-icon set for the whole portal (instead of emoji): 24-unit grid, 1.75 stroke, round caps - drawn to sit next
// to text at the text's weight. Decorative by default (aria-hidden); pass `label` when the icon is the only content.

const PATHS = {
  download: "M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14",
  upload: "M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5M5 19.5h14",
  file: "M14 3.5H7a1.5 1.5 0 00-1.5 1.5v14A1.5 1.5 0 007 20.5h10a1.5 1.5 0 001.5-1.5V8L14 3.5zM14 3.5V8h4.5",
  pdf: "M14 3.5H7a1.5 1.5 0 00-1.5 1.5v14A1.5 1.5 0 007 20.5h10a1.5 1.5 0 001.5-1.5V8L14 3.5zM14 3.5V8h4.5M8.5 13h7M8.5 16.5h4.5",
  sheet: "M5.5 4.5h13v15h-13zM5.5 9.5h13M5.5 14.5h13M10.5 4.5v15",
  slides: "M4 5h16v10H4zM12 15v4.5M8.5 19.5h7",
  image: "M4.5 5.5h15v13h-15zM4.5 15.5l4-4 3.5 3.5 2.5-2.5 5 5M15.5 9.5h.01",
  video: "M4 6.5h11v11H4zM15 10.5l5-3v9l-5-3",
  audio: "M5 14v-2a7 7 0 0114 0v2M5 14h2.5v5H5zM16.5 14H19v5h-2.5z",
  archive: "M4.5 7.5h15v12h-15zM3.5 4.5h17v3h-17zM10 11.5h4",
  folder: "M3.5 6.5a1 1 0 011-1h5l2 2.5h8a1 1 0 011 1v9a1 1 0 01-1 1h-15a1 1 0 01-1-1z",
  camera: "M4 8h3.5l1.5-2.5h6L16.5 8H20v11H4zM12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
  paperclip: "M19 11.5l-7.6 7.6a4.5 4.5 0 01-6.4-6.4L13 4.7a3 3 0 014.2 4.2l-7.9 7.9a1.5 1.5 0 01-2.1-2.1l7.3-7.3",
  check: "M5 12.5l4.5 4.5L19 7.5",
  close: "M6.5 6.5l11 11M17.5 6.5l-11 11",
  chevronDown: "M6.5 9.5L12 15l5.5-5.5",
  note: "M5 4.5h10.5L19 8v11.5H5zM8.5 10h7M8.5 13.5h7M8.5 17h4",
  warning: "M12 4.5l8.5 15h-17zM12 10.5v4M12 17.5h.01",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  pencil: "M15.5 4.5l4 4L9 19H5v-4zM13 7l4 4",
  shield: "M12 3.5l7 3v5.5c0 4.2-3 7.5-7 8.5-4-1-7-4.3-7-8.5V6.5z",
  wrench: "M14.7 6.3a4 4 0 00-5.4 5.4L3.5 17.5l3 3 5.8-5.8a4 4 0 005.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z",
  clipboard: "M9 4.5h6v2.5H9zM9 5.5H6v15h12v-15h-3M9 12l2 2 4-4",
  building: "M5 20.5v-15h9v15M14 9.5h5v11M8 9h3M8 12.5h3M8 16h3M3.5 20.5h17",
  trash: "M4.5 6.5h15M9.5 6.5V4.5h5v2M7 6.5l1 13h8l1-13",
  box: "M20.5 7.5L12 3.5 3.5 7.5v9l8.5 4 8.5-4zM3.5 7.5l8.5 4 8.5-4M12 11.5v9",
  money: "M3.5 6.5h17v11h-17zM12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM6.5 10v4M17.5 10v4",
  truck: "M3.5 6.5h10v9h-10zM13.5 9.5h4l3 3v3h-7M7 18.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 18.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
  minus: "M6 12h12",
  search: "M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM15.5 15.5L20 20",
  checkCircle: "M12 20.5a8.5 8.5 0 100-17 8.5 8.5 0 000 17zM8.5 12l2.5 2.5 4.5-5",
  plus: "M12 5.5v13M5.5 12h13",
} as const;

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, size = 16, className = "", label }: { name: GlyphName; size?: number; className?: string; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 align-[-0.15em] ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
