import type { Metadata } from "next";
import { getTicketView } from "@/app/actions/queue-public";
import { vapidPublicKey } from "@/lib/queue/server";
import { TicketTracker } from "@/components/queue/ticket-tracker";
import { NotFoundCard } from "@/components/queue/not-found-card";

export const metadata: Metadata = { title: "My ticket · MG Service Queue", robots: { index: false } };

/** The customer's ticket page (the link they get on joining; no sign-in). */
export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getTicketView(id);
  if (!view) return <NotFoundCard en="Ticket not found." ar="التذكرة غير موجودة." />;
  return <TicketTracker initial={view} vapidKey={vapidPublicKey()} />;
}
