import { requireRole } from "@/lib/auth";
import { DocumentsSection } from "@/components/documents/documents-section";

export const maxDuration = 60;

export default async function TechnicalDocumentsPage() {
  const user = await requireRole("technical");
  return <DocumentsSection user={user} />;
}
