import {
  Document, 
  Packer, 
  Paragraph, 
  TextRun, 
  HeadingLevel, 
  AlignmentType, 
  Table,
  TableRow, 
  TableCell,
  WidthType,
  BorderStyle,
  Math as DocxMath, 
  MathRun, 
  MathFraction, 
  MathSuperScript, 
  MathSubScript, 
  MathSubSuperScript, 
  MathRadical, 
  MathSum, 
  ImageRun,
  TabStopType
} from "docx";

import { ExtractedElement, OptionArrangement, NumberingStyle } from "../types";

const formatQuestionPrefix = (num: string | number, style: NumberingStyle = NumberingStyle.QUESTION_DOT): string => {
  switch (style) {
    case NumberingStyle.Q_DOT:
      return `Q${num}. `;
    case NumberingStyle.HASH:
      return `#${num}. `;
    case NumberingStyle.NUMBER_DOT:
      return `${num}. `;
    case NumberingStyle.QUESTION_DOT:
    default:
      return `Question: ${num}. `;
  }
};

const cleanBilingualDuplicates = (text: string): string => {
  if (!text) return text;

  // 1. Question level identical text
  let cleaned = text.replace(/^(\s*(?:(?:Question|Q)\.?\s*[:\-]?\s*\d+\.?|#\d+\.?|\d+\.)\s*)([^\n/]+?)\s*\/\s*([^\n/]+)$/gm, (match, prefix, left, right) => {
    const lNorm = left.trim();
    const rNorm = right.trim();
    if (lNorm.toLowerCase() === rNorm.toLowerCase()) {
      return prefix + lNorm;
    }
    return match;
  });

  // 2. Format bilingual question on two lines WITHOUT slash (ONLY FOR QUESTIONS)
  cleaned = cleaned.replace(/^(\s*(?:(?:Question|Q)\.?\s*[:\-]?\s*\d+[\.\)\-:]?|#\d+[\.\)\-:]?|\d+[\.\)\-:]?)\s+[^\n/]+?)\s*\/+\s*([A-Za-z\$\\\(\[\{\d][^\n]+)$/gm, (match, hindiPart, engPart) => {
    const cleanHindi = hindiPart.replace(/\s*\/+$/, '').trim();
    const cleanEng = engPart.trim();
    if (/[\u0900-\u097F]/.test(cleanHindi) || /[a-zA-Z]/.test(cleanEng)) {
      return cleanHindi + '\n' + cleanEng;
    }
    return match;
  });

  // 3. Ensure bilingual options stay on ONE single line with ' / ' (e.g. '(b) सम / Even')
  cleaned = cleaned.replace(/^(\s*\([a-eA-E]\)\s+[^\n/]+?)\r?\n\s*([a-zA-Z][^\n]+)$/gm, (match, optHindi, optEng) => {
    return optHindi.trim() + ' / ' + optEng.trim();
  });

  // 4. Option level clean: '(a) 123 / 123' -> '(a) 123'
  cleaned = cleaned.replace(/^(\s*(?:\([a-zA-Z0-9]+\)|[a-zA-Z0-9]+[\.\)])\s*)([^\n/]+?)\s*\/\s*([^\n/]+)$/gm, (match, prefix, left, right) => {
    const lNorm = left.trim();
    const rNorm = right.trim();
    if (lNorm.toLowerCase() === rNorm.toLowerCase() || lNorm.replace(/\s+/g, '').toLowerCase() === rNorm.replace(/\s+/g, '').toLowerCase()) {
      return prefix + lNorm;
    }
    return match;
  });

  // 5. Inline duplicates: '123 / 123' -> '123'
  cleaned = cleaned.replace(/([^\n/]+?)\s*\/\s*([^\n/]+)/g, (match, left, right) => {
    const lTrim = left.trim();
    const rTrim = right.trim();
    if (lTrim && rTrim && lTrim.toLowerCase() === rTrim.toLowerCase()) {
      return lTrim;
    }
    return match;
  });

  return cleaned;
};

// --- LaTeX Parser Helpers ---

const LATEX_SYMBOLS: Record<string, string> = {
    // Greek Lowercase
    'alpha': 'α', 'beta': 'β', 'gamma': 'γ', 'delta': 'δ', 'epsilon': 'ε', 'zeta': 'ζ',
    'eta': 'η', 'theta': 'θ', 'iota': 'ι', 'kappa': 'κ', 'lambda': 'λ', 'mu': 'μ',
    'nu': 'ν', 'xi': 'ξ', 'omicron': 'ο', 'pi': 'π', 'rho': 'ρ', 'sigma': 'σ',
    'tau': 'τ', 'upsilon': 'υ', 'phi': 'φ', 'chi': 'χ', 'psi': 'ψ', 'omega': 'ω',
    'varphi': 'φ', 'varsigma': 'ς', 'vartheta': 'ϑ', 'varepsilon': 'ε', 'varrho': 'ϱ',
    // Greek Uppercase
    'Alpha': 'Α', 'Beta': 'Β', 'Gamma': 'Γ', 'Delta': 'Δ', 'Theta': 'Θ', 'Lambda': 'Λ',
    'Xi': 'Ξ', 'Pi': 'Π', 'Sigma': 'Σ', 'Phi': 'Φ', 'Psi': 'Ψ', 'Omega': 'Ω',
    // Operators & Symbols
    'circ': '°', 'deg': '°', 'degree': '°',
    'infty': '∞', 'pm': '±', 'mp': '∓', 'times': '×', 'div': '÷', 'cdot': '·',
    'neq': '≠', 'approx': '≈', 'leq': '≤', 'geq': '≥', 'le': '≤', 'ge': '≥',
    'forall': '∀', 'exists': '∃', 'in': '∈', 'notin': '∉', 'subset': '⊂', 'subseteq': '⊆',
    'cup': '∪', 'cap': '∩', 'vee': '∨', 'wedge': '∧',
    'rightarrow': '→', 'leftarrow': '←', 'Rightarrow': '⇒', 'Leftarrow': '⇐',
    'to': '→', 'gets': '←', 'iff': '⇔', 'implies': '⇒', 'mapsto': '↦', 'longleftrightarrow': '↔',
    'sim': '∼', 'simeq': '≃', 'll': '≪', 'gg': '≫', 'empty': '∅', 'emptyset': '∅',
    'partial': '∂', 'nabla': '∇', 'sum': '∑', 'prod': '∏', 'int': '∫', 'oint': '∮',
    'therefore': '∴', 'because': '∵', 'angle': '∠', 'perp': '⊥', 'prime': '′',
    'ell': 'ℓ', 'Re': 'ℜ', 'Im': 'ℑ', 'aleph': 'ℵ', 'hbar': 'ℏ',
    'vert': '|', 'mid': '|', 'dots': '…', 'cdots': '⋯',
    'parallel': '∥', 'cong': '≅', 'equiv': '≡', 'propto': '∝',
    'surd': '√', 'triangle': '△', 'triangledown': '▽', 'square': '□', 'blacksquare': '■',
    'dot': '⋅', 'vdots': '⋮', 'ddots': '⋱', 'checkmark': '✓',
    'bullet': '•', 'ast': '∗', 'star': '★', 'oplus': '⊕', 'ominus': '⊖',
    'otimes': '⊗', 'oslash': '⊘', 'odot': '⊙', 'dagger': '†', 'ddagger': '‡',
    'uplus': '⊎', 'sqcap': '⊓', 'sqcup': '⊔', 'setminus': '∖', 'wr': '≀', 'diamond': '⋄',
    'top': '⊤', 'bottom': '⊥', 'models': '⊧', 'vdash': '⊢', 'dashv': '⊣',
    'langle': '⟨', 'rangle': '⟩', 'lceil': '⌈', 'rceil': '⌉', 'lfloor': '⌊', 'rfloor': '⌋',
    'micro': 'μ', 'ohm': 'Ω'
};

const MATH_FUNCTIONS = [
    'sin', 'cos', 'tan', 'csc', 'sec', 'cot', 'cosec',
    'arcsin', 'arccos', 'arctan', 
    'sinh', 'cosh', 'tanh', 
    'log', 'ln', 'lg', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'exp'
];

function extractArg(str: string, startIndex: number): [string, number] {
    let i = startIndex;
    while(i < str.length && /\s/.test(str[i])) i++;
    
    if (i >= str.length) return ["", i];

    const char = str[i];

    if (char === '{') {
        let depth = 1;
        let start = i;
        i++;
        while (i < str.length && depth > 0) {
            if (str[i] === '{') {
                depth++;
            } else if (str[i] === '}') {
                depth--;
            } else if (str[i] === '\\' && i + 1 < str.length) {
                // Skip escaped braces
                if (str[i+1] === '{' || str[i+1] === '}') i++;
            }
            i++;
        }
        // Return content INSIDE braces
        return [str.slice(start + 1, i - 1), i];
    } else if (char === '\\') {
        let start = i;
        i++; 
        // Scan command name
        if (i < str.length && !/[a-zA-Z]/.test(str[i])) {
            // Single character command like \, or \{
            return [str.slice(start, i + 1), i + 1];
        }
        while (i < str.length && /[a-zA-Z]/.test(str[i])) {
            i++;
        }
        const cmd = str.slice(start + 1, i);
        
        // GREEDY CONSUMPTION for specific commands to treat them as a single "argument" if needed
        if (['frac', 'binom', 'sqrt', 'text', 'mathrm', 'mathbf', 'vec', 'hat', 'bar', 'overline', 'underline'].includes(cmd)) {
             let currentPos = i;
             // Handle optional argument for \sqrt[n]{x}
             if (cmd === 'sqrt') {
                 while(currentPos < str.length && /\s/.test(str[currentPos])) currentPos++;
                 if (str[currentPos] === '[') {
                     let depth = 0;
                     while(currentPos < str.length) {
                         if (str[currentPos] === '[') depth++;
                         if (str[currentPos] === ']') depth--;
                         currentPos++;
                         if (depth === 0) break;
                     }
                 }
             }
             // Handle mandatory arguments
             const numArgs = ['frac', 'binom'].includes(cmd) ? 2 : 1;
             for (let a = 0; a < numArgs; a++) {
                 const [_, nextI] = extractArg(str, currentPos);
                 currentPos = nextI;
             }
             return [str.slice(start, currentPos), currentPos];
        }

        return [str.slice(start, i), i]; // Return full \cmd
    } else {
        return [char, i + 1];
    }
}

function extractOptionalArg(str: string, startIndex: number): [string | null, number] {
    let i = startIndex;
    while(i < str.length && /\s/.test(str[i])) i++;
    if (i < str.length && str[i] === '[') {
        let start = i;
        let depth = 0;
        while (i < str.length) {
            if (str[i] === '[') depth++;
            if (str[i] === ']') depth--;
            i++;
            if (depth === 0) break;
        }
        return [str.slice(start + 1, i - 1), i];
    }
    return [null, startIndex];
}

// --- Specialized Chemistry Parser ---

function isChemicalFormula(latex: string): boolean {
    const clean = latex
        .replace(/\\mathrm/g, '')
        .replace(/\\text/g, '')
        .replace(/\\ce/g, '') 
        .replace(/[\s\{\}\(\)\[\]\+\-\=\._\^]/g, '')
        .replace(/\\rightarrow/g, '')
        .replace(/\\to/g, '');
    
    if (latex.includes('\\ce')) return true;
    if (/\\(frac|sqrt|sum|int|prod|lim|sin|cos|tan)/.test(latex)) return false;
    if (!/[A-Za-z]/.test(clean)) return false;
    // More restrictive: Chemistry usually starts with a capital letter (element symbol)
    // and doesn't contain common math-only patterns.
    return /^[A-Z][A-Za-z0-9\u2192]*$/.test(clean);
}

function parseChemistryToTextRuns(latex: string, isBold: boolean): any[] {
    const runs: any[] = [];
    let i = 0;
    
    let processed = latex
        .replace(/\\rightarrow/g, ' → ')
        .replace(/\\to/g, ' → ')
        .replace(/\\longrightarrow/g, ' ⟶ ')
        .replace(/\\mathrm/g, '')
        .replace(/\\text/g, '')
        .replace(/\\ce/g, '');

    while (i < processed.length) {
        const char = processed[i];
        if (char === '{' || char === '}') { i++; continue; }

        if (char === '\\') {
            const [cmdWithSlash, nextI] = extractArg(processed, i);
            const cmd = cmdWithSlash.replace(/^\\/, '');
            if (LATEX_SYMBOLS[cmd]) {
                runs.push(new TextRun({ text: LATEX_SYMBOLS[cmd], size: 22, font: "Arial", bold: isBold, noProof: true }));
            }
            i = nextI;
            continue;
        }

        if (char === '_' || char === '^') {
            const isSub = char === '_';
            i++;
            const [arg, nextI] = extractArg(processed, i);
            i = nextI;
            const cleanArg = arg.replace(/[\{\}]/g, '');
            runs.push(new TextRun({
                text: cleanArg,
                subScript: isSub,
                superScript: !isSub,
                size: 22,
                font: "Arial",
                bold: isBold,
                noProof: true
            }));
        } else {
            let text = "";
            while (i < processed.length) {
                const c = processed[i];
                if (['^', '_', '\\', '{', '}'].includes(c)) break;
                text += c;
                i++;
            }
            if (text) {
                runs.push(new TextRun({ text: text, size: 22, font: "Arial", bold: isBold, noProof: true }));
            }
        }
    }
    return runs;
}

// --- Standard Math Parser ---

function parseLatex(latex: string): any[] {
    const nodes: any[] = [];
    let i = 0;
    let processedLatex = latex;
    
    // Pre-process common math functions to ensure they have backslashes
    MATH_FUNCTIONS.forEach(fn => {
        const regex = new RegExp(`(?<!\\\\)\\b${fn}(?![a-zA-Z])`, 'g');
        processedLatex = processedLatex.replace(regex, `\\${fn}`);
    });

    while (i < processedLatex.length) {
        const char = processedLatex[i];
        
        if (/\s/.test(char)) { 
            nodes.push(new MathRun(" ")); 
            i++; 
            continue; 
        }

        if (char === '\\') {
             const remainder = processedLatex.slice(i + 1);
             
             // 1. Handle delimiters and layout commands
             const layoutMatch = remainder.match(/^(left|right|limits|nolimits|displaystyle|textstyle|scriptstyle|scriptscriptstyle)\b/);
             if (layoutMatch) {
                 const cmd = layoutMatch[0];
                 i += 1 + cmd.length;
                 if (cmd === 'left' || cmd === 'right') {
                     // Keep the delimiter character
                     while(i < processedLatex.length && /\s/.test(processedLatex[i])) i++;
                     if (i < processedLatex.length) {
                         const delim = processedLatex[i];
                         if (delim !== '.') { // \left. and \right. are invisible delimiters
                             nodes.push(new MathRun(delim));
                         }
                         i++;
                     }
                 }
                 continue;
             }

             // 1.5 Handle Environments (begin/end)
             if (remainder.startsWith('begin') || remainder.startsWith('end')) {
                 const isBegin = remainder.startsWith('begin');
                 i += isBegin ? 5 : 3;
                 const [env, nextI] = extractArg(processedLatex, i);
                 i = nextI;
                 nodes.push(new MathRun(isBegin ? " [" : "] "));
                 continue;
             }

             // 2. Handle text styles and operators
             const styleMatch = remainder.match(/^(text|mathrm|mathbf|mathit|mathsf|mathtt|mathcal|operatorname)\b/);
             if (styleMatch) {
                 const cmd = styleMatch[0];
                 i += 1 + cmd.length; 
                 const [textArg, nextI] = extractArg(processedLatex, i);
                 i = nextI;
                 nodes.push(new MathRun(textArg)); 
                 continue;
             }

             // 3. Handle specific math operators
             if (remainder.startsWith('frac') || remainder.startsWith('binom')) {
                 const isBinom = remainder.startsWith('binom');
                 i += isBinom ? 6 : 5; 
                 const [num, n1] = extractArg(processedLatex, i);
                 i = n1;
                 const [den, n2] = extractArg(processedLatex, i);
                 i = n2;
                 if (MathFraction) {
                     nodes.push(new MathFraction({ 
                         numerator: parseLatex(num), 
                         denominator: parseLatex(den) 
                     }));
                 } else {
                     nodes.push(new MathRun(isBinom ? `(${num} over ${den})` : `(${num}/${den})`));
                 }
                 continue;
             } 
             
             if (remainder.startsWith('sqrt')) {
                 i += 5; 
                 const [optArg, nextI1] = extractOptionalArg(processedLatex, i);
                 i = nextI1;
                 const [inner, nextI2] = extractArg(processedLatex, i);
                 i = nextI2;
                 
                 if (MathRadical) {
                     nodes.push(new MathRadical({ 
                         degree: optArg ? parseLatex(optArg) : undefined, 
                         children: parseLatex(inner) 
                     }));
                 } else {
                     const degStr = optArg ? `[${optArg}]` : "";
                     nodes.push(new MathRun(`√${degStr}(${inner})`));
                 }
                 continue;
             }

             // 4. Handle N-ary operators (sum, int, etc.)
             const naryMatch = remainder.match(/^([a-zA-Z]+)/);
             if (naryMatch) {
                 const cmd = naryMatch[1];
                 if (['sum', 'prod', 'int', 'oint', 'bigcup', 'bigcap', 'coprod'].includes(cmd)) {
                     i += 1 + cmd.length;
                     const naryCharMap: Record<string, string> = { 
                         'sum': '∑', 'prod': '∏', 'int': '∫', 'oint': '∮', 
                         'bigcup': '⋃', 'bigcap': '⋂', 'coprod': '∐' 
                     };
                     const naryChar = naryCharMap[cmd];
                     let sub: any = undefined;
                     let sup: any = undefined;
                     let limitLocation: any = (cmd.includes('int') || cmd.includes('oint')) 
                        ? "subSup" 
                        : "undOvr";
                     
                     let j = i;
                     let subStr = "";
                     let supStr = "";
                     
                     // Parse limits
                     for(let k=0; k<2; k++) {
                         let skipping = true;
                         while (skipping) {
                             skipping = false;
                             while (j < processedLatex.length && /\s/.test(processedLatex[j])) j++;
                             if (processedLatex.slice(j).startsWith('\\limits')) { 
                                 j += 7; skipping = true; 
                                 limitLocation = "undOvr"; 
                             }
                             if (processedLatex.slice(j).startsWith('\\nolimits')) { 
                                 j += 9; skipping = true; 
                                 limitLocation = "subSup"; 
                             }
                         }
                         if (processedLatex[j] === '_') { 
                             j++; const [arg, nextJ] = extractArg(processedLatex, j); 
                             subStr = arg; sub = parseLatex(arg); j = nextJ; 
                         } else if (processedLatex[j] === '^') { 
                             j++; const [arg, nextJ] = extractArg(processedLatex, j); 
                             supStr = arg; sup = parseLatex(arg); j = nextJ; 
                         } else { break; }
                     }
                     
                     if (MathSum) {
                         nodes.push(new MathSum({ children: [new MathRun(naryChar)], subScript: sub ? [sub] : undefined, superScript: sup ? [sup] : undefined }));
                     } else {
                         nodes.push(new MathRun(naryChar));
                         if (subStr) nodes.push(new MathRun(`_(${subStr})`));
                         if (supStr) nodes.push(new MathRun(`^(${supStr})`));
                     }
                     i = j; 
                     continue; 
                 }

                 // 5. Handle Math Functions (sin, cos, etc.)
                 if (MATH_FUNCTIONS.includes(cmd)) {
                     nodes.push(new MathRun(cmd));
                     i += 1 + cmd.length;
                     continue;
                 }

                 // 5.1 Handle text blocks inside math mode (e.g. \text{...}, \mathrm{...})
                 if (['text', 'mathrm', 'mathbf', 'mathit', 'operatorname', 'mbox', 'textbf', 'textit'].includes(cmd)) {
                     i += 1 + cmd.length;
                     const [textArg, nextI] = extractArg(processedLatex, i);
                     i = nextI;
                     nodes.push(new MathRun(textArg));
                     continue;
                 }

                 // 5.5 Handle Accents and Decorations
                 const accentMap: Record<string, string> = {
                     'vec': '\u20D7', 'hat': '\u0302', 'bar': '\u0304',
                     'overline': '\u0305', 'underline': '\u0332',
                     'dot': '\u0307', 'ddot': '\u0308', 'tilde': '\u0303'
                 };
                 if (accentMap[cmd]) {
                     i += 1 + cmd.length;
                     const [arg, nextI] = extractArg(processedLatex, i);
                     i = nextI;
                     const combiningChar = accentMap[cmd];
                     
                     if (cmd === 'overline' || cmd === 'underline') {
                         if (/^[a-zA-Z0-9]+$/.test(arg)) {
                             let modifiedArg = "";
                             for (let c of arg) modifiedArg += c + combiningChar;
                             nodes.push(new MathRun(modifiedArg));
                         } else {
                             nodes.push(new MathRun(`${cmd}(`));
                             nodes.push(...parseLatex(arg));
                             nodes.push(new MathRun(`)`));
                         }
                     } else {
                         if (/^[a-zA-Z0-9]$/.test(arg)) {
                             nodes.push(new MathRun(arg + combiningChar));
                         } else {
                             nodes.push(new MathRun(`${cmd}(`));
                             nodes.push(...parseLatex(arg));
                             nodes.push(new MathRun(`)`));
                         }
                     }
                     continue;
                 }

                 // 6. Handle Symbols
                 i += 1 + cmd.length;
                 const symbol = LATEX_SYMBOLS[cmd];
                 nodes.push(new MathRun(symbol || cmd)); 
             } else {
                 // Escaped character or unknown command
                 const escapedChar = remainder[0] || "";
                 if (escapedChar === '{' || escapedChar === '}') {
                     nodes.push(new MathRun(escapedChar));
                 } else if (escapedChar === '\\') {
                     nodes.push(new MathRun("\n")); // New line in some contexts
                 } else {
                     nodes.push(new MathRun(escapedChar));
                 }
                 i += 1 + escapedChar.length;
             }
        } else if (char === '^' || char === '_') {
            const isSup = char === '^';
            i++;
            const [argContent, nextI] = extractArg(processedLatex, i);
            let currentI = nextI;
            let otherArgContent: string | null = null;
            let hasOther = false;
            
            let j = currentI;
            while(j < processedLatex.length && /\s/.test(processedLatex[j])) j++;
            const otherChar = isSup ? '_' : '^';
            if (j < processedLatex.length && processedLatex[j] === otherChar) {
                j++; 
                const [arg2, nextJ] = extractArg(processedLatex, j); 
                otherArgContent = arg2; 
                currentI = nextJ; 
                hasOther = true;
            }
            
            const lastNode = nodes.pop();
            const base = lastNode || new MathRun(""); 
            const supArgText = isSup ? argContent : otherArgContent;
            const subArgText = isSup ? otherArgContent : argContent;
            
            if (hasOther && otherArgContent !== null) {
                if (MathSubSuperScript) {
                    nodes.push(new MathSubSuperScript({ 
                        children: [base], 
                        subScript: parseLatex(subArgText!), 
                        superScript: parseLatex(supArgText!) 
                    }));
                } else {
                    nodes.push(base);
                    nodes.push(new MathRun(`_(${subArgText})^(${supArgText})`));
                }
            } else {
                if (isSup) { 
                    if (MathSuperScript) { 
                        nodes.push(new MathSuperScript({ children: [base], superScript: parseLatex(argContent) })); 
                    } else { 
                        nodes.push(base); 
                        nodes.push(new MathRun(`^(${argContent})`)); 
                    }
                } else { 
                    if (MathSubScript) { 
                        nodes.push(new MathSubScript({ children: [base], subScript: parseLatex(argContent) })); 
                    } else { 
                        nodes.push(base); 
                        nodes.push(new MathRun(`_(${argContent})`)); 
                    }
                }
            }
            i = currentI;
        } else if (char === '{' || char === '}') { 
            i++; 
        } else { 
            nodes.push(new MathRun(char)); 
            i++; 
        }
    }
    return nodes;
}

function cleanMixedMathText(text: string): string {
    if (!text) return text;

    // 1. Fix $\text{Hindi\nEnglish} math$ or $\text{...}$ spanning lines
    let cleaned = text.replace(/\$+\s*\\text\{([\s\S]*?)\}\s*([\s\S]*?)\$+/g, (_m, textContent, mathContent) => {
        const trimmedMath = mathContent.trim();
        if (trimmedMath) {
            return `${textContent.trim()} $$${trimmedMath}$$`;
        }
        return textContent.trim();
    });

    // 2. Fix broken $\text{... across lines e.g.
    cleaned = cleaned.replace(/\$+\s*\\text\{([^\n\}]+)\n\s*([^\}:]+)\s*:\s*\}\s*([^\$]+)\$+/g, (_m, hindi, eng, math) => {
        return `${hindi.trim()}\n${eng.trim()}: $$${math.trim()}$$`;
    });

    // 3. Fix standalone \text{...} in normal sentences
    cleaned = cleaned.replace(/\\text\{([^\}]+)\}/g, '$1');

    return cleaned;
}

function wrapAllLatexExpressions(text: string): string {
    if (!text) return text;

    // 1. Repair double backslashes, control characters & raw/corrupted frac
    let s = text
        .replace(/\\\\+(frac|sqrt|times|beta|rho|neq|alpha|theta|overline|underline|pm|div|cdot|left|right|sum|int|pi|infty|circ|deg|text|mathbf|mathrm|ge|le|approx|quad|to|sim|partial|Delta|lambda|mu|sigma|omega|phi|sin|cos|tan|log|ln|lim|binom)/g, '\\$1')
        .replace(/[\x0c\f]rac/g, '\\frac')
        .replace(/[\x08\b]eta/g, '\\beta')
        .replace(/(^|[^\\a-zA-Z])rac\{/g, '$1\\frac{')
        .replace(/(^|[^\\a-zA-Z])sqrt\{/g, '$1\\sqrt{')
        .replace(/(^|[^\\a-zA-Z])overline\{/g, '$1\\overline{')
        .replace(/(^|[^\\a-zA-Z])times(\s|\d|\$)/g, '$1\\times$2')
        .replace(/(^|[^\\a-zA-Z])frac(\d{2})(\d{2})/g, '$1\\frac{$2}{$3}')
        .replace(/(^|[^\\a-zA-Z])frac(\d)(\d{2})/g, '$1\\frac{$2}{$3}')
        .replace(/(^|[^\\a-zA-Z])frac(\d)(\d)(?!\d)/g, '$1\\frac{$2}{$3}')
        .replace(/\${3,}/g, '$$')
        .replace(/([^\n]+?)\s*\/+\s*(Answer\s*[:\-]\s*[a-eA-E])/gi, '$1\n$2');

    const lines = s.split('\n');
    const resultLines = lines.map(line => {
        // Split line by existing $$...$$ blocks
        const parts = line.split(/(\$\$[\s\S]*?\$\$)/g);

        const processedParts = parts.map((part) => {
            // If part is already a math block, keep it as is
            if (part.startsWith('$$') && part.endsWith('$$')) {
                return part;
            }

            // Check if part contains unwrapped LaTeX commands
            if (!part.includes('\\')) {
                return part;
            }

            // Find and wrap all LaTeX expressions in this text segment
            let segment = part;
            let result = '';
            
            while (segment.length > 0) {
                const match = segment.match(/\\(frac|binom|sqrt|overline|underline|times|div|pm|cdot|alpha|beta|theta|sum|int|pi|sin|cos|tan)/);
                if (!match || match.index === undefined) {
                    result += segment;
                    break;
                }

                const cmd = match[1];
                const latexIdx = match.index;
                const requiredBraceGroups = ['frac', 'binom'].includes(cmd) ? 2 : (['sqrt', 'overline', 'underline'].includes(cmd) ? 1 : 0);

                // Move backwards to capture math prefix (e.g. "4 - ")
                let startIdx = latexIdx;
                while (startIdx > 0) {
                    const prevChar = segment[startIdx - 1];
                    if (/[\d\s\+\-\*\/\=\(\)\.\^\_]/.test(prevChar)) {
                        const prefixSoFar = segment.substring(0, startIdx);
                        if (/^\s*(?:#?(?:Question|Q)\.?\s*[:\-]?\s*|\bPrashn\s*|\bप्रश्न\s*)?\d+[\.\)\-:]?\s*$/i.test(prefixSoFar) ||
                            /(?:is|are|of|than|value|and|तथा|से|का|मान|है|कौन|बड़ा|छोटा|ज्ञात|सरल|कीजिए)\s*$/i.test(prefixSoFar) ||
                            /^\s*\([a-eA-E]\)\s*$/.test(prefixSoFar)) {
                            break;
                        }
                        startIdx--;
                    } else {
                        break;
                    }
                }

                // Move forwards to balance braces
                let endIdx = latexIdx + 1 + cmd.length;
                if (requiredBraceGroups > 0) {
                    let completedGroups = 0;
                    let braceDepth = 0;
                    let foundFirstBrace = false;

                    for (let i = latexIdx; i < segment.length; i++) {
                        const char = segment[i];
                        if (char === '{') {
                            braceDepth++;
                            foundFirstBrace = true;
                        } else if (char === '}') {
                            braceDepth--;
                            if (braceDepth === 0 && foundFirstBrace) {
                                completedGroups++;
                                if (completedGroups === requiredBraceGroups) {
                                    endIdx = i + 1;
                                    break;
                                }
                            }
                        }
                    }
                }

                const beforeMath = segment.substring(0, startIdx);
                const mathExpr = segment.substring(startIdx, endIdx).trim();
                result += beforeMath + `$$${mathExpr}$$`;
                segment = segment.substring(endIdx);
            }

            return result;
        });

        return processedParts.join('');
    });

    return resultLines.join('\n');
}

// --- Content Parsing Logic ---

/**
 * Parses mixed content strings containing:
 * 1. LaTeX Math: $$ ... $$
 * 2. Markdown Bold: ** ... **
 * 3. Plain Text
 * 4. Markdown Blockquote: > ...
 * Returns an array of Docx Children (TextRun, Math, etc.)
 */
function parseLineToChildren(trimmed: string, forceBold: boolean = false, meta?: { isBlockquote?: boolean }): any[] {
    let content = cleanMixedMathText(trimmed);
    if (content.startsWith('>')) {
        if (meta) meta.isBlockquote = true;
        content = content.substring(1).trim();
    }

    // Normalize LaTeX delimiters into $$...$$ BEFORE running the bare-LaTeX repair/wrap
    // pass. Doing it after (the old order) let wrapAllLatexExpressions' heuristic
    // backslash-command scanner mis-split already-delimited math like
    // "$\displaystyle 4 - \frac{...}$" (it doesn't recognize \displaystyle), leaving the
    // leading "$\displaystyle" and a stray "$" behind as literal, unrendered text.
    let processed = content.replace(/\\\[([\s\S]*?)\\\]/g, (_m, p1) => `$$${p1}$$`);
    processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (_m, p1) => `$$${p1}$$`);
    processed = processed.replace(/(?<!\$)\$(?!\$)([^\$]+?)(?<!\$)\$(?!\$)/g, (_m, p1) => `$$${p1}$$`);
    processed = wrapAllLatexExpressions(processed);

    // Split by Math ($$)
    const parts = processed.split(/(\$\$[\s\S]*?\$\$)/g); 
    
    return parts.map(part => {
        // CASE 1: Math Block
        if (part.startsWith('$$') && part.endsWith('$$')) {
            const latex = part.slice(2, -2).trim();
            if (isChemicalFormula(latex)) {
                 return parseChemistryToTextRuns(latex, forceBold);
            }
            if (DocxMath) {
                try {
                    return new DocxMath({ children: parseLatex(latex) });
                } catch (e) {
                    console.error("Error parsing LaTeX:", latex, e);
                    // Fallback to text if math fails
                    return new TextRun({ text: latex, font: "Arial", size: 22, bold: forceBold });
                }
            } else {
                return new TextRun({ text: latex, font: "Arial", size: 22, bold: forceBold });
            }
        } 
        // CASE 2: Text Block (May contain **Bold**)
        else {
            if (!part) return null;
            
            // Split by Markdown Bold syntax (**text**)
            const boldParts = part.split(/(\*\*(?:[^*]|\*(?!\*))*\*\*)/g);

            return boldParts.map(subPart => {
                if (!subPart) return null;

                let isBold = forceBold;
                let cleanText = subPart;

                // Check if this sub-part matches **...**
                if (subPart.startsWith('**') && subPart.endsWith('**') && subPart.length >= 4) {
                    isBold = true;
                    cleanText = subPart.slice(2, -2); // Remove **
                }

                const subLines = cleanText.split('\n');
                return subLines.map((lineText, lIdx) => {
                    const runProps: any = {
                        text: lineText,
                        font: "Arial",
                        size: 22,
                        bold: isBold,
                        noProof: true
                    };
                    if (lIdx > 0) {
                        runProps.break = 1;
                    }
                    return new TextRun(runProps);
                });
            });
        }
    }).flat(Infinity).filter(Boolean);
}

// --- Table Generation ---

function isTableTooComplex(tableLines: string[]): boolean {
    const dataLines = tableLines.filter(line => !/^\|\s*[\-:]+\s*\|/.test(line) && !/^\|\s*[\-:]+/.test(line));
    if (dataLines.length > 12) return true; // Too many rows
    
    for (const line of dataLines) {
        let content = line.trim();
        if (content.startsWith('|')) content = content.substring(1);
        if (content.endsWith('|')) content = content.substring(0, content.length - 1);
        const cells = content.split('|');
        
        if (cells.length > 6) return true; // Too many columns
        for (const cell of cells) {
            if (cell.trim().length > 120) return true; // Too much text in a cell
            if (cell.includes('$$') && cell.trim().length > 40) return true; // Complex math in table
        }
    }
    return false;
}

function createDocxTable(tableLines: string[]): any {
    const dataLines = tableLines.filter(line => !/^\|\s*[\-:]+\s*\|/.test(line) && !/^\|\s*[\-:]+/.test(line));

    const rows = dataLines.map((line, rowIndex) => {
        let content = line.trim();
        if (content.startsWith('|')) content = content.substring(1);
        if (content.endsWith('|')) content = content.substring(0, content.length - 1);
        
        const cellTexts = content.split('|');
        const isHeader = rowIndex === 0;
        
        return new TableRow({
            children: cellTexts.map(cellText => {
                // Parse text inside cells (handles Bold & Math)
                return new TableCell({
                    children: [new Paragraph({ 
                        children: parseLineToChildren(cellText.trim(), isHeader) as any[],
                        alignment: AlignmentType.CENTER
                    })],
                    width: {
                        size: 100 / cellTexts.length,
                        type: WidthType.PERCENTAGE,
                    },
                    verticalAlign: AlignmentType.CENTER,
                    borders: {
                        top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
                        bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
                        left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
                        right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
                    },
                    shading: isHeader ? { fill: "F2F2F2" } : undefined // Very light gray for header
                });
            })
        });
    });

    return new Table({
        rows: rows,
        width: {
            size: 100,
            type: WidthType.PERCENTAGE,
        },
        borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
            left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
            right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
            insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
        }
    });
}

const cleanRefinedText = (text: string): string => {
  if (!text) return text;
  
  let res = text;

  const examKeywords = [
    'SSC\\s*(?:CGL|CHSL|MTS|CPO|GD|JE)?',
    'CGL', 'CHSL', 'MTS', 'CPO', 'GD',
    'RRB\\s*(?:NTPC|ALP|JE|Group\\s*D)?',
    'NTPC', 'ALP', 'Group\\s*D',
    'UPSC\\s*(?:CSE|IAS|IPS|NDA|CDS|CAPF)?',
    'BPSC', 'UPPSC', 'MPPSC', 'HSSC', 'RAS', 'RPSC', 'UKPSC', 'JPSC', 'CGPSC',
    'IBPS\\s*(?:PO|Clerk)?', 'SBI\\s*(?:PO|Clerk)?',
    'CTET', 'TET', 'REET', 'HTET', 'UPTET', 'NET', 'JRF', 'CSIR', 'GATE',
    'Tier\\s*[-–—]?\\s*(?:I|II|III|IV|1|2|3|4)',
    'Shift\\s*[-–—]?\\s*(?:I|II|III|IV|1|2|3|4)',
    'CBE', 'CBSE', 'NTA',
    'प्रथम\\s*पाली', 'द्वितीय\\s*पाली', 'तृतीय\\s*पाली', 'पाली',
    'परीक्?षा', 'स्मृति\\s*पर\\s*आधारित', 'Memory\\s*Based'
  ];

  const examPattern = `(?:${examKeywords.join('|')})`;
  const examRegex = new RegExp(`\\b${examPattern}`, 'i');

  const lines = res.split('\n');
  const cleanedLines: string[] = [];

  for (let line of lines) {
    let trimmed = line.trim();
    if (!trimmed) {
      cleanedLines.push('');
      continue;
    }

    if (examRegex.test(trimmed)) {
      const isQuestion = /^#?(?:Question|Q)\.?\s*[:\-]?\s*\d+/i.test(trimmed);
      const isOption = /^(\([a-eA-E0-9]\)|[a-eA-E0-9][\.\)])\s+/i.test(trimmed);

      if (!isQuestion && !isOption) {
        continue;
      }
    }

    if (examRegex.test(trimmed)) {
      const slashTagMatch = trimmed.match(/\s*\/+\s*[\(\[](.*)$/);
      if (slashTagMatch && examRegex.test(slashTagMatch[1])) {
        trimmed = trimmed.substring(0, slashTagMatch.index).trim();
      } else {
        const parenTagMatch = trimmed.match(/\s+[\(\[](.*)$/);
        if (parenTagMatch && examRegex.test(parenTagMatch[1])) {
          trimmed = trimmed.substring(0, parenTagMatch.index).trim();
        }
      }
    }

    if (/^(?:Page\s*\d+|\d+\s*\|\s*Page|Chapter\s*\d+|www\.[a-z0-9\.\-_]+|t\.me\/[a-z0-9\-_]+|Telegram\s*:|Join\s*Telegram)/i.test(trimmed)) {
      continue;
    }

    cleanedLines.push(trimmed);
  }

  return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

export const generateDocx = async (
    elements: ExtractedElement[],
    optionArrangement: OptionArrangement = OptionArrangement.VERTICAL,
    showSerialNumbers: boolean = true,
    numberingStyle: NumberingStyle = NumberingStyle.QUESTION_DOT,
    showAnswers: boolean = true
): Promise<Blob> => {
  const docChildren: any[] = [];
  let tableBuffer: string[] = [];
  let optionBuffer: string[] = [];
  let qSerialCounter = 1;
  
  const flushTable = () => {
    if (tableBuffer.length > 0) {
      docChildren.push(createDocxTable(tableBuffer));
      tableBuffer = [];
      docChildren.push(new Paragraph(""));
    }
  };

  const flushOptions = () => {
    if (optionBuffer.length === 0) return;
    
    if (optionArrangement === OptionArrangement.VERTICAL) {
      for (const opt of optionBuffer) {
        docChildren.push(new Paragraph({
          children: parseLineToChildren(opt) as any[],
          indent: { left: 1440, hanging: 360 },
          spacing: { before: 0, after: 0, line: 240 },
          alignment: AlignmentType.LEFT
        }));
      }
    } else if (optionArrangement === OptionArrangement.HORIZONTAL) {
      const children: any[] = [];
      optionBuffer.forEach((opt, idx) => {
          children.push(...parseLineToChildren(opt));
          if (idx < optionBuffer.length - 1) {
              children.push(new TextRun({ text: "    " })); // 4 spaces
          }
      });
      docChildren.push(new Paragraph({
        children: children,
        indent: { left: 1440, hanging: 360 },
        spacing: { before: 0, after: 0, line: 240 },
        alignment: AlignmentType.LEFT
      }));
    } else if (optionArrangement === OptionArrangement.GRID) {
      // 2 options per line using tabs
      for (let i = 0; i < optionBuffer.length; i += 2) {
        const pair = optionBuffer.slice(i, i + 2);
        const children: any[] = [];
        
        children.push(...parseLineToChildren(pair[0]));
        if (pair.length > 1) {
            children.push(new TextRun({ text: "\t" }));
            children.push(...parseLineToChildren(pair[1]));
        }

        docChildren.push(new Paragraph({
          children: children,
          tabStops: [{ type: TabStopType.LEFT, position: 4500 }],
          indent: { left: 1440, hanging: 360 },
          spacing: { before: 0, after: 0, line: 240 },
          alignment: AlignmentType.LEFT
        }));
      }
    }
    optionBuffer = [];
  };

  for (const element of elements) {
    if (element.type === 'image' && element.imageB64) {
      flushTable();
      
      // Convert base64 to Uint8Array for docx
      let binaryData: string;
      try {
        const base64Data = element.imageB64.split(',')[1] || element.imageB64;
        // Basic validation for base64 string
        if (!base64Data || base64Data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(base64Data)) {
           console.warn("Skipping invalid base64 image data");
           continue;
        }
        binaryData = atob(base64Data);
      } catch (e) {
        console.error("Failed to decode base64 image:", e);
        continue; // Skip this image if it can't be decoded
      }
      
      const bytes = new Uint8Array(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
        bytes[i] = binaryData.charCodeAt(i);
      }

      // Calculate dimensions based on bbox aspect ratio if available
      let imgWidth = 350; // Default width in points (approx 3.5 inches)
      let imgHeight = 250; // Default height

      if (element.bbox) {
        const bboxWidth = element.bbox.xmax - element.bbox.xmin;
        const bboxHeight = element.bbox.ymax - element.bbox.ymin;
        if (bboxWidth > 0 && bboxHeight > 0) {
          const aspectRatio = bboxWidth / bboxHeight;
          
          // Limit max width to 450 (4.5 inches)
          // If it's a very wide image, use max width
          // If it's a tall image, limit height
          if (aspectRatio > 1.5) {
            imgWidth = 400;
            imgHeight = 400 / aspectRatio;
          } else if (aspectRatio < 0.5) {
            imgHeight = 350;
            imgWidth = 350 * aspectRatio;
          } else {
            imgWidth = 300;
            imgHeight = 300 / aspectRatio;
          }
        }
      }

      docChildren.push(new Paragraph({
        children: [
          new ImageRun({
            data: bytes,
            transformation: {
              width: imgWidth,
              height: imgHeight,
            },
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 240 },
      }));
      continue;
    }

    if (!element.content) continue;
    
    let content = cleanRefinedText(cleanBilingualDuplicates(element.content || ''));
    if (!showAnswers) {
        content = content
            .replace(/([^\n]+?)\s*\/+\s*Answer\s*[:\-]\s*[a-eA-E]/gi, '$1')
            .replace(/^\s*Answer\s*[:\-]\s*[a-eA-E]\s*$/gim, '')
            .replace(/([^\n])\s+Answer\s*[:\-]\s*[a-eA-E]/gi, '$1')
            .trim();
    }
    
    // Protection for multi-line math: join sections between $$ and $$
    let blockMathRestored = content;
    const mathBlocks = content.match(/\$\$[\s\S]*?\$\$/g);
    if (mathBlocks) {
        mathBlocks.forEach((block, idx) => {
            const protectedBlock = block.replace(/\n/g, ' [[MATH_BR]] ');
            blockMathRestored = blockMathRestored.replace(block, protectedBlock);
        });
    }

    const rawLines = blockMathRestored.split('\n');
    const lines: string[] = [];
    let currentLineBuffer = "";

    for (let i = 0; i < rawLines.length; i++) {
        let line = rawLines[i].trim();
        if (!line) {
            if (currentLineBuffer) lines.push(currentLineBuffer.replace(/ \[\[MATH_BR\]\] /g, '\n'));
            currentLineBuffer = "";
            continue;
        }

        const cleanLineText = line.replace(/\*\*/g, '').replace(/ \[\[MATH_BR\]\] /g, ' ');
        const isHeader = /^(Section|Part|Khand|Unit|Q\.\s*Paper|Paper|Code|Set)\s+[\w\d]+/i.test(cleanLineText) && cleanLineText.length < 50;
        const isMetadata = /^(Subject|Time|Max\.?\s*Marks|Marks|Class|Date|Roll\s*No|Duration)\s*[:\-]/i.test(cleanLineText);
        const isInstruction = /^(Note|Instructions?|General\s*Instructions?)\s*[:\-]/i.test(cleanLineText);
        const isSeparator = /^(\(OR\)|OR|अथवा|Athava|[\/]\s*OR|OR\s*[\/]|\s)+$/i.test(cleanLineText.replace(/[^a-zA-Z\u0900-\u097F\/]/g, '').trim());
        const isFullEquation = line.includes('$$');
        const isMainQuestion = /^#\s/i.test(cleanLineText) || /^(Q\.?\s*\d+|Prashn\s*\d+|Question\s*[:\-]?\s*\d+|प्रश्न\s*\d+|\d+|[\(\[]\d+[\)\]]|#\d+)[\.\)\-:]?\s/i.test(cleanLineText);
        const isSubQuestion = /^(\([ivxIVX]+\)|[ivxIVX]+\.|[ivxIVX]+[\)]|[\(\[]\w+[\)\]])\s/i.test(cleanLineText);
        const isOption = /^(\([a-zA-Z0-9]\)|[a-zA-Z0-9][\.\)]|[A-Z][\.\)])\s/.test(cleanLineText);
        const isAnswerLine = /^Answer\s*[:\-]\s*[A-Ea-e]/i.test(cleanLineText);
        const isTableRow = (line.startsWith('|') && line.endsWith('|')) || (line.startsWith('|') && line.split('|').length > 2);
        const isBlockquote = line.startsWith('>');

        const isNewBlock = isHeader || isMetadata || isInstruction || isSeparator || isFullEquation || isMainQuestion || isSubQuestion || isOption || isAnswerLine || isTableRow || isBlockquote;

        if (isNewBlock) {
            if (currentLineBuffer) lines.push(currentLineBuffer.replace(/ \[\[MATH_BR\]\] /g, '\n'));
            currentLineBuffer = line;
        } else {
            const cleanBuf = currentLineBuffer.replace(/\*\*/g, '').trim();
            const isPrevQuestion = /^#\s/i.test(cleanBuf) || /^(Q\.?\s*\d+|Prashn\s*\d+|Question\s*[:\-]?\s*\d+|प्रश्न\s*\d+|\d+|[\(\[]\d+[\)\]]|#\d+)[\.\)\-:]?\s/i.test(cleanBuf);
            const isPrevOption = /^(\([a-zA-Z0-9]\)|[a-zA-Z0-9][\.\)]|[A-Z][\.\)])\s/.test(cleanBuf);
            
            if (isPrevOption) {
                // If previous line was an option, ALWAYS join with ' / ' on the same line!
                currentLineBuffer += " / " + line;
            } else if (isPrevQuestion) {
                // If previous line was a question, join with newline '\n' to place English below Hindi!
                currentLineBuffer += "\n" + line;
            } else {
                currentLineBuffer += (currentLineBuffer ? " " : "") + line;
            }
        }
    }
    if (currentLineBuffer) lines.push(currentLineBuffer.replace(/ \[\[MATH_BR\]\] /g, '\n'));
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // 1. Table Handling
      const isTableRow = (line.startsWith('|') && line.endsWith('|')) || (line.startsWith('|') && line.split('|').length > 2);
      if (isTableRow || element.type === 'table') {
          flushOptions();
          tableBuffer.push(line);
          if (element.type === 'table' && i === lines.length - 1) flushTable();
          continue;
      } else {
          flushTable();
      }

      if (!line) {
          flushOptions();
          continue; 
      }

    // --- HEURISTICS FOR EXAM LAYOUT ---

    // 1.5. Markdown Headings (#, ##, ###)
    if (/^#\s+([^#].*)/.test(line)) {
        flushOptions();
        const headingText = line.replace(/^#\s+/, '').trim();
        docChildren.push(new Paragraph({
            children: parseLineToChildren(headingText, true),
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 280, after: 140 },
            alignment: AlignmentType.CENTER
        }));
        continue;
    }
    if (/^##\s+([^#].*)/.test(line)) {
        flushOptions();
        const headingText = line.replace(/^##\s+/, '').trim();
        docChildren.push(new Paragraph({
            children: parseLineToChildren(headingText, true),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 240, after: 120 },
            alignment: AlignmentType.LEFT
        }));
        continue;
    }
    if (/^###\s+(.*)/.test(line)) {
        flushOptions();
        const headingText = line.replace(/^###\s+/, '').trim();
        docChildren.push(new Paragraph({
            children: parseLineToChildren(headingText, true),
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 100 },
            alignment: AlignmentType.LEFT
        }));
        continue;
    }

    // 1.6. Bulleted Lists (•, -, *)
    if (/^[•\-\*]\s+(.*)/.test(line)) {
        flushOptions();
        const bulletText = line.replace(/^[•\-\*]\s+/, '').trim();
        docChildren.push(new Paragraph({
            children: [
                new TextRun({ text: "•  ", bold: true, font: "Arial", size: 22 }),
                ...parseLineToChildren(bulletText)
            ],
            indent: { left: 720, hanging: 360 },
            spacing: { before: 40, after: 40, line: 276 },
            alignment: AlignmentType.LEFT
        }));
        continue;
    }

    // 2. Section Headers (e.g. "SECTION A", "PART I")
    // Force Center, Bold, Uppercase
    if (/^(Section|Part|Khand|Unit|Q\.\s*Paper|Paper|Code|Set)\s+[\w\d]+/i.test(line) && line.length < 50) {
        flushOptions();
        // Strip markdown bold if present, we will force bold anyway
        const cleanLine = line.replace(/\*\*/g, '').toUpperCase();
        docChildren.push(new Paragraph({
            children: parseLineToChildren(cleanLine, true), 
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 240, after: 120 },
            alignment: AlignmentType.CENTER
        }));
        continue;
    }

    // 3. Metadata (Subject, Time, etc.)
    // Standard format: Bold label, normal text.
    // e.g. "**Subject**: Science" or "Subject: Science"
    if (/^(Subject|Time|Max\.?\s*Marks|Marks|Class|Date|Roll\s*No|Duration)\s*[:\-]/i.test(line.replace(/\*\*/g, ''))) {
         flushOptions();
         docChildren.push(new Paragraph({
            children: parseLineToChildren(line), // Let the parser handle **bold** parts naturally
            spacing: { before: 60, after: 60 },
            alignment: AlignmentType.LEFT 
        }));
        continue;
    }

    // 4. Instructions
    if (/^(Note|Instructions?|General\s*Instructions?)\s*[:\-]/i.test(line.replace(/\*\*/g, ''))) {
        flushOptions();
        docChildren.push(new Paragraph({
            children: parseLineToChildren(line, true), // Force Bold
            spacing: { before: 120, after: 60 },
            alignment: AlignmentType.LEFT
        }));
        continue;
    }

    // 5. OR Separator
    if (/^(\(OR\)|OR|अथवा|Athava|[\/]\s*OR|OR\s*[\/]|\s)+$/i.test(line.replace(/[^a-zA-Z\u0900-\u097F\/]/g, '').trim())) {
         flushOptions();
         docChildren.push(new Paragraph({
            children: parseLineToChildren(line.replace(/\*\*/g, ''), true),
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
        }));
        continue;
    }

    // 6. Equations (Centered Block)
    const isFullEquation = line.startsWith('$$') && line.endsWith('$$') && (line.match(/\$\$/g) || []).length === 2;
    if (isFullEquation) {
        flushOptions();
        docChildren.push(new Paragraph({
            children: parseLineToChildren(line),
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
        }));
        continue;
    }

    // 7. Questions & Options (Indentation Logic)
    
    const cleanLineText = line.replace(/\*\*/g, '').trim();

    // Main Question: "# What is...", "Q.1", "(1) ", "1) ", "1.", "प्रश्न 1", "Question: 1.", "Q1."
    const isMainQuestion = /^#\s/i.test(cleanLineText) || /^(Q\.?\s*\d+|Prashn\s*\d+|Question\s*[:\-]?\s*\d+|प्रश्न\s*\d+|\d+|[\(\[]\d+[\)\]]|#\d+)[\.\)\-:]?\s/i.test(cleanLineText);
    
    // Answer line: "Answer: A"
    const isAnswerLine = /^Answer\s*[:\-]\s*[A-Ea-e]/i.test(cleanLineText);

    // Option: "(a)", "a.", "a)", "(A)", "A.", "A)", "(E)", "E.", "E)", "(1)", "1.", "1)" if it looks like an option
    // We check for single letters or numbers followed by punctuation or inside parentheses
    const isOption = !isAnswerLine && /^(\([a-zA-Z0-9]\)|[a-zA-Z0-9][\.\)]|[A-Z][\.\)])\s/.test(cleanLineText);
    
    // Sub Question: "(i)", "i.", "(a)" if it looks like a list item (Roman numerals are prioritized)
    const isSubQuestion = /^(\([ivxIVX]+\)|[ivxIVX]+\.|[ivxIVX]+[\)]|[\(\[]\w+[\)\]])\s/i.test(cleanLineText);

    if (isOption) {
        optionBuffer.push(cleanBilingualDuplicates(line));
        continue;
    } else if (isAnswerLine) {
        flushOptions();
        docChildren.push(new Paragraph({
            children: parseLineToChildren(line, true), // Bold Answer
            spacing: { before: 60, after: 120 },
            alignment: AlignmentType.LEFT,
            indent: { left: 500 }
        }));
        continue;
    } else {
        flushOptions();
    }

    let indent = undefined;
    let spacing = { before: 80, after: 80, line: 276 }; // Slightly more spacing
    let borders = undefined;

    if (isSubQuestion) {
        // Sub-questions indented further
        indent = { left: 1080, hanging: 450 };
    } else if (isMainQuestion) {
        // Main questions: Number starts at 0, text at 0.35 inch
        indent = { left: 500, hanging: 500 };
    }

    const meta = { isBlockquote: false };

    if (isMainQuestion) {
        let processedLine = cleanBilingualDuplicates(line);
        if (showSerialNumbers) {
            processedLine = processedLine.replace(/^(\s*(?:#?(?:Question|Q)\.?\s*[:\-]?\s*|\bPrashn\s*|\bप्रश्न\s*)?)(\d+)?([\.\)\-:]?\s+)/i, (_m, prefix, num) => {
                if (/Question|Q|Prashn|प्रश्न|#/i.test(prefix) || num) {
                    return formatQuestionPrefix(qSerialCounter++, numberingStyle);
                }
                return _m;
            });
        } else {
            processedLine = processedLine.replace(/^(\s*(?:#?(?:Question|Q)\.?\s*[:\-]?\s*|\bPrashn\s*|\bप्रश्न\s*)?)(\d+)([\.\)\-:]?\s+)/i, (_m, _prefix, num) => {
                return formatQuestionPrefix(num, numberingStyle);
            });
        }
        const subLines = processedLine.split('\n');
        if (subLines.length > 1) {
            // First line: Hindi Question (with hanging indent)
            docChildren.push(new Paragraph({
                children: parseLineToChildren(subLines[0], false, meta) as any[],
                alignment: AlignmentType.BOTH,
                spacing: { before: 80, after: 20, line: 276 },
                indent: { left: 500, hanging: 500 }
            }));
            // Subsequent lines: English translation (with left indent aligned under question text)
            for (let s = 1; s < subLines.length; s++) {
                if (!subLines[s].trim()) continue;
                docChildren.push(new Paragraph({
                    children: parseLineToChildren(subLines[s], false, meta) as any[],
                    alignment: AlignmentType.BOTH,
                    spacing: { before: 0, after: 80, line: 276 },
                    indent: { left: 500 }
                }));
            }
            continue;
        } else {
            docChildren.push(new Paragraph({
                children: parseLineToChildren(subLines[0], false, meta) as any[],
                alignment: AlignmentType.BOTH,
                spacing: { before: 80, after: 80, line: 276 },
                indent: { left: 500, hanging: 500 }
            }));
            continue;
        }
    }

    const children = parseLineToChildren(line, false, meta);

    if (meta.isBlockquote) {
        indent = { left: 720 }; // 0.5 inch indent
        borders = {
            left: {
                style: BorderStyle.SINGLE,
                size: 20,
                color: "CCCCCC",
                space: 10
            }
        };
    }

    docChildren.push(new Paragraph({
        children: children as any[],
        alignment: AlignmentType.BOTH, // Justified Text for professional look
        spacing: spacing,
        indent: indent,
        border: borders
    }));
    
    } // End of inner lines loop
  } // End of outer elements loop

  // Flush remaining
  flushOptions();
  if (tableBuffer.length > 0) {
      docChildren.push(createDocxTable(tableBuffer));
  }

  const doc = new Document({
    sections: [
      {
        properties: {
            page: {
                // Standard Narrow Margins (0.5 inch = 720 twips)
                margin: {
                    top: 720,
                    right: 720,
                    bottom: 720,
                    left: 720,
                },
            },
        },
        children: docChildren,
      },
    ],
  });

  return await Packer.toBlob(doc);
};