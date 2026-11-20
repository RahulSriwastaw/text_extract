import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { parseAiOutputToMockTestItems, serializeMockTestToCsv } from '../services/mocktestService';
import { resolveMcqFigure } from '../services/mcqFigures';
import { downloadMcqAsDocx } from '../services/mcqDocxService';
import { mcqFigureInstruction } from '../services/figurePrompt';

test('MCQ figures keep the source page, target and bilingual field content through export', async () => {
  const source = { question_hi: 'चित्र चुनें', question_en: 'Choose the figure', option1_en: 'First',
    option2_hi: 'दूसरा', option2_en: 'Second', answer: 'B', figures: [
      { target: 'option2', sourcePage: 3, bbox: [50, 60, 200, 250], content: 'Triangle', svg: '<svg/>' },
      { target: 'solution', content: 'Construction' },
      { target: 'question', content: 'Background watermark' }
    ] };
  const [item] = parseAiOutputToMockTestItems(JSON.stringify([source]));
  assert.equal(item.figures?.length, 2);
  const [figure, unused] = item.figures!;
  assert.equal(figure.sourcePage, 3);
  assert.equal(figure.svg, '<svg/>');
  assert.equal(figure.bbox?.xmin, 60);
  Object.assign(item, resolveMcqFigure(item, unused));
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
  Object.assign(item, resolveMcqFigure(item, figure, png));
  assert.equal(item.figures?.length, 0);
  assert.match(item.option2_en, /Second/);
  assert.match(item.option2_hi, /दूसरा/);
  for (const field of [item.option2_hi, item.option2_en]) assert.ok(field.includes(png));
  assert.equal(serializeMockTestToCsv([item]).split(png).length - 1, 2);
  assert.equal(mcqFigureInstruction('off'), '');
  assert.match(mcqFigureInstruction('svg'), /static SVG/);
  let blob: Blob | undefined;
  const previous = globalThis.document;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} },
  } });
  const createUrl = URL.createObjectURL;
  URL.createObjectURL = value => { blob = value as Blob; return 'blob:test'; };
  try {
    await downloadMcqAsDocx([item], { language: 'both', includeAnswer: true, includeSolution: true });
    const zip = await JSZip.loadAsync(await blob!.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    assert.equal((xml.match(/<w:drawing>/g) || []).length, 2);
    assert.ok(xml.indexOf('Second') < xml.lastIndexOf('<w:drawing>'));
  } finally {
    URL.createObjectURL = createUrl;
    if (previous) Object.defineProperty(globalThis, 'document', { value: previous });
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
