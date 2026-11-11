// Quality control: the fixed choices of the QC form (shared by the browser and the server).

export const QC_PURPOSES = [
  { key: "quality_control", label: "Quality Control" },
  { key: "test_drive_customer", label: "Test Drive - With Customer", group: "Test Drive" },
  { key: "test_drive_pre_repair", label: "Test Drive - Pre-Repair", group: "Test Drive" },
  { key: "test_drive_post_repair", label: "Test Drive - Post Repair", group: "Test Drive" },
  { key: "comeback", label: "Comeback" },
  { key: "diagnosis_verification", label: "Diagnosis Verification" },
] as const;
export type QcPurpose = (typeof QC_PURPOSES)[number]["key"];

export const QC_REPAIR_TYPES = [
  { key: "periodic_maintenance", label: "Periodic Maintenance" },
  { key: "general_repair", label: "General Repair" },
  { key: "both", label: "Both" },
] as const;
export type QcRepairType = (typeof QC_REPAIR_TYPES)[number]["key"];

/** For now a fixed list - each team leader / service advisor gets an account later. */
export const QC_TEAM_LEADERS = ["Yousef Hamed", "Ahmad Khalil"];
export const QC_SERVICE_ADVISORS = ["Amr Elsharbini", "Moayed Al Othman", "Mostafa Magdy", "Omar Kalantan"];

export const purposeLabel = (k: string | null | undefined) => QC_PURPOSES.find((p) => p.key === k)?.label ?? k ?? "—";
export const repairTypeLabel = (k: string | null | undefined) => QC_REPAIR_TYPES.find((p) => p.key === k)?.label ?? k ?? "—";

export type QcTechnician = { id: string | null; name: string };

export const QC_MAX_FILES = 40;
export const QC_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
