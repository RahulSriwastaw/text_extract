import { uploadFigureImage } from '../services/figureStorageService';
import React, { useEffect, useRef, useState } from 'react';
import type { BoundingBox, ExtractedElement, FigureMode, McqFigure } from '../types';
import { prepareConverterFigures, type FigureCrop } from '../services/converterFigures';
import { ConverterFigure } from './ConverterFigure';

export function McqFigureReview({ figure, image, mode, resolve }: {
  figure: McqFigure; image?: string; mode: FigureMode; resolve: (urls?: string[]) => void;
}) {
  const [prepared, setPrepared] = useState<ExtractedElement>();
  const [pending, setPending] = useState<string[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Images that already reached Drive, so a retry after a failed upload never uploads them twice.
  const uploaded = useRef(new Map<string, string>());
  async function upload(pngs: string[]) {
    setBusy(true);
    setError('');
    try {
      const urls: string[] = [];
      for (const png of pngs) {
        let url = uploaded.current.get(png);
        if (!url) {
          url = (await uploadFigureImage({ imageData: png, targetField: figure.target,
            svg: png === prepared?.figureReview?.recreation ? figure.svg : undefined })).url;
          uploaded.current.set(png, url);
        }
        urls.push(url);
      }
      resolve(urls);
    } catch (e) { setError(e instanceof Error ? e.message : 'Drive upload failed'); }
    finally { setBusy(false); }
  }
  /**
   * Attach the chosen crop/SVG right away and show the new crop in the card, instead of hiding it behind an extra button.
   * `extra` are further boxes drawn in the same crop dialog: they are attached to the same field, after the first.
   */
  function choose(png: string, bbox?: BoundingBox, extra: FigureCrop[] = []) {
    const pngs = [png, ...extra.map(crop => crop.image)];
    setPending(pngs);
    if (png !== prepared?.figureReview?.recreation) setPrepared(current => current && {
      ...current, bbox: bbox ?? current.bbox,
      figureReview: { mode: current.figureReview?.mode ?? mode, ...current.figureReview, original: png },
    });
    void upload(pngs);
  }
  useEffect(() => {
    let active = true;
    setPrepared(undefined);
    if (image) void prepareConverterFigures(image, [figure], mode).then(([result]) => {
      if (active) setPrepared(result);
    });
    return () => { active = false; };
  }, [figure, image, mode]);
  return <div className="px-3 py-2">
    <span className="field-label">{figure.target} figure</span>
    {prepared && image
      ? <ConverterFigure element={prepared} pageImage={image} apply={choose} remove={() => resolve()} />
      : image ? <span>Preparing preview…</span> : <><span>Original page unavailable. </span>
        <button className="btn btn-ghost btn-sm" onClick={() => resolve()}>Remove image</button></>}
    {busy && <span role="status" className="text-sm text-ink-2">
      Attaching {pending && pending.length > 1 ? `${pending.length} figures` : 'figure'} (uploading to Google Drive)…
    </span>}
    {error && <p role="alert">{error}</p>}
    {pending && error && !busy && <button className="btn btn-primary btn-sm" onClick={() => upload(pending)}>Retry upload</button>}
  </div>;
}
