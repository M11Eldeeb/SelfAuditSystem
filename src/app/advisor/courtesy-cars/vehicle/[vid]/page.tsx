import { requireAdvisorArea } from "@/lib/reception";
import { VehiclePage } from "@/components/courtesy/fleet-pages";

/** One courtesy car: its state, service, actions and history. */
export default async function Page({ params }: { params: Promise<{ vid: string }> }) {
  await requireAdvisorArea();
  const { vid } = await params;
  return <VehiclePage id={vid} base="/advisor/courtesy-cars" />;
}
