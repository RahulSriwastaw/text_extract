import React, { useEffect, useRef, useState } from 'react';
import type { BoundingBox, ExtractedElement } from '../types';
import { cropImage } from '../services/pdfUtils';
import { normalizeFigureBox, type FigureCrop } from '../services/converterFigures';

/** `extra` holds the further boxes drawn in the same crop dialog: each one is a figure of its own. */
type ApplyFigure = (image: string, bbox?: BoundingBox, extra?: FigureCrop[]) => void;

type Point = { x: number; y: number };
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type CropBox = BoundingBox & { id: number };
type Drag = { mode: 'new'; start: Point; id?: number }
  | { mode: 'move' | Handle; start: Point; id: number; origin: BoundingBox };

/** Smallest box side in 0-1000 page units (1% of the page): anything smaller is a slip, not a figure. */
const MIN_SIDE = 10;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// Grab areas reach further outside the box than inside it, so a small box still keeps a middle to move it by.
const HANDLES: { id: Handle; area: React.CSSProperties; knob: React.CSSProperties }[] = [
  { id: 'n', area: { left: 8, right: 8, top: -12, height: 18, cursor: 'ns-resize' }, knob: { left: 'calc(50% - 4px)', top: 7 } },
  { id: 's', area: { left: 8, right: 8, bottom: -12, height: 18, cursor: 'ns-resize' }, knob: { left: 'calc(50% - 4px)', bottom: 7 } },
  { id: 'w', area: { top: 8, bottom: 8, left: -12, width: 18, cursor: 'ew-resize' }, knob: { top: 'calc(50% - 4px)', left: 7 } },
  { id: 'e', area: { top: 8, bottom: 8, right: -12, width: 18, cursor: 'ew-resize' }, knob: { top: 'calc(50% - 4px)', right: 7 } },
  { id: 'nw', area: { left: -16, top: -16, width: 24, height: 24, cursor: 'nwse-resize' }, knob: { left: 10, top: 10, width: 10, height: 10 } },
  { id: 'ne', area: { right: -16, top: -16, width: 24, height: 24, cursor: 'nesw-resize' }, knob: { right: 10, top: 10, width: 10, height: 10 } },
  { id: 'sw', area: { left: -16, bottom: -16, width: 24, height: 24, cursor: 'nesw-resize' }, knob: { left: 10, bottom: 10, width: 10, height: 10 } },
  { id: 'se', area: { right: -16, bottom: -16, width: 24, height: 24, cursor: 'nwse-resize' }, knob: { right: 10, bottom: 10, width: 10, height: 10 } },
];

/**
 * Crop one or more figures from a page. Drag on empty page area to draw a box, drag inside a box to move it,
 * drag its edges or corners to resize it. With `multiple` every box is returned as its own crop, in numbered order;
 * without it a new drag replaces the box (one region only, e.g. for SVG recreation).
 */
export function CropDialog({ pageImage, initial, apply, close, actionLabel = "Add crop", pluralLabel = count => `Add ${count} crops`, multiple = true }: {
  pageImage: string; initial?: BoundingBox; actionLabel?: string; pluralLabel?: (count: number) => string; multiple?: boolean;
  apply: (crops: FigureCrop[]) => void; close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const frame = useRef(0);
  const nextId = useRef(2);
  const [boxes, setBoxes] = useState<CropBox[]>(() => initial ? [{ ...initial, id: 1 }] : []);
  const [selectedId, setSelectedId] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => { cancelAnimationFrame(frame.current); node.close(); };
  }, []);
  // Some box is always selected while any exist, so the percent fields never point at nothing.
  const selected = boxes.find(box => box.id === selectedId) ?? boxes[boxes.length - 1];
  const crops = boxes.map(box => normalizeFigureBox(box)).filter((box): box is BoundingBox => !!box);

  function point(clientX: number, clientY: number): Point {
    const rect = surface.current!.getBoundingClientRect();
    return { x: Math.round(clamp((clientX - rect.left) * 1000 / rect.width, 0, 1000)),
      y: Math.round(clamp((clientY - rect.top) * 1000 / rect.height, 0, 1000)) };
  }
  function update(id: number, box: BoundingBox) {
    setBoxes(prev => prev.map(item => item.id === id ? { ...box, id } : item));
  }
  function remove(id: number) {
    setBoxes(prev => prev.filter(box => box.id !== id));
  }
  function dragTo(clientX: number, clientY: number) {
    const active = drag.current;
    if (!active) return;
    const now = point(clientX, clientY);
    const dx = now.x - active.start.x, dy = now.y - active.start.y;
    if (active.mode === 'new') {
      const box = { xmin: Math.min(active.start.x, now.x), ymin: Math.min(active.start.y, now.y),
        xmax: Math.max(active.start.x, now.x), ymax: Math.max(active.start.y, now.y) };
      if (active.id !== undefined) return update(active.id, box);
      // A plain click on the page draws nothing: the box appears once the pointer has really moved.
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      const id = active.id = nextId.current++;
      setBoxes(prev => multiple ? [...prev, { ...box, id }] : [{ ...box, id }]);
      setSelectedId(id);
      return;
    }
    const { origin, mode } = active;
    if (mode === 'move') {
      const moveX = clamp(dx, -origin.xmin, 1000 - origin.xmax), moveY = clamp(dy, -origin.ymin, 1000 - origin.ymax);
      return update(active.id, { xmin: origin.xmin + moveX, ymin: origin.ymin + moveY, xmax: origin.xmax + moveX, ymax: origin.ymax + moveY });
    }
    const box = { ...origin };
    if (mode.includes('w')) box.xmin = clamp(origin.xmin + dx, 0, origin.xmax - MIN_SIDE);
    if (mode.includes('e')) box.xmax = clamp(origin.xmax + dx, origin.xmin + MIN_SIDE, 1000);
    if (mode.includes('n')) box.ymin = clamp(origin.ymin + dy, 0, origin.ymax - MIN_SIDE);
    if (mode.includes('s')) box.ymax = clamp(origin.ymax + dy, origin.ymin + MIN_SIDE, 1000);
    update(active.id, box);
  }
  /** While a drag is held near (or past) an edge of the visible page area, scroll so the box can follow. */
  function autoScroll() {
    frame.current = 0;
    const view = scroller.current;
    if (!drag.current || !view) return;
    const rect = view.getBoundingClientRect(), { x, y } = pointer.current;
    const pull = (at: number, low: number, high: number) => clamp((at < low + 12 ? at - low - 12 : at > high - 12 ? at - high + 12 : 0) / 3, -14, 14);
    const left = view.scrollLeft, top = view.scrollTop;
    view.scrollBy(pull(x, rect.left, rect.right), pull(y, rect.top, rect.bottom));
    if (view.scrollLeft !== left || view.scrollTop !== top) dragTo(x, y);
    frame.current = requestAnimationFrame(autoScroll);
  }
  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (busy || !event.isPrimary || event.button !== 0 || target.closest('button')) return;
    const hit = target.closest<HTMLElement>('[data-box]');
    const id = Number(hit?.dataset.box);
    const origin = hit ? normalizeFigureBox(boxes.find(box => box.id === id)) : undefined;
    if (hit && !origin) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event.clientX, event.clientY);
    pointer.current = { x: event.clientX, y: event.clientY };
    if (origin) {
      setSelectedId(id);
      drag.current = { mode: (target.closest<HTMLElement>('[data-handle]')?.dataset.handle as Handle | undefined) ?? 'move', start, id, origin };
    } else {
      drag.current = { mode: 'new', start };
    }
    frame.current ||= requestAnimationFrame(autoScroll);
  }
  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || !drag.current) return;
    pointer.current = { x: event.clientX, y: event.clientY };
    dragTo(event.clientX, event.clientY);
  }
  function pointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary) return;
    if (event.type === 'pointerup') dragTo(event.clientX, event.clientY);
    const done = drag.current;
    drag.current = null;
    if (done?.mode === 'new' && done.id !== undefined) setBoxes(prev => prev.filter(box =>
      box.id !== done.id || (box.xmax - box.xmin >= MIN_SIDE && box.ymax - box.ymin >= MIN_SIDE)));
  }
  function edit(field: keyof BoundingBox, value: number) {
    if (selected) return update(selected.id, { ...selected, [field]: value });
    const id = nextId.current++;
    setBoxes([{ xmin: 0, ymin: 0, xmax: 1000, ymax: 1000, [field]: value, id }]);
    setSelectedId(id);
  }
  async function save() {
    if (!crops.length) return;
    setBusy(true);
    try {
      const result: FigureCrop[] = [];
      for (const bbox of crops) result.push({ image: await cropImage(pageImage, bbox), bbox });
      if (dialog.current?.open) apply(result);
    } catch {
      setError('Could not crop this area. Select the figure and try again.');
      setBusy(false);
    }
  }
  return <dialog ref={dialog} aria-label="Crop figure from page" onCancel={close}
    onKeyDown={event => {
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || !selected || busy || event.target instanceof HTMLInputElement) return;
      event.preventDefault();
      remove(selected.id);
    }}
    className="m-auto w-[min(92vw,760px)] max-h-[92vh] rounded-xl border border-line bg-panel text-ink backdrop:bg-black/75">
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Crop figure from page</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={close}>Cancel</button>
      </div>
      <p className="text-sm text-ink-2">{multiple
        ? 'Drag a box around each figure: draw as many boxes as the page has figures. Drag a box to move it, or its edges and corners to resize it.'
        : 'Drag a box around the figure. Drag the box to move it, or its edges and corners to resize it.'}</p>
      <div ref={scroller} className="max-h-[55vh] overflow-auto rounded-lg border border-line">
        {/* overflow-hidden: handles of a box at the page edge must not add scrollable space around the page. */}
        <div ref={surface} tabIndex={-1} className="relative touch-none cursor-crosshair select-none overflow-hidden outline-none"
          onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
          <img src={pageImage} alt="Original page for cropping" draggable={false} className="block w-full" />
          {boxes.map((item, index) => {
            const box = normalizeFigureBox(item);
            if (!box) return null;
            const active = item === selected;
            return <div key={item.id} data-box={item.id} aria-label={`Crop box ${index + 1}`}
              className={'absolute cursor-move border-2 ' + (active ? 'z-10 border-orange-500 bg-orange-500/15' : 'border-orange-400/80 bg-orange-500/5')}
              style={{ left: box.xmin / 10 + '%', top: box.ymin / 10 + '%',
                width: (box.xmax - box.xmin) / 10 + '%', height: (box.ymax - box.ymin) / 10 + '%' }}>
              {multiple && <span className={'pointer-events-none absolute left-0 top-0 min-w-[18px] px-1 text-center text-[11px] font-bold leading-[18px] text-white '
                + (active ? 'bg-orange-600' : 'bg-orange-500/80')}>{index + 1}</span>}
              {active && HANDLES.map(handle => <span key={handle.id} data-handle={handle.id} className="absolute overflow-hidden" style={handle.area}>
                <span className="pointer-events-none absolute h-2 w-2 rounded-[2px] border border-orange-600 bg-white" style={handle.knob} />
              </span>)}
              {active && <button type="button" title="Delete this box (Delete key)" aria-label={`Delete crop box ${index + 1}`} disabled={busy}
                className="absolute right-1 top-1 flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-full bg-black/75 text-[11px] leading-none text-white hover:bg-red-600"
                onClick={() => remove(item.id)}>✕</button>}
            </div>;
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {multiple && <span className="w-full text-xs text-ink-3">{selected
          ? `Editing box ${boxes.indexOf(selected) + 1} of ${boxes.length}.${boxes.length > 1 ? ' Click another box to edit that one.' : ''}`
          : 'No box yet.'}</span>}
        {([['xmin', 'Left'], ['ymin', 'Top'], ['xmax', 'Right'], ['ymax', 'Bottom']] as const).map(([field, label]) =>
          <label key={field} className="text-xs text-ink-2">{label} (%)
            <input className="input block w-20" type="number" min="0" max="100" step="0.1"
              value={(selected?.[field] ?? (field.endsWith('max') ? 1000 : 0)) / 10}
              onChange={e => edit(field, clamp(Math.round(Number(e.target.value) * 10), 0, 1000))} />
          </label>)}
        <button type="button" className="btn btn-primary ml-auto" disabled={!crops.length || busy} onClick={save}>
          {crops.length > 1 ? pluralLabel(crops.length) : actionLabel}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  </dialog>;
}

export function ConverterFigure({ element, pageImage, apply, remove }: {
  element: ExtractedElement; pageImage: string; apply: ApplyFigure; remove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const review = element.figureReview;
  const original = review?.original;
  function accept(image: string, bbox = element.bbox, extra?: FigureCrop[]) {
    apply(image, bbox, extra);
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
      <button type="button" className="btn btn-danger btn-sm" onClick={remove}>Remove image</button>
    </div>
    {editing && <CropDialog pageImage={pageImage} initial={element.bbox} close={() => setEditing(false)}
      apply={([first, ...extra]) => accept(first.image, first.bbox, extra)} />}
  </section>;
}
