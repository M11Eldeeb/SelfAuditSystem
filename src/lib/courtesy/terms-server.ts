import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { TERMS } from "./agreements";

export type Term = { en: string; ar: string };
export type TermsVersion = { id: string | null; branch_id: string | null; version: number; terms: Term[]; note: string; created_by_name: string | null; created_at: string | null };

// New table (migration 0198): untyped handle until the generated types know it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const termsTable = () => (createAdminClient() as any).from("self_audit_courtesy_terms");

/** The standard terms (no branch version yet). */
export const STANDARD: TermsVersion = { id: null, branch_id: null, version: 0, terms: TERMS, note: "Standard terms", created_by_name: null, created_at: null };

/** The branch's terms now: its latest version, else the standard ones. Never throws. */
export async function currentTerms(branchId: string): Promise<TermsVersion> {
  try {
    const { data } = await termsTable().select("*").eq("branch_id", branchId).order("version", { ascending: false }).limit(1).maybeSingle();
    return (data as TermsVersion | null) ?? STANDARD;
  } catch {
    return STANDARD;
  }
}

/** The terms an agreement was signed with (the standard ones when it has no version). */
export async function termsById(id: string | null | undefined): Promise<Term[]> {
  if (!id) return TERMS;
  try {
    const { data } = await termsTable().select("terms").eq("id", id).maybeSingle();
    return (data?.terms as Term[] | undefined) ?? TERMS;
  } catch {
    return TERMS;
  }
}

/** Every version of the branch's terms, newest first. */
export async function termsHistory(branchId: string): Promise<TermsVersion[]> {
  try {
    const { data } = await termsTable().select("*").eq("branch_id", branchId).order("version", { ascending: false });
    return (data ?? []) as TermsVersion[];
  } catch {
    return [];
  }
}
