"use client";

/**
 * One click downloads every video for this branch instead of clicking each
 * link separately. Browsers block a burst of simultaneous downloads
 * triggered from one gesture in some cases, so each click is staggered
 * slightly rather than fired all at once.
 */
export function DownloadAllButton({ urls }: { urls: string[] }) {
  function handleClick() {
    urls.forEach((url, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 400);
    });
  }

  if (urls.length === 0) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
    >
      Download all {urls.length} video(s)
    </button>
  );
}
