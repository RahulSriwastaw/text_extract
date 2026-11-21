import { uploadFigureImage } from '../services/figureStorageService';
import React, { useEffect, useState } from 'react';
import type { BoundingBox, ExtractedElement, FigureMode, McqFigure } from '../types';
import { prepareConverterFigures } from '../services/converterFigures';
import { ConverterFigure } from './ConverterFigure';

export function McqFigureReview({ figure, image, mode, resolve }: {
  figure: McqFigure; image?: string; mode: FigureMode; resolve: (png?: string) => void;
}) {
  const [prepared, setPrepared] = useState<ExtractedElement>();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function upload(png: string) {
    setBusy(true);
    setError('');
    try {
      const file = await uploadFigureImage({ imageData: png, targetField: figure.target,
        svg: png === prepared?.figureReview?.recreation ? figure.svg : undefined });
      resolve(file.url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Drive upload failed'); }
    finally { setBusy(false); }
  }
  /** Attach the chosen crop/SVG right away and show the new crop in the card, instead of hiding it behind an extra button. */
  function choose(png: string, bbox?: BoundingBox) {
    setPending(png);
    if (png !== prepared?.figureReview?.recreation) setPrepared(current => current && {
      ...current, bbox: bbox ?? current.bbox,
      figureReview: { mode: current.figureReview?.mode ?? mode, ...current.figureReview, original: png },
    });
    void upload(png);
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
    {busy && <span role="status" className="text-sm text-ink-2">Attaching figure (uploading to Google Drive)…</span>}
    {error && <p role="alert">{error}</p>}
    {pending && error && !busy && <button className="btn btn-primary btn-sm" onClick={() => upload(pending)}>Retry upload</button>}
  </div>;
}
