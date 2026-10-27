import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, toLang, type Lang } from "./tech";

/** The technician's chosen language (English unless he switched to Arabic). */
export async function getTechLang(): Promise<Lang> {
  return toLang((await cookies()).get(LANG_COOKIE)?.value);
}
