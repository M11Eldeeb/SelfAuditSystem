"use server";

import { requireAnyViewer } from "@/lib/auth";
import { isReception } from "@/lib/reception";
import { runVehicleQuery, type QueryResult } from "@/lib/query/vehicle";

/** Warranty officers and national managers (every branch), service managers and the queue's reception team (their branch): everything known about a WIP, VIN, plate or claim. */
export async function vehicleQuery(input: string, branchId: string | null = null): Promise<QueryResult> {
  const user = await requireAnyViewer(["officer", "branch_admin", "queue_user"]);
  const allowed = user.role === "officer" ? user.managerKind !== "manager" : user.role === "queue_user" ? isReception(user) : user.managerKind === "service_manager";
  if (!allowed) return { query: String(input ?? ""), sections: [], error: "Query is not available for this account." };
  try {
    return await runVehicleQuery(user, String(input ?? ""), branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : null, user.role === "officer" ? "/admin" : user.role === "queue_user" ? null : "/audit");
  } catch (e) {
    return { query: String(input ?? ""), sections: [], error: e instanceof Error ? `Could not finish the search: ${e.message}` : "Could not finish the search." };
  }
}
