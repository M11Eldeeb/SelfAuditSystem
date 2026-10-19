/** The Saudi Riyal sign (drawn, so it shows on every device - most fonts do not have the new U+20C1 glyph yet). */
export function RiyalIcon({ className = "h-[0.85em] w-[0.85em]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`inline-block shrink-0 align-[-0.08em] ${className}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="SAR">
      <path d="M8.6 2.5v14.2c0 1.4-.9 2.3-2.4 2.7L3.5 20" />
      <path d="M14.2 1.8v16.4" />
      <path d="M2.8 11.2 20.8 7.4" />
      <path d="M2.8 16 20.8 12.2" />
      <path d="M14.8 21.6l6-1.3" />
    </svg>
  );
}

/** "<riyal> 1,234,567" */
export function Sar({ value, digits = 0, className = "" }: { value: number; digits?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap tabular-nums ${className}`}>
      <RiyalIcon />
      {value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}
    </span>
  );
}
