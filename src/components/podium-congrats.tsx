"use client";

import { useRef, useState } from "react";
import { Podium } from "./podium";
import type { StandingsEntry } from "@/lib/standings";
import { sendDirectMail } from "@/app/actions/direct-mail";

/**
 * The podium as a picture plus the congratulations e-mail: "Send" captures the
 * podium exactly as rendered here and sends the mail straight from the
 * warranty mailbox (branch admins in To, warranty head/fellow officer/branch
 * managers in Cc) with that image attached. "Download" just saves the image.
 */
export function PodiumCongrats({
  entries,
  cycleLabel,
  toEmails,
  ccEmails,
}: {
  entries: StandingsEntry[];
  cycleLabel: string;
  toEmails: string[];
  ccEmails: string[];
}) {
  const podiumRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const top3 = entries.slice(0, 3);
  if (top3.length === 0) return <Podium entries={entries} />;

  async function capture(): Promise<string> {
    const { domToPng } = await import("modern-screenshot");
    const node = podiumRef.current!;
    node.classList.add("theme-light");
    try {
      return await domToPng(node, { backgroundColor: "#ffffff", scale: 2 });
    } finally {
      node.classList.remove("theme-light");
    }
  }

  async function handleSend() {
    if (!podiumRef.current) return;
    setError(null);
    setSent(null);
    setSending(true);
    try {
      const dataUrl = await capture();
      const res = await sendDirectMail({
        kind: "podium-congrats",
        to: [...new Set(toEmails)],
        cc: [...new Set(ccEmails)],
        subject,
        text: body,
        attachment: { filename: `podium-${cycleLabel.toLowerCase().replace(/\s+/g, "-")}.png`, mimeType: "image/png", base64: dataUrl.split(",")[1] ?? "" },
      });
      if (res.error) setError(res.error);
      else setSent(`Sent to ${toEmails.length} branch admin${toEmails.length === 1 ? "" : "s"} with the podium image attached.`);
    } catch {
      setError("Could not send the e-mail - please try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleDownload() {
    if (!podiumRef.current) return;
    setError(null);
    setDownloading(true);
    try {
      // html2canvas can't parse the oklch() colors Tailwind v4's default
      // palette renders as (a documented html2canvas/Tailwind-v4 mismatch -
      // it throws on any computed color in a color space it doesn't
      // recognize). modern-screenshot handles oklch/color-mix natively.
      const { domToPng } = await import("modern-screenshot");
      // The e-mailed image is always light, whatever theme the officer is viewing in:
      // force the light palette on the captured element for the duration of the capture.
      const node = podiumRef.current;
      node.classList.add("theme-light");
      let dataUrl: string;
      try {
        dataUrl = await domToPng(node, { backgroundColor: "#ffffff", scale: 2 });
      } finally {
        node.classList.remove("theme-light");
      }
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

  const to = [...new Set(toEmails)].join(",");
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
    "JMM Warranty Team",
  ].join("\n");

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
          {downloading ? "Preparing image..." : "Download podium image"}
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || toEmails.length === 0}
          title={[to && `To: ${to}`, cc && `Cc: ${cc}`].filter(Boolean).join("\n")}
          className="rounded-lg bg-brand shadow-sm shadow-brand/25 hover:shadow-md hover:shadow-brand/30 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {sending ? "Sending..." : "Send congratulations email"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {sent && <p className="text-xs text-emerald-700">{sent}</p>}
    </div>
  );
}
