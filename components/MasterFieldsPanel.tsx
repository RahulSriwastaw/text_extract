import React, { useMemo, useState } from 'react';
import type { MockTestMcqItem } from '../types';
import { buildMasterBankRows } from '../services/mocktestService';
import {
  EXAM_CATEGORIES, EXAM_EXAMPLES, SOURCE_STATUSES, masterGaps,
  type MasterContext, type MasterSource,
} from '../services/masterQuestionBank';

/**
 * Paper-level details of the Master Question Bank guide (exam, year, source ...). The teacher enters them once;
 * they apply to every question in the Master CSV. Chapter, sub-topic, difficulty and the rest come from the AI per question.
 */
export function MasterFieldsPanel({ items, context, onChange, sourceFor }: {
  items: MockTestMcqItem[]; context: MasterContext; onChange: (next: MasterContext) => void;
  sourceFor: (item: MockTestMcqItem) => MasterSource;
}) {
  const [open, setOpen] = useState(false);
  // Only worked out while the panel is open: every row is cleaned and checked, which is wasted work otherwise.
  const gaps = useMemo(() => open ? masterGaps(buildMasterBankRows(items, context, sourceFor)) : [], [open, items, context, sourceFor]);
  const set = (field: keyof MasterContext) => (value: string) => onChange({ ...context, [field]: value });
  return <details className="card" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="flex cursor-pointer select-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-5">
      <span className="font-semibold text-ink">Master bank details</span>
      <span className="text-ink-3">Exam, year and source for the Master CSV (68 fields)</span>
    </summary>
    <div className="space-y-3 px-4 pb-4 sm:px-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label><span className="field-label">Exam category</span>
          <select className="select" value={context.exam_category || ''} onChange={e => set('exam_category')(e.target.value)}>
            <option value="">Choose…</option>
            {EXAM_CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}
          </select></label>
        <label><span className="field-label">Exam</span>
          <input className="input" list="master-exam-examples" value={context.exam || ''} placeholder="SSC CGL"
            onChange={e => set('exam')(e.target.value)} />
          <datalist id="master-exam-examples">{EXAM_EXAMPLES.map(value => <option key={value} value={value} />)}</datalist></label>
        <label><span className="field-label">Year</span>
          <input className="input" inputMode="numeric" maxLength={4} value={context.year || ''} placeholder="2024"
            onChange={e => set('year')(e.target.value.replace(/\D/g, ''))} /></label>
        <label><span className="field-label">Source status</span>
          <select className="select" value={context.source_status || ''} onChange={e => set('source_status')(e.target.value)}>
            <option value="">Choose…</option>
            {SOURCE_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
          </select></label>
        <label><span className="field-label">Test date</span>
          <input className="input" type="date" value={context.test_date || ''} onChange={e => set('test_date')(e.target.value)} /></label>
        <label><span className="field-label">Test time</span>
          <input className="input" value={context.test_time || ''} placeholder="9:00 AM - 10:30 AM"
            onChange={e => set('test_time')(e.target.value)} /></label>
        <label className="col-span-2"><span className="field-label">Subject level</span>
          <input className="input" value={context.subject_level || ''} placeholder="Graduate Level (SSC CGL/CPO)"
            onChange={e => set('subject_level')(e.target.value)} /></label>
      </div>
      <p className="text-xs text-ink-3">
        These apply to every question. Leave a field empty if it is not known: it stays empty in the CSV, nothing is guessed.
        Year is also taken from the test date or the file name when you leave it empty.
      </p>
      {items.length > 0 && (gaps.length
        ? <p className="text-xs text-amber-300" role="status">
          Still empty in the Master CSV: {gaps.map(gap => `${gap.field} (${gap.missing}/${items.length})`).join(', ')}
        </p>
        : <p className="text-xs text-emerald-300" role="status">All required Master CSV fields are filled.</p>)}
    </div>
  </details>;
}
