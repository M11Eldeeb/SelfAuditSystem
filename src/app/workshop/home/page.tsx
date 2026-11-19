import { requireAnyRole } from "@/lib/auth";
import { HomeScreen } from "@/components/home/home-screen";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const user = await requireAnyRole(["workshop_supervisor", "team_leader"]);
  return <HomeScreen user={user} area="workshop" />;
}
