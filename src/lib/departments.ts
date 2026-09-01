import type { DepartmentId } from "@/lib/supabase/types";

export const DEPARTMENT_ORDER: DepartmentId[] = ["reception", "workshop", "parts", "warrantyops", "branchops"];

export const DEPARTMENT_LABELS: Record<DepartmentId, string> = {
  reception: "Reception",
  workshop: "Workshop",
  parts: "Parts",
  warrantyops: "Warranty Administrator",
  branchops: "Branch Operation",
};
