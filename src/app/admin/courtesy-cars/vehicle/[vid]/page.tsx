import { requireRole } from "@/lib/auth";
import { VehiclePage } from "@/components/courtesy/fleet-pages";

/** One courtesy car: its state, service, actions and history. */
export default async function Page({ params }: { params: Promise<{ vid: string }> }) {
  await requireRole("officer");
  const { vid } = await params;
  return <VehiclePage id={vid} base="/admin/courtesy-cars" />;
}
