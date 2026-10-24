import React from 'react';
import { motion } from 'motion/react';
import {
  FileText,
  Zap,
  Split,
  ArrowRight,
  ArrowLeft,
  Calculator,
  Table as TableIcon,
  Languages,
  ListChecks,
  Crop,
  LayoutGrid,
  FileSpreadsheet,
} from 'lucide-react';

interface ToolsPageProps {
  onStartTextConverter: () => void;
  onStartMcqExtractor: () => void;
  onStartQaStitcher: () => void;
  onBack: () => void;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

type ToolCard = {
  id: string;
  icon: React.ReactNode;
  badge: string;
  title: string;
  desc: string;
  tags: { icon: React.ReactNode; label: string }[];
} & ({ action: 'onStartTextConverter' | 'onStartMcqExtractor' | 'onStartQaStitcher'; href?: never } | { href: string; action?: never });

const TOOLS: ToolCard[] = [
  {
    id: 'mcq-extractor',
    icon: <Zap />,
    badge: '34-col CSV',
    title: 'MCQ extractor',
    desc: 'Digitize bilingual MCQs page by page with LaTeX math, AI solutions and a ready-to-upload CSV.',
    tags: [
      { icon: <ListChecks />, label: 'Auto answer key' },
      { icon: <Languages />, label: 'Hindi + English' },
      { icon: <Zap />, label: 'Step-by-step AI' },
    ],
    action: 'onStartMcqExtractor',
  },
  {
    id: 'text-converter',
    icon: <FileText />,
    badge: 'DOCX / Word',
    title: 'Document / text extractor',
    desc: 'Turn PDFs, books and question papers into clean, editable Word (.docx) documents.',
    tags: [
      { icon: <Calculator />, label: 'Native math (OMML)' },
      { icon: <TableIcon />, label: 'Full tables' },
      { icon: <Languages />, label: 'Bilingual' },
    ],
    action: 'onStartTextConverter',
  },
  {
    id: 'qa-stitcher',
    icon: <Split />,
    badge: 'Merge & N-up',
    title: 'Q&A page stitcher',
    desc: 'Crop and merge Q&A pages, or re-layout PDFs with several pages per sheet, margins and borders.',
    tags: [
      { icon: <Crop />, label: 'Smart crop' },
      { icon: <LayoutGrid />, label: 'N-up pages' },
      { icon: <FileText />, label: 'Borders & margins' },
    ],
    action: 'onStartQaStitcher',
  },
  {
    id: 'csv-converter',
    icon: <FileSpreadsheet />,
    badge: '34-col CSV',
    title: 'Universal CSV converter',
    desc: 'Map ALP and GK question banks, keep bilingual passages and images, validate and export with a source audit.',
    tags: [
      { icon: <TableIcon />, label: 'Column mapping' },
      { icon: <ListChecks />, label: 'Validation' },
    ],
    href: '/csv-converter',
  },
];

const ToolsPage: React.FC<ToolsPageProps> = ({
  onStartTextConverter,
  onStartMcqExtractor,
  onStartQaStitcher,
  onBack,
}) => {
  const actions = { onStartTextConverter, onStartMcqExtractor, onStartQaStitcher };

  const cardBody = (tool: ToolCard) => (
    <>
      <div className="flex items-start justify-between gap-3 mb-4">
        <span className="w-11 h-11 rounded-xl flex items-center justify-center bg-accent/10text-accent-light border border-accent/25 [&>svg]:w-5 [&>svg]:h-5">
          {tool.icon}
        </span>
        <span className="badge badge-neutral">{tool.badge}</span>
      </div>

      <h3 className="text-lg font-bold text-ink mb-1.5 font-display">{tool.title}</h3>
      <p className="text-sm text-ink-3 leading-relaxed mb-4 flex-1">{tool.desc}</p>

      <div className="flex flex-wrap gap-1.5 mb-5">
        {tool.tags.map((tag) => (
          <span key={tag.label} className="badge badge-neutral rounded-md">
            {tag.icon}
            {tag.label}
          </span>
        ))}
      </div>

      <span className="flex items-center gap-1.5 text-sm font-semibold text-accent-light">
        Open tool
        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </>
  );

  const cardClass = 'group card text-left p-5 flex flex-col h-full transition-colors hover:border-accent/45 hover:bg-surface-2';

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20">
        <motion.div variants={containerVariants} initial="hidden" animate="visible">
          <motion.button
            variants={itemVariants}
            type="button"
            onClick={onBack}
            className="btn btn-ghost btn-sm -ml-2 mb-6"
          >
            <ArrowLeft />
            Back to home
          </motion.button>

          <motion.div variants={itemVariants} className="mb-8">
            <p className="page-eyebrow mb-2">All tools</p>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight font-display text-ink mb-2">
              Pick a tool
            </h1>
            <p className="text-sm sm:text-base text-ink-3 max-w-xl">
              Digitize documents, extract questions and convert question banks.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {TOOLS.map((tool) => (
              <motion.div key={tool.id} variants={itemVariants}>
                {tool.href ? (
                  <a href={tool.href} className={cardClass}>
                    {cardBody(tool)}
                  </a>
                ) : (
                  <button type="button" onClick={() => actions[tool.action]()} className={`${cardClass} w-full`}>
                    {cardBody(tool)}
                  </button>
                )}
              </motion.div>
            ))}
          </div>
        </motion.div>
      </main>
    </div>
  );
};

export default ToolsPage;
