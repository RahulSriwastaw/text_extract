import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHtmlLatex } from '../components/LatexRenderer';
import { cleanMocktestText } from '../services/textCleanService';
import { normalizeLatexLocally } from '../api/latexRepair';

test('discount and interest solutions keep equation boundaries through cleanup, repair and display', () => {
  for (const [label, next] of [['कुल छूट', 'नया मूल्य'], ['Total discount', 'New price']]) {
    const solution = String.raw`<p>${label} = $3550 - 3124 = ₹426$</p><p>$k\% = \frac{426}{3550} \times 100 = 12\%$</p><p>${next} = $3550 \times \frac{92}{100} = ₹3,266$</p>`;
    assert.equal(cleanMocktestText(solution), solution);
    assert.equal(normalizeLatexLocally(solution), solution);
    assert.doesNotMatch(renderHtmlLatex(solution), /class="math-error"/);
  }
  const old = String.raw`<p>Simple interest = $5008 - 4000 = ₹1,008$1008 = $\frac{4000 × x × 3}{100}$ ⇒ x = 8.4\%$New rate = $8.4 + 2.6 = 11\%$New interest = $\frac{4000 × 11 × 3}{100} = ₹1,320Maturity amount = $4000 + 1320 = ₹5,320</p>`;
  const recovered = cleanMocktestText(old);
  assert.equal(cleanMocktestText(recovered), recovered);
  assert.match(recovered, /₹1,320\$<br>Maturity amount/);
  const rendered = renderHtmlLatex(old);
  assert.doesNotMatch(rendered, /class="math-error"/);
  assert.equal((rendered.match(/class="katex"/g) || []).length, 5);
});
