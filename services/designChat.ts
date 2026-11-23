/**
 * Design Studio AI chat: the prompt (built on the server) and the request/response shapes.
 * The model answers with a short reply plus DesignOps; services/designDoc.ts validates and applies them.
 */
import type { Layout, Theme } from './designDoc';

// Kept in step with FONTS / CALLOUTS / STYLE_KEYS in designDoc.ts (not imported: that module pulls
// in the Word library, which the server prompt does not need).
const FONT_IDS = ['sans', 'serif', 'hindi', 'mangal', 'kokila', 'aparajita', 'utsaah', 'calibri', 'cambria', 'georgia', 'verdana', 'comic'];
const CALLOUT_IDS = ['note', 'caution', 'remember', 'definition', 'example', 'activity', 'objective', 'keyterms', 'summary', 'think', 'homework'];
const STYLE_KEYS = ['title', 'h1', 'h2', 'h3', 'paragraph', 'list', 'question', 'option', 'answer', 'callout', 'image', 'header', 'footer'];
const PENS = ['yellow', 'green', 'pink', 'blue', 'orange', 'purple'];

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
  /** The whole lesson in one request, texts shortened to fit: for writing NEW slides (summary, quiz…). */
  lesson?: boolean;
}

export interface DesignChatResponse {
  reply: string;
  ops: unknown[];
  /** The AI's reply was cut off; only the operations that arrived complete are included. */
  truncated?: boolean;
}

/**
 * How much of the document a request needs:
 *  design   ids, types and the start of each text — cheapest; colours, layout, labelling elements
 *  fullText every word, sent in parts — bold / highlight / proofread / translate
 *  lesson   the whole lesson in one request (shortened to fit) — writing new slides
 */
export type TemplateMode = 'design' | 'fullText' | 'lesson';

export interface DesignTemplate {
  group: string;
  label: string;
  request: string;
  mode: TemplateMode;
}

const SAME_LANGUAGE = 'Write in the same language as the lesson (Hindi lesson → Hindi, English lesson → English).';
const LEFTOVERS = 'lone page numbers, "Reprint" lines, repeated book-name / chapter-name header or footer lines, stray figure labels left without their figure, and empty or duplicate lines';

/** Ready-made requests for the jobs teachers do most. One click does the whole job. */
export const DESIGN_TEMPLATES: DesignTemplate[] = [
  // ---- the whole job ---------------------------------------------------------------
  {
    group: 'One-click lesson', mode: 'fullText', label: 'Teaching slides: full makeover',
    request: `Turn this into clean classroom teaching slides.
1. Remove everything that is not lesson content: ${LEFTOVERS}.
2. Proofread: with updateBlock, correct only clear spelling, matra, spacing, punctuation and OCR/typing mistakes, and join a sentence that was broken across two blocks. Do not rephrase, shorten, translate or add anything.
3. Label the elements: chapter title → heading level 1, section titles → level 2, activity / sub-topic titles → level 3; cautions, notes, definitions, examples, activities and conclusions → callout with the right variant.
4. Set a clean colorful theme: banner headings, a calm primary colour, readable dark text, white or very light page background.
5. In every paragraph and list, bold AND highlight (mark "both") the 1-3 most important key terms or definitions; bold (mark "bold") other important words. Do not mark whole sentences.
6. Use the slides layout and start a new slide at every heading and at every new activity or topic. Give each slide a short title when it does not start with a heading.`,
  },
  {
    group: 'One-click lesson', mode: 'design', label: 'Label all elements (H1, H2, H3, questions, boxes)',
    request: `Label every element correctly so it can be styled as a group. Do not change any text.
- chapter / lesson title → heading level 1; section titles → heading level 2; activity, figure or sub-topic titles → heading level 3
- questions → question; their choices → option; "Answer: …" lines → answer
- cautions, notes, "remember" lines, definitions, examples, activities, objectives, summaries and homework → callout with the matching variant
- a paragraph that is really a heading (short, no full stop, introduces what follows) → heading
Use updateBlock with only "type", "level" and "variant".`,
  },
  {
    group: 'One-click lesson', mode: 'fullText', label: 'Clean & proofread the text',
    request: `Clean and proofread, nothing else.
1. Remove everything that is not lesson content: ${LEFTOVERS}.
2. With updateBlock, correct only clear spelling, matra, spacing, punctuation and OCR/typing mistakes, and join a sentence that was broken across two blocks (update the first block, remove the second). Do not rephrase, shorten, translate or add anything. Leave correct blocks alone.`,
  },

  // ---- the AI writes new slides -------------------------------------------------------
  {
    group: 'Add teaching slides (AI writes them)', mode: 'lesson', label: 'Learning objectives slide',
    request: `Add ONE slide with the learning objectives of this lesson: insertSlide with one callout block (variant "objective") whose text is a bullet list ("- …" lines) of 3 to 5 objectives. Each starts with an action verb and says what students will be able to do. Put it at the start, after the cover slide if there is one (use "afterPageId" of the cover, otherwise "atStart": true). ${SAME_LANGUAGE}`,
  },
  {
    group: 'Add teaching slides (AI writes them)', mode: 'lesson', label: 'Summary / recap slide',
    request: `Add ONE recap slide at the end: insertSlide with one callout block (variant "summary") whose text is a bullet list ("- …" lines) of the 4 to 6 most important points of the lesson, each one short sentence. ${SAME_LANGUAGE}`,
  },
  {
    group: 'Add teaching slides (AI writes them)', mode: 'lesson', label: 'Key terms slide',
    request: `Add ONE slide at the end with the key terms of this lesson: insertSlide with one callout block (variant "keyterms") whose text is a bullet list of 5 to 8 lines in the form "- **term**: meaning in one simple line". Use only terms that appear in the lesson. ${SAME_LANGUAGE}`,
  },
  {
    group: 'Add teaching slides (AI writes them)', mode: 'lesson', label: 'Quick quiz: 5 MCQs with answers',
    request: `Add a quick check at the end: 5 multiple-choice questions on the main ideas of this lesson, one insertSlide per question. Each slide has these blocks in order: one question ("Q1. …"), four option blocks ("(a) …" to "(d) …") and one answer block ("Answer: b"). Mix easy and thinking questions, only from what the lesson says. ${SAME_LANGUAGE}`,
  },
  {
    group: 'Add teaching slides (AI writes them)', mode: 'lesson', label: 'Think & discuss prompts',
    request: `Add ONE slide at the end with a callout block (variant "think") whose text is a bullet list of 3 open questions that make students discuss and connect this lesson to daily life. ${SAME_LANGUAGE}`,
  },
  {
    group: 'Add teaching slides (AI writes them)', mode: 'lesson', label: 'Homework / practice',
    request: `Add ONE slide at the end with a callout block (variant "homework") whose text is a numbered list ("1) …") of 5 practice tasks based on this lesson: 2 short answer, 2 reasoning ("why"), 1 activity to do at home. ${SAME_LANGUAGE}`,
  },
  {
    group: 'Add teaching slides (AI writes them)', mode: 'fullText', label: 'Teacher notes for every slide',
    request: `For every page shown, write teacher notes with setPage ("pageId", "notes"): 2 or 3 short lines saying what to explain, one question to ask the class, and a real-life example if it helps. Notes are for the teacher only; do not change the slides. ${SAME_LANGUAGE}`,
  },

  // ---- marking the text ---------------------------------------------------------------
  {
    group: 'Mark the text', mode: 'fullText', label: 'Highlight key terms & definitions',
    request: 'In every paragraph and list, highlight (mark "both") the 1-3 most important key terms, definitions and scientific words. Mark only the exact words, never whole sentences. Do not change any text.',
  },
  {
    group: 'Mark the text', mode: 'fullText', label: 'Bold important words',
    request: 'In every paragraph, bold (mark "bold") the important words a teacher would stress while reading aloud: key nouns, names, numbers and conclusions. At most 4 per block. Do not change any text.',
  },
  {
    group: 'Mark the text', mode: 'fullText', label: 'Colour-code: terms, definitions, cautions',
    request: 'Colour-code the lesson with highlighter pens: key terms in "yellow", words that are being defined in "green", examples in "blue", and warnings / things to avoid in "pink". Use emphasize with mark "highlight" and the "color" field. Mark only exact words (1-4 words), never whole sentences. Do not change any text.',
  },

  // ---- language ---------------------------------------------------------------------
  {
    group: 'Language', mode: 'fullText', label: 'Simpler language for students',
    request: 'Rewrite every paragraph, list and box in simpler words that a student two classes younger can follow: short sentences, everyday words, same meaning, same language, same order. Keep headings, numbers, names, $LaTeX$ and scientific terms. Use updateBlock with the full new text of each block.',
  },
  {
    group: 'Language', mode: 'fullText', label: 'Translate to English',
    request: 'Translate every block into clear, simple English with updateBlock (full new text of each block). Keep numbers, names, $LaTeX$, table structure ("|") and existing ** / == markers around the matching words. Do not add or drop content.',
  },
  {
    group: 'Language', mode: 'fullText', label: 'Translate to Hindi',
    request: 'Translate every block into clear, simple Hindi (Devanagari) with updateBlock (full new text of each block). Keep numbers, names, $LaTeX$, table structure ("|") and existing ** / == markers around the matching words. Scientific terms may keep the English word in brackets. Do not add or drop content.',
  },

  // ---- look -------------------------------------------------------------------------
  {
    group: 'Look & layout', mode: 'design', label: 'Remove page numbers & book headers',
    request: `Remove printing leftovers only: ${LEFTOVERS}. Remove nothing else.`,
  },
  {
    group: 'Look & layout', mode: 'design', label: 'Make PPT slides (one topic per slide)',
    request: 'Use the slides layout. Start a new slide at every heading and at every new activity, topic or question, and give each slide a short title when it does not start with a heading. Keep a question with its options, answer and figure.',
  },
  {
    group: 'Look & layout', mode: 'design', label: 'Colourful classroom theme',
    request: 'Set a bright, friendly classroom theme: banner headings, a strong primary colour with a matching accent, boxed questions, dark readable text on a white page, a page decoration, and style heading level 2 and 3 so the three heading levels look clearly different (setElementStyle).',
  },
  {
    group: 'Look & layout', mode: 'design', label: 'Options: one per line',
    request: 'Put every option on its own line: setOptionsLayout with columns 1. Change nothing else.',
  },
  {
    group: 'Look & layout', mode: 'design', label: 'Options: 2 × 2 grid',
    request: 'Arrange the options of every question two per row (2 × 2): setOptionsLayout with columns 2. Change nothing else.',
  },
  {
    group: 'Look & layout', mode: 'design', label: 'Options: all in one row',
    request: 'Put all options of a question in one row: setOptionsLayout with columns 4. Change nothing else.',
  },
  {
    group: 'Look & layout', mode: 'design', label: 'Black & white exam paper',
    request: 'Set a plain black and white exam-paper style: serif font, plain headings, plain questions, all options in one row (setOptionsLayout 4), no decoration, document layout.',
  },
];

export function designChatPrompt({ outline, theme, layout, history, request, scopePageId, fullText, part, lesson }: DesignChatRequest): string {
  const scope = scopePageId ? `only page ${scopePageId} is shown and may be changed (theme changes still apply to the whole document).`
    : part ? `part ${part} of the document, with full text. Change only the blocks shown here. Theme operations are allowed (they apply to the whole document).`
    : lesson ? 'the whole lesson in one view; long texts are shortened ("…"). You may ADD slides and blocks. Do not rewrite or emphasize existing text.'
    : fullText ? 'whole document, with full text.' : 'whole document. Long texts are shortened ("…").';

  return `You are the design assistant inside a lesson-design tool used by teachers. The document was extracted from scanned textbooks, question papers and notes (Hindi and English).
You work by returning operations. You never rewrite the whole document.

Reply with ONE JSON object and nothing else:
{"reply": "<one short sentence, in the user's language (Hindi, Hinglish or English)>", "ops": [ ...operations... ]}

OPERATIONS (use only these, with exactly these field names):
Look
- {"op":"setTheme","patch":{...}}  Theme fields: primary, accent, text, pageBackground (colors "#RRGGBB"); font ${FONT_IDS.map(id => `"${id}"`).join('|')} (hindi, mangal, kokila, aparajita, utsaah are Hindi fonts); baseSize 9-18 (pt); headingStyle "plain"|"bar"|"banner"; questionStyle "plain"|"boxed"|"numbered-badge"; decoration "none"|"top-bar"|"bottom-bar"|"left-bar"|"frame"; spacing "compact"|"normal"|"relaxed"; highlight (default pen) ${PENS.map(p => `"${p}"`).join('|')}; labelLang "hi"|"en"; header, footer (short text); showPageNumbers true|false.
- {"op":"setElementStyle","target":"<kind>","style":{...}}  styles EVERY element of one kind, now and later. Kinds: ${STYLE_KEYS.map(k => `"${k}"`).join(', ')} ("title" = slide titles).
- {"op":"styleBlocks","ids":["b3","b7"],"style":{...}}  styles only these blocks.
  Style fields: color, background, borderColor ("#RRGGBB"); align "left"|"center"|"right"; size "sm"|"md"|"lg"|"xl"; bold, italic, underline (true|false); border "none"|"box"|"left-bar"|"underline"; font (a font id).
Options of a question (MCQ)
- {"op":"setOptionsLayout","columns":1|2|4}  arranges the options of EVERY question: 1 = each option on its own line (4 rows), 2 = two per row (2×2), 4 = all in one row (1×4). It also separates lines that hold several options, such as "(A) … (B) …", into one option each. This is the ONLY way to separate, spread out or rearrange options.
- {"op":"splitOptions"}  only separates lines that hold several options into one option block each, keeping the current layout. Optional "pageId" or "ids".
Words
- {"op":"emphasize","id":"b3","phrases":["exact words","another phrase"],"mark":"bold"|"highlight"|"both","color":"<pen>"}  marks words INSIDE a block without rewriting it. Each phrase must be copied exactly, character for character, from that block's text. "both" = bold + highlight. "color" is optional (a pen: ${PENS.join(', ')}); leave it out for the default pen. This is the only way to bold or highlight words.
- {"op":"setHighlighter","color":"<pen>","all":true}  changes the default pen ("all": true also recolours every existing highlight).
Elements
- {"op":"updateBlock","id":"b3","type":"<block type>","level":1|2|3,"variant":"<box kind>","text":"..."}  relabel one block (paragraph → heading, callout…) and/or change its text. Give "text" ONLY when the user asked to change wording.
- {"op":"insertBlock","afterId":"b3","block":{"type":"callout","variant":"remember","text":"..."}}  add one text block (never an image).
- {"op":"removeBlock","id":"b3"}   {"op":"moveBlock","id":"b3","afterId":"b9"}
  Block types: heading (level 1-3), paragraph, question, option, answer, list ("- item" lines), table (Markdown "|" rows), callout, divider.
  Box kinds (callout "variant"): ${CALLOUT_IDS.join(', ')}. The app draws the label and icon itself, so do not repeat the label in the text.
Pages
- {"op":"setLayout","layout":"document"|"slides"}  document = A4 portrait pages, slides = 16:9 PPT-style slides.
- {"op":"paginate","breaks":[{"beforeBlockId":"b9","title":"Slide title"}, ...]}  re-splits the content into pages/slides: a new page starts at each listed block. Optional "pageId" splits only that page.
- {"op":"insertSlide","afterPageId":"p3","title":"...","layout":"content"|"title"|"section"|"two-column","notes":"...","blocks":[{"type":"...","text":"...","level":2,"variant":"..."}]}  adds a new slide with its own blocks. "atStart": true puts it first; with neither "afterPageId" nor "atStart" it goes to the end.
- {"op":"setPage","pageId":"p2","title":"...","layout":"content"|"title"|"section"|"two-column","background":"#RRGGBB","notes":"teacher notes"}
- {"op":"removePage","pageId":"p2"}

RULES:
- Prefer setTheme and setElementStyle: one operation restyles the whole document. Use styleBlocks only for a few specific blocks.
- Options: when the user wants options separated, apart, on separate lines, one below another, in 2 columns / 2×2, in one row, or "like tabs" ("options alag karo", "ek line me ek option", "विकल्प अलग करो"), use setOptionsLayout. Spacing, borders, backgrounds, alignment or updateBlock text cannot separate options: never use them for this, and never retype option text.
- Say in "reply" only what your operations really do. If no operation can do what was asked, return "ops": [] and say so plainly; do not make a different change and call it done.
- Keep text readable: dark text on light backgrounds, light text only on dark backgrounds. Boxes use light tints.
- OVERFLOW IS HANDLED BY THE APP: after your operations it automatically moves extra blocks to a new slide, splits long tables and paragraphs, and shrinks text if needed. So never rewrite, shorten or split a block's text to make it fit, and never reduce the font size for that reason. Just choose sensible slide starts with paginate.
- For slides: setLayout "slides", then ONE paginate listing every slide start for the whole document (or for the part you are shown). Group by topic: a heading starts a slide; keep a question with its options, answer and figure.
- A design request must not change any wording. To bold or highlight use "emphasize", never updateBlock.
- Change wording (updateBlock "text") only when the user asks to proofread, correct, simplify, translate or rewrite. Then: give the block's complete new text; keep its meaning, numbers, names, $LaTeX$ and any existing **bold** / ==highlight== markers; never add new ** or == yourself. If you also emphasize that block, put its updateBlock first and copy the phrases from the new text.
- New content you write (insertSlide / insertBlock) must come only from what the lesson says, in short simple sentences a student can read on a slide.
- Only use block ids and page ids that appear in the outline. Text ending in "…" is shortened for you: you cannot emphasize words you cannot see, and must never copy shortened text into updateBlock.
- If the request is unclear or impossible, return "ops": [] and explain briefly in "reply".
- Be economical: one emphasize operation per block (list all its phrases together), phrases of 1-4 words. At most 100 operations. Put "reply" FIRST in the JSON.

CURRENT LAYOUT: ${layout}
CURRENT THEME: ${JSON.stringify(theme)}
SCOPE: ${scope}

DOCUMENT OUTLINE (pages → blocks):
${JSON.stringify(outline)}

CONVERSATION SO FAR:
${history.length ? history.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`).join('\n') : '(none)'}

USER REQUEST:
${request}`;
}
