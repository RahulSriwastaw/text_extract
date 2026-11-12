import { PDFDocument } from 'pdf-lib';

// pdfjsLib comes from the CDN script in index.html (same as services/pdfUtils.ts)
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

export type CompressMode = 'off' | 'auto' | 'all';

export interface SplitOptions {
  maxBytes: number;
  maxPages: number;
  compress: CompressMode;
  quality: number; // JPEG 40-95
  longSidePx: number;
}

export interface SplitPart {
  name: string;
  bytes: Uint8Array;
  pages: number;
  note: string;
  source: string;
}

export const defaultSplitOptions = (): SplitOptions => ({
  maxBytes: 9 * 1048576,
  maxPages: 250,
  compress: 'auto',
  quality: 70,
  longSidePx: 1600,
});

const pad = (n: number, w: number) => String(n).padStart(w, '0');
const yieldUi = () => new Promise<void>(r => setTimeout(r, 0));

async function pageJpeg(pjs: any, index: number, quality: number, longSidePx: number) {
  const page = await pjs.getPage(index + 1);
  const v1 = page.getViewport({ scale: 1 });
  const scale = Math.min(4, longSidePx / Math.max(v1.width, v1.height));
  const view = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(view.width);
  canvas.height = Math.ceil(view.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: view }).promise;
  const blob: Blob = await new Promise(r => canvas.toBlob(b => r(b!), 'image/jpeg', quality / 100));
  canvas.width = canvas.height = 0;
  page.cleanup();
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: v1.width, h: v1.height };
}

async function rasterDoc(pjs: any, indexes: number[], quality: number, longSidePx: number, tick?: () => void) {
  const doc = await PDFDocument.create();
  for (const i of indexes) {
    const r = await pageJpeg(pjs, i, quality, longSidePx);
    const img = await doc.embedJpg(r.bytes);
    doc.addPage([r.w, r.h]).drawImage(img, { x: 0, y: 0, width: r.w, height: r.h });
    tick?.();
  }
  return doc;
}

const save = (doc: PDFDocument) => doc.save({ useObjectStreams: true, addDefaultPage: false });

/**
 * Split one PDF into parts that respect maxBytes and maxPages.
 * Pages are never dropped, reordered or duplicated. Names carry the page range.
 */
export async function splitPdf(
  file: File,
  opt: SplitOptions,
  onStatus: (msg: string) => void,
): Promise<SplitPart[]> {
  const base = file.name.replace(/\.pdf$/i, '');
  const buf = await file.arrayBuffer();
  const src = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
  const total = src.getPageCount();

  if (file.size <= opt.maxBytes && total <= opt.maxPages && opt.compress !== 'all') {
    return [{ name: file.name, bytes: new Uint8Array(buf), pages: total, note: 'unchanged (within limits)', source: file.name }];
  }

  let pjs: any = null;
  const needPjs = async () => {
    if (!window.pdfjsLib) throw new Error('PDF.js is not loaded (check internet connection).');
    if (!pjs) pjs = await window.pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
    return pjs;
  };

  let work = src;
  if (opt.compress === 'all') {
    await needPjs();
    let done = 0;
    work = await rasterDoc(pjs, [...Array(total).keys()], opt.quality, opt.longSidePx, () => {
      if (++done % 10 === 0) onStatus(`Compressing page ${done}/${total}`);
    });
    await yieldUi();
  }

  const plan: { start: number; count: number; bytes: Uint8Array; note: string }[] = [];
  let start = 0;
  while (start < total) {
    let n = Math.min(opt.maxPages, total - start);
    let bytes: Uint8Array = new Uint8Array();
    let note = '';
    for (let tries = 0; tries < 12; tries++) {
      const d = await PDFDocument.create();
      const copied = await d.copyPages(work, Array.from({ length: n }, (_, k) => start + k));
      copied.forEach(p => d.addPage(p));
      bytes = await save(d);
      if (bytes.length <= opt.maxBytes || n === 1) break;
      n = Math.max(1, Math.min(n - 1, Math.floor((n * opt.maxBytes) / bytes.length * 0.97)));
      await yieldUi();
    }
    if (bytes.length > opt.maxBytes && n === 1 && opt.compress !== 'off') {
      await needPjs();
      for (let q = opt.quality, px = opt.longSidePx; q >= 40; q -= 10, px = Math.round(px * 0.85)) {
        bytes = await save(await rasterDoc(pjs, [start], q, px));
        if (bytes.length <= opt.maxBytes) { note = `page ${start + 1} compressed (q${q})`; break; }
      }
    }
    if (bytes.length > opt.maxBytes) note = (note ? note + '; ' : '') + 'SINGLE PAGE STILL ABOVE LIMIT';
    plan.push({ start, count: n, bytes, note });
    start += n;
    onStatus(`Split ${start}/${total} pages`);
  }
  pjs?.destroy?.();

  const w = Math.max(2, String(plan.length).length);
  const pw = Math.max(3, String(total).length);
  return plan.map((p, k) => ({
    name: `${base}_part${pad(k + 1, w)}_of_${pad(plan.length, w)}_p${pad(p.start + 1, pw)}-${pad(p.start + p.count, pw)}.pdf`,
    bytes: p.bytes,
    pages: p.count,
    note: p.note,
    source: file.name,
  }));
}

// Minimal store-only ZIP writer (no extra dependency).
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (d: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = crcTable[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function makeZip(entries: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const chunks: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint32(14, crc, true); h.setUint32(18, e.data.length, true); h.setUint32(22, e.data.length, true);
    h.setUint16(26, name.length, true);
    chunks.push(h.buffer as ArrayBuffer, name, e.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, e.data.length, true); c.setUint32(24, e.data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    const rec = new Uint8Array(46 + name.length); rec.set(new Uint8Array(c.buffer), 0); rec.set(name, 46);
    central.push(rec);
    offset += 30 + name.length + e.data.length;
  }
  const cdSize = central.reduce((a, r) => a + r.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central as BlobPart[], end.buffer as ArrayBuffer], { type: 'application/zip' });
}
