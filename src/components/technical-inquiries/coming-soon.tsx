/** Shown to branch admins until Technical Inquiries is unlocked for them. */
export function InquiriesComingSoon() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/10 text-brand ring-8 ring-brand/5">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="12" cy="15.2" r="1.2" fill="currentColor" />
        </svg>
      </span>
      <p className="mb-2 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold tracking-wider text-amber-800 uppercase ring-1 ring-amber-200 ring-inset">
        Coming soon
      </p>
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Technical Inquiries</h1>
      <p className="mt-2 text-sm text-neutral-600">
        A direct line to the technical team for workshop problems that need technical help - with the vehicle details, photos and videos in one
        place and the answer tracked until the case is closed. It is not open to branch admins yet - you will be told when it is.
      </p>
    </div>
  );
}
