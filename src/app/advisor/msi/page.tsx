import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { MsiPageContent } from "@/components/msi/msi-page";
import { msiScopeFor } from "@/lib/msi/scope";

export const maxDuration = 60;

/** Major Service Indicators for the service advisor: his own branch only. */
export default async function MsiPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requireRole("service_advisor");
  const scope = await msiScopeFor(user);
  if (!scope || scope.all) notFound();
  const { date } = await searchParams;
  return <MsiPageContent date={date} scope={scope} basePath="/advisor/msi" canRefresh={false} />;
}
