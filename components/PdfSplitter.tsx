import React, { useRef, useState } from 'react';
import { ArrowLeft, Download, Loader2, Scissors, Upload } from 'lucide-react';
import { defaultSplitOptions, makeZip, splitPdf, type CompressMode, type SplitPart } from '../services/pdfSplitService';

const inputClass = 'input h-auto min-h-[34px] py-1.5';
const panelClass = 'card p-5 space-y-4';
const mb = (b: number) => `${(b / 1048576).toFixed(2)} MB`;

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function PdfSplitter() {
  const [files, setFiles] = useState<File[]>([]);
  const [maxMb, setMaxMb] = useState(9);
  const [maxPages, setMaxPages] = useState(250);
  const [compress, setCompress] = useState<CompressMode>('auto');
  const [quality, setQuality] = useState(70);
  const [longSide, setLongSide] = useState(1600);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [parts, setParts] = useState<SplitPart[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | File[]) =>
    setFiles(f => [...f, ...Array.from(list).filter(x => /\.pdf$/i.test(x.name))]);

  const run = async () => {
    setBusy(true); setParts([]); setErrors([]);
    const opt = { ...defaultSplitOptions(), maxBytes: Math.floor(maxMb * 1048576), maxPages, compress, quality, longSidePx: longSide };
    const out: SplitPart[] = [];
    const errs: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        const p = await splitPdf(f, opt, m => setStatus(`(${i + 1}/${files.length}) ${f.name}: ${m}`));
        out.push(...p);
      } catch (e: any) { errs.push(`${f.name}: ${e?.message || e}`); }
    }
    setParts(out); setErrors(errs); setFiles([]); setStatus(''); setBusy(false);
  };

  const downloadZip = () => {
    const report = 'source,output,pages,size_bytes,note\n' +
      parts.map(p => `"${p.source}","${p.name}",${p.pages},${p.bytes.length},"${p.note}"`).join('\n');
    const enc = new TextEncoder();
    save(makeZip([...parts.map(p => ({ name: p.name, data: p.bytes })), { name: '_REPORT.csv', data: enc.encode(report) }]),
      `pdf_parts_${new Date().toISOString().slice(0, 10)}.zip`);
  };

  return <main className="min-h-screen bg-canvas text-ink px-4 py-8 sm:px-8">
    <div className="mx-auto max-w-4xl space-y-6">
      <a href="/" className="btn btn-ghost btn-sm -ml-2"><ArrowLeft size={16} />Back to home</a>
      <header>
        <p className="page-eyebrow mb-2">VedaTool · PDF tools</p>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">PDF splitter &amp; compressor</h1>
        <p className="mt-3 text-ink-3 max-w-2xl">Drop many PDFs at once. Anything over your size or page limit is split on page boundaries into as many parts as needed. Files never leave this browser.</p>
      </header>

      <section className={panelClass}>
        <div
          className="border-2 border-dashed border-accent/40 rounded-xl p-8 text-center cursor-pointer"
          onClick={() => input.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        >
          <Upload className="mx-auto mb-2" />
          {files.length ? `${files.length} PDF selected (${mb(files.reduce((a, f) => a + f.size, 0))})` : 'Drag and drop PDFs here, or click to choose'}
        </div>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={e => e.target.files && addFiles(e.target.files)} />
      </section>

      <section className={panelClass}>
        <h2 className="font-bold text-lg">Limits</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block text-sm space-y-1"><span className="text-ink-3">Max size per part (MB)</span>
            <input className={inputClass} type="number" min={0.5} step={0.5} value={maxMb} onChange={e => setMaxMb(parseFloat(e.target.value) || 9)} /></label>
          <label className="block text-sm space-y-1"><span className="text-ink-3">Max pages per part</span>
            <input className={inputClass} type="number" min={1} value={maxPages} onChange={e => setMaxPages(parseInt(e.target.value) || 250)} /></label>
          <label className="block text-sm space-y-1 sm:col-span-2"><span className="text-ink-3">Compression</span>
            <select className={inputClass} value={compress} onChange={e => setCompress(e.target.value as CompressMode)}>
              <option value="auto">Auto: split first, compress only a page that alone exceeds the limit</option>
              <option value="off">Off: split only</option>
              <option value="all">Compress all pages (scans can even get bigger)</option>
            </select></label>
          <label className="block text-sm space-y-1"><span className="text-ink-3">Compress quality (JPEG 40-95)</span>
            <input className={inputClass} type="number" min={40} max={95} value={quality} onChange={e => setQuality(parseInt(e.target.value) || 70)} /></label>
          <label className="block text-sm space-y-1"><span className="text-ink-3">Compress resolution (long side, px)</span>
            <input className={inputClass} type="number" min={800} step={100} value={longSide} onChange={e => setLongSide(parseInt(e.target.value) || 1600)} /></label>
        </div>
        <p className="text-sm text-ink-3">Compressing turns a page into an image: colours (including green ticks) stay, the text layer is lost.</p>
        <button className="btn btn-primary" disabled={busy || !files.length} onClick={run}><Scissors size={16} />Split &amp; compress</button>
        {busy && <div role="status" className="flex items-center gap-2 text-sm text-accent-light"><Loader2 className="animate-spin" size={18} />{status}</div>}
      </section>

      {errors.map(e => <div key={e} role="alert" className="callout callout-danger">{e}</div>)}

      {parts.length > 0 && <section className={panelClass}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-bold text-lg">Result</h2>
          <button className="btn btn-secondary" onClick={downloadZip}><Download size={16} />Download all as ZIP</button>
          <span className="text-sm text-ink-3">{parts.length} files, {mb(parts.reduce((a, p) => a + p.bytes.length, 0))}</span>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-ink-3"><th className="py-1 pr-2">File</th><th className="pr-2">Pages</th><th className="pr-2">Size</th><th>Note</th><th /></tr></thead>
          <tbody>{parts.map(p => <tr key={p.name} className="border-t border-white/10">
            <td className="py-1 pr-2 break-all">{p.name}</td><td className="pr-2">{p.pages}</td><td className="pr-2">{mb(p.bytes.length)}</td>
            <td className={/STILL ABOVE/.test(p.note) ? 'text-red-400' : 'text-ink-3'}>{p.note}</td>
            <td><button className="btn btn-ghost btn-sm" onClick={() => save(new Blob([p.bytes], { type: 'application/pdf' }), p.name)}>Download</button></td>
          </tr>)}</tbody>
        </table></div>
      </section>}
    </div>
  </main>;
}
