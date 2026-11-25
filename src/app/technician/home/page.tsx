import { requireTechnician } from "@/lib/tech-claims/access";
import { HomeScreen } from "@/components/home/home-screen";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const user = await requireTechnician();
  return <HomeScreen user={user} area="technician" />;
}
