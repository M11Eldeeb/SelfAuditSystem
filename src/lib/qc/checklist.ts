// The QC inspection sheets as questions: the Maintenance inspection sheet (periodic maintenance) and the GR final
// inspection sheet (general repair). A QC asks the sheet of its repair type; "Both" asks both, shared items once.
// Shared by the browser (the form) and the server (checking the answers, the PDF).

export type Mark = "G" | "I" | "R" | "NA";
export const MARK_LABEL: Record<Mark, string> = { G: "Good", I: "Inspect", R: "Repair / Replace", NA: "Not equipped" };

export type SheetKind = "pm" | "gr";
type Item = {
  id: string;
  label: string;
  /** Which sheets ask it. */
  on: SheetKind[];
  /** G/I/R (most items) or G/R only (the sheet has no "Inspect" box for it). */
  marks: "GIR" | "GR";
  /** "If equipped" items may be answered "Not equipped". */
  optional?: boolean;
  /** GR "relating issues": a box to clarify when it is not Good. */
  clarify?: boolean;
};
export type Section = { id: string; title: string; items: Item[]; extra?: "wheels" | "brakes" };

const both: SheetKind[] = ["pm", "gr"];
const pm: SheetKind[] = ["pm"];
const gr: SheetKind[] = ["gr"];

export const QC_SECTIONS: Section[] = [
  {
    id: "under_hood",
    title: "Under Hood",
    items: [
      { id: "washer_tank", label: "Washer fluid tank", on: both, marks: "GIR" },
      { id: "oil_filler_cap", label: "Engine oil filler cap", on: both, marks: "GIR" },
      { id: "oil_dipstick", label: "Engine oil dipstick", on: both, marks: "GIR" },
      { id: "brake_reservoir", label: "Brake fluid reservoir", on: both, marks: "GIR" },
      { id: "battery", label: "Battery & its clamps", on: both, marks: "GIR" },
      { id: "fuse_box", label: "Fuse box", on: both, marks: "GIR" },
      { id: "cooling_fan", label: "Cooling fan", on: both, marks: "GIR" },
      { id: "engine_mountings", label: "Engine mountings", on: both, marks: "GIR" },
      { id: "ac_filter", label: "AC filter", on: pm, marks: "GIR" },
      { id: "radiator", label: "Radiator", on: both, marks: "GIR" },
      { id: "condenser", label: "Condenser", on: both, marks: "GIR" },
      { id: "fuel_lines", label: "Fuel lines", on: both, marks: "GIR" },
      { id: "brake_lines", label: "Brake lines", on: both, marks: "GIR" },
      { id: "wiring", label: "Wiring & connectors", on: both, marks: "GIR" },
      { id: "leakage", label: "Oil or coolant leakage", on: both, marks: "GIR" },
      { id: "drive_belt", label: "Drive belt", on: both, marks: "GIR" },
      { id: "radiator_cap", label: "Radiator cap", on: both, marks: "GR" },
    ],
  },
  {
    id: "fluids",
    title: "Fluids",
    items: [
      { id: "engine_oil_level", label: "Engine oil level", on: both, marks: "GIR" },
      { id: "coolant_level", label: "Coolant level", on: both, marks: "GIR" },
      { id: "brake_fluid_level", label: "Brake fluid level", on: both, marks: "GIR" },
    ],
  },
  {
    id: "exterior",
    title: "Vehicle Exterior",
    extra: "wheels",
    items: [
      { id: "wheel_nuts", label: "Wheel nuts tightening & tire pressure", on: both, marks: "GIR" },
      { id: "fuel_cap", label: "Fuel tank cap & door", on: both, marks: "GR" },
      { id: "windshield", label: "Windshield condition", on: pm, marks: "GR" },
      { id: "latches", label: "Hood & luggage compartment latch", on: pm, marks: "GIR" },
      { id: "lights_horn", label: "Lights & horn", on: pm, marks: "GIR" },
      { id: "exhaust_color", label: "Exhaust gas color", on: pm, marks: "GIR" },
    ],
  },
  {
    id: "under_chassis",
    title: "Under Chassis",
    extra: "brakes",
    items: [
      { id: "under_vehicle", label: "Under vehicle (brake lines, park brake cables…)", on: pm, marks: "GIR" },
      { id: "axles", label: "Differential, axles & propeller shaft", on: pm, marks: "GIR" },
      { id: "exhaust_system", label: "Exhaust system", on: pm, marks: "GIR" },
      { id: "caliper_bolts", label: "Brake caliper bolts & hoses tightening", on: pm, marks: "GR" },
      { id: "shock_absorbers", label: "Shock absorbers (visual)", on: pm, marks: "GIR" },
      { id: "tire_condition", label: "Tire condition", on: pm, marks: "GIR" },
      { id: "wheel_bearing", label: "Wheel bearing", on: pm, marks: "GIR" },
    ],
  },
  {
    id: "interior",
    title: "Interior",
    items: [
      { id: "meter_pm_reminder", label: "Combination meter & PM reminder", on: pm, marks: "GIR" },
      { id: "mirrors", label: "Mirrors operation", on: pm, marks: "GIR" },
      { id: "engine_bay_clean", label: "Engine compartment cleaning", on: pm, marks: "GIR" },
      { id: "ac_heater", label: "AC & heater operation", on: pm, marks: "GIR" },
      { id: "windows_locks", label: "Window & door lock operation", on: pm, marks: "GIR" },
      { id: "wipers", label: "Wipers & washer", on: pm, marks: "GIR" },
      { id: "seat_belts", label: "Seat belts", on: pm, marks: "GIR" },
      { id: "parking_brake", label: "Parking brake (if equipped)", on: pm, marks: "GIR", optional: true },
      { id: "cassette", label: "Cassette / audio", on: pm, marks: "GIR" },
      { id: "idle", label: "Idle condition", on: pm, marks: "GIR" },
      { id: "pedals", label: "Accelerator & brake pedal", on: pm, marks: "GIR" },
    ],
  },
  {
    id: "road_test",
    title: "Road Test",
    items: [
      { id: "wheel_whining", label: "Wheel whining noise", on: both, marks: "GIR" },
      { id: "alignment", label: "Wheel alignment & balance", on: both, marks: "GR" },
      { id: "body_noise", label: "Body abnormal noise", on: both, marks: "GIR" },
      { id: "cruise_control", label: "Cruise control (if equipped)", on: both, marks: "GIR", optional: true },
      { id: "suspension_noise", label: "Suspension noise", on: both, marks: "GIR" },
    ],
  },
  {
    id: "repair_checks",
    title: "Repair Checks",
    items: [
      { id: "warning_lamps", label: "Warning lamps ON", on: gr, marks: "GR", clarify: true },
      { id: "engine_issues", label: "Engine related issues", on: gr, marks: "GR", clarify: true },
      { id: "transmission_issues", label: "Transmission related issues", on: gr, marks: "GR", clarify: true },
      { id: "brake_issues", label: "Brakes related issues", on: gr, marks: "GR", clarify: true },
      { id: "four_wd_issues", label: "4x4 system related issues (if available)", on: gr, marks: "GR", clarify: true, optional: true },
    ],
  },
];

export const WHEELS = ["FL", "FR", "RL", "RR"] as const;
export const BRAKE_MEASURES = [
  { id: "front_pads", label: "Front pads" },
  { id: "front_disks", label: "Front disks" },
  { id: "rear_pads", label: "Rear pads" },
  { id: "rear_disks", label: "Rear disks" },
] as const;

/** The sheets a repair type asks: periodic maintenance -> pm, general repair -> gr, both -> both. */
export function sheetsFor(repairType: string | null | undefined): SheetKind[] {
  if (repairType === "periodic_maintenance") return ["pm"];
  if (repairType === "general_repair") return ["gr"];
  if (repairType === "both") return ["pm", "gr"];
  return [];
}

/** The sections (with only their items) a repair type asks. */
export function sectionsFor(repairType: string | null | undefined): Section[] {
  const kinds = sheetsFor(repairType);
  return QC_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => i.on.some((k) => kinds.includes(k))) }))
    .filter((s) => s.items.length > 0)
    .map((s) => ({ ...s, extra: s.extra === "brakes" && !kinds.includes("pm") ? undefined : s.extra }));
}

export const sheetTitle = (repairType: string | null | undefined) =>
  repairType === "periodic_maintenance" ? "Maintenance inspection sheet" : repairType === "general_repair" ? "GR final inspection sheet" : "Maintenance & GR inspection sheet";

export type Checklist = {
  repairType: string;
  answers: Record<string, Mark>;
  clarify: Record<string, string>;
  wheels: Partial<Record<(typeof WHEELS)[number], { pressure?: string; torque?: string }>>;
  brakes: Partial<Record<(typeof BRAKE_MEASURES)[number]["id"], string>>;
  tireDate?: string;
  comments: Record<string, string>;
};

export const emptyChecklist = (repairType: string): Checklist => ({ repairType, answers: {}, clarify: {}, wheels: {}, brakes: {}, comments: {} });

/** The items still without an answer. */
export function unanswered(c: Checklist): string[] {
  return sectionsFor(c.repairType).flatMap((s) => s.items.filter((i) => !c.answers[i.id]).map((i) => i.label));
}

const short = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const numberText = (v: unknown) => short(v, 12).replace(/[^\d.]/g, "");

/** The checklist as the server keeps it: only the questions of its repair type, only allowed answers, text cut short. */
export function cleanChecklist(raw: unknown, repairType: string): Checklist | null {
  const sections = sectionsFor(repairType);
  if (!sections.length) return null;
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<Checklist>;
  const out = emptyChecklist(repairType);
  for (const s of sections) {
    for (const i of s.items) {
      const m = c.answers?.[i.id];
      const ok: Mark[] = [...(i.marks === "GIR" ? (["G", "I", "R"] as Mark[]) : (["G", "R"] as Mark[])), ...(i.optional ? (["NA"] as Mark[]) : [])];
      if (m && ok.includes(m)) out.answers[i.id] = m;
      if (i.clarify && c.clarify?.[i.id]) out.clarify[i.id] = short(c.clarify[i.id], 500);
    }
    if (c.comments?.[s.id]) out.comments[s.id] = short(c.comments[s.id], 1000);
    if (s.extra === "wheels")
      for (const w of WHEELS) {
        const v = c.wheels?.[w];
        if (v && (v.pressure || v.torque)) out.wheels[w] = { pressure: numberText(v.pressure), torque: numberText(v.torque) };
      }
    if (s.extra === "brakes") {
      for (const b of BRAKE_MEASURES) if (c.brakes?.[b.id]) out.brakes[b.id] = numberText(c.brakes[b.id]);
      if (c.tireDate) out.tireDate = short(c.tireDate, 8).replace(/[^\d/]/g, "");
    }
  }
  return out;
}
