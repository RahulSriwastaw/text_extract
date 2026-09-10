import React from 'react';
import { motion } from 'motion/react';
import { 
  FileText, 
  ArrowRight, 
  Sparkles, 
  Zap, 
  Shield, 
  Layers, 
  Calculator, 
  Table as TableIcon,
  Languages,
  CheckCircle2
} from 'lucide-react';

interface LandingPageProps {
  onStartTextConverter: () => void;
  onStartMcqExtractor: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ 
  onStartTextConverter, 
  onStartMcqExtractor 
}) => {
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
      } 
    },
  };

  const features = [
    {
      icon: <Calculator className="w-5 h-5 text-amber-400" />,
      title: "Real Word Math (OMML)",
      desc: "Converts complex LaTeX fractions, radicals, powers, and equations into native editable Word math objects.",
    },
    {
      icon: <TableIcon className="w-5 h-5 text-blue-400" />,
      title: "Full Table Extraction",
      desc: "Extracts tables of any size with borders, clean rows, and headers directly into Microsoft Word tables.",
    },
    {
      icon: <Languages className="w-5 h-5 text-emerald-400" />,
      title: "Bilingual Translation",
      desc: "Translates Hindi & English question papers with separate lines for questions and single-line options.",
    },
    {
      icon: <Sparkles className="w-5 h-5 text-purple-400" />,
      title: "Smart Refine Mode",
      desc: "Automatically removes unwanted previous year exam tags, shift dates, and watermarks to keep content pure.",
    },
    {
      icon: <Zap className="w-5 h-5 text-orange-400" />,
      title: "Batch High-Speed OCR",
      desc: "Parallel processing with intelligent auto key-rotation for high-volume exam and book digitization.",
    },
    {
      icon: <Shield className="w-5 h-5 text-rose-400" />,
      title: "100% Client Privacy",
      desc: "Enterprise-grade processing with instant local exports in DOCX and clean Markdown formats.",
    },
  ];

  return (
    <div className="min-h-screen bg-[#0B0D13] text-slate-100 overflow-hidden relative selection:bg-[#FF6B2B]/30">
      {/* Dynamic Ambient Background Glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-5xl h-[520px] bg-gradient-to-b from-[#FF6B2B]/15 via-purple-600/10 to-transparent blur-[140px] pointer-events-none rounded-full" />
      <div className="absolute bottom-10 right-10 w-96 h-96 bg-blue-600/10 blur-[130px] pointer-events-none rounded-full" />
      <div className="absolute top-1/3 left-10 w-80 h-80 bg-emerald-600/10 blur-[120px] pointer-events-none rounded-full" />

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
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.1] text-[#FF884D] text-xs uppercase tracking-wider font-bold mb-8 shadow-inner"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#FF6B2B]" />
            <span>Universal AI Document & Exam Digitizer</span>
          </motion.div>

          {/* Heading */}
          <motion.h1 
            variants={itemVariants}
            className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight mb-6 font-display text-white leading-tight"
          >
            Convert PDFs & Exams to{' '}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#FF6B2B] via-[#FFA477] to-amber-300">
              Editable Word
            </span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p 
            variants={itemVariants}
            className="text-base sm:text-lg lg:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed"
          >
            Extract multiple-choice questions, complex math equations, full tables, and bilingual exam papers into perfectly formatted <strong className="text-white">.docx</strong> files in seconds.
          </motion.p>

          {/* Two Dedicated Tool Launchers */}
          <motion.div 
            variants={itemVariants}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto mb-16"
          >
            {/* Tool 1: Document to Word */}
            <button
              type="button"
              onClick={onStartTextConverter}
              className="p-5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.1] hover:border-[#FF6B2B]/50 transition-all text-left group flex flex-col justify-between shadow-xl relative overflow-hidden"
            >
              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between">
                  <div className="p-2.5 rounded-xl bg-[#FF6B2B]/15 text-[#FF884D] border border-[#FF6B2B]/25">
                    <FileText className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-300">
                    DOCX / Word
                  </span>
                </div>
                <h3 className="text-lg font-bold text-white group-hover:text-[#FFA477] transition-colors">
                  Document / Text Extractor
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Extract PDFs, books & papers into clean editable Word (.docx) documents with full tables & native math.
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs font-bold text-[#FF884D] group-hover:translate-x-1 transition-transform">
                <span>Launch Document Tool</span>
                <ArrowRight className="w-4 h-4" />
              </div>
            </button>

            {/* Tool 2: Dedicated MockTest MCQ Extractor */}
            <button
              type="button"
              onClick={onStartMcqExtractor}
              className="p-5 rounded-2xl bg-gradient-to-br from-amber-500/[0.08] to-orange-500/[0.04] hover:from-amber-500/[0.15] hover:to-orange-500/[0.08] border border-amber-500/30 hover:border-amber-400 transition-all text-left group flex flex-col justify-between shadow-xl relative overflow-hidden"
            >
              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between">
                  <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    <Zap className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    18-Col CSV
                  </span>
                </div>
                <h3 className="text-lg font-bold text-white group-hover:text-amber-300 transition-colors">
                  MockTest MCQ Extractor
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Extract bilingual MCQs page-by-page with LaTeX math, deep step-by-step AI solutions & 18-col CSV export.
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs font-extrabold text-amber-400 group-hover:translate-x-1 transition-transform">
                <span>Launch MCQ Tool</span>
                <ArrowRight className="w-4 h-4" />
              </div>
            </button>
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
