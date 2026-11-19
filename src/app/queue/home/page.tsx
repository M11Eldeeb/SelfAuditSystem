import { requireQueueAccess } from "@/lib/queue/server";
import { HomeScreen } from "@/components/home/home-screen";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const user = (await requireQueueAccess()).user;
  return <HomeScreen user={user} area="queue" />;
}
