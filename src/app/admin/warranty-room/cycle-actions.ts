"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { shiftMonth } from "@/lib/month";
import { AUDIT_CYCLE_DEADLINE_DAYS } from "@/lib/cycle";

export type GenerateWarrantyRoomCycleState = { error?: string; success?: string } | undefined;

/**
 * Warranty Room's own cycle, independent of the self-audit cycle
 * (self_audit_audit_cycles) it used to borrow - destroy evidence deadlines
 * shouldn't depend on when someone happens to generate a self-audit cycle.
 * Same 25-day deadline convention, its own month picker.
 */
export async function generateWarrantyRoomCycle(
  _prev: GenerateWarrantyRoomCycleState,
  formData: FormData
): Promise<GenerateWarrantyRoomCycleState> {
  const officer = await requireRole("officer");
  const supabase = await createClient();

  const cycleMonthInput = String(formData.get("cycle_month") ?? "");
  if (!cycleMonthInput) return { error: "Select the warranty room cycle's month." };

  const cycleMonth = shiftMonth(cycleMonthInput, 0);
  const deadlineAt = new Date(Date.now() + AUDIT_CYCLE_DEADLINE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase.from("self_audit_warranty_room_cycles").insert({
    cycle_month: cycleMonth,
    created_by: officer.id,
    deadline_at: deadlineAt,
  });

  if (error) {
    return {
      error: error.message.includes("duplicate")
        ? `A warranty room cycle for ${cycleMonthInput} already exists.`
        : error.message,
    };
  }

  revalidatePath("/admin/warranty-room");
  revalidatePath("/admin/warranty-room/destroy-evidence");
  revalidatePath("/audit/warranty-room");
  return { success: `Warranty room cycle for ${cycleMonthInput} created.` };
}
