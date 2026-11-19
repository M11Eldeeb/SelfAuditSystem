import { requireRole } from "@/lib/auth";
import { HomeScreen } from "@/components/home/home-screen";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const user = await requireRole("technician");
  return <HomeScreen user={user} area="technician" />;
}
