const fs = require('fs');
const path = require('path');

const walkSync = (dir, filelist = []) => {
  if (!fs.existsSync(dir)) return filelist;
  fs.readdirSync(dir).forEach(file => {
    const dirFile = path.join(dir, file);
    if (fs.statSync(dirFile).isDirectory()) {
      filelist = walkSync(dirFile, filelist);
    } else if (dirFile.endsWith('.tsx') || dirFile.endsWith('.css')) {
      filelist.push(dirFile);
    }
  });
  return filelist;
};

const files = walkSync('./components').concat(walkSync('./src')).concat(['index.css', 'App.tsx']);

files.forEach(file => {
  if (!fs.existsSync(file)) return;
  console.log('Processing', file);
  let content = fs.readFileSync(file, 'utf8');

  // Background colors
  content = content.replace(/bg-white/g, 'bg-[#1A1A1A]');
  content = content.replace(/bg-slate-50|bg-gray-50/g, 'bg-[#111111]');
  content = content.replace(/bg-slate-100|bg-gray-100/g, 'bg-[#141414]');
  content = content.replace(/bg-slate-800|bg-gray-800/g, 'bg-[#141414]');
  content = content.replace(/bg-slate-900|bg-gray-900/g, 'bg-[#0F0F0F]');
  content = content.replace(/bg-black/g, 'bg-[#0F0F0F]');
  
  // Custom badges/status pills
  content = content.replace(/bg-orange-50|bg-amber-50|bg-rose-50|bg-blue-50|bg-purple-50|bg-emerald-50/g, 'bg-[#1A2A3A]');
  content = content.replace(/bg-emerald-100|bg-green-100|bg-emerald-500\/10/g, 'bg-[#1A3A1A]');
  content = content.replace(/bg-rose-100|bg-red-100|bg-rose-500\/10/g, 'bg-[#3A1A1A]');
  content = content.replace(/bg-blue-100|text-blue-50|bg-blue-500\/10/g, 'bg-[#1A2A3A]');

  // Colors
  content = content.replace(/text-slate-900|text-gray-900|text-slate-800|text-gray-800|text-black/g, 'text-[#EFEFEF]');
  content = content.replace(/text-slate-700|text-gray-700|text-slate-600|text-gray-600/g, 'text-[#EFEFEF]');
  content = content.replace(/text-slate-500|text-gray-500|text-slate-400|text-gray-400|text-gray-300|text-slate-300|text-muted-foreground/g, 'text-[#555555]');
  
  content = content.replace(/text-orange-600|text-orange-500|text-amber-500|text-amber-600/g, 'text-[#FF6B2B]');
  content = content.replace(/text-rose-600|text-rose-500|text-red-600|text-red-500/g, 'text-[#F44336]');
  content = content.replace(/text-emerald-600|text-emerald-500|text-green-600|text-green-500/g, 'text-[#4CAF50]');
  content = content.replace(/text-blue-600|text-blue-500/g, 'text-[#2196F3]');

  // Border colors
  content = content.replace(/border-slate-200|border-gray-200|border-slate-300|border-gray-300|border-slate-100|border-gray-100|border-border/g, 'border-[#252525]');
  content = content.replace(/border-slate-800|border-gray-800/g, 'border-[#252525]');
  
  // Primary buttons & accents
  content = content.replace(/bg-indigo-600|bg-blue-600|bg-blue-500|bg-orange-500|bg-orange-600|bg-primary/g, 'bg-[#FF6B2B]');
  content = content.replace(/hover:bg-indigo-700|hover:bg-blue-700|hover:bg-blue-600|hover:bg-orange-600|hover:bg-orange-700/g, 'hover:bg-[#E55A1A]');
  content = content.replace(/text-indigo-600|text-blue-600|text-orange-500/g, 'text-[#FF6B2B]');
  content = content.replace(/ring-indigo-500|ring-blue-500|ring-orange-500/g, 'ring-[#FF6B2B]');
  content = content.replace(/border-indigo-600|border-blue-600|border-indigo-500|border-blue-500|border-orange-500/g, 'border-[#FF6B2B]');
  content = content.replace(/bg-slate-200|bg-slate-300/g, 'bg-[#2A2A2A]'); // Scrollbar or toggle background
  
  // Primary buttons styles
  content = content.replace(/text-white/g, 'text-white');
  
  // Gradients (NO gradients globally)
  content = content.replace(/bg-gradient-to-[a-z]+|from-[a-z]+-[0-9]+|to-[a-z]+-[0-9]+|via-[a-z]+-[0-9]+/g, '');
  
  // Shadows (replace generally with no shadows except specified)
  content = content.replace(/shadow-sm|shadow-md|shadow-lg|shadow-xl|shadow|drop-shadow-sm/g, '');
  // Custom hover shadow
  content = content.replace(/hover:shadow-md|hover:shadow-lg/g, 'hover:shadow-[0_2px_8px_rgba(0,0,0,0.35)]');

  // Padding reduction globally (-30%)
  content = content.replace(/\bp-8\b/g, 'p-5');
  content = content.replace(/\bp-6\b/g, 'p-4');
  content = content.replace(/\bp-5\b/g, 'p-3');
  content = content.replace(/\bp-4\b/g, 'p-3');
  content = content.replace(/\bpy-8\b/g, 'py-5');
  content = content.replace(/\bpy-6\b/g, 'py-4');
  content = content.replace(/\bpy-5\b/g, 'py-3');
  content = content.replace(/\bpy-4\b/g, 'py-3');
  content = content.replace(/\bpx-8\b/g, 'px-5');
  content = content.replace(/\bpx-6\b/g, 'px-4');
  content = content.replace(/\bpx-5\b/g, 'px-3');
  content = content.replace(/\bpx-4\b/g, 'px-3');

  // Gaps reduction
  content = content.replace(/\bgap-8\b/g, 'gap-5');
  content = content.replace(/\bgap-6\b/g, 'gap-4');
  content = content.replace(/\bgap-4\b/g, 'gap-3');
  
  // Font sizes (-1 to 2px equivalent)
  content = content.replace(/\btext-sm\b/g, 'text-[13px]');
  content = content.replace(/\btext-xs\b/g, 'text-[11px]');
  content = content.replace(/\btext-base\b/g, 'text-[14px]');
  content = content.replace(/\btext-lg\b/g, 'text-[16px]');
  content = content.replace(/\btext-xl\b/g, 'text-[18px]');
  content = content.replace(/\btext-2xl\b/g, 'text-[20px]');
  
  // Border radius rules
  content = content.replace(/\brounded-xl|rounded-2xl|rounded-lg\b/g, 'rounded-[8px]');
  content = content.replace(/\brounded-md\b/g, 'rounded-[6px]');
  content = content.replace(/\brounded-full\b/g, 'rounded-[20px]');

  // Inputs and textareas
  content = content.replace(/outline-none/g, 'outline-none focus:border-[#FF6B2B]');

  fs.writeFileSync(file, content, 'utf8');
});
console.log('Script completed');