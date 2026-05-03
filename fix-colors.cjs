const fs = require('fs');
const files = [
  'components/PdfConverter.tsx',
  'components/AdminPanel.tsx',
  'components/McqSidebar.tsx',
  'components/FileUploader.tsx',
  'components/HistorySidebar.tsx',
  'components/ProcessingList.tsx'
];

files.forEach(file => {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/bg-\[#1A2A3A\]0/g, 'bg-[#FF6B2B]');
    content = content.replace(/bg-transparent text-\[#EFEFEF\] border border-\[#2A2A2A\]/g, 'transparent text-[#EFEFEF] border border-[#2A2A2A]');
    // Fix toggles
    content = content.replace(/bg-\[#1A2A3A\]\/50 border border-orange-100/g, 'bg-[#1A1A1A] border border-[#252525]');
    content = content.replace(/bg-\[#1A2A3A\]\/50 border border-purple-100/g, 'bg-[#1A1A1A] border border-[#252525]');
    content = content.replace(/bg-\[#1A2A3A\]\/50 border border-blue-100/g, 'bg-[#1A1A1A] border border-[#252525]');
    content = content.replace(/bg-\[#1A2A3A\]\/50 border border-emerald-100/g, 'bg-[#1A1A1A] border border-[#252525]');
    
    // Fix additional border colors
    content = content.replace(/border-orange-100|border-purple-100|border-blue-100|border-emerald-100|border-red-100/g, 'border-[#252525]');
    // Fix additional text colors for toggle text (keep white/grayish instead of colored variants)
    content = content.replace(/text-orange-700\/70|text-purple-700\/70|text-emerald-700\/70/g, 'text-[#555555]');
    content = content.replace(/text-blue-800/g, 'text-[#EFEFEF]');
    
    // Convert remaining blue/red/green solid bg to orange or dark where appropriate
    content = content.replace(/bg-rose-600/g, 'bg-[#3A1A1A] text-[#F44336] border border-[#F44336]/30');
    content = content.replace(/hover:bg-rose-700/g, 'hover:bg-[#F44336]/20');
    
    // Convert any shadowed classes correctly
    content = content.replace(/ -orange-100| -orange-[0-9]+\/?[0-9]*| -soft| -card| -2xl/gi, '');
    
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated ${file}`);
  }
});
