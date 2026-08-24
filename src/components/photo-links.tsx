import type { PhotoStatus } from "@/lib/photo-status";

export function PhotoLinks({
  photoTypes,
  statusByType,
}: {
  photoTypes: { id: string; label: string }[];
  statusByType: Map<string, PhotoStatus>;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {photoTypes.map((pt) => {
        const status = statusByType.get(pt.id);

        if (status && "url" in status) {
          return (
            <a
              key={pt.id}
              href={status.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-100"
            >
              {pt.label}
            </a>
          );
        }

        if (status && "removed" in status) {
          return (
            <span
              key={pt.id}
              className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-400"
              title="Deleted from storage after the officer's review to save space"
            >
              {pt.label} (removed after review)
            </span>
          );
        }

        return (
          <span
            key={pt.id}
            className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-400"
          >
            {pt.label} (not uploaded)
          </span>
        );
      })}
    </div>
  );
}
