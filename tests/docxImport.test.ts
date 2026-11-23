import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  Document as WordDocument, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, ShadingType, Table, TableRow, TableCell, BorderStyle,
  Math as DocxMath, MathRun, MathFraction, MathSuperScript, MathRadical,
} from 'docx';
import { docxToDesignDoc, ommlToLatex } from '../services/docxImport.ts';
import { allBlocks, resolveStyle } from '../services/designDoc.ts';

const { DOMParser } = createRequire(import.meta.url)('@xmldom/xmldom');
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document;
const run = (text: string, extra: Record<string, unknown> = {}) => new TextRun({ text, size: 22, font: 'Arial', ...extra });

async function build(children: (Paragraph | Table)[]) {
  const buffer = await Packer.toBuffer(new WordDocument({ sections: [{ children }] }));
  return docxToDesignDoc(buffer, 'Test', parse);
}

describe('Word import that keeps the look', () => {
  it('keeps colour, bold, italic, alignment, shading, borders and size per paragraph', async () => {
    const plain = Array.from({ length: 6 }, (_, i) => new Paragraph({ children: [run(`Body line number ${i + 1} of the lesson, in the usual black text.`)] }));
    const { doc } = await build([
      new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [run('LCM & HCF', { color: 'C00000', bold: true, size: 40 })] }),
      new Paragraph({ children: [run('TYPE 01 | LCM of Numbers', { bold: true, size: 32, color: '1F4E79' })] }),                       // looks like a heading, no heading style
      ...plain,
      new Paragraph({ children: [run('Q12. Find the HCF of 6, 33 and 42.', { bold: true })] }),
      new Paragraph({ children: [run('निम्नलिखित संख्याओं का म.स.प. ज्ञात कीजिए।', { color: '0070C0' })] }),
      new Paragraph({ children: [run('[RRB Group D, 9 Aug 2026]', { italics: true, size: 18, color: '7F7F7F' })] }),
      new Paragraph({ children: [run('(a) 3')] }), new Paragraph({ children: [run('(b) 7')] }),
      new Paragraph({ children: [run('(a)', { bold: true }), run('27 '), run('(b)', { bold: true }), run('45')] }),              // bold label glued to its text
      new Paragraph({ children: [run('(c)36 (d)54')] }),
      new Paragraph({ alignment: AlignmentType.RIGHT, shading: { type: ShadingType.CLEAR, fill: 'FFF2CC', color: 'auto' }, children: [run('Remember: '), run('HCF divides LCM', { bold: true }), run(' always.')] }),
      new Paragraph({ border: { left: { style: BorderStyle.SINGLE, size: 24, color: '00B050', space: 4 } }, children: [run('A note with a green bar', { underline: {} })] }),
    ]);
    const blocks = allBlocks(doc);
    const find = (start: string) => blocks.find(b => (b.text || '').startsWith(start))!;

    assert.deepEqual([find('LCM & HCF').type, find('LCM & HCF').level, find('LCM & HCF').style], ['heading', 1, { color: '#C00000', align: 'center' }]);
    assert.deepEqual([find('TYPE 01').type, find('TYPE 01').style], ['heading', { color: '#1F4E79' }]);
    assert.equal(find('Body line number 1').style, undefined);                                   // the document's own body text carries no style
    assert.deepEqual([find('Q12.').type, find('Q12.').style], ['question', { bold: true }]);
    assert.deepEqual([find('निम्नलिखित').type, find('निम्नलिखित').style], ['paragraph', { color: '#0070C0' }]);
    assert.deepEqual(find('[RRB').style, { color: '#7F7F7F', italic: true, size: 'sm' });
    assert.deepEqual([find('(a) 3').type, find('(b) 7').type], ['option', 'option']);
    assert.deepEqual(blocks.filter(b => b.type === 'option').map(b => b.text), ['(a) 3', '(b) 7', '(a) 27', '(b) 45', '(c) 36', '(d) 54']);
    assert.deepEqual(find('Remember:').text, 'Remember: **HCF divides LCM** always.');           // bold only on those words
    assert.deepEqual(find('Remember:').style, { background: '#FFF2CC', align: 'right' });
    assert.deepEqual(find('A note').style, { border: 'left-bar', borderColor: '#00B050', underline: true });
    assert.deepEqual([doc.theme.font, doc.theme.baseSize], ['sans', 11]);
    assert.equal(resolveStyle(doc.theme, find('निम्नलिखित')).color, '#0070C0');
  });

  it('turns Word equations into LaTeX and keeps a table; an options table becomes options', async () => {
    const cell = (text: string) => new TableCell({ children: [new Paragraph({ children: [run(text)] })] });
    const { doc, equations } = await build([
      new Paragraph({ children: [run('Area = '), new DocxMath({ children: [
        new MathFraction({ numerator: [new MathRun('1')], denominator: [new MathRun('2')] }), new MathRun('×'),
        new MathSuperScript({ children: [new MathRun('r')], superScript: [new MathRun('2')] }), new MathRun('+'),
        new MathRadical({ children: [new MathRun('x')] }),
      ] })] }),
      new Table({ rows: [new TableRow({ children: [cell('Type'), cell('Topic')] }), new TableRow({ children: [cell('01'), cell('LCM | HCF')] })] }),
      new Paragraph({ children: [run('Q1. Pick one?')] }),
      new Table({ rows: [new TableRow({ children: [cell('(a) 27 (b) 45'), cell('(c) 36 (d) 54')] })] }),
    ]);
    const blocks = allBlocks(doc);
    assert.equal(equations, 1);
    assert.equal(blocks[0].text, 'Area = $\\frac{1}{2}\\times {r}^{2}+\\sqrt{x}$');
    assert.deepEqual([blocks[1].type, blocks[1].text], ['table', '| Type | Topic |\n| --- | --- |\n| 01 | LCM / HCF |']);
    assert.deepEqual(blocks.slice(2).map(b => [b.type, b.text]), [['question', 'Q1. Pick one?'], ['option', '(a) 27'], ['option', '(b) 45'], ['option', '(c) 36'], ['option', '(d) 54']]);
  });

  it('reads the common equation shapes', () => {
    const m = (inner: string) => ommlToLatex(parse(`<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${inner}</m:oMath>`).documentElement);
    const r = (t: string) => `<m:r><m:t>${t}</m:t></m:r>`;
    assert.equal(m(`<m:sSub><m:e>${r('a')}</m:e><m:sub>${r('n')}</m:sub></m:sSub>`), '{a}_{n}');
    assert.equal(m(`<m:rad><m:deg>${r('3')}</m:deg><m:e>${r('8')}</m:e></m:rad>`), '\\sqrt[3]{8}');
    assert.equal(m(`<m:d><m:e>${r('a+b')}</m:e></m:d>`), '\\left(a+b\\right)');
    assert.equal(m(`<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${r('43')}</m:e></m:bar>`), '\\overline{43}');
    assert.equal(m(`<m:func><m:fName>${r('sin')}</m:fName><m:e>${r('θ')}</m:e></m:func>`).trim(), '\\sin \\theta');
    assert.equal(m(r('45% ≤ x')), '45\\% \\le  x');
    assert.equal(m(r('संख्या')), '\\text{संख्या}');
  });
});
