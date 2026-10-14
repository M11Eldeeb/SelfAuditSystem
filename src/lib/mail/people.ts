import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { PODIUM_STANDING_CC, WARRANTY_HEAD_EMAIL } from "@/lib/mail/contacts";
import { MAIL_DEFS, MAIL_KEYS_IN_ORDER, resolveTemplate, type MailKey, type MailOverride, type ResolvedTemplate } from "@/lib/mail/catalog";

// A real-looking address only: a test account such as "c@c" is left out instead of making the whole mail fail.
export const VALID_EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

const admin = () => createAdminClient();

export type People = {
  officers: string[];
  adminsByBranch: Map<string, string[]>;
  managersByBranch: Map<string, string[]>;
  supervisorsByBranch: Map<string, string[]>;
  teamLeadersByBranch: Map<string, string[]>;
  /** The technical team's accounts (self_audit_users with the technical role). */
  technical: string[];
  branchName: Map<string, string>;
  /** Branches that are still open - a closed branch gets no mail. */
  activeBranches: Set<string>;
  /** The standing lists an officer can edit under Email settings. */
  head: string[];
  aftersales: string[];
  standing: string[];
};

export async function loadPeople(): Promise<People> {
  const [{ data: users }, { data: contacts }, { data: branches }, { data: lists }] = await Promise.all([
    admin().from("self_audit_users").select("email, role, branch_id"),
    admin().from("self_audit_branch_contacts").select("branch_id, email, role"),
    admin().from("self_audit_branches").select("id, name, active"),
    admin().from("self_audit_mail_lists").select("key, emails"),
  ]);
  const adminsByBranch = new Map<string, string[]>();
  for (const u of users ?? []) {
    if (u.role === "branch_admin" && u.branch_id && u.email && VALID_EMAIL.test(u.email)) adminsByBranch.set(u.branch_id, [...(adminsByBranch.get(u.branch_id) ?? []), u.email.toLowerCase()]);
  }
  const managersByBranch = new Map<string, string[]>();
  const supervisorsByBranch = new Map<string, string[]>();
  const teamLeadersByBranch = new Map<string, string[]>();
  for (const c of contacts ?? []) {
    const target = c.role === "workshop_supervisor" ? supervisorsByBranch : c.role === "workshop_team_leader" ? teamLeadersByBranch : managersByBranch;
    target.set(c.branch_id, [...(target.get(c.branch_id) ?? []), c.email.toLowerCase()]);
  }
  const list = (key: string, fallback: string[]) => lists?.find((l) => l.key === key)?.emails ?? fallback;
  return {
    officers: [...new Set((users ?? []).filter((u) => u.role === "officer" && u.email && VALID_EMAIL.test(u.email)).map((u) => u.email.toLowerCase()))],
    adminsByBranch,
    managersByBranch,
    supervisorsByBranch,
    teamLeadersByBranch,
    technical: [...new Set((users ?? []).filter((u) => u.role === "technical" && u.email && VALID_EMAIL.test(u.email)).map((u) => u.email.toLowerCase()))],
    branchName: new Map((branches ?? []).map((b) => [b.id, b.name])),
    activeBranches: new Set((branches ?? []).filter((b) => b.active).map((b) => b.id)),
    head: list("warranty_head", [WARRANTY_HEAD_EMAIL]).map((e) => e.toLowerCase()),
    aftersales: list("aftersales_head", []).map((e) => e.toLowerCase()),
    standing: list("standing_managers", PODIUM_STANDING_CC).map((e) => e.toLowerCase()),
  };
}

/** What an officer has saved for each mail, merged over the built-in wording. */
export async function loadTemplates(): Promise<Record<MailKey, ResolvedTemplate>> {
  const { data } = await admin().from("self_audit_mail_templates").select("*");
  const saved = new Map((data ?? []).map((r) => [r.key, r]));
  return Object.fromEntries(
    MAIL_KEYS_IN_ORDER.map((key) => {
      const r = saved.get(key);
      const override: MailOverride | null = r
        ? { subject: r.subject, body: r.body, cc_groups: r.cc_groups as MailOverride["cc_groups"], extra_to: r.extra_to, extra_cc: r.extra_cc, settings: (r.settings ?? {}) as MailOverride["settings"] }
        : null;
      return [key, resolveTemplate(MAIL_DEFS[key], override)];
    })
  ) as Record<MailKey, ResolvedTemplate>;
}

const unique = (list: string[]) => [...new Set(list.map((e) => e.trim().toLowerCase()).filter((e) => VALID_EMAIL.test(e)))];

/**
 * The To and Cc of one mail: the people the mail is for, plus what the template adds.
 * The Cc always comes in this order, and a group that is not ticked is simply skipped (the next one moves up):
 *   1. the warranty head   2. the aftersales head (Ahmed Mahmod)   3. the extra addresses typed for this mail
 *   4. the service manager(s)   5. the workshop supervisor(s)   6. the workshop team leader(s)   7. the officers
 *   8. the technical team   9. the standing managers.
 * Someone who is in two groups appears once, at the earliest place.
 * Service managers are the branch's own (branchId), or those of several branches (branchIds), or of every branch.
 */
export function recipientsFor(t: ResolvedTemplate, people: People, opts: { to: string[]; branchId?: string; branchIds?: string[] }): { to: string[]; cc: string[] } {
  const ofBranches = (byBranch: Map<string, string[]>) =>
    opts.branchId
      ? (byBranch.get(opts.branchId) ?? [])
      : [...new Set((opts.branchIds ?? [...byBranch.keys()]).flatMap((id) => byBranch.get(id) ?? []))];
  const managers = ofBranches(people.managersByBranch);
  const has = (g: string) => (t.ccGroups as string[]).includes(g);
  return {
    to: unique([...opts.to, ...t.extraTo]),
    cc: unique([
      ...(has("head") ? people.head : []),
      ...(has("aftersales_head") ? people.aftersales : []),
      ...t.extraCc,
      ...(has("service_managers") ? managers : []),
      ...(has("workshop_supervisors") ? ofBranches(people.supervisorsByBranch) : []),
      ...(has("workshop_team_leaders") ? ofBranches(people.teamLeadersByBranch) : []),
      ...(has("officers") ? people.officers : []),
      ...(has("technical_team") ? people.technical : []),
      ...(has("standing") ? people.standing : []),
    ]),
  };
}
