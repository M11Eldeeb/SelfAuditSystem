import { requireRole } from "@/lib/auth";
import { DocumentsSection } from "@/components/documents/documents-section";

// Reading both Drive folder trees can take a while the first time.
export const maxDuration = 60;

export default async function AdminDocumentsPage({ searchParams }: { searchParams: Promise<{ mail?: string }> }) {
  const user = await requireRole("officer");
  const { mail } = await searchParams;
  return <DocumentsSection user={user} flag={mail} />;
}
