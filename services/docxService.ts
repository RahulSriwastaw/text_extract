import * as docx from "docx";

// Workaround: Handle ESM/CJS interop issues where named exports might be missing in the bundle
// We treat 'docx' as a namespace and extract classes from it.
const docxLib = (docx as any).default || docx;

const { 
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
  Math: DocxMath, 
  MathRun, 
  MathFraction, 
  MathSuperScript, 
  MathSubScript, 
  MathSubSuperScript, 
  MathRadical, 
  MathNary, 
  MathNaryLimitLocation,
  ImageRun,
  TabStopType
} = docxLib;

import { ExtractedElement, OptionArrangement } from "../types";

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
    'surd': '√', 'triangle': '△',
    'square': '□', 'blacksquare': '■', 'bullet': '•', 'ast': '∗', 'star': '★', 'oplus': '⊕', 'ominus': '⊖',
    'otimes': '⊗', 'oslash': '⊘', 'odot': '⊙', 'dagger': '†', 'ddagger': '‡',
    'uplus': '⊎', 'sqcap': '⊓', 'sqcup': '⊔',
    'setminus': '∖', 'wr': '≀', 'diamond': '⋄',
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
                     let limitLocation = (cmd.includes('int') || cmd.includes('oint')) 
                        ? (MathNaryLimitLocation ? MathNaryLimitLocation.SUB_SUP : undefined) 
                        : (MathNaryLimitLocation ? MathNaryLimitLocation.UND_OVR : undefined);
                     
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
                                 if(MathNaryLimitLocation) limitLocation = MathNaryLimitLocation.UND_OVR; 
                             }
                             if (processedLatex.slice(j).startsWith('\\nolimits')) { 
                                 j += 9; skipping = true; 
                                 if(MathNaryLimitLocation) limitLocation = MathNaryLimitLocation.SUB_SUP; 
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
                     
                     if (MathNary) {
                         nodes.push(new MathNary({ char: naryChar, subScript: sub, superScript: sup, limitLocation: limitLocation }));
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
    let content = trimmed;
    if (trimmed.startsWith('>')) {
        if (meta) meta.isBlockquote = true;
        content = trimmed.substring(1).trim();
    }

    // Normalize LaTeX delimiters
    let processed = content.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$ $1 $$$$');
    processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, '$$$$ $1 $$$$');
    processed = processed.replace(/(?<!\$)\$(?!\$)([^\$]+?)(?<!\$)\$(?!\$)/g, '$$$$ $1 $$$$');

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

                return new TextRun({ 
                    text: cleanText, 
                    font: "Arial", 
                    size: 22, // 11pt
                    bold: isBold,
                    noProof: true 
                });
            });
        }
    }).flat().filter(Boolean);
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

export const generateDocx = async (
    elements: ExtractedElement[],
    optionArrangement: OptionArrangement = OptionArrangement.VERTICAL
): Promise<Blob> => {
  const docChildren: any[] = [];
  let tableBuffer: string[] = [];
  let optionBuffer: string[] = [];
  
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
    const isComplexTable = element.type === 'table' && element.content && isTableTooComplex(element.content.split('\n'));
    
    if ((element.type === 'image' || isComplexTable) && element.imageB64) {
      flushTable();
      
      // Convert base64 to Uint8Array for docx
      const base64Data = element.imageB64.split(',')[1] || element.imageB64;
      const binaryData = atob(base64Data);
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
      
      if (isComplexTable) {
          docChildren.push(new Paragraph({
              children: [new TextRun({ text: "(Table rendered as image due to complexity)", size: 16, italic: true, color: "666666" })],
              alignment: AlignmentType.CENTER,
              spacing: { after: 120 }
          }));
      }
      continue;
    }

    if (!element.content) continue;
    
    // Pre-process lines to merge those that don't start a new block
    const content = element.content || '';
    const rawLines = content.split('\n');
    const lines: string[] = [];
    let currentLineBuffer = "";

    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i].trim();
        if (!line) {
            if (currentLineBuffer) lines.push(currentLineBuffer);
            currentLineBuffer = "";
            continue;
        }

        const cleanLineText = line.replace(/\*\*/g, '');
        const isHeader = /^(Section|Part|Khand|Unit|Q\.\s*Paper|Paper|Code|Set)\s+[\w\d]+/i.test(line) && line.length < 50;
        const isMetadata = /^(Subject|Time|Max\.?\s*Marks|Marks|Class|Date|Roll\s*No|Duration)\s*[:\-]/i.test(cleanLineText);
        const isInstruction = /^(Note|Instructions?|General\s*Instructions?)\s*[:\-]/i.test(cleanLineText);
        const isSeparator = /^(\(OR\)|OR|अथवा|Athava|[\/]\s*OR|OR\s*[\/]|\s)+$/i.test(line.replace(/[^a-zA-Z\u0900-\u097F\/]/g, '').trim());
        const isFullEquation = line.startsWith('$$') && line.endsWith('$$') && (line.match(/\$\$/g) || []).length === 2;
        const isMainQuestion = /^#\s/i.test(cleanLineText) || /^(Q\.?\s?\d+|Prashn\s?\d+|Question\s?\d+|प्रश्न\s?\d+|\d+\.|[\(\[]\d+[\)\]]|\d+[\)])\s/i.test(cleanLineText);
        const isSubQuestion = /^(\([ivxIVX]+\)|[ivxIVX]+\.|[ivxIVX]+[\)]|[\(\[]\w+[\)\]])\s/i.test(cleanLineText);
        const isOption = /^(\([a-zA-Z0-9]\)|[a-zA-Z0-9][\.\)]|[A-Z][\.\)])\s/.test(cleanLineText);
        const isTableRow = (line.startsWith('|') && line.endsWith('|')) || (line.startsWith('|') && line.split('|').length > 2);
        const isBlockquote = line.startsWith('>');

        const isNewBlock = isHeader || isMetadata || isInstruction || isSeparator || isFullEquation || isMainQuestion || isSubQuestion || isOption || isTableRow || isBlockquote;

        if (isNewBlock) {
            if (currentLineBuffer) lines.push(currentLineBuffer);
            currentLineBuffer = line;
        } else {
            currentLineBuffer += (currentLineBuffer ? " " : "") + line;
        }
    }
    if (currentLineBuffer) lines.push(currentLineBuffer);
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // 1. Table Handling
      const isTableRow = (line.startsWith('|') && line.endsWith('|')) || (line.startsWith('|') && line.split('|').length > 2);
      if (isTableRow || element.type === 'table') {
          // If it's a table element that we already decided was too complex, we skip it here
          // because it was already handled as an image at the top of the loop.
          if (element.type === 'table' && isComplexTable) continue;

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

    // Main Question: "# What is...", "Q.1", "(1) ", "1) ", "1.", "प्रश्न 1", "Q1."
    const isMainQuestion = /^#\s/i.test(cleanLineText) || /^(Q\.?\s?\d+|Prashn\s?\d+|Question\s?\d+|प्रश्न\s?\d+|\d+\.|[\(\[]\d+[\)\]]|\d+[\)])\s/i.test(cleanLineText);
    
    // Option: "(a)", "a.", "a)", "(A)", "A.", "A)", "(E)", "E.", "E)", "(1)", "1.", "1)" if it looks like an option
    // We check for single letters or numbers followed by punctuation or inside parentheses
    const isOption = /^(\([a-zA-Z0-9]\)|[a-zA-Z0-9][\.\)]|[A-Z][\.\)])\s/.test(cleanLineText);
    
    // Sub Question: "(i)", "i.", "(a)" if it looks like a list item (Roman numerals are prioritized)
    const isSubQuestion = /^(\([ivxIVX]+\)|[ivxIVX]+\.|[ivxIVX]+[\)]|[\(\[]\w+[\)\]])\s/i.test(cleanLineText);

    if (isOption) {
        optionBuffer.push(line);
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
        borders: borders
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