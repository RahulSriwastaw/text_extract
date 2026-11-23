/**
 * Which pages a run of the MCQ extractor should process, and what the main Run button should offer.
 *
 * A page is "done" when its status is `ready`. Everything else (`pending`, a failed `error`, or a page that was stopped
 * half way) is "remaining". Starting again must only touch the remaining pages: finished pages are re-run only when the
 * teacher asks for it explicitly ("Re-run selected / all"), and then only after a warning.
 *
 * Pure functions with no imports, so the screen and the tests share one definition.
 */

export type RunStatus = 'pending' | 'processing' | 'ready' | 'error';

export interface RunPage {
  status: RunStatus;
  isSelected: boolean;
  items?: readonly unknown[];
}

/**
 * - remaining: selected pages that are not done yet (new, stopped or failed): the default for Start / Continue
 * - failed: selected pages whose last attempt failed
 * - selected: every selected page, done or not (a deliberate re-run)
 * - rest: every page that is not done, selected or not
 * - all: every page (a deliberate full re-run)
 */
export type RunScope = 'remaining' | 'failed' | 'selected' | 'rest' | 'all';

export interface RunSummary {
  total: number;
  selected: number;
  done: number;
  failed: number;
  selectedDone: number;
  selectedRemaining: number;
  selectedFailed: number;
  /** Not selected and not done: pages a teacher may have left out on purpose. */
  unselectedRemaining: number;
}

export function summarizeRun(pages: readonly RunPage[]): RunSummary {
  const summary: RunSummary = {
    total: pages.length, selected: 0, done: 0, failed: 0,
    selectedDone: 0, selectedRemaining: 0, selectedFailed: 0, unselectedRemaining: 0,
  };
  for (const page of pages) {
    const done = page.status === 'ready';
    if (done) summary.done++;
    if (page.status === 'error') summary.failed++;
    if (page.isSelected) {
      summary.selected++;
      if (done) summary.selectedDone++;
      else summary.selectedRemaining++;
      if (page.status === 'error') summary.selectedFailed++;
    } else if (!done) {
      summary.unselectedRemaining++;
    }
  }
  return summary;
}

export function pagesForScope<T extends RunPage>(pages: readonly T[], scope: RunScope): T[] {
  switch (scope) {
    case 'remaining': return pages.filter(page => page.isSelected && page.status !== 'ready');
    case 'failed': return pages.filter(page => page.isSelected && page.status === 'error');
    case 'selected': return pages.filter(page => page.isSelected);
    case 'rest': return pages.filter(page => page.status !== 'ready');
    case 'all': return [...pages];
  }
}

/** How much finished work a run would replace: pages that are done, and the questions they hold. */
export function replacedByRun(pages: readonly RunPage[]): { pages: number; questions: number } {
  const done = pages.filter(page => page.status === 'ready');
  return { pages: done.length, questions: done.reduce((sum, page) => sum + (page.items?.length ?? 0), 0) };
}

export type PrimaryKind = 'start' | 'continue' | 'retry' | 'rest' | 'done' | 'select' | 'empty';

export interface PrimaryRun {
  kind: PrimaryKind;
  /** The scope the button runs; null when the button cannot run anything. */
  scope: RunScope | null;
  /** Pages the click would process. */
  count: number;
  label: string;
  hint: string;
}

const pagesText = (count: number) => `${count} page${count === 1 ? '' : 's'}`;

/** What the main button should say and do for the current state of the page queue. */
export function primaryRun(summary: RunSummary): PrimaryRun {
  const { total, selected, done, failed, selectedRemaining, selectedFailed, unselectedRemaining } = summary;
  if (total === 0) return { kind: 'empty', scope: null, count: 0, label: 'Start extraction', hint: 'Add pages first.' };

  if (selectedRemaining > 0) {
    if (done === 0 && failed === 0) {
      return { kind: 'start', scope: 'remaining', count: selectedRemaining, label: 'Start extraction',
        hint: `Extract ${pagesText(selectedRemaining)}.` };
    }
    if (selectedFailed === selectedRemaining) {
      return { kind: 'retry', scope: 'failed', count: selectedFailed, label: 'Retry failed',
        hint: `Try the ${pagesText(selectedFailed)} that failed again. Finished pages are left as they are.` };
    }
    return { kind: 'continue', scope: 'remaining', count: selectedRemaining, label: 'Continue',
      hint: `Extract the ${pagesText(selectedRemaining)} not done yet${selectedFailed ? ` (${selectedFailed} failed earlier)` : ''}. ${pagesText(done)} already finished are left as they are.` };
  }
  if (unselectedRemaining > 0) {
    return { kind: 'rest', scope: 'rest', count: unselectedRemaining, label: 'Extract unselected pages',
      hint: `Every selected page is done. This also extracts the ${pagesText(unselectedRemaining)} you did not select.` };
  }
  if (selected === 0) {
    return { kind: 'select', scope: null, count: 0, label: 'Select pages', hint: 'Tick at least one page to extract.' };
  }
  return { kind: 'done', scope: null, count: 0, label: 'All pages done',
    hint: 'Every page is extracted. Use the arrow to re-run selected or all pages.' };
}
