import { VehiclePage } from "@/components/courtesy/fleet-pages";
import { requireWorkshopCourtesy } from "../../access";

/** One courtesy car: its state, service, actions and history. */
export default async function Page({ params }: { params: Promise<{ vid: string }> }) {
  await requireWorkshopCourtesy();
  const { vid } = await params;
  return <VehiclePage id={vid} base="/workshop/courtesy-cars" />;
}
