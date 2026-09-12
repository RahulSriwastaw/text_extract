/**
 * Standardize MockTest CSV:
 * 1. Guarantees 100% consistent <p>...</p> wrapping across all 14 text fields (fixes bare text e.g. Q.21-25, 46-50, 76).
 * 2. Converts exponents (y^3, y²), roots (∛, √), fractions (13/12, a/b), and operators to MathJax \(...\) inline syntax.
 * 
 * Usage:
 *   node scripts/standardize_csv.cjs [input_csv_file] [output_csv_file]
 */

const fs = require('fs');
const path = require('path');

function ensureHtmlParagraph(text) {
  if (!text) return '';
  const trimmed = text.trim();
  if (!trimmed) return '';

  // Check if ALREADY strictly wrapped in <p>...</p>
  if (/^<p(?:\s+[^>]*)?>/i.test(trimmed) && /<\/p>$/i.test(trimmed)) {
    return trimmed;
  }

  // Strip broken partial outer tags if any
  const uncorrupted = trimmed.replace(/^<p(?:\s+[^>]*)?>/i, '').replace(/<\/p>$/i, '').trim();
  const paras = uncorrupted.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paras.length <= 1) {
    return `<p>${uncorrupted.replace(/\n/g, '<br>')}</p>`;
  }
  return paras.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

function convertToMathJaxSyntax(text) {
  if (!text) return '';
  let res = text.trim();

  // 1. Trig functions with powers
  res = res.replace(/\b(sin|cos|tan|sec|csc|cot|cosec)\s*[²2]\s*θ/gi, (_m, fn) => `\\(\\${fn.toLowerCase()}^2 \\theta\\)`);
  res = res.replace(/\b(sin|cos|tan|sec|csc|cot|cosec)\s*[³3]\s*θ/gi, (_m, fn) => `\\(\\${fn.toLowerCase()}^3 \\theta\\)`);
  res = res.replace(/\b(sin|cos|tan|sec|csc|cot|cosec)\s*θ/gi, (_m, fn) => `\\(\\${fn.toLowerCase()} \\theta\\)`);

  // 2. Convert HTML exponents & subscripts to LaTeX within MathJax
  res = res.replace(/([a-zA-Z0-9\)]+)\s*<sup>([^{}<>]+)<\/sup>/gi, (_m, base, exp) => {
    const cleanExp = exp.trim();
    const expStr = cleanExp.length === 1 ? cleanExp : `{${cleanExp}}`;
    return `\\(${base}^${expStr}\\)`;
  });

  res = res.replace(/([a-zA-Z0-9\)]+)\s*<sub>([^{}<>]+)<\/sub>/gi, (_m, base, sub) => {
    const cleanSub = sub.trim();
    const subStr = cleanSub.length === 1 ? cleanSub : `{${cleanSub}}`;
    return `\\(${base}_${subStr}\\)`;
  });

  res = res.replace(/<sup>([^{}<>]+)<\/sup>/gi, (_m, exp) => `\\(^{${exp.trim()}}\\)`);
  res = res.replace(/<sub>([^{}<>]+)<\/sub>/gi, (_m, sub) => `\\(_{${sub.trim()}}\\)`);

  // 3. Convert Unicode superscripts: e.g. 4², x³, y²
  res = res.replace(/([a-zA-Z0-9\)]+)[\s]*²(?!\w)/g, `\\($1^2\\)`);
  res = res.replace(/([a-zA-Z0-9\)]+)[\s]*³(?!\w)/g, `\\($1^3\\)`);

  // 4. Convert Unicode cube roots & square roots
  res = res.replace(/∛\s*\(?([0-9a-zA-Z\.\+\-\*\/]+)\)?/g, (_m, inside) => `\\(\\sqrt[3]{${inside.trim()}}\\)`);
  res = res.replace(/√\s*\(?([0-9a-zA-Z\.\+\-\*\/]+)\)?/g, (_m, inside) => `\\(\\sqrt{${inside.trim()}}\\)`);

  // 5. Degrees: 90° -> \(90^\circ\)
  res = res.replace(/(\d+)\s*°/g, `\\($1^\\circ\\)`);

  // 6. Greek letters: θ, α, β, π
  res = res.replace(/\bθ\b|(?<=[0-9a-zA-Z\^\s])θ/g, `\\(\\theta\\)`);
  res = res.replace(/\bα\b/g, `\\(\\alpha\\)`);
  res = res.replace(/\bβ\b/g, `\\(\\beta\\)`);
  res = res.replace(/\bπ\b/g, `\\(\\pi\\)`);

  // 7. Fractions
  res = res.replace(/\(\s*([0-9a-zA-Z\^\_\+\-\*\s\\]+)\s*\)\s*\/\s*\(\s*([0-9a-zA-Z\^\_\+\-\*\s\\]+)\s*\)/g, (_m, num, den) => {
    return `\\(\\frac{${num.trim()}}{${den.trim()}}\\)`;
  });
  res = res.replace(/(?<=\s|^|\(|>|:|;)(\d+)\s*\/\s*(\d+)(?=\s|$|\)|<|\.|\,)/g, (_m, num, den) => {
    return `\\(\\frac{${num}}{${den}}\\)`;
  });
  res = res.replace(/(?<=\s|^|\(|>)([a-zA-Z])\s*\/\s*([a-zA-Z])(?=\s|$|\)|<|\.|\,)/g, (_m, num, den) => {
    return `\\(\\frac{${num}}{${den}}\\)`;
  });

  // Multiplication / division operators
  res = res.replace(/(\d+|[a-zA-Z])\s*×\s*(\d+|[a-zA-Z])/g, `\\($1 \\times $2\\)`);
  res = res.replace(/(\d+|[a-zA-Z])\s*÷\s*(\d+|[a-zA-Z])/g, `\\($1 \\div $2\\)`);

  // 8. Consolidate adjacent MathJax blocks and inline operators
  for (let k = 0; k < 4; k++) {
    res = res.replace(/\\\(([^()]+)\\\)\s*\\\(([^()]+)\\\)/g, `\\($1 $2\\)`);
    res = res.replace(/\\\(([^()]+)\\\)\s*([+\-*=×÷<≤>≥≠])\s*\\\(([^()]+)\\\)/g, (_m, a, op, b) => {
      const texOp = op === '×' ? '\\times' : (op === '÷' ? '\\div' : (op === '≤' ? '\\le' : (op === '≥' ? '\\ge' : (op === '≠' ? '\\ne' : op))));
      return `\\(${a.trim()} ${texOp} ${b.trim()}\\)`;
    });
    res = res.replace(/\\\(([^()]+)\\\)\s*([+\-*=×÷])\s*(\d+|[a-zA-Z])/g, (_m, a, op, b) => {
      const texOp = op === '×' ? '\\times' : (op === '÷' ? '\\div' : op);
      return `\\(${a.trim()} ${texOp} ${b}\\)`;
    });
    res = res.replace(/(\d+|[a-zA-Z])\s*([+\-*=×÷])\s*\\\(([^()]+)\\\)/g, (_m, a, op, b) => {
      const texOp = op === '×' ? '\\times' : (op === '÷' ? '\\div' : op);
      return `\\(${a} ${texOp} ${b.trim()}\\)`;
    });
  }

  res = res.replace(/\\\(\s*\\\(([^()]+)\\\)\s*\\\)/g, `\\($1\\)`);
  res = res.replace(/\\\(\s+/g, `\\(`).replace(/\s+\\\)/g, `\\)`);

  return res;
}

function parseCsv(csvText) {
  let clean = csvText.replace(/^\uFEFF/, '');
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField);
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentField);
      currentField = '';
      if (currentRow.some(c => c.trim().length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += char;
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some(c => c.trim().length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function escapeCsvField(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function processCsvFile(inputPath, outputPath) {
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: File not found: ${inputPath}`);
    return;
  }

  const content = fs.readFileSync(inputPath, 'utf8');
  const rows = parseCsv(content);
  if (rows.length <= 1) {
    console.error('Error: Empty or header-only CSV.');
    return;
  }

  const headers = rows[0];
  const textColIndices = [];
  const textColNames = [
    'question_hi', 'option1_hi', 'option2_hi', 'option3_hi', 'option4_hi', 'option5_hi', 'solution_hi',
    'question_en', 'option1_en', 'option2_en', 'option3_en', 'option4_en', 'option5_en', 'solution_en'
  ];

  headers.forEach((h, idx) => {
    if (textColNames.includes(h.trim().toLowerCase())) {
      textColIndices.push(idx);
    }
  });

  let bareFixedCount = 0;
  let mathJaxConvertedCount = 0;

  const outputRows = [headers.map(escapeCsvField).join(',')];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const newRow = row.map((field, colIdx) => {
      if (!textColIndices.includes(colIdx) || !field || !field.trim()) {
        return escapeCsvField(field);
      }

      const trimmed = field.trim();
      const hadNoP = !(/^<p(?:\s+[^>]*)?>/i.test(trimmed) && /<\/p>$/i.test(trimmed));
      if (hadNoP) bareFixedCount++;

      const withP = ensureHtmlParagraph(trimmed);
      const withMath = convertToMathJaxSyntax(withP);
      if (withMath !== withP) mathJaxConvertedCount++;

      return escapeCsvField(ensureHtmlParagraph(withMath));
    });

    outputRows.push(newRow.join(','));
  }

  const outCsv = '\uFEFF' + outputRows.join('\n');
  const targetOut = outputPath || inputPath.replace(/\.csv$/i, '_Standardized.csv');
  fs.writeFileSync(targetOut, outCsv, 'utf8');

  console.log(`\n======================================================`);
  console.log(`✅ Standardized CSV saved to: ${targetOut}`);
  console.log(`📊 Rows Processed: ${rows.length - 1}`);
  console.log(`🔧 Bare text fields wrapped in <p>: ${bareFixedCount}`);
  console.log(`📐 Fields converted to MathJax: ${mathJaxConvertedCount}`);
  console.log(`======================================================\n`);
}

const args = process.argv.slice(2);
if (args.length > 0) {
  processCsvFile(args[0], args[1]);
} else {
  console.log('MockTest CSV Standardizer ready. Provide an input CSV file.');
}
