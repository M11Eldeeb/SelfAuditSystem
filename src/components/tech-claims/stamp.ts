// Date stamp burned into every claim photo and video, on the phone, before upload.
// The date is when the photo / video was taken (photo: EXIF date; video: the MP4's own creation time; otherwise the file's
// date), shown in Saudi time with the technician's name.

/** The stamp shows the date only (Saudi calendar day), e.g. 20/10/2026. */
const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Riyadh" });

// ---------- capture time ----------

/** EXIF DateTimeOriginal of a JPEG (camera local time = Saudi time), or null. */
async function exifDate(file: File): Promise<Date | null> {
  const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
  if (buf.byteLength < 4 || buf.getUint16(0) !== 0xffd8) return null;
  let p = 2;
  while (p + 4 < buf.byteLength) {
    const marker = buf.getUint16(p);
    const len = buf.getUint16(p + 2);
    if (marker === 0xffe1 && buf.getUint32(p + 4) === 0x45786966) {
      const t = p + 10; // TIFF header
      const le = buf.getUint16(t) === 0x4949;
      const u16 = (o: number) => buf.getUint16(t + o, le);
      const u32 = (o: number) => buf.getUint32(t + o, le);
      const readAscii = (o: number, n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(buf.getUint8(t + o + i))).join("");
      const findTag = (ifd: number, tag: number): number | null => {
        const n = u16(ifd);
        for (let i = 0; i < n; i++) {
          const e = ifd + 2 + i * 12;
          if (u16(e) === tag) return e;
        }
        return null;
      };
      const ifd0 = u32(4);
      const exifPtr = findTag(ifd0, 0x8769);
      const candidates: number[] = [];
      if (exifPtr != null) {
        const exifIfd = u32(exifPtr + 8);
        const e = findTag(exifIfd, 0x9003) ?? findTag(exifIfd, 0x9004);
        if (e != null) candidates.push(u32(e + 8));
      }
      const e0 = findTag(ifd0, 0x0132);
      if (e0 != null) candidates.push(u32(e0 + 8));
      for (const off of candidates) {
        const m = readAscii(off, 19).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
        if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+03:00`);
      }
      return null;
    }
    if ((marker & 0xff00) !== 0xff00) return null;
    p += 2 + len;
  }
  return null;
}

/** creation_time of an MP4 / MOV (the "mvhd" box inside "moov"), or null. Reads only box headers. */
async function mp4Date(file: File): Promise<Date | null> {
  const read = async (pos: number, n: number) => new DataView(await file.slice(pos, pos + n).arrayBuffer());
  const boxes = async (start: number, end: number, want: string): Promise<{ pos: number; size: number; header: number } | null> => {
    let pos = start;
    for (let guard = 0; pos + 8 <= end && guard < 500; guard++) {
      const h = await read(pos, 16);
      let size = h.getUint32(0);
      const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
      let header = 8;
      if (size === 1) {
        size = Number(h.getBigUint64(8));
        header = 16;
      } else if (size === 0) size = end - pos;
      if (size < header) return null;
      if (type === want) return { pos, size, header };
      pos += size;
    }
    return null;
  };
  try {
    const moov = await boxes(0, file.size, "moov");
    if (!moov) return null;
    const mvhd = await boxes(moov.pos + moov.header, moov.pos + moov.size, "mvhd");
    if (!mvhd) return null;
    const d = await read(mvhd.pos + mvhd.header, 12);
    const secs = d.getUint8(0) === 1 ? Number(d.getBigUint64(4)) : d.getUint32(4);
    if (!secs) return null;
    const date = new Date((secs - 2082844800) * 1000); // seconds since 1904-01-01 UTC
    return date.getFullYear() > 2015 && date.getTime() < Date.now() + 86_400_000 ? date : null;
  } catch {
    return null;
  }
}

async function takenAt(file: File, kind: "photo" | "video"): Promise<Date> {
  const d = kind === "photo" ? await exifDate(file).catch(() => null) : await mp4Date(file);
  return d ?? new Date(file.lastModified || Date.now());
}

// ---------- drawing ----------

function drawStamp(ctx: CanvasRenderingContext2D, w: number, h: number, lines: string[]) {
  const size = Math.max(14, Math.round(Math.min(w, h) / 26));
  ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = "top";
  const pad = Math.round(size * 0.45);
  const lineH = Math.round(size * 1.25);
  const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const boxH = lineH * lines.length + pad * 2 - (lineH - size);
  const x = w - boxW - pad;
  const y = h - boxH - pad;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x, y, boxW, boxH);
  ctx.fillStyle = "#ffd400";
  lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + i * lineH));
}

const baseName = (n: string) => n.replace(/\.[^.]+$/, "");

/** A photo with the stamp, as JPEG (longest side up to 2048 px - about 0.5 MB, quick to send). */
export async function stampPhoto(file: File, who: string): Promise<File> {
  const when = await takenAt(file, "photo");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`"${file.name}" cannot be opened on this phone - take the photo with the "Take photo" button.`);
  }
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  drawStamp(ctx, canvas.width, canvas.height, [fmt(when), who]);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error(`Could not stamp "${file.name}".`);
  return new File([blob], `${baseName(file.name)}_stamped.jpg`, { type: "image/jpeg", lastModified: when.getTime() });
}

function recorderType(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const [mime, ext] of [
    ["video/mp4;codecs=avc1.42E01F,mp4a.40.2", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm;codecs=vp8,opus", "webm"],
    ["video/webm", "webm"],
  ] as const)
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return null;
}

/**
 * A video with the stamp burned in: the video is played (silently) into a canvas that draws the stamp on each frame and
 * recorded again with its sound. Takes as long as the video lasts. The clock in the stamp runs with the video.
 */
/** Video length in seconds (from the file's own header; null if it cannot be read). */
export function videoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    const done = (d: number | null) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    v.src = url;
  });
}

const VIDEO_LONG_SIDE = 1280; // 720p: sharp enough to see a part, a fraction of the size

/**
 * Fast path: the phone's hardware video decoder and encoder (WebCodecs, via Mediabunny) - every frame is drawn with
 * the stamp and re-encoded to 720p H.264, typically several times faster than the video lasts. Null when this phone's
 * browser cannot do it (the caller then uses the slower replay method).
 */
export async function stampVideoFast(file: File, who: string, onProgress: (pct: number) => void): Promise<File | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") return null;
  const mb = await import("mediabunny");
  const start = await takenAt(file, "video");
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const scale = Math.min(1, VIDEO_LONG_SIDE / Math.max(track.displayWidth, track.displayHeight));
    const outW = Math.round((track.displayWidth * scale) / 2) * 2;
    const outH = Math.round((track.displayHeight * scale) / 2) * 2;
    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D | null;
    if (!ctx) return null;
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: {
        width: outW,
        height: outH,
        fit: "contain",
        codec: "avc",
        quality: mb.QUALITY_MEDIUM,
        forceTranscode: true,
        allowTransformationMetadata: false,
        hardwareAcceleration: "prefer-hardware",
        processedWidth: outW,
        processedHeight: outH,
        process: (sample) => {
          sample.draw(ctx, 0, 0, outW, outH);
          drawStamp(ctx, outW, outH, [fmt(new Date(start.getTime() + sample.timestamp * 1000)), who]);
          return canvas;
        },
      },
      audio: { codec: "aac" },
    });
    if (!conversion.isValid) return null;
    conversion.onProgress = (p) => onProgress(Math.min(99, Math.round(p * 100)));
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer?.byteLength) return null;
    onProgress(100);
    return new File([buffer], `${baseName(file.name)}_stamped.mp4`, { type: "video/mp4", lastModified: start.getTime() });
  } catch (e) {
    console.warn("Fast video stamp unavailable, using the replay method:", e);
    return null;
  } finally {
    input.dispose?.();
  }
}

/** A video with the stamp burned in - the fast hardware path when the phone supports it, else the replay method. */
export async function stampVideo(file: File, who: string, onProgress: (pct: number) => void): Promise<File> {
  const fast = await stampVideoFast(file, who, onProgress).catch(() => null);
  if (fast) return fast;
  return stampVideoReplay(file, who, onProgress);
}

async function stampVideoReplay(file: File, who: string, onProgress: (pct: number) => void): Promise<File> {
  const type = recorderType();
  if (!type) throw new Error("This phone's browser cannot stamp videos - use Chrome or Safari.");
  const start = await takenAt(file, "video");
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.playsInline = true;
  video.preload = "auto";
  video.muted = false;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error(`"${file.name}" cannot be played on this phone - record it with the "Record video" button.`));
    });
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((video.videoWidth * scale) / 2) * 2;
    canvas.height = Math.round((video.videoHeight * scale) / 2) * 2;
    const ctx = canvas.getContext("2d")!;

    const stream = canvas.captureStream(30);
    // Sound: through an audio graph that is not connected to the speaker.
    let audio: AudioContext | null = null;
    try {
      audio = new AudioContext();
      const src = audio.createMediaElementSource(video);
      const dest = audio.createMediaStreamDestination();
      src.connect(dest);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch {
      video.muted = true; // no sound track rather than no video
    }

    const rec = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 4_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));

    const draw = () => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      drawStamp(ctx, canvas.width, canvas.height, [fmt(new Date(start.getTime() + video.currentTime * 1000)), who]);
      if (video.duration) onProgress(Math.min(99, Math.round((video.currentTime / video.duration) * 100)));
    };
    const vfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback?.bind(video);
    let running = true;
    const loop = () => {
      if (!running) return;
      draw();
      if (vfc) vfc(loop);
      else requestAnimationFrame(loop);
    };

    const ended = new Promise<void>((resolve, reject) => {
      video.onended = () => resolve();
      video.onerror = () => reject(new Error(`Could not stamp "${file.name}".`));
    });
    rec.start(1000);
    await audio?.resume().catch(() => undefined);
    await video.play();
    loop();
    await ended;
    draw();
    running = false;
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    await audio?.close().catch(() => undefined);
    onProgress(100);
    const blob = new Blob(chunks, { type: type.mime.split(";")[0] });
    if (!blob.size) throw new Error(`Could not stamp "${file.name}".`);
    return new File([blob], `${baseName(file.name)}_stamped.${type.ext}`, { type: type.mime.split(";")[0], lastModified: start.getTime() });
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
