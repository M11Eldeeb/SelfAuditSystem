import type { Metadata } from "next";
import { branchByCode, branchReceiving } from "@/lib/queue/server";
import { JoinForm } from "@/components/queue/join-form";
import { NotFoundCard } from "@/components/queue/not-found-card";

export const metadata: Metadata = { title: "MG Service Queue", robots: { index: false } };

/** The branch's QR code / kiosk: the customer joins the queue (no sign-in). */
export default async function JoinQueuePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const branch = await branchByCode(code);
  if (!branch) return <NotFoundCard en="Branch not found - check the QR code." ar="الفرع غير موجود - تحقق من رمز QR." />;
  const { receiving } = await branchReceiving(branch.id);
  return <JoinForm branch={{ id: branch.id, name: branch.name, name_ar: branch.name_ar, status: branch.queue_status }} receiving={receiving} />;
}
