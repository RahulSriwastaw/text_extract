import React, { useEffect, useRef, useState } from 'react';
import { CropDialog } from './ConverterFigure';
import { renderFigureSvg } from '../services/converterFigures';
import { extractWithStudyAiBridge, type AiProvider } from '../services/studyAiBridgeService';
import { extractLayoutFromImage } from '../services/geminiService';
import type { DirectModel } from '../services/claudeModels';
import { SVG_FIGURE_INSTRUCTION } from '../services/figurePrompt';

export function QuestionFigureActions({ image, engine, provider, model, hasPassageGroup, attach }: {
  image?: string; engine: string; provider: AiProvider; model: DirectModel; hasPassageGroup?: boolean; attach: (image: string, svg?: string, shared?: boolean) => Promise<void>;
}) {
  const [mode, setMode] = useState<'crop' | 'svg'>();
  const [original, setOriginal] = useState('');
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState('');
  const [sourceSvg, setSourceSvg] = useState('');
  const [shared, setShared] = useState(false);
  const [uploading, setUploading] = useState(false);
  async function save(image: string, svg?: string) {
    setUploading(true);
    try { await attach(image, svg, hasPassageGroup && shared); clear(); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Drive upload failed. Retry.'); }
    finally { setUploading(false); }
  }
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  function clear() {
    request.current?.abort();
    setMode(undefined);
    setOriginal('');
    setPreview('');
    setSourceSvg('');
    setShared(false);
    setStatus('');
  }
  async function apply(region: string) {
    const recreate = mode === 'svg';
    clear();
    if (!recreate) { setOriginal(region); return; }
    const controller = new AbortController();
    request.current = controller;
    setOriginal(region);
    setStatus('Creating SVG…');
    try {
      let svg: string | undefined;
      if (engine === 'bridge') {
        const result = await extractWithStudyAiBridge({ base64Image: region, provider, responseFormat: 'text',
          prompt: SVG_FIGURE_INSTRUCTION + ' Recreate this selected figure. Return only the SVG markup or NONE.',
          fileName: 'question-figure.png', mimeType: region.split(';')[0].slice(5), signal: controller.signal });
        svg = result.rawText.match(/<svg\b[\s\S]*?<\/svg>/i)?.[0];
      } else {
        const elements = await extractLayoutFromImage(region, undefined, true, false, false, false, false, false, false,
          undefined, 0, controller.signal, 'svg', model);
        svg = elements.find(e => e.type === 'image' && e.svg)?.svg;
      }
      const png = svg && await renderFigureSvg(svg);
      if (controller.signal.aborted) return;
      if (!png) throw new Error();
      setSourceSvg(svg!);
      setPreview(png);
      setStatus('');
    } catch {
      if (!controller.signal.aborted) setStatus('SVG nahi ban paaya. Original crop add kar sakte hain.');
    }
  }
  return <div className="flex flex-wrap items-center gap-2">
    <button className="btn btn-secondary btn-sm" disabled={!image || uploading} onClick={() => { clear(); setMode('crop'); }}>Crop image</button>
    <button className="btn btn-secondary btn-sm" disabled={!image || uploading} onClick={() => { clear(); setMode('svg'); }}>Create SVG</button>
    {!image && <span>Original page image unavailable</span>}
    {mode && image && <CropDialog pageImage={image} apply={apply} close={clear} actionLabel={mode === 'svg' ? 'Create SVG from selection' : 'Attach crop'} />}
    {original && hasPassageGroup && <label className="inline-flex items-center gap-1.5 text-xs">
      <input type="checkbox" checked={shared} disabled={uploading} onChange={e => setShared(e.target.checked)} />
      Attach to all questions in this group
    </label>}
    {status && <span role="status">{status}</span>}
    {preview && <><img className="max-h-40 bg-white" src={preview} alt="Recreated question figure" />
      <button className="btn btn-primary btn-sm" disabled={uploading} onClick={() => save(preview, sourceSvg)}>Use SVG</button></>}
    {original && <><button className="btn btn-secondary btn-sm" disabled={uploading} onClick={() => save(original)}>Upload crop to Drive</button>
      <button className="btn btn-ghost btn-sm" disabled={uploading} onClick={clear}>Cancel</button></>}
  </div>;
}
