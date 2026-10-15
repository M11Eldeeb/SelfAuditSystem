import { redirect } from "next/navigation";
import { getCurrentUser, homePathFor } from "@/lib/auth";
import { basePathFor, isWorkshopRole, type InquiryRole } from "@/lib/technical-inquiries";

/**
 * The link every Technical Inquiries mail points at: it sends each person to the case in their own part of the portal
 * (the technical team, an officer, a branch admin, a workshop supervisor or a team leader).
 */
export default async function TechnicalInquiryDoor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/technical-inquiries/${id}`)}`);
  if (user.role === "officer" || user.role === "technical" || isWorkshopRole(user.role)) redirect(`${basePathFor(user.role as InquiryRole)}/${id}`);
  redirect(homePathFor(user.role));
}
