import { requireAdvisorArea } from "@/lib/reception";
import { HomeScreen } from "@/components/home/home-screen";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const user = await requireAdvisorArea();
  return <HomeScreen user={user} area="advisor" />;
}
