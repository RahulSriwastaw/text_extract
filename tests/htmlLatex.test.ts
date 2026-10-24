import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHtmlLatex, htmlToPlainText, toInlineHtml } from '../services/htmlLatex';
import { cleanMocktestText, safeParseAiJsonObject } from '../services/textCleanService';

test('plain text becomes <p> paragraphs with <br> line breaks', () => {
  assert.equal(normalizeHtmlLatex('Line one\nline two\n\nNext para'), '<p>Line one<br>line two</p><p>Next para</p>');
});

test('\\( \\) and \\[ \\] are normalized to $ and $$', () => {
  assert.equal(normalizeHtmlLatex('Find \\(x^2\\) and \\[\\frac{a}{b}\\]'), '<p>Find $x^2$ and $$\\frac{a}{b}$$</p>');
});

test('comparison signs inside math become \\lt / \\gt, outside math they are escaped', () => {
  assert.equal(normalizeHtmlLatex('<p>If $a<b$ then x<y and y>z</p>'), '<p>If $a \\lt b$ then x&lt;y and y&gt;z</p>');
});

test('tables, lists and allowed attributes survive; scripts, styles and handlers do not', () => {
  const out = normalizeHtmlLatex('<div><span style="color:red">Hi</span><script>alert(1)</script></div><ol type="I"><li>A</li></ol><table><tr><td colspan="2">$x$</td></tr></table><img src="https://x.test/a.png" onerror="alert(1)">');
  assert.equal(out, '<p><span>Hi</span></p><ol type="I"><li>A</li></ol><table><tr><td colspan="2">$x$</td></tr></table><p><img src="https://x.test/a.png"></p>');
  assert.equal(normalizeHtmlLatex('<img src="javascript:alert(1)">'), '');
});

test('markdown tables and bold from AI answers become HTML', () => {
  assert.equal(normalizeHtmlLatex('| A | B |\n|---|---|\n| 1 | **2** |'), '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td><b>2</b></td></tr></table>');
});

test('cleanMocktestText output is canonical HTML + LaTeX and idempotent', () => {
  const inputs = [
    'यदि एक संख्या N, 3 से विभाज्य है?\n(a) $\\frac{1}{2}$',
    '<p>Consider:</p>\n<ol><li>$\\sqrt{2}$</li></ol>\nWhich is correct?',
    '<p>$$\\begin{align} a &= b \\end{align}$$</p>',
  ];
  for (const input of inputs) {
    const once = cleanMocktestText(input);
    assert.match(once, /^<(p|ol|table|ul)>/);
    assert.equal(cleanMocktestText(once), once);
  }
  assert.equal(cleanMocktestText('<p>$$\\begin{align} a &= b \\end{align}$$</p>'), '<p>$$\\begin{aligned} a &= b \\end{aligned}$$</p>');
});

test('option helpers: plain text for blank checks, inline HTML for one-line rendering', () => {
  assert.equal(htmlToPlainText('<p>Blank</p>'), 'Blank');
  assert.equal(htmlToPlainText('<p>5 &lt; 7</p>'), '5 < 7');
  assert.equal(toInlineHtml('<p>a</p><p>b</p>'), 'a<br>b');
});

test('AI JSON with single-backslash LaTeX parses without losing commands', () => {
  const raw = String.raw`{"q": "<p>$a \lt b$, $\theta=\frac{\pi}{2}$, $\begin{aligned}x\end{aligned}$, $\left(1\right)$, $\neq$</p>", "s": "line1\nThe end"}`;
  const obj = safeParseAiJsonObject(raw);
  assert.equal(obj.q, '<p>$a \\lt b$, $\\theta=\\frac{\\pi}{2}$, $\\begin{aligned}x\\end{aligned}$, $\\left(1\\right)$, $\\neq$</p>');
  assert.equal(obj.s, 'line1\nThe end');
});
