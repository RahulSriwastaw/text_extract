import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { generateDocx } from '../services/docxService';
import { NumberingStyle, OptionArrangement } from '../types';

test('full-text Word export keeps Hindi stems, LaTeX roots and their options in reading order', async () => {
  const content = [
    'Type-III', 'Nature-1', String.raw`बहुपद के शून्यकों का योग $$(\alpha + \beta)$$ ज्ञात करना`,
    String.raw`#32. यदि द्विघात बहुपद $$x^2-2x-4$$ के शून्यक $$\alpha, \beta$$ हैं, तब योग क्या होगा [16 (A) II]`,
    '(A) −1', '(B) 4', '(C) 1', '(D) 0',
    String.raw`#33. यदि $$5x^2+8$$ के शून्यक $$\alpha$$ तथा $$\beta$$ हों तो योग ज्ञात करें [20 (A) II]`,
    '(A) 5', '(B) −5', '(C) 8', '(D) −8',
  ].join('\n');
  const blob = await generateDocx([{ type: 'text', id: 'page', content }],
    OptionArrangement.VERTICAL, true, NumberingStyle.HASH, false, false);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file('word/document.xml')!.async('string');
  const paragraphs = Array.from(xml.matchAll(/<w:p(?: [^>]*)?>([\s\S]*?)<\/w:p>/g),
    m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  assert.match(paragraphs[2], /शून्यकों का योग.*α.*β/);
  assert.match(paragraphs[3], /^#32\..*α.*β.*योग क्या होगा.*16 \(A\) II/);
  assert.deepEqual(paragraphs.slice(4, 8), ['(A) −1', '(B) 4', '(C) 1', '(D) 0']);
  assert.match(paragraphs[8], /^#33\..*α.*β.*योग ज्ञात करें/);
  assert.deepEqual(paragraphs.slice(9), ['(A) 5', '(B) −5', '(C) 8', '(D) −8']);
});
