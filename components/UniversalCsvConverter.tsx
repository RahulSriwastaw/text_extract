import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, Play, Search, Upload, XCircle } from 'lucide-react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import {
  TARGET_FIELDS, EXTRA_FIELDS, MAX_FILE_BYTES, cleanHtml, csvString, defaultSettings, editRow, escapeHtml,
  exportAudit, exportReview, exportTarget, exportValidation, parseSettings, revalidate, summary,
  type ConvertedRow, type Settings, type SourceFile, type TargetField,
} from '../services/universalCsv';
import { deleteJob, listJobs, saveJob, type ConversionJob } from '../services/universalCsvHistory';

const inputClass = 'w-full rounded-lg border border-white/15 bg-[#0B0D13] px-3 py-2 text-sm text-slate-100 focus:border-orange-400 outline-none';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed';
const panelClass = 'rounded-2xl border border-white/10 bg-[#141720] p-5 space-y-4';
const fieldLabels: Record<string, string> = { passage_hi: 'Hindi passage', passage_en: 'English passage', directions_hi: 'Hindi directions', directions_en: 'English directions', passage_id: 'Shared passage ID', option_e: 'Single Option_E' };
function download(filename: string, content: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function StudentContent({ value, hosts }: { value: string; hosts: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    const element = ref.current;
    if (!element) return;
    element.innerHTML = /<\/?[a-z][^>]*>/i.test(value) ? cleanHtml(value, hosts) : escapeHtml(value);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    for (const node of texts) {
      const text = node.textContent || '';
      const regex = /\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|(?<![\\$])\$(?!\$)([^\n$]+?)(?<!\\)\$(?!\$)/g;
      let offset = 0, matched = false;
      const fragment = document.createDocumentFragment();
      for (const match of text.matchAll(regex)) {
        const expression = match[1] ?? match[2] ?? match[3] ?? match[4];
        if (/^\d[\d,.]*\s+(?:and|or|to)\s*$/i.test(expression)) continue;
        matched = true;
        fragment.append(text.slice(offset, match.index));
        const span = document.createElement('span');
        try { katex.render(expression, span, { throwOnError: true, trust: false, strict: 'ignore', displayMode: !!(match[1] || match[2]), maxExpand: 1000 }); }
        catch { span.textContent = match[0]; }
        fragment.append(span); offset = match.index! + match[0].length;
      }
      if (matched) { fragment.append(text.slice(offset)); node.replaceWith(fragment); }
    }
    const images = element.querySelectorAll('img');
    images.forEach(img => { img.referrerPolicy = 'no-referrer'; img.onerror = () => setFailed(true); });
    return () => { images.forEach(img => { img.onerror = null; }); };
  }, [value, hosts]);
  return <><div ref={ref} className="whitespace-pre-wrap break-words leading-7 [&_img]:max-w-full [&_img]:max-h-80 [&_img]:object-contain [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-6" />{failed && <p role="alert" className="text-red-700 text-sm">An image could not load. Its original URL remains in the source audit. Check it before accepting review.</p>}</>;
}

export default function UniversalCsvConverter() {
  const [source, setSource] = useState<SourceFile | null>(null);
  const [filename, setFilename] = useState('');
  const sourceText = useRef('');
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [rows, setRows] = useState<ConvertedRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(2);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [mode, setMode] = useState<'student' | 'source' | 'converted'>('student');
  const [lang, setLang] = useState<'hi' | 'en'>('en');
  const [editField, setEditField] = useState<TargetField>('question_en');
  const [draft, setDraft] = useState('');
  const [resolution, setResolution] = useState('');
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [jobId, setJobId] = useState('');
  const [jobDate, setJobDate] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [compatibilityConfirmed, setCompatibilityConfirmed] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const historyQueue = useRef(Promise.resolve());
  const presetInput = useRef<HTMLInputElement>(null);
  const selectedRow = rows.find(r => r.source.row === selected);
  const totals = useMemo(() => summary(rows), [rows]);
  const filtered = useMemo(() => rows.filter(r => (filter === 'all' || r.status === filter) && `${r.source.row} ${r.target.question_en} ${r.target.question_hi} ${r.target.source_question_reference}`.toLowerCase().includes(search.toLowerCase())), [rows, filter, search]);
  useEffect(() => { listJobs().then(setJobs).catch(() => setNotice('Browser history is unavailable. Download the audit and mapping files to keep your work.')); return () => workerRef.current?.terminate(); }, []);
  useEffect(() => { setDraft(selectedRow?.target[editField] || ''); setResolution(selectedRow?.resolution || ''); }, [selectedRow, editField]);
  const runWorker = (text: string, config?: Settings) => new Promise<any>((resolve, reject) => {
    const worker = new Worker(new URL('../services/universalCsv.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = event => {
      if (event.data.type === 'progress') { setProgress(`Converting ${event.data.value} / ${event.data.total} rows…`); return; }
      worker.terminate(); workerRef.current = null;
      if (event.data.type === 'error') reject(new Error(event.data.message)); else resolve(event.data);
    };
    worker.onerror = event => { worker.terminate(); workerRef.current = null; reject(new Error(event.message || 'Conversion worker failed.')); };
    worker.postMessage({ text, settings: config });
  });
  async function upload(file?: File) {
    if (!file) return;
    setError(''); setNotice('');
    if (file.size > MAX_FILE_BYTES) { setError('Maximum CSV size is 10 MB.'); return; }
    setBusy(true); setProgress('Reading and detecting source CSV…');
    try {
      const bytes = await file.arrayBuffer();
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const result = await runWorker(text);
      sourceText.current = text; setSource(result.source); setFilename(file.name);
      setSettings(defaultSettings(result.source.headers)); setRows([]); setJobId(''); setSelected(2); setCompatibilityConfirmed(false);
    } catch (e) { setError(e instanceof TypeError ? 'The file is not valid UTF-8. Save a UTF-8 CSV and retry.' : String((e as Error).message)); }
    finally { setBusy(false); }
  }
  function configure(next: Settings) { setSettings(next); setRows([]); setJobId(''); setCompatibilityConfirmed(false); setNotice('Settings changed. Convert again to apply the new configuration.'); }
  async function persist(updated: ConvertedRow[], id = jobId, date = jobDate, exportedRows?: number) {
    if (!source || !id) return;
    try {
      const job = { id, filename, createdAt: date, exportedRows: exportedRows ?? jobs.find(j => j.id === id)?.exportedRows ?? 0, source, settings, rows: updated };
      historyQueue.current = historyQueue.current.catch(() => {}).then(() => saveJob(job));
      await historyQueue.current;
      setJobs(await listJobs());
    } catch { setNotice('History could not be saved. The current results remain available; download the reports before leaving.'); }
  }
  async function convert() {
    if (!source) return;
    setBusy(true); setError(''); setNotice(''); setProgress('Converting and validating…');
    try {
      const result = await runWorker(sourceText.current, settings);
      const id = crypto.randomUUID(), date = new Date().toISOString();
      setRows(result.rows); setSelected(result.rows[0]?.source.row || 2); setJobId(id); setJobDate(date); setCompatibilityConfirmed(false);
      await persist(result.rows, id, date);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function updateRows(next: ConvertedRow[]) { setRows(next); setCompatibilityConfirmed(false); void persist(next); }
  function review(action: 'accept' | 'exclude' | 'restore', bulk = false) {
    const ids = new Set(bulk ? filtered.map(r => r.source.row) : [selected]);
    updateRows(revalidate(rows.map(r => !ids.has(r.source.row) ? r : { ...r,
      reviewAccepted: action === 'accept' ? !r.issues.some(i => i.severity === 'error') : false,
      excluded: action === 'exclude' ? true : action === 'restore' ? false : r.excluded,
    }), settings));
  }
  async function loadPreset(file?: File) {
    if (!file || !source) return;
    try { if (file.size > 100000) throw new Error('Preset exceeds 100 KB.'); configure(parseSettings(await file.text(), source.headers)); setNotice('Mapping preset loaded. Review it and convert.'); }
    catch (e) { setError((e as Error).message); }
  }
  const booleanSetting = (field: keyof Settings, label: string) => <label key={field} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!settings[field]} onChange={e => configure({ ...settings, [field]: e.target.checked })} />{label}</label>;
  const selectSetting = (field: keyof Settings, label: string, options: [string, string][]) => <label className="block text-sm space-y-1"><span className="text-slate-400">{label}</span><select className={inputClass} value={settings[field] as string} onChange={e => configure({ ...settings, [field]: e.target.value })}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
  return <main className="min-h-screen bg-[#0B0D13] text-slate-100 px-4 py-8 sm:px-8">
    <div className="mx-auto max-w-7xl space-y-6">
      <a href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={16} />Back to home</a>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-orange-400 text-xs font-bold uppercase tracking-widest mb-2">VedaTool · CSV tools</p><h1 className="text-3xl sm:text-4xl font-bold">Universal CSV Converter</h1><p className="mt-3 text-slate-400 max-w-2xl">Turn bilingual question banks into the fixed 34-field template. Map, validate, review, and export with a complete source audit.</p></div>
        <span className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-emerald-500/25 text-emerald-300 text-xs"><FileSpreadsheet size={16} />ALP · GK · Custom mappings</span>
      </header>
      {error && <div role="alert" className="p-4 rounded-xl border border-red-400/30 bg-red-500/10 text-red-200">{error}</div>}
      {notice && <div role="status" className="p-4 rounded-xl border border-blue-400/30 bg-blue-500/10 text-blue-200">{notice}</div>}
      {busy && <div role="status" className="flex gap-2 text-orange-300"><Loader2 className="animate-spin" size={20} />{progress}</div>}
      <fieldset disabled={busy} className="space-y-6 disabled:opacity-60">
        <section className={panelClass}>
          <h2 className="font-bold text-lg">1. Upload & detect</h2>
          <div className="grid md:grid-cols-2 gap-5">
            <label className="flex flex-col items-center justify-center gap-3 cursor-pointer rounded-xl border border-dashed border-orange-400/40 bg-orange-500/5 p-6"><Upload className="text-orange-400" /><span className="font-semibold">Choose a source CSV</span><span className="text-xs text-slate-400">UTF-8 · Up to 10 MB and 5,000 records · Processing stays in this browser</span><input aria-label="Upload source CSV" type="file" accept=".csv,text/csv" className="max-w-full text-sm" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
            <div className="space-y-3"><label className="block text-sm text-slate-400">Target template<select className={`${inputClass} mt-1`} aria-label="Target template"><option>VedaTool — fixed 34-field template (v1)</option></select></label><p className="text-sm">{source ? <><strong>{filename}</strong><br /><span className="text-slate-400">Detected {source.format} · {source.headers.length} columns · {source.rows.length} records</span></> : <span className="text-slate-400">Upload an ALP, GK, target-template, or custom CSV to begin.</span>}</p><p className="text-xs text-slate-500">Detection uses column names, not a fixed column count. No AI or automatic translation is used.</p></div>
          </div>
        </section>
        {source && <>
          <details className={panelClass} open={!rows.length}>
            <summary className="font-bold text-lg cursor-pointer">2. Field mapping & reusable presets</summary>
            <p className="text-sm text-slate-400">Check proposed mappings. Unmapped source values remain in the audit. Changing settings clears the current preview; saved jobs retain prior edits.</p>
            <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => configure(defaultSettings(source.headers))}>Reset auto mapping</button><button className={buttonClass} onClick={() => presetInput.current?.click()}>Load mapping JSON</button><button className={buttonClass} onClick={() => download('vedatool-mapping-v1.json', JSON.stringify(settings, null, 2), 'application/json')}>Save mapping JSON</button><input ref={presetInput} type="file" accept=".json" className="hidden" onChange={e => { void loadPreset(e.target.files?.[0]); e.target.value = ''; }} /></div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto pr-2">{[...TARGET_FIELDS, ...EXTRA_FIELDS].map((field, i) => <label key={field} className="text-xs text-slate-400 space-y-1"><span>{i < 34 ? `${i + 1}. ` : 'Context · '}{fieldLabels[field] || field}</span><select aria-label={`Map ${field}`} className={inputClass} value={settings.mapping[field] || ''} onChange={e => configure({ ...settings, mapping: { ...settings.mapping, [field]: e.target.value } })}><option value="">Not mapped</option>{source.headers.map(h => <option key={h} value={h}>{h}</option>)}</select></label>)}</div>
          </details>
          <details className={panelClass}>
            <summary className="font-bold text-lg cursor-pointer">3. Conversion & target compatibility settings</summary>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="space-y-3"><h3 className="text-orange-300 font-semibold">Passages & answers</h3>{booleanSetting('mergePassage', 'Merge passages')}{booleanSetting('mergeDirections', 'Merge directions')}{booleanSetting('deduplicatePassage', 'Skip already embedded passages')}{booleanSetting('neutralOptionE', 'Confirm Option_E is language-neutral')}{selectSetting('answerFormat', 'Answer output', [['preserve', 'Preserve source'], ['letters', 'A–E'], ['numbers', '1–5']])}<label className="block text-sm text-slate-400">Explicit generic directions to omit (one exact entry per line)<textarea className={inputClass} value={settings.omitDirections.join('\n')} onChange={e => configure({ ...settings, omitDirections: e.target.value ? e.target.value.split('\n') : [] })} /></label><p className="text-xs text-slate-500">Shared context is inherited only through a mapped passage ID. Adjacent rows never imply a group.</p></div>
              <div className="space-y-3"><h3 className="text-orange-300 font-semibold">Formatting & images</h3>{selectSetting('formatting', 'Formatting mode', [['preserve', 'Preserve original (sanitize unsafe HTML)'], ['normalize', 'Normalize supported HTML'], ['plain', 'Convert to plain text']])}{selectSetting('images', 'Attach source images to', [['both', 'Both languages'], ['hi', 'Hindi only'], ['en', 'English only'], ['audit', 'Audit only (blocks affected rows)']])}{booleanSetting('supportsImages', 'Target importer supports images')}{booleanSetting('supportsTables', 'Target importer supports tables')}<label className="block text-sm text-slate-400">Approved image hostnames (comma-separated; blank allows HTTPS)<input className={inputClass} value={settings.approvedImageHosts.join(',')} onChange={e => configure({ ...settings, approvedImageHosts: e.target.value ? e.target.value.split(',').map(s => s.trim()) : [] })} /></label><p className="text-xs text-slate-500">HTTPS syntax and host policy are checked locally. Image reachability needs preview review; no server fetch is performed.</p></div>
              <div className="space-y-3"><h3 className="text-orange-300 font-semibold">Validation & export</h3>{selectSetting('missingSolution', 'Missing solution', [['warning', 'Require review'], ['error', 'Block export']])}{selectSetting('duplicates', 'Duplicate detection', [['exact', 'Exact content'], ['similar', 'Exact + text similarity'], ['off', 'Disabled']])}{selectSetting('formulaPolicy', 'Spreadsheet formula protection', [['block', 'Block formula-like cells; preserve values'], ['prefix', 'Prefix formula-like cells with apostrophe']])}{booleanSetting('bom', 'UTF-8 BOM for Excel')}<p className="text-xs text-slate-500">Text similarity is a review aid, not semantic or educational correctness verification. Quality columns stay blank until accepted importer values are configured.</p></div>
            </div>
            <details className="border-t border-white/10 pt-4"><summary className="cursor-pointer text-sm font-semibold">Metadata defaults & accepted quality values</summary><div className="grid sm:grid-cols-3 gap-3 mt-4">{(['subject', 'difficulty_level'] as const).map(f => <label className="text-xs text-slate-400" key={f}>Default {f}<input className={inputClass} value={settings.defaults[f]} onChange={e => configure({ ...settings, defaults: { ...settings.defaults, [f]: e.target.value } })} /></label>)}{(['PASS', 'WARNING', 'FAIL', 'NOT_CHECKED'] as const).map(state => <label className="text-xs text-slate-400" key={state}>Importer value for {state}<input className={inputClass} value={settings.qualityValues[state]} onChange={e => configure({ ...settings, qualityValues: { ...settings.qualityValues, [state]: e.target.value } })} /></label>)}{(['reviewValue', 'reviewedValue'] as const).map(f => <label className="text-xs text-slate-400" key={f}>{f === 'reviewValue' ? 'Importer needs-review value' : 'Importer reviewed value'}<input className={inputClass} value={settings[f]} onChange={e => configure({ ...settings, [f]: e.target.value })} /></label>)}<label className="text-xs text-slate-400">Required metadata (Ctrl/click to select)<select multiple className={inputClass} value={settings.requiredMetadata} onChange={e => configure({ ...settings, requiredMetadata: [...e.target.selectedOptions].map(o => o.value) })}>{['set_name', 'subject', 'difficulty_level', 'test_date', 'test_time', 'source_pdf', 'source_pages'].map(f => <option key={f}>{f}</option>)}</select></label></div></details>
          </details>
          <button className="inline-flex gap-2 items-center rounded-xl px-6 py-3 bg-orange-500 hover:bg-orange-400 text-white font-bold disabled:opacity-50" disabled={busy} onClick={() => void convert()}><Play size={18} />Convert & validate {source.rows.length} records</button>
        </>}
      </fieldset>
      {!!rows.length && <>
        <section className={panelClass}><h2 className="font-bold text-lg">4. Preview & validation</h2><p className="text-xs text-slate-400">Structural checks only. Review acknowledgment cannot override blocking errors. Image counts include unverified references.</p><div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">{Object.entries(totals).map(([name, count]) => <div key={name} className="rounded-lg bg-black/25 p-3"><div className={`text-2xl font-bold ${name === 'blocked' ? 'text-red-300' : name === 'ready' ? 'text-emerald-300' : 'text-white'}`}>{count}</div><div className="text-xs text-slate-400 capitalize">{name.replace(/([A-Z])/g, ' $1')}</div></div>)}</div></section>
        <section className={panelClass}>
          <h2 className="font-bold text-lg">Question preview & corrections</h2>
          <div className="flex flex-wrap gap-2"><label className="flex items-center gap-2 flex-1 min-w-48"><Search size={16} /><input aria-label="Search questions" className={inputClass} placeholder="Search questions or source references" value={search} onChange={e => setSearch(e.target.value)} /></label><select aria-label="Filter validation status" className={`${inputClass} !w-auto`} value={filter} onChange={e => setFilter(e.target.value)}>{['all', 'ready', 'review', 'blocked', 'excluded'].map(s => <option key={s}>{s}</option>)}</select><button className={buttonClass} onClick={() => review('accept', true)}>Accept warnings in filtered rows ({filtered.length})</button><button className={buttonClass} onClick={() => review('exclude', true)}>Exclude filtered</button></div>
          <div className="grid lg:grid-cols-[260px_1fr] gap-5">
            <div className="max-h-[700px] overflow-auto border border-white/10 rounded-xl">{filtered.length === 0 && <p className="p-4 text-sm text-slate-400">No matching rows.</p>}{filtered.map(r => <button key={r.source.row} onClick={() => setSelected(r.source.row)} className={`w-full text-left p-3 border-b border-white/5 ${selected === r.source.row ? 'bg-orange-500/15' : 'hover:bg-white/5'}`}><span className="text-xs text-slate-400">Source row {r.source.row} · <span className={r.status === 'blocked' ? 'text-red-300' : r.status === 'ready' ? 'text-emerald-300' : 'text-amber-300'}>{r.status}</span></span><p className="text-sm truncate mt-1">{r.target.source_question_reference}</p><p className="text-xs text-slate-500">{r.issues.length} issue(s)</p></button>)}</div>
            {selectedRow && <div className="min-w-0 space-y-4">
              <div className="flex flex-wrap gap-2">{(['student', 'source', 'converted'] as const).map(m => <button key={m} className={`${buttonClass} ${mode === m ? '!border-orange-400 !text-orange-300' : ''}`} onClick={() => setMode(m)}>{m === 'student' ? 'Student view' : m === 'source' ? 'Original source' : 'All 34 fields'}</button>)}<select aria-label="Preview language" className={`${inputClass} !w-auto ml-auto`} value={lang} onChange={e => setLang(e.target.value as 'hi' | 'en')}><option value="en">English</option><option value="hi">हिन्दी</option></select></div>
              <p className="text-xs text-slate-400">Source row {selectedRow.source.row} · {selectedRow.status} · Answer: {selectedRow.target.answer || 'Missing'}</p>
              {mode === 'student' ? <div className="bg-slate-50 text-slate-900 rounded-xl p-5 space-y-4 max-h-[600px] overflow-auto"><StudentContent value={selectedRow.target[`question_${lang}`]} hosts={settings.approvedImageHosts} />{[1, 2, 3, 4, 5].map(n => selectedRow.target[`option${n}_${lang}`] && <div key={n} className="flex gap-3 p-3 border border-slate-200 rounded-lg"><span className="font-bold text-slate-500">{'ABCDE'[n - 1]}.</span><StudentContent value={selectedRow.target[`option${n}_${lang}`]} hosts={settings.approvedImageHosts} /></div>)}<div className="border-t border-slate-200 pt-4"><h3 className="font-bold mb-2">Solution</h3><StudentContent value={selectedRow.target[`solution_${lang}`] || 'No solution supplied.'} hosts={settings.approvedImageHosts} /></div></div> : <div className="max-h-[600px] overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-400"><th className="p-2">Field</th><th className="p-2">{mode === 'source' ? 'Original value' : 'Converted value'}</th></tr></thead><tbody>{(mode === 'source' ? source!.headers : TARGET_FIELDS).map(f => <tr key={f} className="border-t border-white/10 align-top"><th className="p-2 text-left text-xs font-normal text-slate-400">{f}</th><td className="p-2 whitespace-pre-wrap break-all">{mode === 'source' ? selectedRow.source.values[f] : selectedRow.target[f]}</td></tr>)}</tbody></table>{mode === 'source' && selectedRow.source.error && <pre className="whitespace-pre-wrap text-red-300">{JSON.stringify(selectedRow.source.cells, null, 2)}</pre>}</div>}
              <div className="space-y-2">{selectedRow.issues.map((issue, i) => <p key={`${issue.code}-${i}`} className={`text-xs flex gap-2 ${issue.severity === 'error' ? 'text-red-300' : 'text-amber-200'}`}><XCircle className="shrink-0" size={14} />{issue.message}</p>)}{selectedRow.duplicates.length > 0 && <div className="flex gap-2 flex-wrap">{selectedRow.duplicates.map(n => <button key={n} className={buttonClass} onClick={() => setSelected(n)}>Compare source row {n}</button>)}</div>}</div>
              <details className="border border-white/10 rounded-xl p-4"><summary className="font-semibold cursor-pointer text-sm">Edit target fields & revalidate</summary><div className="mt-3 space-y-3"><select aria-label="Field to edit" className={inputClass} value={editField} onChange={e => setEditField(e.target.value as TargetField)}>{TARGET_FIELDS.filter(f => !['latex_check', 'html_check', 'answer_check', 'solution_check', 'manually_review'].includes(f)).map(f => <option key={f}>{f}</option>)}</select><textarea aria-label="Target field value" className={`${inputClass} min-h-32 font-mono`} value={draft} onChange={e => setDraft(e.target.value)} /><button className={buttonClass} onClick={() => updateRows(editRow(rows, selected, editField, draft, settings))}>Save field & revalidate</button><p className="text-xs text-slate-400">Original values and every edit remain in the audit. Source parse, grouping, and image-policy errors require correcting the source/settings and reconverting.</p></div></details>
              {selectedRow.baseIssues.some(i => i.code === 'sixth_option') && <div className="border border-red-400/20 rounded-xl p-4 space-y-2"><p className="text-sm font-semibold">Resolve unsupported sixth option</p><p className="text-xs text-slate-400">Review all original options in Source view, edit the five target options and answer, then explain your decision. No options are renumbered automatically.</p><textarea aria-label="Sixth option resolution" className={inputClass} placeholder="Record the exact correction or approved disposition of option 6…" value={resolution} onChange={e => setResolution(e.target.value)} /><button disabled={resolution.trim().length < 12} className={buttonClass} onClick={() => updateRows(revalidate(rows.map(r => r.source.row === selected ? { ...r, resolution: resolution.trim(), reviewAccepted: false } : r), settings))}>Record explicit resolution & revalidate</button></div>}
              <div className="flex flex-wrap gap-2"><button disabled={selectedRow.status === 'blocked' || selectedRow.excluded} className={buttonClass} onClick={() => review('accept')}><CheckCircle2 size={16} />Accept reviewed warnings</button><button className={buttonClass} onClick={() => review(selectedRow.excluded ? 'restore' : 'exclude')}>{selectedRow.excluded ? 'Restore row' : 'Exclude row'}</button></div>
            </div>}
          </div>
        </section>
        <section className={panelClass}>
          <h2 className="font-bold text-lg">5. Download CSV & reports</h2><p className="text-sm text-slate-400">{totals.ready} ready · {totals.review} need review · {totals.blocked} blocked · {totals.excluded} excluded. Only ready rows enter the target CSV. Every record is included in the audit and validation report.</p>
          <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={compatibilityConfirmed} onChange={e => setCompatibilityConfirmed(e.target.checked)} /><span>I checked the destination importer’s image, table, answer, and quality-field requirements against this profile. A real destination import is still required for final acceptance.</span></label>
          <div className="flex flex-wrap gap-2"><button className={`${buttonClass} !bg-orange-500 !text-white`} disabled={!totals.ready || !compatibilityConfirmed || busy} onClick={() => { const csv = exportTarget(rows, settings); download('vedatool-target.csv', csv); void persist(rows, jobId, jobDate, totals.ready); }}><Download size={16} />Download target CSV ({totals.ready})</button><button className={buttonClass} onClick={() => download('vedatool-validation.csv', exportValidation(rows))}>Validation report</button><button className={buttonClass} onClick={() => download('vedatool-source-audit.csv', exportAudit(source!, rows, settings))}>Source audit</button><button className={buttonClass} onClick={() => download('vedatool-review.csv', exportReview(rows))}>Rejected / review CSV</button><button className={buttonClass} onClick={() => download('vedatool-mapping-v1.json', JSON.stringify(settings, null, 2), 'application/json')}>Mapping JSON</button></div>
        </section>
      </>}
      <details className={panelClass}><summary className="font-bold text-lg cursor-pointer">Saved conversions (local)</summary><p className="text-xs text-slate-400">Saved locally in this browser. Reopen a job to review or download reports. Delete jobs here to remove local source data. History is not synchronized to the server.</p><input aria-label="Search history" className={inputClass} placeholder="Search filename, format, or job ID" value={historySearch} onChange={e => setHistorySearch(e.target.value)} />{jobs.length === 0 && <p className="text-sm text-slate-500">Completed conversions will appear here.</p>}<div className="space-y-2 max-h-96 overflow-auto">{jobs.filter(j => `${j.filename} ${j.id} ${j.source.format}`.toLowerCase().includes(historySearch.toLowerCase())).map(job => <div key={job.id} className="rounded-xl bg-black/20 p-3 flex flex-wrap justify-between gap-3"><div><p className="text-sm font-semibold">{job.filename} <span className="text-slate-500">· {job.source.format}</span></p><p className="text-xs text-slate-400">{new Date(job.createdAt).toLocaleString()} · {job.rows.length} input · {job.exportedRows} last exported · {job.rows.filter(r => r.status !== 'ready').length} held</p><p className="text-[10px] text-slate-600">{job.id}</p></div><div className="flex gap-2"><button disabled={busy} className={buttonClass} onClick={() => { setSource(job.source); setFilename(job.filename); setSettings(job.settings); setRows(revalidate(job.rows, job.settings)); setJobId(job.id); setJobDate(job.createdAt); setSelected(job.rows[0]?.source.row || 2); setCompatibilityConfirmed(false); setError(''); setNotice('Saved job reopened. Edits and source audit restored.'); sourceText.current = csvString([job.source.headers, ...job.source.rows.map(r => r.cells)]); }}>Reopen</button><button disabled={busy} className={buttonClass} onClick={async () => { try { await historyQueue.current.catch(() => {}); await deleteJob(job.id); setJobs(await listJobs()); if (jobId === job.id) setJobId(''); } catch { setError('Could not delete the saved job.'); } }}>Delete</button></div></div>)}</div></details>
    </div>
  </main>;
}
