import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, googleProvider } from '../services/firebase';
import { signInWithPopup } from 'firebase/auth';
import { 
  FileText, 
  ArrowRight, 
  Sparkles, 
  Zap, 
  Shield, 
  Clock, 
  Type, 
  Image as ImageIcon, 
  Grid 
} from 'lucide-react';

interface LandingPageProps {
  onStart: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onStart }) => {
  const loginAndStart = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      onStart();
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
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
      icon: <Sparkles className="w-5 h-5 text-blue-400" />,
      title: "AI Layout Analysis",
      desc: "Gemini 2.5 Flash precisely identifies headers, text, images, and tables.",
    },
    {
      icon: <Zap className="w-5 h-5 text-yellow-400" />,
      title: "Fast Conversion",
      desc: "Convert entire exam papers to editable Word documents in seconds.",
    },
    {
      icon: <Grid className="w-5 h-5 text-purple-400" />,
      title: "Format Support",
      desc: "Supports MCQs, bilingual papers, and complex numbering styles.",
    },
    {
      icon: <ImageIcon className="w-5 h-5 text-green-400" />,
      title: "Image Extraction",
      desc: "Automatically crops and embeds diagrams directly into your Word file.",
    },
    {
      icon: <Shield className="w-5 h-5 text-red-400" />,
      title: "Private & Secure",
      desc: "Your documents are processed securely and deleted from transient storage.",
    },
    {
      icon: <Clock className="w-5 h-5 text-orange-400" />,
      title: "History Search",
      desc: "Access your previous conversions anytime from your cloud history.",
    },
  ];

  return (
    <div className="min-h-screen bg-[#0F0F0F] text-[#EFEFEF] overflow-hidden relative selection:bg-[#FF6B2B]/30">
      {/* Background Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-[500px] bg-[#FF6B2B]/10 blur-[120px] pointer-events-none rounded-full" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-purple-600/5 blur-[100px] pointer-events-none rounded-full" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32 relative z-10">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="text-center"
        >
          {/* Badge */}
          <motion.div 
            variants={itemVariants}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#1A1A1A] border border-[#252525] text-[#FF6B2B] text-[11px] uppercase tracking-wider font-bold mb-8"
          >
            <Sparkles className="w-3 h-3" />
            <span>AI-Powered Exam Paper OCR</span>
          </motion.div>

          <motion.h1 
            variants={itemVariants}
            className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-b from-[#EFEFEF] to-[#888888]"
          >
            Convert PDF Papers <br /> to <span className="text-[#FF6B2B]">Editable Word</span>
          </motion.h1>

          <motion.p 
            variants={itemVariants}
            className="text-[#888888] text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-[1.5]"
          >
            The world's most advanced AI-powered converter for complex exam papers. 
            Extract text, images, and tables with pixel-perfect precision.
          </motion.p>

          <motion.div 
            variants={itemVariants}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <button
              onClick={loginAndStart}
              className="group relative flex items-center gap-2 bg-[#FF6B2B] hover:bg-[#E55A1A] text-white px-8 py-4 rounded-xl transition-all text-[13px] font-bold shadow-xl shadow-[#FF6B2B]/20"
              id="hero-start-btn"
            >
              Get Started for Free
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            <button 
              className="px-8 py-4 rounded-xl text-[#888888] hover:text-[#EFEFEF] transition-colors border border-[#252525] hover:bg-[#1A1A1A] text-[13px] font-bold"
              onClick={() => {
                const featuresSection = document.getElementById('features');
                featuresSection?.scrollIntoView({ behavior: 'smooth' });
              }}
              id="hero-features-btn"
            >
              See Features
            </button>
          </motion.div>

          {/* Floating UI Element Preview */}
          <motion.div
            variants={itemVariants}
            className="mt-20 relative px-4"
          >
            <div className="relative max-w-5xl mx-auto rounded-3xl border border-[#252525] bg-[#111111] shadow-2xl p-2 overflow-hidden">
               <div className="absolute top-0 left-0 right-0 h-10 bg-[#141414] border-b border-[#252525] flex items-center px-4 gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/50" />
                  <div className="ml-4 h-5 w-48 rounded bg-[#2A2A2A]" />
               </div>
               <div className="pt-12 pb-2 px-1">
                 <img 
                   src="https://images.unsplash.com/photo-1614064641938-3bbee52942c7?auto=format&fit=crop&q=80&w=2000" 
                   alt="App Preview" 
                   className="w-full rounded-2xl opacity-40 mix-blend-luminosity grayscale shadow-inner h-[300px] object-cover"
                   referrerPolicy="no-referrer"
                 />
                 <div className="absolute inset-0 bg-gradient-to-t from-[#111111] via-transparent to-transparent flex items-center justify-center">
                    <div className="bg-[#1A1A1A]/50 backdrop-blur-md rounded-2xl border border-[#252525] p-8 shadow-2xl">
                       <Type className="w-12 h-12 text-[#FF6B2B] mx-auto mb-4" />
                       <p className="text-[#FF6B2B] font-mono text-[13px] font-bold">Initializing Neural Layout Engine...</p>
                    </div>
                 </div>
               </div>
            </div>
          </motion.div>
        </motion.div>

        {/* Features Grid */}
        <section id="features" className="py-32">
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"
          >
            {features.map((feature, idx) => (
              <motion.div
                key={idx}
                whileHover={{ y: -5, borderColor: '#FF6B2B' }}
                className="p-4 md:p-6 rounded-2xl bg-[#1A1A1A] border border-[#252525] transition-all duration-300"
              >
                <div className="w-10 h-10 rounded-xl bg-[#141414] flex items-center justify-center mb-6 border border-[#252525]">
                  {feature.icon}
                </div>
                <h3 className="text-[16px] font-bold mb-3 text-[#EFEFEF]">{feature.title}</h3>
                <p className="text-[#888888] leading-[1.5] text-[13px]">
                  {feature.desc}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </section>

        {/* Trust Section */}
        <motion.div 
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          transition={{ duration: 1 }}
          className="text-center py-20 border-t border-[#252525]"
        >
          <p className="text-gray-600 text-sm uppercase tracking-widest mb-8">Built on Next-Gen Technology</p>
          <div className="flex flex-wrap justify-center items-center gap-12 grayscale opacity-30 invert">
            <span className="text-2xl font-black italic tracking-tighter">GEMINI AI</span>
            <span className="text-2xl font-black italic tracking-tighter">FIRESTORE</span>
            <span className="text-2xl font-black italic tracking-tighter">REACT 19</span>
            <span className="text-2xl font-black italic tracking-tighter">TAILWIND</span>
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 py-12 border-t border-[#252525] text-center">
        <p className="text-gray-500 text-xs">
          © 2024 AI Paper Converter. All rights reserved. Powered by Google Gemini.
        </p>
      </footer>
    </div>
  );
};

export default LandingPage;
