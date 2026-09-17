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
} from 'lucide-react';

interface ToolsPageProps {
  onStartTextConverter: () => void;
  onStartMcqExtractor: () => void;
  onStartQaStitcher: () => void;
  onBack: () => void;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: 'easeOut' as const } },
};

const TOOLS = [
  {
    id: 'text-converter',
    icon: <FileText className="w-7 h-7" />,
    accent: '#FF6B2B',
    accentSoft: 'from-[#FF6B2B]/20 to-[#FF884D]/5',
    border: 'hover:border-[#FF6B2B]/60',
    glow: 'group-hover:shadow-[#FF6B2B]/20',
    badge: 'DOCX / Word',
    title: 'Document / Text Extractor',
    desc: 'Extract PDFs, books & question papers into clean, perfectly formatted editable Word (.docx) documents.',
    tags: [
      { icon: <Calculator className="w-3 h-3" />, label: 'Native Math (OMML)' },
      { icon: <TableIcon className="w-3 h-3" />, label: 'Full Tables' },
      { icon: <Languages className="w-3 h-3" />, label: 'Bilingual' },
    ],
    action: 'onStartTextConverter' as const,
  },
  {
    id: 'mcq-extractor',
    icon: <Zap className="w-7 h-7" />,
    accent: '#F59E0B',
    accentSoft: 'from-amber-500/20 to-orange-500/5',
    border: 'hover:border-amber-400/60',
    glow: 'group-hover:shadow-amber-500/20',
    badge: '18-Col CSV',
    title: 'MockTest MCQ Extractor',
    desc: 'Digitize bilingual MCQs page-by-page with LaTeX math, deep AI solutions and ready-to-use 18-column CSV export.',
    tags: [
      { icon: <ListChecks className="w-3 h-3" />, label: 'Auto Answer Key' },
      { icon: <Languages className="w-3 h-3" />, label: 'Hindi + English' },
      { icon: <Zap className="w-3 h-3" />, label: 'Step-by-step AI' },
    ],
    action: 'onStartMcqExtractor' as const,
  },
  {
    id: 'qa-stitcher',
    icon: <Split className="w-7 h-7" />,
    accent: '#3B82F6',
    accentSoft: 'from-blue-600/20 to-indigo-600/5',
    border: 'hover:border-blue-400/60',
    glow: 'group-hover:shadow-blue-500/20',
    badge: '1-Page Merge',
    title: 'Q&A Page Stitcher',
    desc: 'Crop and freely arrange separate question & solution pages onto one unified page with drag-and-drop.',
    tags: [
      { icon: <Crop className="w-3 h-3" />, label: 'Smart Crop' },
      { icon: <LayoutGrid className="w-3 h-3" />, label: 'Drag & Drop' },
      { icon: <FileText className="w-3 h-3" />, label: 'Send to any tool' },
    ],
    action: 'onStartQaStitcher' as const,
  },
];

const ToolsPage: React.FC<ToolsPageProps> = ({
  onStartTextConverter,
  onStartMcqExtractor,
  onStartQaStitcher,
  onBack,
}) => {
  const actions = { onStartTextConverter, onStartMcqExtractor, onStartQaStitcher };

  return (
    <div className="min-h-screen bg-[#0B0D13] text-slate-100 overflow-hidden relative selection:bg-[#FF6B2B]/30">
      {/* Ambient animated glows */}
      <motion.div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-5xl h-[480px] bg-gradient-to-b from-[#FF6B2B]/12 via-purple-600/8 to-transparent blur-[140px] pointer-events-none rounded-full"
        animate={{ opacity: [0.5, 0.9, 0.5] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-0 left-0 w-96 h-96 bg-blue-600/10 blur-[130px] pointer-events-none rounded-full"
        animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
        transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20 lg:pt-28 relative z-10">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.button
            variants={itemVariants}
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white mb-8 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Home
          </motion.button>

          <motion.div variants={itemVariants} className="text-center max-w-2xl mx-auto mb-14">
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.1] text-[#FF884D] text-xs uppercase tracking-wider font-bold mb-5">
              <LayoutGrid className="w-3.5 h-3.5" />
              All Tools
            </span>
            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight font-display text-white mb-4">
              Pick Your Tool
            </h1>
            <p className="text-sm sm:text-base text-slate-400">
              Three focused digitizers, one AI engine. Choose a tool below to get started.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {TOOLS.map((tool) => (
              <motion.button
                key={tool.id}
                type="button"
                variants={itemVariants}
                whileHover={{ y: -6 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => actions[tool.action]()}
                className={`group relative text-left p-6 rounded-3xl bg-white/[0.03] border border-white/[0.08] ${tool.border} transition-all shadow-xl ${tool.glow} overflow-hidden flex flex-col`}
              >
                {/* Animated background blob */}
                <motion.div
                  className={`absolute -top-10 -right-10 w-40 h-40 rounded-full bg-gradient-to-br ${tool.accentSoft} blur-2xl pointer-events-none`}
                  animate={{ scale: [1, 1.15, 1] }}
                  transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                />

                <div className="relative z-10 flex flex-col h-full">
                  <div className="flex items-center justify-between mb-5">
                    <motion.div
                      whileHover={{ rotate: 6, scale: 1.05 }}
                      className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg"
                      style={{
                        backgroundColor: `${tool.accent}22`,
                        color: tool.accent,
                        border: `1px solid ${tool.accent}44`,
                      }}
                    >
                      {tool.icon}
                    </motion.div>
                    <span
                      className="text-[10px] font-extrabold px-2.5 py-1 rounded-full"
                      style={{ backgroundColor: `${tool.accent}22`, color: tool.accent, border: `1px solid ${tool.accent}44` }}
                    >
                      {tool.badge}
                    </span>
                  </div>

                  <h3 className="text-xl font-bold text-white mb-2 font-display">{tool.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-5 flex-1">{tool.desc}</p>

                  <div className="flex flex-wrap gap-1.5 mb-6">
                    {tool.tags.map((tag, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[10px] font-semibold text-slate-300"
                      >
                        {tag.icon}
                        {tag.label}
                      </span>
                    ))}
                  </div>

                  <div
                    className="flex items-center gap-2 text-sm font-bold group-hover:translate-x-1 transition-transform"
                    style={{ color: tool.accent }}
                  >
                    <span>Launch Tool</span>
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        </motion.div>
      </main>
    </div>
  );
};

export default ToolsPage;
