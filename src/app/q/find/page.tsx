import type { Metadata } from "next";
import { FindTicket } from "@/components/queue/find-ticket";

export const metadata: Metadata = { title: "Find my ticket · MG Service Queue", robots: { index: false } };

/** "Find my ticket": the customer types the mobile they joined with (no sign-in). */
export default function FindTicketPage() {
  return <FindTicket />;
}
