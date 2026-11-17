import type { Metadata } from "next";
import { branchByCode } from "@/lib/queue/server";
import { TvDisplay } from "@/components/queue/tv-display";
import { NotFoundCard } from "@/components/queue/not-found-card";

export const metadata: Metadata = { title: "Queue display · MG", robots: { index: false } };

/** The branch TV (any smart TV / tablet browser; no sign-in). Ticket numbers and advisor names only. */
export default async function DisplayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const branch = await branchByCode(code);
  if (!branch) return <NotFoundCard en="Branch not found." ar="الفرع غير موجود." />;
  return <TvDisplay branch={{ id: branch.id, name: branch.name, name_ar: branch.name_ar }} />;
}
