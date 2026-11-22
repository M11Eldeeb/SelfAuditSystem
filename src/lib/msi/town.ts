// The shape of business_town() (migration 0193): the 3D view's department details. Importable by the browser.

type LabelN = { label: string; n: number };

export type TownDetails = {
  workshop: {
    open: number;
    value: number;
    labour: number;
    parts: number;
    avgAge: number | null;
    /** Open WIPs by age in days: 0-7, 8-15, 16-30, 31-60, over 60. */
    ageing: [number, number, number, number, number];
    overdue: number;
    dueToday: number;
    awaitingParts: number;
    completeNotInvoiced: number;
    statuses: LabelN[];
    trend: { day: string; n: number }[];
    qc: { total: number; passed: number; failed: number; firstTime: number };
    techClaims: { waiting: number; returned: number; approved: number; rejected: number; reviewHours: number | null };
  };
  warranty: {
    claims: number;
    amount: number;
    settled: number;
    settledAmount: number;
    rejected: number;
    inProgress: number;
    returned: number;
    priorApproval: number;
    settleDays: number | null;
    submitDays: number | null;
    statuses: LabelN[];
    months: { m: string; n: number; amount: number }[];
    rejectedRegister: number;
    inquiries: { total: number; open: number; firstResponseHours: number | null };
    verifications: { total: number; open: number };
  };
  room: {
    cycle: string | null;
    flaggedClaims: number;
    flaggedParts: number;
    scrappedThisCycle: number;
    scrappedYear: number;
    evidence: { approved: number; waiting: number };
    returnsOpen: number;
    returnsClosed: number;
    collectionsOpen: number;
    collectionsDone: number;
  };
  audit: {
    cycle: string | null;
    cycleStatus: string | null;
    deadline: string | null;
    assignments: number;
    done: number;
    reviewed: number;
    score: number | null;
    opsSubmitted: number;
    internal: { count: number; score: number | null; last: string | null };
    scores: { m: string; score: number }[];
  };
  customers: { today: number; waiting: number; served: number; noShow: number; avgWait: number | null; appointments: number };
  complaints: { total: number; open: number; valid: number; notValid: number; resolveDays: number | null; categories: LabelN[]; sources: LabelN[] };
};
