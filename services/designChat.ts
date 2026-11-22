/**
 * Design Studio AI chat: the prompt (built on the server) and the request/response shapes.
 * The model answers with a short reply plus DesignOps; services/designDoc.ts validates and applies them.
 */
import type { Layout, Theme } from './designDoc';

export interface DesignChatTurn { role: 'user' | 'assistant'; text: string }

export interface DesignChatRequest {
  outline: unknown;              // outlineForAi(doc, scopePageId, fill)
  theme: Theme;
  layout: Layout;
  history: DesignChatTurn[];
  request: string;
  scopePageId?: string;
}

export interface DesignChatResponse { reply: string; ops: unknown[] }

export const DESIGN_SUGGESTIONS = [
  'Make it colorful and modern',
  'Put every question in a light box',
  'Turn this into PPT slides, one question per slide',
  'Make headings bigger with a colored banner',
  'Arrange options in 2 columns',
  'Use a clean exam-paper style in black and white',
];

export function designChatPrompt({ outline, theme, layout, history, request, scopePageId }: DesignChatRequest): string {
  return `You are the design assistant inside a document design tool used by teachers. The document was extracted from scanned question papers and notes (Hindi and English).
You change the DESIGN and LAYOUT by returning operations. You never rewrite the whole document.

Reply with ONE JSON object and nothing else:
{"reply": "<one or two short sentences, in the user's language (Hindi, Hinglish or English)>", "ops": [ ...operations... ]}

OPERATIONS (use only these, with exactly these field names):
- {"op":"setTheme","patch":{...}}  Theme fields: primary, accent, text, pageBackground (colors "#RRGGBB"); font "sans"|"serif"|"hindi"; baseSize 9-18 (pt); headingStyle "plain"|"bar"|"banner"; questionStyle "plain"|"boxed"|"numbered-badge"; optionColumns 1|2|4; header, footer (short text); showPageNumbers true|false.
- {"op":"styleBlocks","type":"<block type>","style":{...}}  styles EVERY block of that type. Or {"op":"styleBlocks","ids":["b3","b7"],"style":{...}} for specific blocks. Optional "pageId" limits it to one page.
  Style fields: color, background, borderColor ("#RRGGBB"); align "left"|"center"|"right"; size "sm"|"md"|"lg"|"xl"; bold, italic (true|false); border "none"|"box"|"left-bar"|"underline".
- {"op":"updateBlock","id":"b3","text":"...","type":"<block type>","level":1|2|3}  change one block's text or type. Keep Markdown and $LaTeX$ exactly unless asked to change them.
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
- For slides: use setLayout "slides" and then paginate. Keep a question together with its options, answer and figure on one slide. Never put more on a slide than fits; a page with fillPercent above 100 is overflowing and must be split.
- Change content (updateBlock / insertBlock / removeBlock) only when the user clearly asks for it. A design request must not change any text.
- Only use block ids and page ids that appear in the outline. Text ending in "…" is shortened for you; never copy a shortened text into updateBlock.
- If the request is unclear or impossible, return "ops": [] and explain briefly in "reply".
- At most 60 operations.

CURRENT LAYOUT: ${layout}
CURRENT THEME: ${JSON.stringify(theme)}
${scopePageId ? `SCOPE: only page ${scopePageId} is shown and may be changed (theme changes still apply to the whole document).` : 'SCOPE: whole document.'}

DOCUMENT OUTLINE (pages → blocks):
${JSON.stringify(outline)}

CONVERSATION SO FAR:
${history.length ? history.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`).join('\n') : '(none)'}

USER REQUEST:
${request}`;
}
