import type { CurrentUser } from "@/lib/auth";
import { homeKpisFor } from "@/lib/home/kpis";
import { homeActionsFor } from "@/lib/home/actions";
import { cleanHomeLayout } from "@/lib/home/layout";
import { HomeBoard } from "@/components/home/home-board";

/** Every area's Home page: the person's widgets and the figures of their own work. */
export async function HomeScreen({ user, area }: { user: CurrentUser; area: string }) {
  const [kpis, actions] = await Promise.all([homeKpisFor(user, area), homeActionsFor(user, area)]);
  const first = (user.full_name ?? "").trim().split(/\s+/)[0] ?? "";
  return <HomeBoard firstName={first} initial={user.home_layout ? cleanHomeLayout(user.home_layout) : null} kpis={kpis} actions={actions} />;
}
