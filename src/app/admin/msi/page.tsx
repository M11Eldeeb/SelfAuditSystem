import { requireRole } from "@/lib/auth";
import { MsiPageContent } from "@/components/msi/msi-page";

// The first visit reads the newest e-mail and its ~10 MB Excel file when nothing is stored yet.
export const maxDuration = 60;

/** Major Service Indicators for the warranty officer, the manager and the national manager: every branch. */
export default async function MsiPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requireRole("officer");
  const { date } = await searchParams;
  return <MsiPageContent date={date} scope={{ all: true }} basePath="/admin/msi" canRefresh={!user.viewOnly} />;
}
