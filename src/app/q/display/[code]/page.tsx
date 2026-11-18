import type { Metadata } from "next";
import QRCode from "qrcode";
import { siteOrigin } from "@/lib/site-origin";
import { branchByCode } from "@/lib/queue/server";
import { TvDisplay } from "@/components/queue/tv-display";
import { NotFoundCard } from "@/components/queue/not-found-card";

export const metadata: Metadata = { title: "Queue display · MG", robots: { index: false } };

/** The branch TV (any smart TV / tablet browser; no sign-in). Ticket numbers and advisor names only. */
export default async function DisplayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const branch = await branchByCode(code);
  if (!branch) return <NotFoundCard en="Branch not found." ar="الفرع غير موجود." />;
  // The branch's join page as a QR code, so customers in the waiting area can scan it from the TV.
  const qrSvg = await QRCode.toString(`${await siteOrigin()}/q/${branch.queue_code}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return <TvDisplay branch={{ id: branch.id, name: branch.name, name_ar: branch.name_ar }} qrSvg={qrSvg} />;
}
