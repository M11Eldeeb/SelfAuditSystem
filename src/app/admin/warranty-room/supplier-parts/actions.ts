"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Direct officer shortcut - skips the full branch/supplier signature
 * ceremony (hand_over_supplier_collection, branch-admin only) for a
 * collection that was actually handed over some other way. Plain table
 * update: officers already have full RLS rights on self_audit_supplier_collections.
 */
export async function markSupplierCollectionSent(collectionId: string): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  const supabase = await createClient();

  const { error } = await supabase
    .from("self_audit_supplier_collections")
    .update({ status: "handed_over", handed_over_at: new Date().toISOString(), handed_over_by: officer.id })
    .eq("id", collectionId);
  if (error) return { error: error.message };

  revalidatePath("/admin/warranty-room/supplier-parts");
  revalidatePath(`/admin/warranty-room/supplier-parts/${collectionId}`);
  return {};
}

export async function deleteSupplierCollection(collectionId: string, redirectAfter?: boolean): Promise<{ error?: string }> {
  await requireRole("officer");
  const supabase = await createClient();

  const { error } = await supabase.from("self_audit_supplier_collections").delete().eq("id", collectionId);
  if (error) return { error: error.message };

  revalidatePath("/admin/warranty-room/supplier-parts");
  if (redirectAfter) redirect("/admin/warranty-room/supplier-parts");
  return {};
}
