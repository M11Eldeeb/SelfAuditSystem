import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getNotifications } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/** Polled by the bell in the top bar so the count updates without a page reload. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json(await getNotifications(user, { includeTasks: true }), { headers: { "Cache-Control": "no-store" } });
}
