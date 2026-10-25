/**
 * Page loading: a small car rolling along the road - wheels turning, lane marks passing - with the workshop's own
 * steps cycling underneath. Pure CSS (works before scripts); with Reduce Motion it stands still and says "Loading".
 */
export function Spinner() {
  return (
    <div className="flex flex-1 items-center justify-center py-24" role="status" aria-label="Loading">
      <div className="car-loader">
        <svg viewBox="0 0 132 56" width="132" height="56" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <g className="car-loader__body">
            {/* body */}
            <path
              d="M10 37V31.5c0-2 1.3-3.6 3.2-4.1L28 23.5l11.5-9.3A7 7 0 0 1 44 12.6h28.5a7 7 0 0 1 5 2.1l9.3 9 19.6 3.1c3 .5 5.1 3 5.1 6V37"
              stroke="currentColor"
              strokeWidth="2.2"
            />
            <path d="M10 37h12M42 37h44M108 37h5" stroke="currentColor" strokeWidth="2.2" />
            {/* windows */}
            <path d="M33 24l9-7.4h13.5V24zM60 16.6h12.3a4 4 0 0 1 2.9 1.2L81 24H60z" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
            {/* lights */}
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
        <div className="car-loader__steps">
          <span>Opening the job card…</span>
          <span>Checking the VIN…</span>
          <span>Reading the claims…</span>
          <span>Torquing the numbers…</span>
        </div>
        <span className="car-loader__static">Loading…</span>
      </div>
    </div>
  );
}
