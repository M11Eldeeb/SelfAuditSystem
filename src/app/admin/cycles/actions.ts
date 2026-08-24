"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { shiftMonth } from "@/lib/month";
import { shuffle } from "@/lib/shuffle";

const CLAIMS_PER_BRANCH = 10;

export type GenerateCycleState =
  | {
      error?: string;
      success?: string;
      perBranch?: { branchName: string; available: number; assigned: number }[];
    }
  | undefined;

export async function generateCycle(
  _prev: GenerateCycleState,
  formData: FormData
): Promise<GenerateCycleState> {
  const officer = await requireRole("officer");

  const cycleMonthInput = String(formData.get("cycle_month") ?? "");
  if (!cycleMonthInput) {
    return { error: "Select the audit cycle's month." };
  }

  const cycleMonth = shiftMonth(cycleMonthInput, 0);
  const claimsMonth = shiftMonth(cycleMonthInput, -1);

  const supabase = await createClient();

  const { data: branches } = await supabase
    .from("branches")
    .select("id, name")
    .eq("active", true)
    .order("name");
  if (!branches || branches.length === 0) {
    return { error: "Add at least one active branch first." };
  }

  const { data: cycle, error: cycleError } = await supabase
    .from("audit_cycles")
    .insert({
      cycle_month: cycleMonth,
      claims_month: claimsMonth,
      status: "open",
      created_by: officer.id,
    })
    .select("id")
    .single();

  if (cycleError || !cycle) {
    return {
      error: cycleError?.message.includes("duplicate")
        ? `An audit cycle for ${cycleMonthInput} already exists.`
        : (cycleError?.message ?? "Could not create the cycle."),
    };
  }

  const perBranch: { branchName: string; available: number; assigned: number }[] = [];

  for (const branch of branches) {
    const { data: claims } = await supabase
      .from("claims")
      .select("id")
      .eq("branch_id", branch.id)
      .eq("has_parts", true)
      .gte("creation_date", claimsMonth)
      .lt("creation_date", cycleMonth);

    const available = claims ?? [];
    const selected = shuffle(available).slice(0, CLAIMS_PER_BRANCH);

    if (selected.length > 0) {
      const { error: assignError } = await supabase.from("audit_assignments").insert(
        selected.map((c) => ({
          cycle_id: cycle.id,
          branch_id: branch.id,
          claim_id: c.id,
          status: "not_started" as const,
        }))
      );
      if (assignError) {
        return { error: `Failed assigning claims for ${branch.name}: ${assignError.message}` };
      }
    }

    perBranch.push({ branchName: branch.name, available: available.length, assigned: selected.length });
  }

  revalidatePath("/admin/cycles");

  return {
    success: `Audit cycle for ${cycleMonthInput} created (auditing claims from ${claimsMonth.slice(0, 7)}).`,
    perBranch,
  };
}

// Deletes a cycle regardless of progress - including submitted/reviewed work,
// which is permanently lost (cascades away assignments, answers, photos, and
// ai_reviews). The confirm dialog on the client is the safety check here.
export async function deleteCycle(cycleId: string): Promise<{ error?: string }> {
  await requireRole("officer");

  const supabase = await createClient();

  const { error } = await supabase.from("audit_cycles").delete().eq("id", cycleId);
  if (error) return { error: error.message };

  revalidatePath("/admin/cycles");
  return {};
}
