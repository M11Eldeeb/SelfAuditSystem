import "server-only";
import { headers } from "next/headers";

/** The address the portal is being used at (https://...), for links inside e-mails. Works in a server action or a page. */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}
