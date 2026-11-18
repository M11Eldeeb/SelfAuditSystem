import "server-only";
import { redirect } from "next/navigation";
import { requireAnyRole, type CurrentUser } from "@/lib/auth";

/**
 * The reception team in the customer queue (queue-only accounts that are service advisors or the queue / reception
 * manager) use the service advisor's pages too: Major Service Indicators, Complaints, Open WIPs, VOR Part Query,
 * Courtesy Cars, and Query. Spare parts staff do not.
 */
export const isReception = (u: Pick<CurrentUser, "role" | "queue_role">) => u.role === "queue_user" && (u.queue_role === "advisor" || u.queue_role === "manager");

/** A service advisor page: the service advisor, or the reception team. */
export async function requireAdvisorArea(): Promise<CurrentUser> {
  const user = await requireAnyRole(["service_advisor", "queue_user"]);
  if (user.role === "queue_user" && !isReception(user)) redirect("/queue");
  return user;
}

/** In a server action shared with other roles: a queue-only account that is not reception gets nothing. */
export function refuseNonReception(u: Pick<CurrentUser, "role" | "queue_role">) {
  if (u.role === "queue_user" && !isReception(u)) throw new Error("Not available for this account.");
}

/** Does a complaint's advisor name (as typed in the complaints file) mean this person? */
export function sameAdvisor(fileName: string | null | undefined, user: Pick<CurrentUser, "full_name" | "email">): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z؀-ۿ ]/g, " ").replace(/\s+/g, " ").trim();
  const a = norm(fileName ?? "");
  const b = norm(user.full_name || user.email.split("@")[0].replace(/[._]/g, " "));
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  // First and last name the same ("Omar Abdulhadi Kalantan" = "Omar Kalantan"), allowing a spelling difference of up
  // to 2 letters in longer names ("Mustafa" / "Mostafa", "Alothman" / "Alosman").
  const ta = a.split(" ");
  const tb = b.split(" ");
  return close(ta[0], tb[0]) && close(ta[ta.length - 1], tb[tb.length - 1]);
}

function close(x: string, y: string): boolean {
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 4) return false;
  // Levenshtein distance, stopped once it is over 2.
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    if (Math.min(...cur) > 2) return false;
    prev = cur;
  }
  return prev[y.length] <= 2;
}
