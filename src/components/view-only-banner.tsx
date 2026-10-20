/** Shown on every page a view-only account opens (service manager, or a view_all user on the officer's pages). */
export function ViewOnlyBanner({ note }: { note?: string }) {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900" role="status">
      <span className="font-semibold">View only</span> - you can open and read everything here, but changes are not saved from this account.
      {note && <span className="ml-1">{note}</span>}
    </div>
  );
}
