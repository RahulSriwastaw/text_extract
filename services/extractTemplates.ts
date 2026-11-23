/**
 * Output templates for the Text extractor: an extra block of prompt rules that makes the AI
 * write the extracted text in one fixed layout. Used by the browser-bridge prompt and by the
 * server prompt (/api/extract), so both engines produce the same shape.
 *
 * `none` adds nothing: extraction behaves exactly as before.
 */
export const EXTRACT_TEMPLATES = {
  none: { label: 'No template (as on the page)', hint: '', instruction: '' },
  'board-exam': {
    label: 'Board exam paper',
    hint: 'Numbered questions, Hindi then English, section headings, no page codes. Ready for the "Board Exam" look in Design Studio.',
    instruction: `OUTPUT TEMPLATE: PRINTED BOARD EXAM QUESTION PAPER (these rules win over any numbering or option-arrangement rule above):
- Write the page the way a printed board question paper reads, top to bottom, nothing left out and nothing added.
- SECTION TITLES: a section title or question-type title, for example "खण्ड - अ / SECTION - A", "वस्तुनिष्ठ प्रश्न / Objective Type Questions", "भूगोल / Geography", goes on its own line as a Markdown heading starting with "## ". Keep both languages on that one line, joined by " / ", exactly as printed.
- SECTION INSTRUCTIONS: the instruction lines under a title (for example "Question Nos. 1 to 80 have four options each ...") are plain paragraphs, the Hindi one first and the English one after it. Keep the marks note such as "40 × 1 = 40" at the end of its line.
- QUESTIONS: every question starts on a new line with its PRINTED number and a dot, for example "1. " or "27. ". Keep the printed numbers, even when numbering restarts in a new section. Never renumber and never write "Q", "#" or "Question".
- BILINGUAL QUESTIONS: when a question is printed in two languages, write the Hindi question (with the number), then its options; then the English question on its own new line WITHOUT a number, then its options. Do not join the two languages with "/" and do not translate anything yourself.
- OPTIONS: keep the printed labels "(A)", "(B)", "(C)", "(D)" exactly, capital letters in round brackets, each label followed by one space and its text. Write every option on its own line, also when the paper prints two side by side.
- LONG AND SHORT ANSWER QUESTIONS (no options): number, question in Hindi, then the English question on the next line.
- NO PAGE FURNITURE: do not output what is printed on every page around the questions: the set code in a box (for example "A"), the subject code (for example "[ 111 ]"), the booklet or paper code at the foot (for example "10/41/012★"), and "Page 4 of 24".
- NO ANSWERS: a question paper has none. Do not output answers, solutions or explanations.`,
  },
} as const;

export type ExtractTemplateId = keyof typeof EXTRACT_TEMPLATES;
export const EXTRACT_TEMPLATE_IDS = Object.keys(EXTRACT_TEMPLATES) as ExtractTemplateId[];

/** The prompt rules of a template; '' for none or for an id this build does not know. */
export const extractTemplateInstruction = (id: unknown): string =>
  typeof id === 'string' && Object.prototype.hasOwnProperty.call(EXTRACT_TEMPLATES, id) ? EXTRACT_TEMPLATES[id as ExtractTemplateId].instruction : '';
