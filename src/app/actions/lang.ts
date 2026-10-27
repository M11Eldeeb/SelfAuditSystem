"use server";

import { cookies } from "next/headers";
import { LANG_COOKIE, toLang, type Lang } from "@/lib/i18n/tech";

/** The technician screens' language (English / Arabic), kept for a year. */
export async function setTechLang(lang: Lang): Promise<void> {
  (await cookies()).set(LANG_COOKIE, toLang(lang), { path: "/", maxAge: 31_536_000, sameSite: "lax" });
}
