/** The roles an account can have (create and edit forms), in the order the menu lists them. */
export const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "branch_admin", label: "Branch admin" },
  { value: "officer", label: "Warranty officer" },
  { value: "technical", label: "Technical team" },
  { value: "workshop_supervisor", label: "Workshop supervisor" },
  { value: "team_leader", label: "Team leader" },
  { value: "national_manager", label: "National Manager (all branches, view only)" },
  { value: "manager", label: "Manager (all branches, view only)" },
  { value: "data_analyst", label: "Data Analyst (Sub-Dealer Analytics only)" },
  { value: "service_manager", label: "Service manager (own branch, view only)" },
  { value: "technician", label: "Technician" },
  { value: "claims_reviewer", label: "Technician claims reviewer" },
  { value: "service_advisor", label: "Service advisor" },
  { value: "quality_controller", label: "Quality controller" },
  { value: "quality_supervisor", label: "Quality supervisor (QC of all branches)" },
  { value: "queue_user", label: "Customer queue only (e.g. parts advisor, reception)" },
];

/** Roles that work in one branch (the branch is required); queue-only accounts may have one too. */
export const BRANCH_ROLES = ["branch_admin", "workshop_supervisor", "team_leader", "service_manager", "technician", "claims_reviewer", "service_advisor", "quality_controller"];

/** The "Customer queue" choice's first option, by role. */
export const queueDefaultLabel = (role: string) =>
  role === "service_advisor" ? "Service advisor (from the role)" : role === "service_manager" ? "Queue manager (from the role)" : role === "queue_user" ? "Select" : "No queue access";
