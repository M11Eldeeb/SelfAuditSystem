/** The car itself: line-drawn sedan, turning wheels, passing lane marks. Driving right (red tail light at the back). */
function Car({ width }: { width: number }) {
  return (
    <svg viewBox="0 0 132 56" width={width} height={(width * 56) / 132} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g className="car-loader__body">
        <path
          d="M10 37V31.5c0-2 1.3-3.6 3.2-4.1L28 23.5l11.5-9.3A7 7 0 0 1 44 12.6h28.5a7 7 0 0 1 5 2.1l9.3 9 19.6 3.1c3 .5 5.1 3 5.1 6V37"
          stroke="currentColor"
          strokeWidth="2.2"
        />
        <path d="M10 37h12M42 37h44M108 37h5" stroke="currentColor" strokeWidth="2.2" />
        <path d="M33 24l9-7.4h13.5V24zM60 16.6h12.3a4 4 0 0 1 2.9 1.2L81 24H60z" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
        <path d="M110.5 29.5h2.5" stroke="currentColor" strokeWidth="2.6" opacity="0.5" />
        <path d="M11.5 30h2.5" stroke="var(--brand)" strokeWidth="2.6" />
      </g>
      {[32, 97].map((cx) => (
        <g key={cx} className="car-loader__wheel" style={{ transformOrigin: `${cx}px 38px` }}>
          <circle cx={cx} cy="38" r="7.5" stroke="currentColor" strokeWidth="2.2" />
          <circle cx={cx} cy="38" r="1.6" fill="currentColor" />
          <path d={`M${cx} 32.5v3M${cx} 40.5v3M${cx - 5.5} 38h3M${cx + 2.5} 38h3`} stroke="currentColor" strokeWidth="1.4" />
        </g>
      ))}
      <line className="car-loader__road" x1="0" y1="50" x2="132" y2="50" stroke="currentColor" strokeWidth="1.6" strokeDasharray="10 8" opacity="0.35" />
    </svg>
  );
}

const STEPS = ["Opening the job card…", "Checking the VIN…", "Reading the claims…", "Torquing the numbers…"];

/**
 * Loading: a small car rolling along the road with the workshop's steps cycling underneath. Pure CSS (works before
 * scripts); with Reduce Motion it stands still and says "Loading". `compact` fits inside a card; `label` replaces the
 * cycling steps with one line (e.g. "Loading trends…").
 */
export function CarLoader({ compact = false, label, className = "" }: { compact?: boolean; label?: string; className?: string }) {
  return (
    <div className={`car-loader ${compact ? "car-loader--compact" : ""} ${className}`} role="status" aria-label={label ?? "Loading"}>
      <Car width={compact ? 92 : 132} />
      {label ? (
        <span className="car-loader__label">{label}</span>
      ) : (
        <>
          <div className="car-loader__steps">
            {STEPS.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </div>
          <span className="car-loader__static">Loading…</span>
        </>
      )}
    </div>
  );
}

/** A panel-sized placeholder: the card's outline with the compact car in the middle. */
export function CarLoaderCard({ height = "h-64", label }: { height?: string; label?: string }) {
  return (
    <div className={`flex ${height} items-center justify-center rounded-2xl bg-white ring-1 ring-black/[0.05]`}>
      <CarLoader compact label={label} />
    </div>
  );
}

/** Whole-page loading. */
export function Spinner() {
  return (
    <div className="flex flex-1 items-center justify-center py-24">
      <CarLoader />
    </div>
  );
}

/** A tiny car that drives across the top edge of the screen while something updates (e.g. a dashboard filter). */
export function CarProgress({ active }: { active: boolean }) {
  return (
    <div className={`car-progress ${active ? "car-progress--on" : ""}`} aria-hidden={!active} role={active ? "status" : undefined} aria-label={active ? "Updating" : undefined}>
      <div className="car-progress__car">
        <Car width={46} />
      </div>
    </div>
  );
}
