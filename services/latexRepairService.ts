import katex from 'katex';
import { LatexRepairRequest, LatexRepairResponse, MockTestMcqItem } from '../types';
import { getAiSettings } from './aiDbService';

// In-memory undo history map for item backups (stores previous versions of items before repair)
const itemBackups = new Map<string, MockTestMcqItem[]>();

/**
 * Saves a backup snapshot of an item before applying a repair.
 */
export function saveItemBackup(item: MockTestMcqItem): void {
  if (!item || !item.id) return;
  const history = itemBackups.get(item.id) || [];
  history.push(JSON.parse(JSON.stringify(item)));
  // Limit history depth to 10 per item
  if (history.length > 10) history.shift();
  itemBackups.set(item.id, history);
}

/**
 * Checks if an item has a backup that can be undone.
 */
export function canUndoItem(itemId: string): boolean {
  const history = itemBackups.get(itemId);
  return !!(history && history.length > 0);
}

/**
 * Restores and returns the last saved snapshot for an item.
 */
export function restoreItemBackup(itemId: string): MockTestMcqItem | null {
  const history = itemBackups.get(itemId);
  if (!history || history.length === 0) return null;
  const previous = history.pop();
  if (history.length === 0) itemBackups.delete(itemId);
  return previous || null;
}

/**
 * Clears backup history for an item.
 */
export function clearItemBackup(itemId: string): void {
  itemBackups.delete(itemId);
}

/**
 * Validates formulas or mixed question/solution content on the client using KaTeX.
 * Handles:
 * 1. Pure single formulas (e.g. `\frac{a}{b}`, `$x^2$`, `$$E=mc^2$$`)
 * 2. Mixed text with embedded LaTeX formulas (e.g. English/Hindi explanations with `$v$` and `$$t = ...$$`)
 * Returns { valid: true } or { valid: false, error: string }.
 */
export function validateFormulaClient(formula: string): { valid: boolean; error?: string } {
  const trimmed = formula.trim();
  if (!trimmed) return { valid: true };

  // Case 1: Pure single formula (e.g. user typed directly \frac{a}{b} or single $...$)
  const isPureSingle = (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length >= 4) ||
                       (trimmed.startsWith('$') && trimmed.endsWith('$') && trimmed.length >= 2 && !trimmed.slice(1, -1).includes('$')) ||
                       (!trimmed.includes('\n') && !trimmed.includes(' ') && trimmed.startsWith('\\'));

  if (isPureSingle) {
    let inner = trimmed;
    let isDisplay = false;
    if (inner.startsWith('$$') && inner.endsWith('$$')) {
      inner = inner.slice(2, -2).trim();
      isDisplay = true;
    } else if (inner.startsWith('$') && inner.endsWith('$')) {
      inner = inner.slice(1, -1).trim();
    }
    try {
      katex.renderToString(inner, {
        throwOnError: true,
        displayMode: isDisplay,
        strict: false
      });
      return { valid: true };
    } catch (err: any) {
      return {
        valid: false,
        error: err?.message || 'KaTeX parse error'
      };
    }
  }

  // Case 2: Mixed text containing embedded formulas ($...$ or $$...$$)
  // Check for unclosed display delimiters $$
  const displayMatches = trimmed.match(/\$\$/g) || [];
  if (displayMatches.length % 2 !== 0) {
    return {
      valid: false,
      error: 'Unclosed display math delimiter ($$) detected.'
    };
  }

  // Check for unclosed single dollar delimiters (excluding display $$)
  const textWithoutDisplay = trimmed.replace(/\$\$[\s\S]*?\$\$/g, '');
  const singleDollarMatches = textWithoutDisplay.match(/(?<!\\)\$/g) || [];
  if (singleDollarMatches.length % 2 !== 0) {
    return {
      valid: false,
      error: 'Unclosed inline math delimiter ($) detected.'
    };
  }

  // Validate every display math block $$...$$
  const displayBlocks = trimmed.match(/\$\$[\s\S]*?\$\$/g) || [];
  for (const block of displayBlocks) {
    const formulaInner = block.slice(2, -2).trim();
    try {
      katex.renderToString(formulaInner, {
        throwOnError: true,
        displayMode: true,
        strict: false
      });
    } catch (err: any) {
      const snippet = formulaInner.length > 30 ? formulaInner.slice(0, 30) + '...' : formulaInner;
      return {
        valid: false,
        error: `KaTeX error in $$${snippet}$$: ${err?.message || 'Syntax error'}`
      };
    }
  }

  // Validate every inline math block $...$
  const inlineBlocks = textWithoutDisplay.match(/\$[^\$\n]+?\$/g) || [];
  for (const block of inlineBlocks) {
    const formulaInner = block.slice(1, -1).trim();
    try {
      katex.renderToString(formulaInner, {
        throwOnError: true,
        displayMode: false,
        strict: false
      });
    } catch (err: any) {
      const snippet = formulaInner.length > 30 ? formulaInner.slice(0, 30) + '...' : formulaInner;
      return {
        valid: false,
        error: `KaTeX error in $${snippet}$: ${err?.message || 'Syntax error'}`
      };
    }
  }

  return { valid: true };
}

/**
 * Calls backend POST /api/latex/repair with rate-limiting & error handling.
 */
export async function repairLatexViaApi(request: LatexRepairRequest): Promise<LatexRepairResponse> {
  const settings = await getAiSettings();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (settings.apiKey) {
    headers['x-user-gemini-key'] = settings.apiKey.trim();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s safety timeout

  try {
    const res = await fetch('/api/latex/repair', {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData.error || `Server responded with status ${res.status}`;
      throw new Error(msg);
    }

    const data: LatexRepairResponse = await res.json();
    return data;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      throw new Error('LaTeX repair request timed out after 45 seconds. Please try again.');
    }
    throw err;
  }
}
