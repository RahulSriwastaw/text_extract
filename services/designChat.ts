/**
 * Design Studio AI chat: the prompt (built on the server) and the request/response shapes.
 * The model answers with a short reply plus DesignOps; services/designDoc.ts validates and applies them.
 */
import type { Layout, Theme } from './designDoc';

// Kept in step with FONTS in designDoc.ts (not imported: that module pulls in the Word library, which the server prompt does not need).
const FONT_IDS = ['sans', 'serif', 'hindi', 'mangal', 'kokila', 'aparajita', 'utsaah', 'calibri', 'cambria', 'georgia', 'verdana', 'comic'];

export interface DesignChatTurn { role: 'user' | 'assistant'; text: string }

export interface DesignChatRequest {
  outline: unknown;              // outlineForAi(doc, …)
  theme: Theme;
  layout: Layout;
  history: DesignChatTurn[];
  request: string;
  /** Only this page is shown (and may be changed). */
  scopePageId?: string;
  /** The outline carries every block's whole text (needed to pick words to bold / highlight). */
  fullText?: boolean;
  /** "2 of 5" when a long document is sent in parts. */
  part?: string;
}

export interface DesignChatResponse {
  reply: string;
  ops: unknown[];
  /** The AI's reply was cut off; only the operations that arrived complete are included. */
  truncated?: boolean;
}

export interface DesignTemplate {
  label: string;
  request: string;
  /** The AI must read whole texts: sent in full-text mode (more tokens). */
  fullText?: boolean;
  /** Switch to slides and auto-fit after this template. */
  slides?: boolean;
}

/** Ready-made requests in a classroom teaching style. One click does the whole job. */
export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    label: 'Teaching slides: full makeover',
    fullText: true, slides: true,
    request: `Turn this into clean classroom teaching slides.
1. Remove everything that is not lesson content: lone page numbers, "Reprint" lines, repeated book-name / chapter-name header or footer lines, stray figure labels left without their figure, and empty or duplicate lines.
2. Proofread: with updateBlock, correct only clear spelling, matra, spacing, punctuation and OCR/typing mistakes, and join a sentence that was broken across two blocks. Do not rephrase, shorten, translate or add anything.
3. Set a clean colorful theme: banner headings, a calm primary colour, readable dark text, white or very light page background.
4. Make every chapter / section / activity title a heading (level 1 for the chapter, 2 for sections, 3 for activities) if it is not one already.
5. In every paragraph and list, bold AND highlight (mark "both") the 1-3 most important key terms or definitions; bold (mark "bold") other important words. Do not mark whole sentences.
6. Turn cautions, notes, "remember" lines and conclusions into callout blocks.
7. Use the slides layout and start a new slide at every heading and at every new activity or topic. Give each slide a short title when it does not start with a heading.`,
  },
  {
    label: 'Clean & proofread the text',
    fullText: true,
    request: `Clean and proofread, nothing else.
1. Remove everything that is not lesson content: lone page numbers, "Reprint" lines, repeated book-name / chapter-name header or footer lines, stray figure labels left without their figure, and empty or duplicate lines.
2. With updateBlock, correct only clear spelling, matra, spacing, punctuation and OCR/typing mistakes, and join a sentence that was broken across two blocks (update the first block, remove the second). Do not rephrase, shorten, translate or add anything. Leave correct blocks alone.`,
  },
  {
    label: 'Highlight key terms & definitions',
    fullText: true,
    request: 'In every paragraph and list, highlight (mark "both") the 1-3 most important key terms, definitions and scientific words. Mark only the exact words, never whole sentences. Do not change any text.',
  },
  {
    label: 'Bold important words',
    fullText: true,
    request: 'In every paragraph, bold (mark "bold") the important words a teacher would stress while reading aloud: key nouns, names, numbers and conclusions. At most 4 per block. Do not change any text.',
  },
  {
    label: 'Remove page numbers & book headers',
    request: 'Remove printing leftovers only: blocks that are just a page number, "Reprint ..." lines, and repeated book-name / chapter-name header or footer lines. Remove nothing else.',
  },
  {
    label: 'Make PPT slides (one topic per slide)',
    slides: true,
    request: 'Use the slides layout. Start a new slide at every heading and at every new activity, topic or question, and give each slide a short title. Keep a question with its options, answer and figure.',
  },
  {
    label: 'Cautions & notes in coloured boxes',
    fullText: true,
    request: 'Turn every caution, warning, note, "remember" line and conclusion into a callout block (updateBlock with type "callout"), keeping its text exactly.',
  },
  {
    label: 'Colourful classroom theme',
    request: 'Set a bright, friendly classroom theme: banner headings, a strong primary colour with a matching accent, boxed questions, dark readable text on a white page.',
  },
  {
    label: 'Black & white exam paper',
    request: 'Set a plain black and white exam-paper style: serif font, plain headings, plain questions, options in 4 columns, document layout.',
  },
];

export function designChatPrompt({ outline, theme, layout, history, request, scopePageId, fullText, part }: DesignChatRequest): string {
  return `You are the design assistant inside a document design tool used by teachers. The document was extracted from scanned textbooks, question papers and notes (Hindi and English).
You change the DESIGN and LAYOUT by returning operations. You never rewrite the whole document.

Reply with ONE JSON object and nothing else:
{"reply": "<one or two short sentences, in the user's language (Hindi, Hinglish or English)>", "ops": [ ...operations... ]}

OPERATIONS (use only these, with exactly these field names):
- {"op":"setTheme","patch":{...}}  Theme fields: primary, accent, text, pageBackground (colors "#RRGGBB"); font ${FONT_IDS.map(id => `"${id}"`).join('|')} (hindi, mangal, kokila, aparajita, utsaah are Hindi fonts; kokila/aparajita look like a printed book); baseSize 9-18 (pt); headingStyle "plain"|"bar"|"banner"; questionStyle "plain"|"boxed"|"numbered-badge"; optionColumns 1|2|4; header, footer (short text); showPageNumbers true|false.
- {"op":"styleBlocks","type":"<block type>","style":{...}}  styles EVERY block of that type. Or {"op":"styleBlocks","ids":["b3","b7"],"style":{...}} for specific blocks. Optional "pageId" limits it to one page.
  Style fields: color, background, borderColor ("#RRGGBB"); align "left"|"center"|"right"; size "sm"|"md"|"lg"|"xl"; bold, italic (true|false); border "none"|"box"|"left-bar"|"underline".
- {"op":"emphasize","id":"b3","phrases":["exact words","another phrase"],"mark":"bold"|"highlight"|"both"}  marks words INSIDE a block without rewriting it. Each phrase must be copied exactly, character for character, from that block's text. "both" = bold + highlight. This is the way to bold or highlight words.
- {"op":"updateBlock","id":"b3","text":"...","type":"<block type>","level":1|2|3}  change one block's type (e.g. paragraph → heading or callout) and/or its text. Give "text" ONLY when the user asked to change wording.
- {"op":"insertBlock","afterId":"b3","block":{"type":"heading","text":"...","level":2}}  add a text block (never an image).
- {"op":"removeBlock","id":"b3"}
- {"op":"moveBlock","id":"b3","afterId":"b9"}
- {"op":"setLayout","layout":"document"|"slides"}  document = A4 portrait pages, slides = 16:9 PPT-style slides.
- {"op":"paginate","breaks":[{"beforeBlockId":"b9","title":"Slide title"}, ...]}  re-splits the content into pages/slides: a new page starts at each listed block. Optional "pageId" splits only that page.
- {"op":"setPage","pageId":"p2","title":"...","background":"#RRGGBB"}

Block types: heading, paragraph, question, option, answer, list, table, image, callout, divider.

RULES:
- Prefer setTheme and styleBlocks by type: one operation restyles the whole document. Do not list every block id when a type works.
- Keep text readable: dark text on light backgrounds, light text only on dark backgrounds. Boxes use light tints.
- OVERFLOW IS HANDLED BY THE APP: after your operations it automatically moves extra blocks to a new slide, splits long tables and paragraphs, and shrinks text if needed. So never rewrite, shorten or split a block's text to make it fit, and never reduce the font size for that reason. Just choose sensible slide starts with paginate.
- For slides: setLayout "slides", then ONE paginate listing every slide start for the whole document (or for the part you are shown). Group by topic: a heading starts a slide; keep a question with its options, answer and figure.
- A design request must not change any wording. To bold or highlight use "emphasize", never updateBlock.
- Change wording (updateBlock "text") only when the user asks to proofread, correct or rewrite. Then: give the block's complete corrected text; keep its meaning, numbers, names, $LaTeX$ and any existing **bold** / ==highlight== markers; never add new ** or == yourself. If you also emphasize that block, put its updateBlock first and copy the phrases from the corrected text.
- Only use block ids and page ids that appear in the outline. Text ending in "…" is shortened for you: you cannot emphasize words you cannot see, and must never copy shortened text into updateBlock.
- If the request is unclear or impossible, return "ops": [] and explain briefly in "reply".
- Be economical: one emphasize operation per block (list all its phrases together), phrases of 1-4 words. At most 100 operations. Put "reply" FIRST in the JSON and keep it to one sentence.

CURRENT LAYOUT: ${layout}
CURRENT THEME: ${JSON.stringify(theme)}
${scopePageId ? `SCOPE: only page ${scopePageId} is shown and may be changed (theme changes still apply to the whole document).`
    : part ? `SCOPE: part ${part} of the document, with full text. Change only the blocks shown here. Theme operations are allowed (they apply to the whole document).`
    : fullText ? 'SCOPE: whole document, with full text.' : 'SCOPE: whole document. Long texts are shortened.'}

DOCUMENT OUTLINE (pages → blocks):
${JSON.stringify(outline)}

CONVERSATION SO FAR:
${history.length ? history.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`).join('\n') : '(none)'}

USER REQUEST:
${request}`;
}
