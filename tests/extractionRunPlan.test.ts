import test from 'node:test';
import assert from 'node:assert/strict';
import { pagesForScope, primaryRun, replacedByRun, summarizeRun, type RunPage, type RunStatus } from '../services/extractionRunPlan';

const queue = (spec: string): (RunPage & { n: number })[] =>
  // "r" ready, "p" pending, "e" error, "x" processing; a "-" after the letter means not selected
  spec.split(' ').map((token, index) => ({
    n: index + 1,
    status: ({ r: 'ready', p: 'pending', e: 'error', x: 'processing' } as Record<string, RunStatus>)[token[0]],
    isSelected: token[1] !== '-',
    items: token[0] === 'r' ? [1, 2, 3] : [],
  }));
const numbers = (pages: { n: number }[]) => pages.map(page => page.n);

test('a rerun with some pages done only takes the pages that are left, including failed ones', () => {
  const pages = queue('r r e p p');
  assert.deepEqual(numbers(pagesForScope(pages, 'remaining')), [3, 4, 5]);
  assert.deepEqual(numbers(pagesForScope(pages, 'failed')), [3]);
  const summary = summarizeRun(pages);
  assert.deepEqual([summary.done, summary.selectedRemaining, summary.selectedFailed], [2, 3, 1]);
  const main = primaryRun(summary);
  assert.deepEqual([main.kind, main.scope, main.count], ['continue', 'remaining', 3]);
});

test('new pages added after a finished run are the only ones the next run takes', () => {
  const pages = queue('r r r r p p');
  assert.deepEqual(numbers(pagesForScope(pages, 'remaining')), [5, 6]);
  assert.equal(primaryRun(summarizeRun(pages)).kind, 'continue');
});

test('a fresh queue starts everything selected; unselected pages stay out', () => {
  const pages = queue('p p p- p');
  assert.deepEqual(numbers(pagesForScope(pages, 'remaining')), [1, 2, 4]);
  const main = primaryRun(summarizeRun(pages));
  assert.deepEqual([main.kind, main.scope, main.count, main.label], ['start', 'remaining', 3, 'Start extraction']);
});

test('when only failures are left the button says retry, and a stopped or stuck page counts as left', () => {
  const failed = primaryRun(summarizeRun(queue('r r e e')));
  assert.deepEqual([failed.kind, failed.scope, failed.count], ['retry', 'failed', 2]);
  const stuck = queue('r x p');
  assert.deepEqual(numbers(pagesForScope(stuck, 'remaining')), [2, 3]);
  assert.equal(primaryRun(summarizeRun(stuck)).kind, 'continue');
  // every page failed and nothing was ever done: still a retry, not a first start
  assert.equal(primaryRun(summarizeRun(queue('e e'))).kind, 'retry');
});

test('when every selected page is done the button does not re-run them; unselected leftovers are offered', () => {
  const done = primaryRun(summarizeRun(queue('r r r')));
  assert.deepEqual([done.kind, done.scope, done.count], ['done', null, 0]);
  const leftovers = primaryRun(summarizeRun(queue('r r p- p-')));
  assert.deepEqual([leftovers.kind, leftovers.scope, leftovers.count], ['rest', 'rest', 2]);
  assert.deepEqual(numbers(pagesForScope(queue('r r p- p-'), 'rest')), [3, 4]);
  // an unselected page that is already done is not "left"
  assert.equal(primaryRun(summarizeRun(queue('r r r-'))).kind, 'done');
});

test('nothing selected, and an empty queue, are told apart', () => {
  assert.equal(primaryRun(summarizeRun(queue('p- p-'))).kind, 'rest');
  assert.equal(primaryRun(summarizeRun(queue('r- r-'))).kind, 'select');
  const empty = primaryRun(summarizeRun([]));
  assert.deepEqual([empty.kind, empty.scope], ['empty', null]);
});

test('re-running selected or all pages is explicit, and says how much finished work it replaces', () => {
  const pages = queue('r r- e p');
  assert.deepEqual(numbers(pagesForScope(pages, 'selected')), [1, 3, 4]);
  assert.deepEqual(numbers(pagesForScope(pages, 'all')), [1, 2, 3, 4]);
  assert.deepEqual(replacedByRun(pagesForScope(pages, 'selected')), { pages: 1, questions: 3 });
  assert.deepEqual(replacedByRun(pagesForScope(pages, 'all')), { pages: 2, questions: 6 });
  // the default scopes never contain finished pages, so they never need a warning
  assert.deepEqual(replacedByRun(pagesForScope(pages, 'remaining')), { pages: 0, questions: 0 });
  assert.deepEqual(replacedByRun(pagesForScope(pages, 'failed')), { pages: 0, questions: 0 });
});

test('the hint explains what a click does', () => {
  assert.match(primaryRun(summarizeRun(queue('r r p p p'))).hint, /3 pages not done yet.*2 pages already finished are left/);
  assert.match(primaryRun(summarizeRun(queue('r r e p'))).hint, /1 failed earlier/);
  assert.match(primaryRun(summarizeRun(queue('p'))).hint, /1 page\./);
});
