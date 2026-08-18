export function Spinner() {
  return (
    <div className="flex flex-1 items-center justify-center py-24">
      <div
        className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 border-t-brand"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
