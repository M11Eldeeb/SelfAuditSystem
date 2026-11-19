import type { CurrentUser } from "@/lib/auth";
import { homeKpisFor } from "@/lib/home/kpis";
import { cleanHomeLayout } from "@/lib/home/layout";
import { HomeBoard } from "@/components/home/home-board";

/** Every area's Home page: the person's widgets and the figures of their own work. */
export async function HomeScreen({ user, area }: { user: CurrentUser; area: string }) {
  const kpis = await homeKpisFor(user, area);
  const first = (user.full_name ?? "").trim().split(/\s+/)[0] ?? "";
  return <HomeBoard firstName={first} initial={user.home_layout ? cleanHomeLayout(user.home_layout) : null} kpis={kpis} />;
}
