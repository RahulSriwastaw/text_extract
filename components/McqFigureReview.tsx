import React, { useEffect, useState } from 'react';
import type { ExtractedElement, FigureMode, McqFigure } from '../types';
import { prepareConverterFigures } from '../services/converterFigures';
import { ConverterFigure } from './ConverterFigure';

export function McqFigureReview({ figure, image, mode, resolve }: {
  figure: McqFigure; image?: string; mode: FigureMode; resolve: (png?: string) => void;
}) {
  const [prepared, setPrepared] = useState<ExtractedElement>();
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
      ? <ConverterFigure element={prepared} pageImage={image} apply={png => resolve(png)} remove={() => resolve()} />
      : image ? <span>Preparing preview…</span> : <><span>Original page unavailable. </span>
        <button className="btn btn-ghost btn-sm" onClick={() => resolve()}>Remove image</button></>}
  </div>;
}
