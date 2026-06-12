import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Photo OCR for the bulk importers. Tony photographs a printed list in the
// field; this turns it into (a) plain text lines for the labeled/line-scan
// passes and (b) a cell grid for the spreadsheet-style column inference.
//
// - tesseract.js runs in-process (no API keys, no per-photo cost).
// - The English model is vendored at server/tessdata so Railway needs no CDN.
// - Columns are rebuilt GEOMETRICALLY from word coordinates: a gap between
//   words much wider than that line's typical word spacing is a column break.
//   (OCR plain text collapses table columns to single spaces, which would
//   make "Ann Arbor  Washtenaw" unsplittable; coordinates keep it right.)
// ---------------------------------------------------------------------------

export interface OcrResult {
  text: string;       // newline-joined lines (words single-spaced)
  grid: string[][];   // lines split into cells at geometric column gaps
}

const TESSDATA_DIR = path.resolve(process.cwd(), "server", "tessdata");

let workerPromise: Promise<any> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker("eng", 1, {
        langPath: TESSDATA_DIR,
        cachePath: os.tmpdir(),
        gzip: false,
        // Quiet the default logger; route errors to console.
        logger: () => {},
        errorHandler: (e: unknown) => console.error("[ocr]", e),
      });
    })().catch((e) => {
      workerPromise = null; // allow retry on next request
      throw e;
    });
  }
  return workerPromise;
}

/** Normalize a phone-camera image for OCR: honor EXIF rotation, cap size, grayscale, stretch contrast. */
async function preprocess(buffer: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(buffer)
    .rotate() // apply EXIF orientation — critical for phone photos
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .greyscale()
    .normalise()
    .png()
    .toBuffer();
}

interface Word { text: string; x0: number; x1: number; y0: number; y1: number }

/** Pull a flat word list (with boxes) out of tesseract's block tree, grouped by line. */
function linesFromBlocks(blocks: any[]): Word[][] {
  const lines: Word[][] = [];
  for (const block of blocks ?? []) {
    for (const para of block?.paragraphs ?? []) {
      for (const line of para?.lines ?? []) {
        const words: Word[] = [];
        for (const w of line?.words ?? []) {
          const t = String(w?.text ?? "").trim();
          if (!t) continue;
          const b = w.bbox ?? {};
          words.push({ text: t, x0: b.x0 ?? 0, x1: b.x1 ?? 0, y0: b.y0 ?? 0, y1: b.y1 ?? 0 });
        }
        if (words.length) lines.push(words.sort((a, b) => a.x0 - b.x0));
      }
    }
  }
  return lines;
}

/** Split one line of words into cells wherever the gap is much wider than the line's normal spacing. */
function lineToCells(words: Word[]): string[] {
  if (words.length <= 1) return [words.map((w) => w.text).join(" ")].filter(Boolean);
  const gaps: number[] = [];
  for (let i = 1; i < words.length; i++) gaps.push(Math.max(0, words[i].x0 - words[i - 1].x1));
  const avgH = words.reduce((s, w) => s + (w.y1 - w.y0), 0) / words.length || 12;
  // Estimate normal word spacing from the SMALLEST gaps (the 25th percentile),
  // capped by glyph height — never from the median: in a table whose cells are
  // single words, the median gap IS the column gap, which would make the
  // threshold unreachable and collapse the whole line into one cell.
  const pos = gaps.filter((g) => g > 0).sort((a, b) => a - b);
  const p25 = pos.length ? pos[Math.floor(pos.length * 0.25)] : 0;
  const smallGap = Math.min(p25 || avgH * 0.45, avgH * 0.6);
  const threshold = Math.max(smallGap * 3, avgH * 1.4, 12);

  const cells: string[] = [];
  let cur = [words[0].text];
  for (let i = 1; i < words.length; i++) {
    if (gaps[i - 1] > threshold) {
      cells.push(cur.join(" "));
      cur = [words[i].text];
    } else {
      cur.push(words[i].text);
    }
  }
  cells.push(cur.join(" "));
  return cells.map((c) => c.trim()).filter(Boolean);
}

export async function ocrImage(buffer: Buffer): Promise<OcrResult> {
  const img = await preprocess(buffer);
  const worker = await getWorker();
  const { data } = await worker.recognize(img, {}, { text: true, blocks: true });

  const wordLines = linesFromBlocks(data?.blocks ?? []);
  if (wordLines.length) {
    const grid = wordLines.map(lineToCells).filter((cells) => cells.length > 0);
    const text = wordLines.map((ws) => ws.map((w) => w.text).join(" ")).join("\n");
    return { text, grid };
  }

  // Fallback if block detail isn't available: plain text, cells split on 2+ spaces.
  const text = String(data?.text ?? "");
  const grid = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s{2,}|\t+/).map((c) => c.trim()).filter(Boolean));
  return { text, grid };
}

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff"]);

export function isImageFile(name: string, buffer: Buffer): boolean {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (IMAGE_EXTS.has(ext)) return true;
  const head = buffer.subarray(0, 12);
  if (head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return true;            // JPEG
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true; // PNG
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return true;
  return false;
}
