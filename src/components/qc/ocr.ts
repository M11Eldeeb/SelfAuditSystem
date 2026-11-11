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

export type JobCardReading = { wips: string[]; vin: string | null; plates: string[] };

/**
 * Job card: the WIP number (5 digits after "W.I.P. No.", else every 5-digit number on the card, best first) and the VIN
 * (17 characters, after "Chassis No." when it can be found).
 */
export async function readJobCard(file: File): Promise<JobCardReading> {
  const text = await readText(file);
  const flat = text.replace(/\s+/g, " ");
  const wips: string[] = [];
  for (const m of flat.matchAll(/W\s*\.?\s*[I1l|]\s*\.?\s*P\s*\.?\s*(?:N[o0]\s*\.?)?\s*[:.]?\s*(\d{5})(?!\d)/gi)) wips.push(m[1]);
  for (const m of flat.matchAll(/(?<!\d)(\d{5})(?!\d)/g)) if (!wips.includes(m[1])) wips.push(m[1]);

  let vin: string | null = null;
  const afterChassis = flat.match(/Chass[il1]s\s*N[o0]\.?\s*[:.]?\s*([A-Z0-9 ]{17,24})/i)?.[1];
  for (const raw of [afterChassis, ...text.split(/\n+/), flat].filter(Boolean) as string[]) {
    const m = vinFix(raw).match(/L[A-HJ-NPR-Z0-9]{16}/) ?? vinFix(raw).match(/[A-HJ-NPR-Z0-9]{17}/);
    if (m) {
      vin = m[0];
      break;
    }
  }
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
