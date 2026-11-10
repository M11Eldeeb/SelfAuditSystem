/** Roles from the highest to the lowest: the Users list and the users download follow this order. An unknown role goes last. */
const ROLE_ORDER = ["officer", "service_manager", "finance", "technical", "claims_reviewer", "branch_admin", "workshop_supervisor", "team_leader", "service_advisor", "technician"];

const rank = (role: string | null | undefined) => {
  const i = ROLE_ORDER.indexOf(role ?? "");
  return i === -1 ? ROLE_ORDER.length : i;
};

/** Role (highest first), then branch name, then name (or e-mail). */
export function compareUsers(
  a: { role: string | null; branchName?: string | null; full_name?: string | null; email: string },
  b: { role: string | null; branchName?: string | null; full_name?: string | null; email: string }
): number {
  return (
    rank(a.role) - rank(b.role) ||
    (a.branchName ?? "").localeCompare(b.branchName ?? "") ||
    (a.full_name?.trim() || a.email).localeCompare(b.full_name?.trim() || b.email)
  );
}
