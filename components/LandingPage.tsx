import React from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Sparkles,
  Zap,
  Shield,
  Calculator,
  Table as TableIcon,
  Languages,
  FileText,
  Split,
  LayoutGrid,
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  Download,
  Check,
} from 'lucide-react';

type LaunchableTool = 'text-converter' | 'mcq-extractor' | 'qa-stitcher';

interface LandingPageProps {
  onExploreTools: () => void;
  onOpenTool?: (tool: LaunchableTool) => void;
}

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' as const } },
};

const stagger = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const TRUST = ['Hindi + English', 'LaTeX math', 'Word & CSV export', 'Your own AI key'];

const TOOLS: { id: LaunchableTool | 'csv'; icon: React.ReactNode; title: string; desc: string; output: string }[] = [
  {
    id: 'mcq-extractor',
    icon: <Zap />,
    title: 'MCQ extractor',
    desc: 'Page-by-page bilingual MCQs with answers, solutions and LaTeX math.',
    output: '34-column CSV · DOCX',
  },
  {
    id: 'text-converter',
    icon: <FileText />,
    title: 'Document to Word',
    desc: 'Scanned PDFs, books and papers into clean, editable Word files.',
    output: 'DOCX · Markdown',
  },
  {
    id: 'qa-stitcher',
    icon: <Split />,
    title: 'Page stitcher',
    desc: 'Crop and merge question and solution pages, or lay out several per sheet.',
    output: 'PDF',
  },
  {
    id: 'csv',
    icon: <FileSpreadsheet />,
    title: 'Universal CSV converter',
    desc: 'Map existing question banks to the 34-field template with validation.',
    output: 'CSV · audit report',
  },
];

const STEPS = [
  { icon: <Upload />, title: 'Upload', desc: 'Drop a PDF, Word file, images or pasted text.' },
  { icon: <Sparkles />, title: 'Extract', desc: 'AI reads every page: questions, options, tables and math.' },
  { icon: <CheckCircle2 />, title: 'Review', desc: 'Fix flagged fields side by side with the original page.' },
  { icon: <Download />, title: 'Export', desc: 'Download CSV for your test portal or an editable DOCX.' },
];

const FEATURES = [
  { icon: <Calculator />, title: 'Native Word math', desc: 'Fractions, roots and powers become editable Word equations (OMML), not images.' },
  { icon: <TableIcon />, title: 'Full tables', desc: 'Tables keep their rows, headers and borders, including match-the-following.' },
  { icon: <Languages />, title: 'Bilingual by design', desc: 'Hindi and English questions, options and solutions stay paired.' },
  { icon: <Sparkles />, title: 'Clean output', desc: 'Exam tags, shift dates and watermarks are removed automatically.' },
  { icon: <Zap />, title: 'Fast batches', desc: 'Process many pages in parallel with automatic key rotation.' },
  { icon: <Shield />, title: 'Private', desc: 'Files are processed with your own AI connection and exported locally.' },
];

/** Static miniature of the MCQ extractor's split view, used as the hero visual. */
const ProductPreview: React.FC = () => (
  <div className="card overflow-hidden shadow-[0_24px_64px_rgb(0_0_0/0.45)]" aria-hidden="true">
    {/* window bar */}
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line bg-surface-2">
      <span className="flex gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
        <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
        <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
      </span>
      <span className="ml-2 text-xs text-ink-3">MCQ extractor · RRB NTPC 2024.pdf</span>
      <span className="ml-auto badge badge-success h-5 text-[10.5px]">12 / 12 pages</span>
    </div>

    <div className="grid grid-cols-[38%_1fr]">
      {/* page thumbnail */}
      <div className="p-4 border-r border-line bg-canvas/60">
        <div className="rounded-md bg-white p-3 space-y-1.5">
          <div className="h-2 w-2/3 rounded bg-slate-800/80" />
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-1.5 rounded bg-slate-300" style={{ width: `${92 - ((i * 17) % 35)}%` }} />
          ))}
          <div className="h-8 rounded border border-slate-300 bg-slate-100 mt-2" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={`b${i}`} className="h-1.5 rounded bg-slate-300" style={{ width: `${85 - i * 9}%` }} />
          ))}
        </div>
        <div className="mt-3 flex gap-1.5">
          <span className="badge badge-success h-5 text-[10.5px]">8 MCQs</span>
          <span className="badge badge-neutral h-5 text-[10.5px]">Page 3</span>
        </div>
      </div>

      {/* extracted question */}
      <div className="p-4 space-y-3 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-ink">Q17</span>
          <span className="badge badge-neutral h-5 text-[10.5px]">Mathematics</span>
          <span className="badge badge-neutral h-5 text-[10.5px] hidden sm:inline-flex">Medium</span>
          <span className="ml-auto text-[11px] font-semibold text-emerald-300">Ans A</span>
        </div>
        <p className="text-[13px] leading-relaxed text-ink">
          यदि <span className="font-serif italic">x² + 5x + 6 = 0</span>, तो <span className="font-serif italic">x</span> के मानों का योग क्या है?
        </p>
        <div className="space-y-1.5">
          {['−5', '5', '6', '−6'].map((opt, i) => (
            <div
              key={opt}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                i === 0 ? 'border-emerald-500/45 bg-emerald-500/10 text-emerald-100' : 'border-line text-ink-2'
              }`}
            >
              <span className={`w-5 h-5 rounded flex items-center justify-center text-[10.5px] font-bold ${i === 0 ? 'bg-emerald-500 text-black' : 'bg-white/[0.06] text-ink-3'}`}>
                {'ABCD'[i]}
              </span>
              {opt}
              {i === 0 && <Check className="w-3.5 h-3.5 ml-auto text-emerald-400" />}
            </div>
          ))}
        </div>
        <div className="rounded-md border border-line bg-white/[0.025] px-2.5 py-2 text-[11.5px] text-ink-2">
          <span className="field-label mb-0.5 text-[10px]">Solution</span>
          मूलों का योग = −b/a = −5
        </div>
      </div>
    </div>
  </div>
);

const LandingPage: React.FC<LandingPageProps> = ({ onExploreTools, onOpenTool }) => {
  const openTool = (id: LaunchableTool) => (onOpenTool ? onOpenTool(id) : onExploreTools());

  return (
    <div className="min-h-screen bg-canvas text-ink relative overflow-hidden">
      {/* single soft glow behind the hero */}
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[1100px] h-[560px] rounded-full bg-accent/[0.07] blur-[120px] pointer-events-none" />

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="app-container relative pt-28 pb-16 lg:pt-36 lg:pb-24">
        <div className="grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-14 items-center">
          <motion.div variants={stagger} initial="hidden" animate="visible">
            <motion.p variants={fadeUp} className="badge badge-accent h-7 px-3 mb-6">
              <Sparkles />
              AI digitizer for exam papers
            </motion.p>

            <motion.h1
              variants={fadeUp}
              className="font-display text-4xl sm:text-5xl xl:text-6xl font-bold tracking-tight leading-[1.08] text-ink mb-5"
            >
              Exam papers to clean, <span className="text-accent-light">editable</span> files
            </motion.h1>

            <motion.p variants={fadeUp} className="text-base sm:text-lg text-ink-2 leading-relaxed max-w-xl mb-8">
              Turn scanned PDFs and question papers into bilingual MCQ sets, Word documents with real math, and
              ready-to-upload CSVs. Review everything side by side before you export.
            </motion.p>

            <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-3 mb-8">
              <button type="button" onClick={() => openTool('mcq-extractor')} className="btn btn-primary btn-lg">
                Start with MCQ extractor
                <ArrowRight />
              </button>
              <button type="button" onClick={onExploreTools} className="btn btn-secondary btn-lg">
                <LayoutGrid />
                All tools
              </button>
            </motion.div>

            <motion.ul variants={fadeUp} className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-3">
              {TRUST.map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-400" />
                  {t}
                </li>
              ))}
            </motion.ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
          >
            <ProductPreview />
          </motion.div>
        </div>
      </section>

      {/* ── Tools ────────────────────────────────────────── */}
      <section className="border-t border-line bg-surface/40">
        <div className="app-container py-16 lg:py-20">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
            <div>
              <p className="page-eyebrow mb-2">Tools</p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">Four tools, one workflow</h2>
              <p className="text-ink-3 mt-2 max-w-lg">From a raw PDF to a test-ready question bank without leaving the browser.</p>
            </div>
            <button type="button" onClick={onExploreTools} className="btn btn-ghost">
              View all tools
              <ArrowRight />
            </button>
          </div>

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-60px' }}
            className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4"
          >
            {TOOLS.map((tool) => {
              const body = (
                <>
                  <span className="w-10 h-10 rounded-lg flex items-center justify-center bg-accent/10 border border-accent/25 text-accent-light mb-4 [&>svg]:w-5 [&>svg]:h-5">
                    {tool.icon}
                  </span>
                  <h3 className="font-display text-base font-bold text-ink mb-1.5">{tool.title}</h3>
                  <p className="text-sm text-ink-3 leading-relaxed flex-1">{tool.desc}</p>
                  <div className="mt-4 pt-3 border-t border-line flex items-center justify-between gap-2">
                    <span className="text-xs text-ink-3">{tool.output}</span>
                    <ArrowRight className="w-4 h-4 text-ink-3 transition-all group-hover:text-accent-light group-hover:translate-x-0.5" />
                  </div>
                </>
              );
              const cls = 'group card p-5 h-full w-full text-left flex flex-col transition-colors hover:border-accent/45 hover:bg-surface-2';
              return (
                <motion.div key={tool.id} variants={fadeUp}>
                  {tool.id === 'csv' ? (
                    <a href="/csv-converter" className={cls}>{body}</a>
                  ) : (
                    <button type="button" onClick={() => openTool(tool.id as LaunchableTool)} className={cls}>{body}</button>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────── */}
      <section className="border-t border-line">
        <div className="app-container py-16 lg:py-20">
          <div className="max-w-2xl mb-10">
            <p className="page-eyebrow mb-2">How it works</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">From upload to export in four steps</h2>
          </div>
          <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="relative panel p-5">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-9 h-9 rounded-full flex items-center justify-center bg-surface-3 border border-line-strong text-ink [&>svg]:w-4 [&>svg]:h-4">
                    {step.icon}
                  </span>
                  <span className="text-xs font-semibold text-ink-3 tabular-nums">Step {i + 1}</span>
                </div>
                <h3 className="font-semibold text-ink mb-1">{step.title}</h3>
                <p className="text-sm text-ink-3 leading-relaxed">{step.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────── */}
      <section className="border-t border-line bg-surface/40">
        <div className="app-container py-16 lg:py-20">
          <div className="max-w-2xl mb-10">
            <p className="page-eyebrow mb-2">Why TextExtract</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">Built for exams, formulas and bilingual books</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-8">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-4">
                <span className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center bg-white/[0.04] border border-line text-ink-2 [&>svg]:w-[18px] [&>svg]:h-[18px]">
                  {f.icon}
                </span>
                <div>
                  <h3 className="font-semibold text-ink mb-1">{f.title}</h3>
                  <p className="text-sm text-ink-3 leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────── */}
      <section className="border-t border-line">
        <div className="app-container py-16">
          <div className="card px-6 py-10 sm:px-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight">Digitize your next paper</h2>
              <p className="text-ink-3 mt-1.5">Upload a PDF and get your first questions back in under a minute.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={onExploreTools} className="btn btn-secondary btn-lg">
                All tools
              </button>
              <button type="button" onClick={() => openTool('mcq-extractor')} className="btn btn-primary btn-lg">
                Open MCQ extractor
                <ArrowRight />
              </button>
            </div>
          </div>
        </div>
        <footer className="app-container py-6 border-t border-line flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
          <span>
            Text<span className="text-accent">Extract</span> PRO
          </span>
          <span>PDF, Word and images to editable DOCX and CSV</span>
        </footer>
      </section>
    </div>
  );
};

export default LandingPage;
