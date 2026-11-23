// Reads the VIN and the plate from a photo of the vehicle registration card (استمارة), free and on the phone
// (Tesseract.js - no server, no API cost). The reading is a suggestion: the customer sees it in editable boxes.
import type { Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;
async function worker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = import("tesseract.js").then(async ({ createWorker }) => {
      const w = await createWorker("eng");
      await w.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 " });
      return w;
    });
    workerPromise.catch(() => (workerPromise = null));
  }
  return workerPromise;
}

/**
 * The photo turned `deg` degrees and made easy to read: the bright card is cut out of a dark background (an Absher
 * screenshot, a card on a table), enlarged to about 1600 px wide, in grey with the contrast stretched.
 */
function prepare(img: HTMLImageElement, deg: 0 | 90 | 270): HTMLCanvasElement {
  const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const turned = document.createElement("canvas");
  turned.width = deg === 0 ? w : h;
  turned.height = deg === 0 ? h : w;
  const tctx = turned.getContext("2d", { willReadFrequently: true })!;
  tctx.translate(turned.width / 2, turned.height / 2);
  tctx.rotate((deg * Math.PI) / 180);
  tctx.drawImage(img, -w / 2, -h / 2, w, h);
  tctx.setTransform(1, 0, 0, 1, 0, 0);

  // The card: rows and columns where many pixels are bright.
  const W = turned.width;
  const H = turned.height;
  const src = tctx.getImageData(0, 0, W, H).data;
  const grey = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    return 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
  };
  const rows: number[] = [];
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x += 4) if (grey(x, y) > 170) n++;
    if (n > W / 4 / 2) rows.push(y);
  }
  const cols: number[] = [];
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = 0; y < H; y += 4) if (grey(x, y) > 170) n++;
    if (n > H / 4 / 4) cols.push(x);
  }
  let box = { x: 0, y: 0, w: W, h: H };
  if (rows.length && cols.length) {
    const b = { x: cols[0], y: rows[0], w: cols[cols.length - 1] - cols[0] + 1, h: rows[rows.length - 1] - rows[0] + 1 };
    const share = (b.w * b.h) / (W * H);
    if (share > 0.12 && share < 0.9) box = b;
  }
  const up = Math.min(2.5, Math.max(1, 1600 / box.w));
  const c = document.createElement("canvas");
  c.width = Math.round(box.w * up);
  c.height = Math.round(box.h * up);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(turned, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height);
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
  for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = ((px[i] - min) / span) * 255;
  ctx.putImageData(data, 0, 0);
  return c;
}

const VALUE: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const WEIGHT = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
/** The VIN's own check digit (position 9) is right. */
export function vinCheckOk(v: string): boolean {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return false;
  const sum = [...v].reduce((n, ch, i) => n + (/\d/.test(ch) ? Number(ch) : (VALUE[ch] ?? 0)) * WEIGHT[i], 0) % 11;
  return (sum === 10 ? "X" : String(sum)) === v[8];
}

/** The best 17-character VIN in the text and how sure: right check digit first, an MG start (LSJW / LSJA / LSJZ ...) next. */
function bestVin(text: string): { vin: string; score: number } | null {
  const cands = new Set<string>();
  for (const raw of [...text.split(/\n+/), text.replace(/\s+/g, "")]) {
    const s = raw.replace(/[^A-Z0-9]/g, "").replace(/[IO]/g, (c) => (c === "I" ? "1" : "0")).replace(/Q/g, "0");
    for (let i = 0; i + 17 <= s.length; i++) cands.add(s.slice(i, i + 17));
    // The reader sometimes adds one letter: try each 18-character run without one of its characters.
    for (let i = 0; i + 18 <= s.length; i++) {
      const run = s.slice(i, i + 18);
      for (let j = 0; j < 18; j++) cands.add(run.slice(0, j) + run.slice(j + 1));
    }
  }
  const score = (v: string) => (vinCheckOk(v) ? 4 : 0) + (v.startsWith("LSJ") ? 2 : 0) + (/^LSJ[WAZ]/.test(v) ? 1 : 0) + (/\d{5,6}$/.test(v) ? 1 : 0);
  const list = [...cands].filter((v) => /^[A-HJ-NPR-Z0-9]{17}$/.test(v)).sort((a, b) => score(b) - score(a));
  if (!list.length) return null;
  const top = list[0];
  return score(top) >= 4 || top.startsWith("LSJ") ? { vin: top, score: score(top) } : null;
}

/** A Saudi plate in Latin letters: 1-4 digits and 1-3 letters ("2012 RGR"). Best: 4 digits, 3 letters, under the VIN. */
function bestPlate(text: string, vin: string | null): string | null {
  const lines = text.split(/\n+/);
  const vinLine = vin ? lines.findIndex((l) => l.replace(/[^A-Z0-9]/g, "").includes(vin.slice(0, 10))) : -1;
  let best = { plate: "", score: 0 };
  lines.forEach((line, i) => {
    if (i === vinLine) return;
    const clean = ` ${line.replace(/[^A-Z0-9 ]/g, " ")} `;
    for (const m of clean.matchAll(/\s(\d{1,4})\s*([ABDEGHJKLNRSTUVXZ](?:\s?[ABDEGHJKLNRSTUVXZ]){0,2})(?=\s)/g)) {
      const letters = m[2].replace(/\s+/g, "");
      const score = (m[1].length === 4 ? 3 : m[1].length >= 3 ? 1 : 0) + letters.length + (vinLine >= 0 && i > vinLine && i <= vinLine + 3 ? 2 : 0);
      if (score > best.score) best = { plate: `${m[1]} ${letters.split("").join(" ")}`, score };
    }
  });
  return best.score >= 4 ? best.plate : null;
}

/** Reads the card (turning the photo if it was taken sideways). */
export async function readRegistration(file: File): Promise<{ vin: string | null; plate: string | null }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const w = await worker();
    // Upright first (a screenshot or a card photo is usually upright); a sideways photo next. A VIN with the right
    // check digit and the MG start is taken at once; otherwise the surest reading of the three turns wins.
    let best: { vin: string | null; plate: string | null; score: number } = { vin: null, plate: null, score: -1 };
    for (const deg of [0, 90, 270] as const) {
      const { data } = await w.recognize(prepare(img, deg));
      const text = data.text.toUpperCase();
      const v = bestVin(text);
      const plate = bestPlate(text, v?.vin ?? null);
      const score = (v?.score ?? -1) + (plate ? 1 : 0);
      if (score > best.score) best = { vin: v?.vin ?? null, plate, score };
      if (v && v.score >= 6) break;
    }
    return { vin: best.vin, plate: best.plate };
  } finally {
    URL.revokeObjectURL(url);
  }
}
