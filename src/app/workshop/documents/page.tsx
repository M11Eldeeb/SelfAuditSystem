import { requireAnyRole } from "@/lib/auth";
import { DocumentsSection } from "@/components/documents/documents-section";

export const maxDuration = 60;

export default async function WorkshopDocumentsPage() {
  const user = await requireAnyRole(["workshop_supervisor", "team_leader"]);
  return <DocumentsSection user={user} />;
}
