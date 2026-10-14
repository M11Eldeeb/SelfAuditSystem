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
  branchName: Map<string, string>;
  /** The standing lists an officer can edit under Email settings. */
  head: string[];
  standing: string[];
};

export async function loadPeople(): Promise<People> {
  const [{ data: users }, { data: contacts }, { data: branches }, { data: lists }] = await Promise.all([
    admin().from("self_audit_users").select("email, role, branch_id"),
    admin().from("self_audit_branch_contacts").select("branch_id, email"),
    admin().from("self_audit_branches").select("id, name"),
    admin().from("self_audit_mail_lists").select("key, emails"),
  ]);
  const adminsByBranch = new Map<string, string[]>();
  for (const u of users ?? []) {
    if (u.role === "branch_admin" && u.branch_id && u.email && VALID_EMAIL.test(u.email)) adminsByBranch.set(u.branch_id, [...(adminsByBranch.get(u.branch_id) ?? []), u.email.toLowerCase()]);
  }
  const managersByBranch = new Map<string, string[]>();
  for (const c of contacts ?? []) managersByBranch.set(c.branch_id, [...(managersByBranch.get(c.branch_id) ?? []), c.email.toLowerCase()]);
  const list = (key: string, fallback: string[]) => lists?.find((l) => l.key === key)?.emails ?? fallback;
  return {
    officers: [...new Set((users ?? []).filter((u) => u.role === "officer" && u.email && VALID_EMAIL.test(u.email)).map((u) => u.email.toLowerCase()))],
    adminsByBranch,
    managersByBranch,
    branchName: new Map((branches ?? []).map((b) => [b.id, b.name])),
    head: list("warranty_head", [WARRANTY_HEAD_EMAIL]).map((e) => e.toLowerCase()),
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

/** The To and Cc of one mail: the people the mail is for, plus what the template adds (copy groups and extra addresses). */
export function recipientsFor(t: ResolvedTemplate, people: People, opts: { to: string[]; branchId?: string }): { to: string[]; cc: string[] } {
  const groups: Record<string, string[]> = {
    head: people.head,
    officers: people.officers,
    service_managers: opts.branchId ? (people.managersByBranch.get(opts.branchId) ?? []) : [...new Set([...people.managersByBranch.values()].flat())],
    standing: people.standing,
  };
  return {
    to: unique([...opts.to, ...t.extraTo]),
    cc: unique([...t.ccGroups.flatMap((g) => groups[g] ?? []), ...t.extraCc]),
  };
}
