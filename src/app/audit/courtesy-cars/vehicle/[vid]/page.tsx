import { requireRole } from "@/lib/auth";
import { VehiclePage } from "@/components/courtesy/fleet-pages";

/** One courtesy car: its state, service, actions and history. */
export default async function Page({ params }: { params: Promise<{ vid: string }> }) {
  await requireRole("branch_admin");
  const { vid } = await params;
  return <VehiclePage id={vid} base="/audit/courtesy-cars" />;
}
