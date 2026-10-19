// Free, on-device text reading (Tesseract.js runs in the phone's browser - no server, no API cost).
// The reading is a suggestion: the user always sees it in an editable box.
import type { Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;

async function worker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = import("tesseract.js").then(({ createWorker }) => createWorker("eng"));
    workerPromise.catch(() => (workerPromise = null));
  }
  return workerPromise;
}

/** Grayscale + stretched contrast, which helps Tesseract on plates, stickers and dashboards. */
function prepare(dataUrl: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
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
    img.onerror = reject;
    img.src = dataUrl;
  });
}

const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";

/** Finds a 17-character VIN in the photo (I/O/Q never appear in a VIN, so they are read as 1/0/0). */
export async function readVin(dataUrl: string): Promise<string | null> {
  const w = await worker();
  await w.setParameters({ tessedit_char_whitelist: `${VIN_CHARS}IOQ` });
  const { data } = await w.recognize(await prepare(dataUrl));
  const lines = data.text.toUpperCase().split(/\n+/);
  for (const raw of [...lines, lines.join("")]) {
    const s = raw.replace(/[^A-Z0-9]/g, "").replace(/[IO]/g, (c) => (c === "I" ? "1" : "0")).replace(/Q/g, "0");
    const m = s.match(/[A-HJ-NPR-Z0-9]{17}/);
    if (m) return m[0];
  }
  return null;
}

/** Reads the odometer: the longest whole number in the photo (the trip meter has a decimal point, so it is skipped). */
export async function readMileage(dataUrl: string): Promise<string | null> {
  const w = await worker();
  await w.setParameters({ tessedit_char_whitelist: "0123456789.,kmKM " });
  const { data } = await w.recognize(await prepare(dataUrl));
  const candidates = [...data.text.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => m[0])
    .filter((t) => !t.includes("."))
    .map((t) => t.replace(/,/g, ""))
    .filter((t) => t.length >= 2);
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.length - a.length || Number(b) - Number(a));
  return String(Number(candidates[0]));
}
