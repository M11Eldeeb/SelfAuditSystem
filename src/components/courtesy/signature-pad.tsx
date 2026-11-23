"use client";

import { useEffect, useRef } from "react";

/**
 * A box to sign in with a finger or the mouse. Calls `onChange` with the signature as a PNG (base64, no "data:" prefix)
 * after every stroke, or null when it is cleared / empty.
 */
export function SignaturePad({ onChange, clearLabel = "Clear", hint, dir = "ltr" }: { onChange: (png: string | null) => void; clearLabel?: string; hint?: string; dir?: "ltr" | "rtl" }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const fit = () => {
      const r = c.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(r.width * ratio);
      c.height = Math.round(r.height * ratio);
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111827";
      drawn.current = false;
      cb.current(null);
    };
    fit();
    let down = false;
    let last: { x: number; y: number } | null = null;
    const at = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const start = (e: PointerEvent) => {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      down = true;
      last = at(e);
      ctx.beginPath();
      ctx.arc(last.x, last.y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = "#111827";
      ctx.fill();
    };
    const move = (e: PointerEvent) => {
      if (!down || !last) return;
      const p = at(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      drawn.current = true;
    };
    const end = () => {
      if (!down) return;
      down = false;
      last = null;
      if (drawn.current) cb.current(c.toDataURL("image/png").split(",")[1]);
    };
    c.addEventListener("pointerdown", start);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    window.addEventListener("resize", fit);
    return () => {
      c.removeEventListener("pointerdown", start);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", end);
      c.removeEventListener("pointercancel", end);
      window.removeEventListener("resize", fit);
    };
  }, []);

  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    drawn.current = false;
    onChange(null);
  };

  return (
    <div dir={dir} className="space-y-1">
      <div className="relative">
        <canvas ref={canvas} className="h-40 w-full touch-none rounded-xl border-2 border-dashed border-neutral-300 bg-white" aria-label={hint ?? "Signature"} />
        <button type="button" onClick={clear} className="absolute top-2 rounded-md bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 ltr:right-2 rtl:left-2">
          {clearLabel}
        </button>
      </div>
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

/** A phone photo made smaller (longest side 1600 px, JPEG) for upload: base64 without the "data:" prefix. */
export async function shrinkPhoto(file: File, max = 1600): Promise<{ base64: string; mimeType: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bitmap.width * scale);
  c.height = Math.round(bitmap.height * scale);
  c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  const url = c.toDataURL("image/jpeg", 0.82);
  return { base64: url.split(",")[1], mimeType: "image/jpeg" };
}
