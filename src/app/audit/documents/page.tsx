import { requireRole } from "@/lib/auth";
import { DocumentsSection } from "@/components/documents/documents-section";

export const maxDuration = 60;

export default async function BranchDocumentsPage() {
  const user = await requireRole("branch_admin");
  return <DocumentsSection user={user} />;
}
