"use client";

import { useRef, useState } from "react";
import { Podium } from "./podium";
import type { StandingsEntry } from "@/lib/standings";

/**
 * A mailto: link can't carry an attachment - there's no such thing as a
 * mailto attachment, in any browser or mail client. So this is a two-step,
 * fully manual flow by necessity: download an image of the podium exactly as
 * rendered here, then the mailto link opens a draft with everyone CC'd and
 * the congratulations text ready, for the officer to attach that image to
 * and send themselves. Nothing is sent automatically.
 */
export function PodiumCongrats({
  entries,
  cycleLabel,
  ccEmails,
}: {
  entries: StandingsEntry[];
  cycleLabel: string;
  ccEmails: string[];
}) {
  const podiumRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const top3 = entries.slice(0, 3);
  if (top3.length === 0) return <Podium entries={entries} />;

  async function handleDownload() {
    if (!podiumRef.current) return;
    setError(null);
    setDownloading(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(podiumRef.current, { backgroundColor: "#ffffff", scale: 2 });
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `podium-${cycleLabel.toLowerCase().replace(/\s+/g, "-")}.png`;
      a.click();
    } catch {
      setError("Could not generate the podium image - try again, or take a screenshot instead.");
    } finally {
      setDownloading(false);
    }
  }

  const cc = [...new Set(ccEmails)].join(",");
  const subject = `${cycleLabel} Self-Audit — Top Performing Branches`;
  const ranked = top3.map((e, i) => `${i + 1}. ${e.name} — ${e.avg}%`).join("\n");
  const body = [
    "Dear team,",
    "",
    `Congratulations to this month's top-performing branches in the ${cycleLabel} self-audit cycle:`,
    "",
    ranked,
    "",
    "Great work maintaining such high standards in claims documentation and compliance. Keep it up.",
    "",
    "To every other branch: thank you for your continued effort and participation this cycle. We encourage you to keep pushing forward and aim for a podium finish next month.",
    "",
    "Best regards,",
    "Warranty Audit Team",
  ].join("\n");
  const mailtoHref = `mailto:?cc=${encodeURIComponent(cc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <div className="space-y-3">
      <div ref={podiumRef} className="bg-white">
        <Podium entries={entries} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="rounded-lg border border-neutral-300 bg-white shadow-sm px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
        >
          {downloading ? "Preparing image..." : "1. Download podium image"}
        </button>
        <a
          href={mailtoHref}
          className="rounded-lg bg-brand shadow-sm shadow-brand/25 hover:shadow-md hover:shadow-brand/30 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark"
        >
          2. Compose congratulations email
        </a>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-xs text-neutral-500">
        Download the image, then attach it to the draft before sending - a mailto link can&apos;t attach files on its own.
      </p>
    </div>
  );
}
