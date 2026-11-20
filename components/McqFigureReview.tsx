import { uploadFigureImage } from '../services/figureStorageService';
import React, { useEffect, useState } from 'react';
import type { ExtractedElement, FigureMode, McqFigure } from '../types';
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
      ? <ConverterFigure element={prepared} pageImage={image} apply={setPending} remove={() => resolve()} />
      : image ? <span>Preparing preview…</span> : <><span>Original page unavailable. </span>
        <button className="btn btn-ghost btn-sm" onClick={() => resolve()}>Remove image</button></>}
    {pending && <button disabled={busy} className="btn btn-primary btn-sm" onClick={() => upload(pending)}>{busy ? 'Uploading…' : 'Upload to Google Drive'}</button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
