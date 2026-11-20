import { storageTarget } from './storageTarget.js';
import { randomInt } from 'node:crypto';
import { driveToken } from './driveFigures.js';
import { MOCKTEST_CSV_HEADERS } from '../services/mcqColumns.js';

const headers = ['storage_id', 'user_id', 'id', ...MOCKTEST_CSV_HEADERS, 'question_type', 'passage_hi', 'passage_en', 'pageNumber', 'pageId', 'figures'];
const limit = 10_000_000;
const title = 'Questions';
type Grid = { sheetId: number; title: string; gridProperties?: { rowCount: number; columnCount: number } };
type Row = { values: { userEnteredValue: { stringValue: string } }[] };
let queue = Promise.resolve();

async function save(uid: string, questions: Record<string, unknown>[], setName: string) {
  const { id, resourceKey } = storageTarget('sheet');
  const token = await driveToken();
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id);
  async function sheets(path: string, body?: unknown) {
    const r = await fetch(base + path, { method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, ...(resourceKey ? { 'X-Goog-Drive-Resource-Keys': id + '/' + resourceKey } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || 'Sheets request failed.');
    return data;
  }
  const meta = await sheets('?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))');
  const grids: Grid[] = meta.sheets.map((s: {properties: Grid}) => s.properties);
  const grid = grids.find(g => g.title === title);
  const allocated = grids.reduce((n,g) => n + (g.gridProperties?.rowCount || 0) * (g.gridProperties?.columnCount || 0), 0);
  const oldRows = grid?.gridProperties?.rowCount || 0;
  const oldCols = grid?.gridProperties?.columnCount || 0;
  const keys = new Map<string, number>();
  if (grid) {
    const existing = await sheets('/values:batchGet?ranges=Questions!1:1&ranges=Questions!A:A');
    const first = existing.valueRanges[0].values?.[0];
    if (JSON.stringify(first) !== JSON.stringify(headers)) throw new Error('Questions tab has a different header. Choose a workbook without a Questions tab or use the existing question bank.');
    (existing.valueRanges[1].values || []).forEach((r: string[], i: number) => { if (i && r[0]) keys.set(r[0], i); });
  }
  let next = 1;
  for (const index of keys.values()) next = Math.max(next, index + 1);
  const changes = new Map<number, Row>();
  const row = (v: string[]): Row => ({ values: v.map(stringValue => ({ userEnteredValue: { stringValue } })) });
  if (!grid) changes.set(0, row(headers));
  for (const q of questions) {
    if (typeof q?.id !== 'string' || !q.id) throw new Error('Question ID missing.');
    const key = JSON.stringify([uid,q.id]);
    const index = keys.get(key) ?? next++;
    keys.set(key,index);
    const record: Record<string, unknown> = { ...q, set_name: setName || q.set_name, storage_id: key, user_id: uid };
    const values = headers.map(h => typeof record[h] === 'object' && record[h] !== null ? JSON.stringify(record[h]) : String(record[h] ?? ''));
    if (values.some(v => v.length > 50000)) throw new Error('Question ' + q.question_r + ' exceeds the Sheets cell size. Upload embedded images to Drive first.');
    changes.set(index,row(values));
  }
  const rows = Math.max(next, oldRows), cols = Math.max(headers.length, oldCols);
  const cells = allocated - oldRows * oldCols + rows * cols;
  if (cells > limit) {
    console.warn('[question-sheet] Save would exceed workbook capacity', {allocated,cells,limit});
    throw new Error('This batch exceeds the workbook capacity. Configure a new sheet link and retry. No questions from this batch were written.');
  }
  const sheetId = grid?.sheetId ?? randomInt(1, 2147483647);
  const requests: unknown[] = [];
  if (!grid) requests.push({ addSheet: { properties: { sheetId, title, gridProperties: { rowCount: rows, columnCount: cols, frozenRowCount: 1 } } } });
  else if (rows > oldRows) requests.push({ appendDimension: {sheetId, dimension:'ROWS', length:rows-oldRows} });
  let group: Row[] = [], previous = -2;
  for (const [index, data] of [...changes].sort(([a],[b]) => a-b)) {
    if (index !== previous + 1) {
      group = [];
      requests.push({ updateCells: { start: {sheetId,rowIndex:index,columnIndex:0}, rows:group, fields:'userEnteredValue' } });
    }
    group.push(data);
    previous = index;
  }
  await sheets(':batchUpdate', {requests});
  const warning = cells >= limit * 0.95;
  if (warning) console.warn('[question-sheet] Workbook at or above 95% capacity', {cells,limit});
  return { saved: questions.length, cells, limit, percent: cells * 100 / limit, warning };
}

// Serialize read/allocate/write across all users of this backend process.
export function saveQuestions(uid: string, questions: Record<string, unknown>[], setName: string) {
  if (!Array.isArray(questions) || !questions.length) throw new Error('No questions to save.');
  const operation = queue.then(() => save(uid,questions,setName));
  queue = operation.then(() => {}, () => {});
  return operation;
}
