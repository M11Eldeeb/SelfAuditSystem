// Every automatic mail, as data: its built-in subject and wording, which {placeholders} it understands, who
// is copied by default, and the numbers (reminder days, deadline) that can be changed. Officers edit these from
// Settings -> Email settings; what they change is stored in self_audit_mail_templates and layered on top of this.
// No "server-only" here on purpose: the editor's live preview runs in the browser on the same code.

import { fillPlaceholders, placeholdersIn, renderMailText, type DepartmentScoreEntry, type PodiumEntry } from "@/lib/mail/template";

export type MailKey =
  | "ready"
  | "reminder"
  | "flagged"
  | "flagged_reminder"
  | "podium"
  | "notice"
  | "results"
  | "inquiry_new"
  | "inquiry_reply"
  | "inquiry_resubmitted"
  | "inquiry_cancelled"
  | "inquiry_delegated"
  | "inquiry_answered"
  | "inquiry_closed"
  | "inquiry_reopened"
  | "inquiry_verify"
  | "inquiry_rejected";
export type CcGroup = "head" | "aftersales_head" | "officers" | "service_managers" | "workshop_supervisors" | "workshop_team_leaders" | "technical_team" | "standing";

/** In the order they appear in the Cc line (the extra addresses come right after the warranty head). */
export const CC_GROUP_LABELS: Record<CcGroup, string> = {
  head: "The warranty head",
  aftersales_head: "The aftersales head",
  service_managers: "The branch's service manager(s)",
  workshop_supervisors: "The branch's workshop supervisor(s)",
  workshop_team_leaders: "The branch's workshop team leader(s)",
  officers: "All officers",
  technical_team: "The whole technical team",
  standing: "The standing managers list",
};

export type PlaceholderDef = { name: string; help: string; sample: string };

export type MailDef = {
  key: MailKey;
  title: string;
  /** Who it is sent to, in words (the "To" is always decided by the mail itself, extra addresses can be added). */
  to: string;
  /** The on/off switch this mail follows, or null when a button sends it. */
  switchKey: string | null;
  defaultSubject: string;
  defaultBody: string;
  defaultCc: CcGroup[];
  placeholders: PlaceholderDef[];
  /** Sent as a reply in the thread of an earlier mail, so its subject becomes "Re: <that mail's subject>". */
  asReply?: boolean;
  /** Days-before-deadline on which a reminder goes out. */
  milestones?: number[];
  /** Days from the cycle's start to the deadline mentioned in the mail. */
  deadlineDays?: number;
  attachment?: string;
};

const SIGN_OFF = "Thank you,\nWarranty Department - Jiad Modern Motors";
const LINK = { name: "link", help: "The address of the portal (becomes a button in the mail).", sample: "https://portal.example/audit" };

export const MAIL_DEFS: Record<MailKey, MailDef> = {
  ready: {
    key: "ready",
    title: "Self audit is ready",
    to: "All the branch admins of the branches that were assigned claims, together in ONE mail",
    switchKey: null,
    defaultSubject: "{month} self audit is ready",
    defaultBody: `Dear team,

The {month} self audit is now open. {claims} {have} been assigned to you, and the branch operations checklist is also waiting.

Please sign in, review each claim and submit before {deadline} ({cycle_days} days).

Open the portal: {link}

Note: Automated mail - No Reply

${SIGN_OFF}`,
    defaultCc: ["head", "officers", "service_managers"],
    placeholders: [
      { name: "month", help: "The cycle's month.", sample: "October 2026" },
      { name: "claims", help: "How many claims each branch was assigned, with the word - \"up to 10 claims\" if the branches got different numbers.", sample: "10 claims" },
      { name: "have", help: '"have" or "has" to match the number of claims.', sample: "have" },
      { name: "deadline", help: "The submission deadline.", sample: "8 November 2026" },
      { name: "cycle_days", help: "The length of the self-audit window in days.", sample: "25" },
      LINK,
    ],
  },
  reminder: {
    key: "reminder",
    title: "Self-audit reminders",
    to: "Admins of branches with unsubmitted claims or an unsubmitted checklist",
    switchKey: "self_audit_reminder",
    defaultSubject: "Reminder: {month} self audit closes in {days_left} {days_word} - {branch}",
    defaultBody: `Dear team,

Reminder: {days_left} {days_word} left.

Your {month} self audit closes on {deadline}. {open} of {total} claims are still not submitted{checklist}.

Note: Failing to submit before the deadline date would make the unanswered questions automatically zero.

Link to the portal: {link}

${SIGN_OFF}`,
    defaultCc: ["head", "officers", "service_managers"],
    asReply: true,
    milestones: [7, 3, 1],
    placeholders: [
      { name: "month", help: "The cycle's month.", sample: "October 2026" },
      { name: "branch", help: "The branch's name.", sample: "Riyadh North" },
      { name: "days_left", help: "Days left until the deadline.", sample: "3" },
      { name: "days_word", help: '"day" or "days".', sample: "days" },
      { name: "deadline", help: "The submission deadline.", sample: "8 November 2026" },
      { name: "open", help: "How many of the branch's claims are not submitted.", sample: "6" },
      { name: "total", help: "How many claims the branch was assigned.", sample: "10" },
      { name: "checklist", help: 'Becomes ", and the branch operations checklist is not submitted" when it is still open, otherwise nothing.', sample: ", and the branch operations checklist is not submitted" },
      LINK,
    ],
  },
  flagged: {
    key: "flagged",
    title: "Flagged parts (first mail)",
    to: "Each admin of a branch that has parts flagged and no submitted evidence - a separate mail for every admin",
    switchKey: "flagged_parts",
    defaultSubject: "Action needed: {parts} flagged to scrap - {branch}",
    defaultBody: `Dear {branch} team,

{parts} at your branch {is} flagged to be scrapped in the {month} cycle.

Please destroy {them}, record one or more videos showing it, and upload the videos in the portal under Warranty Room → Submit destroy evidence. The flagged list is on the same page.

The deadline is {deadline} ({deadline_days} days from the start of the cycle).

Link to the portal: {link}

${SIGN_OFF}`,
    defaultCc: ["officers"],
    deadlineDays: 15,
    placeholders: [
      { name: "branch", help: "The branch's name.", sample: "Riyadh North" },
      { name: "month", help: "The warranty room cycle's month.", sample: "October 2026" },
      { name: "parts", help: "How many parts are flagged, with the word.", sample: "14 parts" },
      { name: "is", help: '"is" or "are" to match the number of parts.', sample: "are" },
      { name: "them", help: '"it" or "them" to match the number of parts.', sample: "them" },
      { name: "deadline", help: "The deadline for the evidence.", sample: "30 October 2026" },
      { name: "deadline_days", help: "Days from the start of the cycle to the deadline.", sample: "15" },
      { name: "link", help: "The address of the Warranty Room page (becomes a button).", sample: "https://portal.example/audit/warranty-room" },
    ],
  },
  flagged_reminder: {
    key: "flagged_reminder",
    title: "Flagged parts (reminders)",
    to: "Each admin of a branch that still has flagged parts and no submitted evidence - a separate mail for every admin",
    switchKey: "flagged_parts",
    defaultSubject: "Reminder: {days_left} {days_word} left to submit destroy evidence - {branch}",
    defaultBody: `Dear {branch} team,

Reminder: {days_left} {days_word} left to submit your destroy evidence for the {month} cycle (deadline {deadline}).

{parts} at your branch {is} still flagged to be scrapped. Please upload the videos under Warranty Room → Submit destroy evidence.

Link to the portal: {link}

${SIGN_OFF}`,
    defaultCc: ["officers"],
    asReply: true,
    milestones: [7, 3, 1],
    placeholders: [
      { name: "branch", help: "The branch's name.", sample: "Riyadh North" },
      { name: "month", help: "The warranty room cycle's month.", sample: "October 2026" },
      { name: "parts", help: "How many parts are still flagged, with the word.", sample: "14 parts" },
      { name: "is", help: '"is" or "are" to match the number of parts.', sample: "are" },
      { name: "days_left", help: "Days left until the deadline.", sample: "3" },
      { name: "days_word", help: '"day" or "days".', sample: "days" },
      { name: "deadline", help: "The deadline for the evidence.", sample: "30 October 2026" },
      { name: "link", help: "The address of the Warranty Room page (becomes a button).", sample: "https://portal.example/audit/warranty-room" },
    ],
  },
  podium: {
    key: "podium",
    title: "Podium congratulations",
    to: "Every branch admin",
    switchKey: "podium_congrats",
    defaultSubject: "{month} Self-Audit - Top Performing Branches",
    defaultBody: `Dear team,

Congratulations to this month’s top-performing branches in the {month} self audit:

{podium}

Great work maintaining such high standards in claims documentation and compliance.

To every other branch: thank you for your effort this cycle. We encourage you to keep pushing and aim for a podium finish next month.

Full results: {link}

${SIGN_OFF}`,
    defaultCc: ["head", "officers", "standing"],
    placeholders: [
      { name: "month", help: "The cycle's month.", sample: "October 2026" },
      { name: "podium", help: "The podium (a graphic in the mail; 1st, 2nd and 3rd lines in plain text). Keep it on its own line.", sample: "" },
      { name: "link", help: "The address of the results page (becomes a button).", sample: "https://portal.example/audit/results/self-audit" },
    ],
  },
  notice: {
    key: "notice",
    title: "Internal audit notice",
    to: "The branch's admins",
    switchKey: "internal_audit_notice",
    defaultSubject: "Internal Audit Notice - {branch}",
    defaultBody: `Dear {branch} team,

The Warranty department will conduct an internal audit{on_date}. The {claims} selected {is} in the attached Excel sheet. Please have the original job cards in order, parts and documentation ready for review.

${SIGN_OFF}`,
    defaultCc: ["head", "service_managers", "officers"],
    attachment: "The Excel sheet of the selected claims is attached automatically.",
    placeholders: [
      { name: "branch", help: "The branch's name.", sample: "Riyadh North" },
      { name: "claims", help: "How many claims were selected, with the word.", sample: "15 claims" },
      { name: "is", help: '"is" or "are" to match the number of claims.', sample: "are" },
      { name: "on_date", help: 'Becomes " on <the audit date>" when the audit has a date, otherwise nothing.', sample: " on 18 October 2026" },
    ],
  },
  results: {
    key: "results",
    title: "Internal audit results",
    to: "The branch's admins",
    switchKey: null,
    defaultSubject: "Internal Audit Results - {branch}",
    defaultBody: `Dear {branch} team,

The internal audit for your branch is complete, with an overall score of {score}%. The full report is attached.

{departments}

View the audit on the portal: {link}

Audit files on Google Drive: {drive_link}

${SIGN_OFF}`,
    defaultCc: ["head", "service_managers", "officers"],
    attachment: "The results PDF is attached automatically.",
    placeholders: [
      { name: "branch", help: "The branch's name.", sample: "Riyadh North" },
      { name: "score", help: "The overall score (a number, the % sign is in the text).", sample: "86" },
      { name: "departments", help: "The score of each department (a table in the mail). Keep it on its own line.", sample: "" },
      { name: "link", help: "The audit's page on the portal (becomes a button).", sample: "https://self-audit-system.vercel.app/audit/internal-audit/0f8c2d1e-6b7a-4c3d-9e2f-1a2b3c4d5e6f" },
      { name: "drive_link", help: "The audit's Google Drive folder - Internal Audit / branch / month (becomes a button; the recipients get view access).", sample: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz" },
    ],
  },
  inquiry_new: {
    key: "inquiry_new",
    title: "Technical inquiry - new case",
    to: "The technical advisor the case is assigned to (the branch's technical advisor), or the whole technical team when nobody is assigned",
    switchKey: "inquiry_mails_technical",
    defaultSubject: "{in_workshop}New technical inquiry {number} - {branch} - {model}",
    defaultBody: `Dear technical team,

{branch} has submitted a new technical inquiry, {number}.

Work order: {work_order}
VIN: {vin}
Plate number: {plate}
Vehicle: {model}
Sent because: {reasons}
Mileage: {mileage}
Escalated by: {escalated_by}
System: {system}
The car: {car_location}
Assigned to: {advisor}

Fault complaint:
{fault}

Open the case: {link}

${SIGN_OFF}`,
    defaultCc: [],
    placeholders: [
      { name: "number", help: "The inquiry number.", sample: "TI-0007" },
      { name: "branch", help: "The branch's name.", sample: "Riyadh North" },
      { name: "work_order", help: "The work order number.", sample: "RNQ-35698" },
      { name: "vin", help: "The vehicle's VIN.", sample: "LSJW74U99NZ012345" },
      { name: "plate", help: "The vehicle's plate number.", sample: "ABC 1234" },
      { name: "reasons", help: "Which of the conditions for sending a case to the technical team are met (MOC case - a Ministry of Commerce complaint, second come-back, low mileage, unsolved case).", sample: "Second come-back for the same problem" },
      { name: "mileage", help: "The mileage, with the unit.", sample: "45,200 km" },
      { name: "escalated_by", help: "The workshop supervisor or delegated responsible who escalated the case (name and role).", sample: "Mohamed Ali (Workshop supervisor)" },
      { name: "model", help: "The vehicle model.", sample: "MG ZS 2024" },
      { name: "system", help: "The vehicle system the fault is in.", sample: "Engine" },
      { name: "car_location", help: 'Whether the car is in the workshop: "The car is in the workshop" or "The car is out of the workshop".', sample: "The car is in the workshop" },
      { name: "in_workshop", help: 'Becomes "CAR IN WORKSHOP - " when the car is still in the workshop, otherwise nothing (useful in the subject).', sample: "CAR IN WORKSHOP - " },
      { name: "advisor", help: 'The technical advisor the case is assigned to, or "Not assigned yet".', sample: "Hesham" },
      { name: "by", help: "Who wrote it (the person who submitted, replied, closed...).", sample: "Mohamed Ali" },
      { name: "submitted_by", help: "Who submitted the case.", sample: "Mohamed Ali" },
      { name: "fault", help: "The fault complaint (the first part of it).", sample: "Engine warning light on and the car loses power on acceleration." },
      { name: "link", help: "The address of the case in the portal (becomes a button).", sample: "https://portal.example/technical/technical-inquiries/123" },
    ],
  },
  inquiry_reply: {
    key: "inquiry_reply",
    title: "Technical inquiry - the workshop replied",
    to: "The technical advisor the case is assigned to (the branch's technical advisor), or the whole technical team when nobody is assigned",
    switchKey: "inquiry_mails_technical",
    defaultSubject: "{in_workshop}{number} - {branch} replied",
    defaultBody: `Dear technical team,

{by} from {branch} replied on inquiry {number} (work order {work_order}).

{comment}

Open the case: {link}

${SIGN_OFF}`,
    defaultCc: [],
    asReply: true,
    placeholders: [
      { name: "number", help: "The inquiry number.", sample: "TI-0007" },
      { name: "branch", help: "The branch's name.", sample: "Riyadh North" },
      { name: "work_order", help: "The work order number.", sample: "RNQ-35698" },
      { name: "vin", help: "The vehicle's VIN.", sample: "LSJW74U99NZ012345" },
      { name: "plate", help: "The vehicle's plate number.", sample: "ABC 1234" },
      { name: "reasons", help: "Which of the conditions for sending a case to the technical team are met (MOC case - a Ministry of Commerce complaint, second come-back, low mileage, unsolved case).", sample: "Second come-back for the same problem" },
      { name: "mileage", help: "The mileage, with the unit.", sample: "45,200 km" },
      { name: "escalated_by", help: "The workshop supervisor or delegated responsible who escalated the case (name and role).", sample: "Mohamed Ali (Workshop supervisor)" },
      { name: "model", help: "The vehicle model.", sample: "MG ZS 2024" },
      { name: "system", help: "The vehicle system the fault is in.", sample: "Engine" },
      { name: "car_location", help: 'Whether the car is in the workshop: "The car is in the workshop" or "The car is out of the workshop".', sample: "The car is in the workshop" },
      { name: "in_workshop", help: 'Becomes "CAR IN WORKSHOP - " when the car is still in the workshop, otherwise nothing (useful in the subject).', sample: "CAR IN WORKSHOP - " },
      { name: "advisor", help: 'The technical advisor the case is assigned to, or "Not assigned yet".', sample: "Hesham" },
      { name: "by", help: "Who wrote it (the person who submitted, replied, closed...).", sample: "Mohamed Ali" },
      { name: "submitted_by", help: "Who submitted the case.", sample: "Mohamed Ali" },
      { name: "fault", help: "The fault complaint (the first part of it).", sample: "Engine warning light on and the car loses power on acceleration." },
      { name: "comment", help: "The text that was written (reply, reason, note).", sample: "Cleaned the throttle body and the fault came back after 20 km." },
      { name: "link", help: "The address of the case in the portal (becomes a button).", sample: "https://portal.example/technical/technical-inquiries/123" },
    ],
  },
  inquiry_resubmitted: {
    key: "inquiry_resubmitted",
    title: "Technical inquiry - sent again by the workshop",
    to: "The technical advisor the case is assigned to (the branch's technical advisor), or the whole technical team when nobody is assigned",
    switchKey: "inquiry_mails_technical",
    defaultSubject: "{in_workshop}{number} - {branch} sent the case again",
    defaultBody: `Dear technical team,

{by} from {branch} has sent inquiry {number} (work order {work_order}) back to you.

{comment}

Open the case: {link}

${SIGN_OFF}`,
    defaultCc: [],
    asReply: true,
    placeholders: [
      { name: "number", help: "The inquiry number.", sample: "TI-0007" },
      { name: "branch", help: "The branch's name.", sample: "Riyadh North" },
      { name: "work_order", help: "The work order number.", sample: "RNQ-35698" },
      { name: "vin", help: "The vehicle's VIN.", sample: "LSJW74U99NZ012345" },
      { name: "plate", help: "The vehicle's plate number.", sample: "ABC 1234" },
      { name: "reasons", help: "Which of the conditions for sending a case to the technical team are met (MOC case - a Ministry of Commerce complaint, second come-back, low mileage, unsolved case).", sample: "Second come-back for the same problem" },
      { name: "mileage", help: "The mileage, with the unit.", sample: "45,200 km" },
      { name: "escalated_by", help: "The workshop supervisor or delegated responsible who escalated the case (name and role).", sample: "Mohamed Ali (Workshop supervisor)" },
      { name: "model", help: "The vehicle model.", sample: "MG ZS 2024" },
      { name: "system", help: "The vehicle system the fault is in.", sample: "Engine" },
      { name: "car_location", help: 'Whether the car is in the workshop: "The car is in the workshop" or "The car is out of the workshop".', sample: "The car is in the workshop" },
      { name: "in_workshop", help: 'Becomes "CAR IN WORKSHOP - " when the car is still in the workshop, otherwise nothing (useful in the subject).', sample: "CAR IN WORKSHOP - " },
      { name: "advisor", help: 'The technical advisor the case is assigned to, or "Not assigned yet".', sample: "Hesham" },
      { name: "by", help: "Who wrote it (the person who submitted, replied, closed...).", sample: "Mohamed Ali" },
      { name: "submitted_by", help: "Who submitted the case.", sample: "Mohamed Ali" },
      { name: "fault", help: "The fault complaint (the first part of it).", sample: "Engine warning light on and the car loses power on acceleration." },
      { name: "comment", help: "The text that was written (reply, reason, note).", sample: "Cleaned the throttle body and the fault came back after 20 km." },
      { name: "link", help: "The address of the case in the portal (becomes a button).", sample: "https://portal.example/technical/technical-inquiries/123" },
    ],
  },
  inquiry_cancelled: {
    key: "inquiry_cancelled",
    title: "Technical inquiry - cancelled by the workshop",
    to: "The technical advisor the case is assigned to (the branch's technical advisor), or the whole technical team when nobody is assigned",
    switchKey: "inquiry_mails_technical",
    defaultSubject: "{number} - {branch} cancelled the case",
    defaultBody: `Dear technical team,

{by} from {branch} has cancelled inquiry {number} (work order {work_order}). No answer is needed any more.

{comment}

Open the case: {link}

${SIGN_OFF}`,
    defaultCc: [],
    asReply: true,
    placeholders: [
      { name: "number", help: "The inquiry number.", sample: "TI-0007" },
      { name: "branch", help: "The branch's name.", sample: "Riyadh North" },
      { name: "work_order", help: "The work order number.", sample: "RNQ-35698" },
      { name: "vin", help: "The vehicle's VIN.", sample: "LSJW74U99NZ012345" },
      { name: "plate", help: "The vehicle's plate number.", sample: "ABC 1234" },
      { name: "reasons", help: "Which of the conditions for sending a case to the technical team are met (MOC case - a Ministry of Commerce complaint, second come-back, low mileage, unsolved case).", sample: "Second come-back for the same problem" },
      { name: "mileage", help: "The mileage, with the unit.", sample: "45,200 km" },
      { name: "escalated_by", help: "The workshop supervisor or delegated responsible who escalated the case (name and role).", sample: "Mohamed Ali (Workshop supervisor)" },
      { name: "model", help: "The vehicle model.", sample: "MG ZS 2024" },
      { name: "system", help: "The vehicle system the fault is in.", sample: "Engine" },
      { name: "car_location", help: 'Whether the car is in the workshop: "The car is in the workshop" or "The car is out of the workshop".', sample: "The car is in the workshop" },
      { name: "in_workshop", help: 'Becomes "CAR IN WORKSHOP - " when the car is still in the workshop, otherwise nothing (useful in the subject).', sample: "CAR IN WORKSHOP - " },
      { name: "advisor", help: 'The technical advisor the case is assigned to, or "Not assigned yet".', sample: "Hesham" },
      { name: "by", help: "Who wrote it (the person who submitted, replied, closed...).", sample: "Mohamed Ali" },
      { name: "submitted_by", help: "Who submitted the case.", sample: "Mohamed Ali" },
      { name: "fault", help: "The fault complaint (the first part of it).", sample: "Engine warning light on and the car loses power on acceleration." },
      { name: "comment", help: "The text that was written (reply, reason, note).", sample: "Cleaned the throttle body and the fault came back after 20 km." },
      { name: "link", help: "The address of the case in the portal (becomes a button).", sample: "https://portal.example/technical/technical-inquiries/123" },
    ],
  },
  inquiry_delegated: {
    key: "inquiry_delegated",
    title: "Technical inquiry - delegated to a technical advisor",
    to: "The technical advisor the case was delegated to",
    switchKey: "inquiry_mails_technical",
    defaultSubject: "{in_workshop}{number} - {by} delegated this case to you",
    defaultBody: `Dear {advisor},

{by} has delegated technical inquiry {number} ({branch}, work order {work_order}) to you.

Vehicle: {model}
System: {system}
The car: {car_location}

Customer concern:
{fault}

Open the case: {link}

${SIGN_OFF}`,
    defaultCc: [],
    placeholders: [
      { name: "number", help: "The inquiry number.", sample: "TI-0007" },
      { name: "branch", help: "The branch's name.", sample: "Riyadh North" },
      { name: "work_order", help: "The work order number.", sample: "RNQ-35698" },
      { name: "vin", help: "The vehicle's VIN.", sample: "LSJW74U99NZ012345" },
      { name: "plate", help: "The vehicle's plate number.", sample: "ABC 1234" },
      { name: "reasons", help: "Which of the conditions for sending a case to the technical team are met (MOC case - a Ministry of Commerce complaint, second come-back, low mileage, unsolved case).", sample: "Second come-back for the same problem" },
      { name: "mileage", help: "The mileage, with the unit.", sample: "45,200 km" },
      { name: "escalated_by", help: "The workshop supervisor or delegated responsible who escalated the case (name and role).", sample: "Mohamed Ali (Workshop supervisor)" },
      { name: "model", help: "The vehicle model.", sample: "MG ZS 2024" },
      { name: "system", help: "The vehicle system the fault is in.", sample: "Engine" },
      { name: "car_location", help: 'Whether the car is in the workshop: "The car is in the workshop" or "The car is out of the workshop".', sample: "The car is in the workshop" },
      { name: "in_workshop", help: 'Becomes "CAR IN WORKSHOP - " when the car is still in the workshop, otherwise nothing (useful in the subject).', sample: "CAR IN WORKSHOP - " },
      { name: "advisor", help: 'The technical advisor the case is assigned to, or "Not assigned yet".', sample: "Hesham" },
      { name: "by", help: "Who wrote it (the person who submitted, replied, closed...).", sample: "Mohamed Ali" },
      { name: "submitted_by", help: "Who submitted the case.", sample: "Mohamed Ali" },
      { name: "fault", help: "The fault complaint (the first part of it).", sample: "Engine warning light on and the car loses power on acceleration." },
      { name: "comment", help: "The text that was written (reply, reason, note).", sample: "Cleaned the throttle body and the fault came back after 20 km." },
      { name: "link", help: "The address of the case in the portal (becomes a button).", sample: "https://portal.example/technical/technical-inquiries/123" },
    ],
  },
  inquiry_answered: {
    key: "inquiry_answered",
    title: "Technical inquiry - the technical team answered",
    to: "The branch's admins",
    switchKey: "inquiry_mails_workshop",
    defaultSubject: "{number} - the technical team replied - {work_order}",
    defaultBody: `Dear {branch} team,

{by} from the technical team has replied on inquiry {number} (work order {work_order}, {model}).

{comment}

Please read it and reply in the portal: {link}

${SIGN_OFF}`,
    defaultCc: ["service_managers","workshop_supervisors","workshop_team_leaders"],
    asReply: true,
    placeholders: [
      { name: "number", help: "The inquiry number.", sample: "TI-0007" },
      { name: "branch", help: "The branch's name.", sample: "Riyadh North" },
      { name: "work_order", help: "The work order number.", sample: "RNQ-35698" },
      { name: "vin", help: "The vehicle's VIN.", sample: "LSJW74U99NZ012345" },
      { name: "plate", help: "The vehicle's plate number.", sample: "ABC 1234" },
      { name: "reasons", help: "Which of the conditions for sending a case to the technical team are met (MOC case - a Ministry of Commerce complaint, second come-back, low mileage, unsolved case).", sample: "Second come-back for the same problem" },
      { name: "mileage", help: "The mileage, with the unit.", sample: "45,200 km" },
      { name: "escalated_by", help: "The workshop supervisor or delegated responsible who escalated the case (name and role).", sample: "Mohamed Ali (Workshop supervisor)" },
      { name: "model", help: "The vehicle model.", sample: "MG ZS 2024" },
      { name: "system", help: "The vehicle system the fault is in.", sample: "Engine" },
      { name: "car_location", help: 'Whether the car is in the workshop: "The car is in the workshop" or "The car is out of the workshop".', sample: "The car is in the workshop" },
      { name: "in_workshop", help: 'Becomes "CAR IN WORKSHOP - " when the car is still in the workshop, otherwise nothing (useful in the subject).', sample: "CAR IN WORKSHOP - " },
      { name: "advisor", help: 'The technical advisor the case is assigned to, or "Not assigned yet".', sample: "Hesham" },
      { name: "by", help: "Who wrote it (the person who submitted, replied, closed...).", sample: "Mohamed Ali" },
      { name: "submitted_by", help: "Who submitted the case.", sample: "Mohamed Ali" },
      { name: "fault", help: "The fault complaint (the first part of it).", sample: "Engine warning light on and the car loses power on acceleration." },
      { name: "comment", help: "The text that was written (reply, reason, note).", sample: "Cleaned the throttle body and the fault came back after 20 km." },
      { name: "link", help: "The address of the case in the portal (becomes a button).", sample: "https://portal.example/technical/technical-inquiries/123" },
    ],
  },
  inquiry_verify: {
    key: "inquiry_verify",
    title: "Technical inquiry - a team leader's case waits for verification",
    to: "The workshop supervisor(s) of the branch (the branch admins when the branch has no supervisor account)",
    switchKey: "inquiry_mails_workshop",
    defaultSubject: "{in_workshop}{number} - waiting for your verification - {branch}",
    defaultBody: `Dear {branch} workshop supervisor,

{by} has submitted technical inquiry {number} (work order {work_order}). It does not go to the technical team until you verify it.

Vehicle: {model}
VIN: {vin}
Plate number: {plate}
The car: {car_location}
Sent because: {reasons}

Customer concern:
{fault}

Please check it, then verify it or send it back with the reason: {link}

${SIGN_OFF}`,
    defaultCc: [],
    placeholders: [
      { name: "number", help: "The inquiry number.", sample: "TI-0007" },
      { name: "branch", help: "The branch's name.", sample: "Riyadh North" },
      { name: "work_order", help: "The work order number.", sample: "RNQ-35698" },
      { name: "vin", help: "The vehicle's VIN.", sample: "LSJW74U99NZ012345" },
      { name: "plate", help: "The vehicle's plate number.", sample: "ABC 1234" },
      { name: "reasons", help: "Which of the conditions for sending a case to the technical team are met (MOC case - a Ministry of Commerce complaint, second come-back, low mileage, unsolved case).", sample: "Second come-back for the same problem" },
      { name: "mileage", help: "The mileage, with the unit.", sample: "45,200 km" },
      { name: "escalated_by", help: "The workshop supervisor or delegated responsible who escalated the case (name and role).", sample: "Mohamed Ali (Workshop supervisor)" },
      { name: "model", help: "The vehicle model.", sample: "MG ZS 2024" },
      { name: "system", help: "The vehicle system the fault is in.", sample: "Engine" },
      { name: "car_location", help: 'Whether the car is in the workshop: "The car is in the workshop" or "The car is out of the workshop".', sample: "The car is in the workshop" },
      { name: "in_workshop", help: 'Becomes "CAR IN WORKSHOP - " when the car is still in the workshop, otherwise nothing (useful in the subject).', sample: "CAR IN WORKSHOP - " },
      { name: "advisor", help: 'The technical advisor the case is assigned to, or "Not assigned yet".', sample: "Hesham" },
      { name: "by", help: "Who wrote it (the person who submitted, replied, closed...).", sample: "Mohamed Ali" },
      { name: "submitted_by", help: "Who submitted the case.", sample: "Mohamed Ali" },
      { name: "fault", help: "The fault complaint (the first part of it).", sample: "Engine warning light on and the car loses power on acceleration." },
      { name: "comment", help: "The text that was written (reply, reason, note).", sample: "Cleaned the throttle body and the fault came back after 20 km." },
      { name: "link", help: "The address of the case in the portal (becomes a button).", sample: "https://portal.example/technical/technical-inquiries/123" },
    ],
  },
  inquiry_rejected: {
    key: "inquiry_rejected",
    title: "Technical inquiry - sent back by the workshop supervisor",
    to: "The team leader who submitted the case",
    switchKey: "inquiry_mails_workshop",
    defaultSubject: "{number} - sent back by the workshop supervisor - {work_order}",
    defaultBody: `Dear {submitted_by},

{by} (workshop supervisor) did not verify your technical inquiry {number} (work order {work_order}), so it was not sent to the technical team.

Reason:
{comment}

Please speak to your workshop supervisor, then send the case again from the portal: {link}

${SIGN_OFF}`,
    defaultCc: [],
    placeholders: [
      { name: "number", help: "The inquiry number.", sample: "TI-0007" },
      { name: "branch", help: "The branch's name.", sample: "Riyadh North" },
      { name: "work_order", help: "The work order number.", sample: "RNQ-35698" },
      { name: "vin", help: "The vehicle's VIN.", sample: "LSJW74U99NZ012345" },
      { name: "plate", help: "The vehicle's plate number.", sample: "ABC 1234" },
      { name: "reasons", help: "Which of the conditions for sending a case to the technical team are met (MOC case - a Ministry of Commerce complaint, second come-back, low mileage, unsolved case).", sample: "Second come-back for the same problem" },
      { name: "mileage", help: "The mileage, with the unit.", sample: "45,200 km" },
      { name: "escalated_by", help: "The workshop supervisor or delegated responsible who escalated the case (name and role).", sample: "Mohamed Ali (Workshop supervisor)" },
      { name: "model", help: "The vehicle model.", sample: "MG ZS 2024" },
      { name: "system", help: "The vehicle system the fault is in.", sample: "Engine" },
      { name: "car_location", help: 'Whether the car is in the workshop: "The car is in the workshop" or "The car is out of the workshop".', sample: "The car is in the workshop" },
      { name: "in_workshop", help: 'Becomes "CAR IN WORKSHOP - " when the car is still in the workshop, otherwise nothing (useful in the subject).', sample: "CAR IN WORKSHOP - " },
      { name: "advisor", help: 'The technical advisor the case is assigned to, or "Not assigned yet".', sample: "Hesham" },
      { name: "by", help: "Who wrote it (the person who submitted, replied, closed...).", sample: "Mohamed Ali" },
      { name: "submitted_by", help: "Who submitted the case.", sample: "Mohamed Ali" },
      { name: "fault", help: "The fault complaint (the first part of it).", sample: "Engine warning light on and the car loses power on acceleration." },
      { name: "comment", help: "The text that was written (reply, reason, note).", sample: "Cleaned the throttle body and the fault came back after 20 km." },
      { name: "link", help: "The address of the case in the portal (becomes a button).", sample: "https://portal.example/technical/technical-inquiries/123" },
    ],
  },
  inquiry_closed: {
    key: "inquiry_closed",
    title: "Technical inquiry - closed with a solution",
    to: "The branch's admins",
    switchKey: "inquiry_mails_workshop",
    defaultSubject: "{number} - closed - {work_order}",
    defaultBody: `Dear {branch} team,

{by} from the technical team has closed inquiry {number} (work order {work_order}, {model}).

Solution:
{resolution}

Open the case: {link}

${SIGN_OFF}`,
    defaultCc: ["service_managers","workshop_supervisors","workshop_team_leaders"],
    asReply: true,
    placeholders: [
      { name: "number", help: "The inquiry number.", sample: "TI-0007" },
      { name: "branch", help: "The branch's name.", sample: "Riyadh North" },
      { name: "work_order", help: "The work order number.", sample: "RNQ-35698" },
      { name: "vin", help: "The vehicle's VIN.", sample: "LSJW74U99NZ012345" },
      { name: "plate", help: "The vehicle's plate number.", sample: "ABC 1234" },
      { name: "reasons", help: "Which of the conditions for sending a case to the technical team are met (MOC case - a Ministry of Commerce complaint, second come-back, low mileage, unsolved case).", sample: "Second come-back for the same problem" },
      { name: "mileage", help: "The mileage, with the unit.", sample: "45,200 km" },
      { name: "escalated_by", help: "The workshop supervisor or delegated responsible who escalated the case (name and role).", sample: "Mohamed Ali (Workshop supervisor)" },
      { name: "model", help: "The vehicle model.", sample: "MG ZS 2024" },
      { name: "system", help: "The vehicle system the fault is in.", sample: "Engine" },
      { name: "car_location", help: 'Whether the car is in the workshop: "The car is in the workshop" or "The car is out of the workshop".', sample: "The car is in the workshop" },
      { name: "in_workshop", help: 'Becomes "CAR IN WORKSHOP - " when the car is still in the workshop, otherwise nothing (useful in the subject).', sample: "CAR IN WORKSHOP - " },
      { name: "advisor", help: 'The technical advisor the case is assigned to, or "Not assigned yet".', sample: "Hesham" },
      { name: "by", help: "Who wrote it (the person who submitted, replied, closed...).", sample: "Mohamed Ali" },
      { name: "submitted_by", help: "Who submitted the case.", sample: "Mohamed Ali" },
      { name: "fault", help: "The fault complaint (the first part of it).", sample: "Engine warning light on and the car loses power on acceleration." },
      { name: "resolution", help: "The summary of the solution written when the case was closed.", sample: "Replaced the throttle position sensor (part 10312345) and updated the ECU software." },
      { name: "link", help: "The address of the case in the portal (becomes a button).", sample: "https://portal.example/technical/technical-inquiries/123" },
    ],
  },
  inquiry_reopened: {
    key: "inquiry_reopened",
    title: "Technical inquiry - reopened by the technical team",
    to: "The branch's admins",
    switchKey: "inquiry_mails_workshop",
    defaultSubject: "{number} - reopened - {work_order}",
    defaultBody: `Dear {branch} team,

{by} from the technical team has reopened inquiry {number} (work order {work_order}, {model}) and is waiting for your reply.

{comment}

Please reply in the portal: {link}

${SIGN_OFF}`,
    defaultCc: ["service_managers","workshop_supervisors","workshop_team_leaders"],
    asReply: true,
    placeholders: [
      { name: "number", help: "The inquiry number.", sample: "TI-0007" },
      { name: "branch", help: "The branch's name.", sample: "Riyadh North" },
      { name: "work_order", help: "The work order number.", sample: "RNQ-35698" },
      { name: "vin", help: "The vehicle's VIN.", sample: "LSJW74U99NZ012345" },
      { name: "plate", help: "The vehicle's plate number.", sample: "ABC 1234" },
      { name: "reasons", help: "Which of the conditions for sending a case to the technical team are met (MOC case - a Ministry of Commerce complaint, second come-back, low mileage, unsolved case).", sample: "Second come-back for the same problem" },
      { name: "mileage", help: "The mileage, with the unit.", sample: "45,200 km" },
      { name: "escalated_by", help: "The workshop supervisor or delegated responsible who escalated the case (name and role).", sample: "Mohamed Ali (Workshop supervisor)" },
      { name: "model", help: "The vehicle model.", sample: "MG ZS 2024" },
      { name: "system", help: "The vehicle system the fault is in.", sample: "Engine" },
      { name: "car_location", help: 'Whether the car is in the workshop: "The car is in the workshop" or "The car is out of the workshop".', sample: "The car is in the workshop" },
      { name: "in_workshop", help: 'Becomes "CAR IN WORKSHOP - " when the car is still in the workshop, otherwise nothing (useful in the subject).', sample: "CAR IN WORKSHOP - " },
      { name: "advisor", help: 'The technical advisor the case is assigned to, or "Not assigned yet".', sample: "Hesham" },
      { name: "by", help: "Who wrote it (the person who submitted, replied, closed...).", sample: "Mohamed Ali" },
      { name: "submitted_by", help: "Who submitted the case.", sample: "Mohamed Ali" },
      { name: "fault", help: "The fault complaint (the first part of it).", sample: "Engine warning light on and the car loses power on acceleration." },
      { name: "comment", help: "The text that was written (reply, reason, note).", sample: "Cleaned the throttle body and the fault came back after 20 km." },
      { name: "link", help: "The address of the case in the portal (becomes a button).", sample: "https://portal.example/technical/technical-inquiries/123" },
    ],
  },
};

export const MAIL_KEYS_IN_ORDER: MailKey[] = [
  "ready",
  "reminder",
  "flagged",
  "flagged_reminder",
  "podium",
  "notice",
  "results",
  "inquiry_new",
  "inquiry_reply",
  "inquiry_resubmitted",
  "inquiry_cancelled",
  "inquiry_delegated",
  "inquiry_answered",
  "inquiry_closed",
  "inquiry_reopened",
  "inquiry_verify",
  "inquiry_rejected",
];

/** What an officer saved for a mail (all optional - anything missing falls back to the built-in wording). */
export type MailOverride = {
  subject: string | null;
  body: string | null;
  cc_groups: CcGroup[] | null;
  extra_to: string[];
  extra_cc: string[];
  settings: { milestones?: number[]; deadline_days?: number };
};

export type ResolvedTemplate = {
  subject: string;
  body: string;
  ccGroups: CcGroup[];
  extraTo: string[];
  extraCc: string[];
  milestones: number[];
  deadlineDays: number;
};

export function resolveTemplate(def: MailDef, o?: MailOverride | null): ResolvedTemplate {
  return {
    subject: o?.subject?.trim() ? o.subject : def.defaultSubject,
    body: o?.body?.trim() ? o.body : def.defaultBody,
    ccGroups: o?.cc_groups ?? def.defaultCc,
    extraTo: o?.extra_to ?? [],
    extraCc: o?.extra_cc ?? [],
    milestones: o?.settings?.milestones?.length ? o.settings.milestones : (def.milestones ?? [7, 3, 1]),
    deadlineDays: o?.settings?.deadline_days ?? def.deadlineDays ?? 15,
  };
}

/** The finished mail (subject, plain text, HTML) from a template and the values for its placeholders. */
export function composeMail(t: Pick<ResolvedTemplate, "subject" | "body">, vars: Record<string, string>, podium?: PodiumEntry[], departments?: DepartmentScoreEntry[]) {
  const { text, html } = renderMailText(t.body, vars, podium, departments);
  return { subject: fillPlaceholders(t.subject, vars).replace(/[\r\n]+/g, " ").trim(), text, html };
}

export const sampleVars = (def: MailDef): Record<string, string> => Object.fromEntries(def.placeholders.map((p) => [p.name, p.sample]));

export const SAMPLE_PODIUM: PodiumEntry[] = [
  { place: 1, name: "Sample Branch A", pct: "97.5%" },
  { place: 2, name: "Sample Branch B", pct: "94%" },
  { place: 3, name: "Sample Branch C", pct: "91.2%" },
];

/** A message for the editor if the subject or body uses a {name} this mail does not know, or the body is empty. */
export function validateTemplate(def: MailDef, subject: string, body: string): string | null {
  if (!subject.trim()) return "The subject cannot be empty.";
  if (!body.trim()) return "The message cannot be empty.";
  const known = new Set(def.placeholders.map((p) => p.name));
  const unknown = [...placeholdersIn(subject), ...placeholdersIn(body)].filter((n) => !known.has(n));
  if (unknown.length) return `Unknown placeholder${unknown.length === 1 ? "" : "s"}: ${unknown.map((n) => `{${n}}`).join(", ")}. Use only the ones listed under the message.`;
  return null;
}
