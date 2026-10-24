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
} from 'lucide-react';

interface LandingPageProps {
  onExploreTools: () => void;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.15,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
    },
  },
};

const FLOATING_ICONS = [
  { icon: <FileText className="w-4 h-4" />, color: '#FF6B2B', top: '12%', left: '8%', delay: 0 },
  { icon: <Zap className="w-4 h-4" />, color: '#F59E0B', top: '18%', left: '88%', delay: 0.6 },
  { icon: <Split className="w-4 h-4" />, color: '#3B82F6', top: '72%', left: '6%', delay: 1.2 },
  { icon: <Calculator className="w-4 h-4" />, color: '#10B981', top: '78%', left: '90%', delay: 1.8 },
];

const STATS = [
  { value: '3', label: 'Focused Tools' },
  { value: '0', label: 'Tokens Wasted' },
  { value: '100%', label: 'Client Privacy' },
];

const features = [
  {
    icon: <Calculator className="w-5 h-5 text-amber-400" />,
    title: 'Real Word Math (OMML)',
    desc: 'Converts complex LaTeX fractions, radicals, powers, and equations into native editable Word math objects.',
  },
  {
    icon: <TableIcon className="w-5 h-5 text-blue-400" />,
    title: 'Full Table Extraction',
    desc: 'Extracts tables of any size with borders, clean rows, and headers directly into Microsoft Word tables.',
  },
  {
    icon: <Languages className="w-5 h-5 text-emerald-400" />,
    title: 'Bilingual Translation',
    desc: 'Translates Hindi & English question papers with separate lines for questions and single-line options.',
  },
  {
    icon: <Sparkles className="w-5 h-5 text-ink-3" />,
    title: 'Smart Refine Mode',
    desc: 'Automatically removes unwanted previous year exam tags, shift dates, and watermarks to keep content pure.',
  },
  {
    icon: <Zap className="w-5 h-5 text-orange-400" />,
    title: 'Batch High-Speed OCR',
    desc: 'Parallel processing with intelligent auto key-rotation for high-volume exam and book digitization.',
  },
  {
    icon: <Shield className="w-5 h-5 text-rose-400" />,
    title: '100% Client Privacy',
    desc: 'Enterprise-grade processing with instant local exports in DOCX and clean Markdown formats.',
  },
];

const LandingPage: React.FC<LandingPageProps> = ({ onExploreTools }) => {
  return (
    <div className="min-h-screen bg-canvas text-slate-100 overflow-hidden relative selection:bg-accent/30">
      {/* Dynamic Ambient Background Glows */}
      <motion.div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-5xl h-[520px] bg-accent/10 blur-[140px] pointer-events-none rounded-full"
        animate={{ opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-10 right-10 w-96 h-96 bg-blue-600/10 blur-[130px] pointer-events-none rounded-full"
        animate={{ x: [0, 25, 0], y: [0, -15, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-1/3 left-10 w-80 h-80 bg-emerald-600/10 blur-[120px] pointer-events-none rounded-full"
        animate={{ x: [0, -20, 0], y: [0, 20, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Faint grid texture */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.025]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Floating decorative icons (hidden on small screens to avoid clutter) */}
      <div className="hidden md:block">
        {FLOATING_ICONS.map((f, i) => (
          <motion.div
            key={i}
            className="absolute w-10 h-10 rounded-xl flex items-center justify-center backdrop-blur-sm border pointer-events-none"
            style={{
              top: f.top,
              left: f.left,
              backgroundColor: `${f.color}15`,
              borderColor: `${f.color}30`,
              color: f.color,
            }}
            animate={{ y: [0, -14, 0], rotate: [0, 6, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: f.delay }}
          >
            {f.icon}
          </motion.div>
        ))}
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20 lg:pt-32 relative z-10">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="text-center max-w-4xl mx-auto"
        >
          {/* Badge */}
          <motion.div
            variants={itemVariants}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.1] text-accent-light text-xs uppercase tracking-wider font-bold mb-8 shadow-inner"
          >
            <motion.span
              animate={{ rotate: [0, 15, 0, -15, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Sparkles className="w-3.5 h-3.5 text-accent" />
            </motion.span>
            <span>Universal AI Document & Exam Digitizer</span>
          </motion.div>

          {/* Heading */}
          <motion.h1
            variants={itemVariants}
            className="text-4xl sm:text-6xl lg:text-7xl font-semibold tracking-tight mb-6 font-display text-white leading-tight"
          >
            Convert PDFs & Exams to{' '}
            <motion.span
              className="text-accent-light"
              animate={{ backgroundPosition: ['0% center', '200% center'] }}
              transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
            >
              Editable Word
            </motion.span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            variants={itemVariants}
            className="text-base sm:text-lg lg:text-xl text-slate-400 mb-8 max-w-2xl mx-auto leading-relaxed"
          >
            Extract multiple-choice questions, complex math equations, full tables, and bilingual exam papers into perfectly formatted <strong className="text-white">.docx</strong> files in seconds.
          </motion.p>

          {/* Stats row */}
          <motion.div variants={itemVariants} className="flex items-center justify-center gap-6 sm:gap-10 mb-10">
            {STATS.map((s, i) => (
              <div key={i} className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-white font-display">{s.value}</div>
                <div className="text-[11px] sm:text-xs text-slate-500 uppercase tracking-wider font-semibold">{s.label}</div>
              </div>
            ))}
          </motion.div>

          {/* Primary CTA -> Tools hub */}
          <motion.div variants={itemVariants} className="mb-20">
            <motion.button
              type="button"
              onClick={onExploreTools}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="inline-flex items-center gap-2.5 px-7 py-3.5 rounded-2xl bg-accent text-on-accent font-bold text-sm sm:text-base shadow-xl hover:shadow-2xl transition-shadow"
            >
              <LayoutGrid className="w-5 h-5" />
              Explore All Tools
              <ArrowRight className="w-4 h-4" />
            </motion.button>
            <p className="text-[11px] text-slate-500 mt-3">3 focused tools · Zero setup · Start in seconds</p>
          </motion.div>

          {/* Feature Grid */}
          <motion.div
            variants={containerVariants}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6 text-left"
          >
            {features.map((feat, idx) => (
              <motion.div
                key={idx}
                variants={itemVariants}
                whileHover={{ y: -4 }}
                className="p-5 sm:p-6 rounded-2xl glass-panel glass-panel-hover"
              >
                <div className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center mb-4">
                  {feat.icon}
                </div>
                <h3 className="text-base font-bold text-white mb-2 font-display">{feat.title}</h3>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">{feat.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
};

export default LandingPage;
