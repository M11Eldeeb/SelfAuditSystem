import { notFound } from "next/navigation";
import { requireAdvisorArea } from "@/lib/reception";
import { MsiPageContent } from "@/components/msi/msi-page";
import { msiScopeFor } from "@/lib/msi/scope";

export const maxDuration = 60;

/** Major Service Indicators for the service advisor (and the reception team): his own branch only. */
export default async function MsiPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requireAdvisorArea();
  const scope = await msiScopeFor(user);
  if (!scope || scope.all) notFound();
  const { date } = await searchParams;
  return <MsiPageContent date={date} scope={scope} basePath="/advisor/msi" canRefresh={false} />;
}
