// Reads the job card and the parts requisition on the phone itself (Tesseract.js: free, no server, no API cost). What it
// reads is only a suggestion: the server checks it against the Open WIPs report and the user sees it in editable fields.
import type { Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;

function worker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = import("tesseract.js").then(({ createWorker }) => createWorker("eng"));
    workerPromise.catch(() => (workerPromise = null));
  }
  return workerPromise;
}

/** Downscaled (phone photos are huge and slow to read), grayscale, contrast stretched. */
function prepare(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 2200 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = data.data;
      let min = 255;
      let max = 0;
      for (let i = 0; i < px.length; i += 4) {
        const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        px[i] = g;
        if (g < min) min = g;
        if (g > max) max = g;
      }
      const span = Math.max(1, max - min);
      for (let i = 0; i < px.length; i += 4) {
        const v = ((px[i] - min) / span) * 255;
        px[i] = px[i + 1] = px[i + 2] = v;
      }
      ctx.putImageData(data, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This photo cannot be opened."));
    };
    img.src = url;
  });
}

async function readText(file: File): Promise<string> {
  const w = await worker();
  await w.setParameters({ tessedit_char_whitelist: "" });
  const { data } = await w.recognize(await prepare(file));
  return data.text;
}

/** VIN letters never include I, O or Q: read as 1, 0, 0. */
const vinFix = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/I/g, "1").replace(/[OQ]/g, "0");

/** In the last 6 places of a VIN (the serial number) there are only digits: letters that look like digits are digits. */
const LOOKS_LIKE_DIGIT: Record<string, string> = { S: "5", B: "8", Z: "2", G: "6", T: "7", D: "0", U: "0", A: "4", L: "1", J: "1" };
const serialFix = (v: string) => v.slice(0, 11) + v.slice(11).replace(/[A-Z]/g, (c) => LOOKS_LIKE_DIGIT[c] ?? c);

/**
 * The VIN on the card: a single word of 17 characters (or two pieces the reader split) that really looks like a VIN -
 * starting with "L", 11 letters/digits then a 6-digit serial number. "LSJ" (SAIC) preferred.
 * Never a run of letters glued together from other words.
 */
function findVin(text: string): string | null {
  const words = text.toUpperCase().split(/[\s|,;:]+/).map(vinFix).filter(Boolean);
  const candidates: string[] = [];
  for (let i = 0; i < words.length; i++) {
    // A stray mark next to the VIN can add a character or two in front: try those offsets too.
    for (const w of [words[i], words[i] + (words[i + 1] ?? "")]) for (let k = 0; k + 17 <= w.length && k <= 2; k++) {
        const raw = w.slice(k, k + 17);
        // As read (before any letter is turned into a digit): a serial number that is mostly digits already, and digits
        // among the first 11 too - words of the form never look like that.
        const digits = (x: string) => (x.match(/\d/g) ?? []).length;
        if (digits(raw.slice(11)) >= 4 && digits(raw.slice(0, 11)) >= 2) candidates.push(serialFix(raw));
      }
  }
  // Every MG here is made by SAIC in China: its VIN starts with "L" (world maker code LSJ).
  const valid = candidates.filter((v) => /^L[A-HJ-NPR-Z0-9]{10}\d{6}$/.test(v));
  const score = (v: string) => (v.startsWith("LSJ") ? 3 : v.startsWith("L") ? 1 : 0);
  valid.sort((a, b) => score(b) - score(a));
  return valid[0] ?? null;
}

export type JobCardReading = { wips: string[]; vin: string | null; plates: string[] };

/**
 * Job card: the WIP number (5 digits after "W.I.P. No.", else every 5-digit number on the card, best first), the VIN
 * (after "Chassis No." when it can be found, else the VIN-shaped word on the card) and the plate.
 */
export async function readJobCard(file: File): Promise<JobCardReading> {
  const text = await readText(file);
  const flat = text.replace(/\s+/g, " ");
  const wips: string[] = [];
  for (const m of flat.matchAll(/W\s*\.?\s*[I1l|]\s*\.?\s*P\s*\.?\s*(?:N[o0]\s*\.?)?\s*[:.]?\s*(\d{5})(?!\d)/gi)) wips.push(m[1]);
  for (const m of flat.matchAll(/(?<!\d)(\d{5})(?!\d)/g)) if (!wips.includes(m[1])) wips.push(m[1]);

  const afterChassis = flat.match(/Chass[il1]s\s*N[o0]\.?\s*[:.]?\s*([A-Z0-9 ]{17,24})/i)?.[1];
  const vin = (afterChassis && findVin(afterChassis)) || findVin(text);
  // Saudi plates as the job card prints them ("4987BBR"): 1-4 digits and 3 letters.
  const plates = [...new Set([...flat.toUpperCase().matchAll(/(?<![A-Z0-9])(\d{1,4})\s?([A-Z]{3})(?![A-Z0-9])/g)].map((m) => `${m[1]}${m[2]}`))].slice(0, 6);
  return { wips: wips.slice(0, 12), vin, plates };
}

export type RequisitionPart = { partNo: string; description: string };

/** Parts requisition: each line's part number (MG11154869-NBC, 10123456 ...) and its description (SUNVISOR ASM-R). */
export async function readRequisition(file: File): Promise<RequisitionPart[]> {
  const text = await readText(file);
  const parts: RequisitionPart[] = [];
  for (const line of text.split(/\n+/)) {
    // The "-" of a suffix is often read as "." ("MG11154869.NBC").
    const m = line.toUpperCase().match(/(?<![A-Z0-9])((?:MG)?[0-9][0-9A-Z]{6,13}(?:[-.][A-Z0-9]{2,5})?)\s+([A-Z][A-Z0-9 ./&()'+-]{2,60}?)(?=\s+\d+[.,]\d{2}\b|\s+[A-Z][0-9O]{2}[A-Z][0-9O]{2}\b|\s*$)/);
    if (!m) continue;
    const partNo = m[1].replace(".", "-");
    if ((partNo.match(/\d/g) ?? []).length < 6) continue;
    // A stray mark before the quantity (a signature, a tick) is read as a short token: drop it.
    const description = m[2].replace(/\s+/g, " ").trim().replace(/(\s+[^\s]{1,2})+$/, "");
    if (!parts.some((p) => p.partNo === partNo)) parts.push({ partNo, description });
  }
  return parts;
}
