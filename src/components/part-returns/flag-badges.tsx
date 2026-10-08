import type { PartFlag } from "@/lib/part-return-flags";

const STYLE: Record<PartFlag["kind"], { label: string; cls: string }> = {
  scrapped: { label: "Scrapped", cls: "bg-neutral-900 text-white" },
  flagged: { label: "Flagged to scrap", cls: "bg-red-100 text-red-800 ring-1 ring-red-300" },
  supplier: { label: "Supplier list", cls: "bg-violet-100 text-violet-800 ring-1 ring-violet-300" },
};

/** Inline warnings next to a part: scrapped / flagged to be scrapped / supplier list. */
export function FlagBadges({ flags }: { flags: PartFlag[] | undefined }) {
  if (!flags?.length) return null;
  return (
    <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
      {flags.map((f) => (
        <span key={f.kind} title={f.detail} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${STYLE[f.kind].cls}`}>
          ⚠ {STYLE[f.kind].label}
        </span>
      ))}
    </span>
  );
}
