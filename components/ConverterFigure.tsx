import React, { useEffect, useRef, useState } from 'react';
import type { BoundingBox, ExtractedElement } from '../types';
import { cropImage } from '../services/pdfUtils';
import { normalizeFigureBox } from '../services/converterFigures';

type ApplyFigure = (image: string, bbox?: BoundingBox) => void;

function CropDialog({ pageImage, initial, apply, close }: {
  pageImage: string; initial?: BoundingBox; apply: ApplyFigure; close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  function point(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.round(Math.max(0, Math.min(1000, v)));
    return { x: clamp((event.clientX - rect.left) * 1000 / rect.width), y: clamp((event.clientY - rect.top) * 1000 / rect.height) };
  }
  function draw(event: React.PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const end = point(event);
    setBox({ xmin: Math.min(start.current.x, end.x), ymin: Math.min(start.current.y, end.y),
      xmax: Math.max(start.current.x, end.x), ymax: Math.max(start.current.y, end.y) });
  }
  const selection = normalizeFigureBox(box);
  async function save() {
    if (!selection) return;
    setBusy(true);
    try {
      const image = await cropImage(pageImage, selection);
      if (dialog.current?.open) apply(image, selection);
    } catch {
      setError('Could not crop this area. Select the figure and try again.');
      setBusy(false);
    }
  }
  return <dialog ref={dialog} aria-label="Crop figure from page" onCancel={close}
    className="m-auto w-[min(92vw,760px)] max-h-[92vh] rounded-xl border border-line bg-panel text-ink backdrop:bg-black/75">
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Crop figure from page</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={close}>Cancel</button>
      </div>
      <p className="text-sm text-ink-2">Drag a box around the figure, or adjust its edges below.</p>
      <div className="max-h-[55vh] overflow-auto rounded-lg border border-line">
        <div className="relative touch-none cursor-crosshair select-none" onPointerDown={e => {
          if (!e.isPrimary || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = point(e);
          draw(e);
        }} onPointerMove={e => { if (e.isPrimary) draw(e); }} onPointerUp={e => {
          if (e.isPrimary) { draw(e); start.current = null; }
        }} onPointerCancel={() => { start.current = null; }}>
          <img src={pageImage} alt="Original page for cropping" draggable={false} className="block w-full" />
          {selection && <div className="absolute pointer-events-none border-2 border-orange-500 bg-orange-500/15"
            style={{ left: selection.xmin / 10 + '%', top: selection.ymin / 10 + '%',
              width: (selection.xmax - selection.xmin) / 10 + '%', height: (selection.ymax - selection.ymin) / 10 + '%' }} />}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {([['xmin', 'Left'], ['ymin', 'Top'], ['xmax', 'Right'], ['ymax', 'Bottom']] as const).map(([field, label]) =>
          <label key={field} className="text-xs text-ink-2">{label} (%)
            <input className="input block w-20" type="number" min="0" max="100" step="0.1"
              value={(box?.[field] ?? (field.endsWith('max') ? 1000 : 0)) / 10}
              onChange={e => setBox({ xmin: 0, ymin: 0, xmax: 1000, ymax: 1000, ...box,
                [field]: Math.max(0, Math.min(1000, Math.round(Number(e.target.value) * 10))) })} />
          </label>)}
        <button type="button" className="btn btn-primary ml-auto" disabled={!selection || busy} onClick={save}>Add crop</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  </dialog>;
}

export function ConverterFigure({ element, pageImage, apply }: {
  element: ExtractedElement; pageImage: string; apply: ApplyFigure;
}) {
  const [editing, setEditing] = useState(false);
  const review = element.figureReview;
  if (!review && !element.imageB64) return null;
  const original = review?.original;
  function accept(image: string, bbox = element.bbox) {
    apply(image, bbox);
    setEditing(false);
  }
  return <section className="my-3 rounded-lg border border-line p-3 space-y-2">
    <h4 className="text-sm font-semibold">{element.content || 'Figure'}</h4>
    <div className="flex flex-wrap gap-3">
      {[[review ? original ? 'Original crop' : 'Original page' : 'Selected figure', review ? original || pageImage : element.imageB64],
        ['SVG recreation', review?.recreation]].map(([label, src]) => src && <figure key={label} className="min-w-0 flex-1">
          <figcaption className="text-xs text-ink-3 mb-1">{label}</figcaption>
          <img src={src} alt={label} className="w-full h-40 object-contain rounded bg-white" />
        </figure>)}
    </div>
    {review?.mode === 'svg' && !review.recreation && <p className="text-sm text-amber-300">
      Ye figure SVG mein sahi tarah se nahi ban paayi. Original page se crop karke add karein.
    </p>}
    {review?.mode === 'crop' && !original && <p className="text-sm text-amber-300">Select the figure on the original page to add it.</p>}
    <div className="flex flex-wrap gap-2">
      {review?.recreation && <button type="button" className="btn btn-primary btn-sm" onClick={() => accept(review.recreation!)}>Use SVG</button>}
      {review?.mode === 'crop' && original && <button type="button" className="btn btn-primary btn-sm" onClick={() => accept(original)}>Use crop</button>}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
        {review?.mode === 'svg' ? review.recreation ? 'Crop original' : 'Crop manually' : original || !review ? 'Adjust crop' : 'Crop manually'}
      </button>
    </div>
    {editing && <CropDialog pageImage={pageImage} initial={element.bbox} apply={accept} close={() => setEditing(false)} />}
  </section>;
}
