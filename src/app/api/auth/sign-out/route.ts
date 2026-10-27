import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign out as a plain form post (not a script action): it works even when the page's JavaScript is busy, and the
 * phone shows its own loading bar while it happens.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut().catch(() => undefined);
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
