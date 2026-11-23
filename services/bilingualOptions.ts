/**
 * Bilingual pages often print every option as "(a) English text / हिंदी पाठ". The AI sometimes copies that whole
 * line into the Hindi field, so the Hindi option shows both languages. These helpers split such a line back into
 * its two languages and drop the option's own "(a)" / "(b)" label (the app shows A/B/C/D itself).
 *
 * Pure functions with no imports, so the browser, the backend and the tests can all use them.
 */

const DEVANAGARI = /[ऀ-ॿ]/;
const LANGUAGES = ['hi', 'en'] as const;

/** Any tag other than the <p> wrapper means real markup (image, table, list): such an option is left alone. */
const hasMarkup = (text: string) => /<(?!\/?p\b)[^>]*>/i.test(text);
const unwrap = (text: string) => text.replace(/^\s*<p>\s*/i, '').replace(/\s*<\/p>\s*$/i, '').trim();
const rewrap = (like: string, inner: string) => /^\s*<p>/i.test(like) ? `<p>${inner}</p>` : inner;
const sameText = (a: string, b: string) => unwrap(a).replace(/\s+/g, ' ').toLowerCase() === unwrap(b).replace(/\s+/g, ' ').toLowerCase();

/** A real English word, once formulas are ignored (so "\(x^2\) / \(x^2\) मीटर" is not mistaken for two languages). */
const hasEnglishWord = (text: string) => /[A-Za-z]{3,}/.test(text.replace(/\\\([\s\S]*?\\\)|\$[^$]*\$/g, ' '));

/**
 * Splits "English text / हिंदी पाठ" into its two parts. Only when everything before the slash has no Devanagari at all
 * but has an English word, and what follows has Devanagari. Anything else (Hindi-only text, "km / h", "a / b") returns null.
 */
export function splitBilingualLine(value: string): { en: string; hi: string } | null {
  if (!value || hasMarkup(value)) return null;
  const text = unwrap(value);
  let found: { en: string; hi: string } | null = null;
  for (let at = text.indexOf(' / '); at >= 0; at = text.indexOf(' / ', at + 1)) {
    const en = text.slice(0, at).trim(), hi = text.slice(at + 3).trim();
    // The last valid slash wins: it is where the Hindi part begins.
    if (en && hi && !DEVANAGARI.test(en) && DEVANAGARI.test(hi) && hasEnglishWord(en)) found = { en, hi };
  }
  return found;
}

const LABEL = /^(\s*(?:<p>\s*)?)\(\s*([A-Ea-e1-5])\s*\)\s*/;
const isOwnLabel = (index: number, label: string) => label.toLowerCase() === 'abcde'[index] || label === String(index + 1);

/**
 * Removes "(a)", "(b)", ... from the options, but only when options 1-4 all start with their own label in order.
 * An option such as "(a) and (b) only" in an unlabelled set is real content and is never touched.
 */
export function stripOptionLabels(options: string[]): string[] {
  const labelled = [0, 1, 2, 3].every(index => {
    const match = LABEL.exec(options[index] ?? '');
    return !!match && isOwnLabel(index, match[2]);
  });
  if (!labelled) return options;
  return options.map((option, index) => {
    const match = LABEL.exec(option ?? '');
    return match && isOwnLabel(index, match[2]) ? option.replace(LABEL, '$1') : option;
  });
}

/**
 * Fixes the option fields of one question: an "English / Hindi" line in the Hindi field keeps only the Hindi part
 * (the English part goes to the English field if that is empty or a copy), the same the other way round, and the
 * option labels are removed. Returns the same object when nothing needed fixing.
 */
export function fixBilingualOptions<T extends object>(item: T): T {
  const fields = item as Record<string, unknown>;
  const read = (language: 'hi' | 'en') => [1, 2, 3, 4, 5].map(n => String(fields[`option${n}_${language}`] ?? ''));
  const options = { hi: read('hi'), en: read('en') };

  for (let index = 0; index < 5; index++) {
    const { hi: hindi, en: english } = { hi: options.hi[index], en: options.en[index] };
    const fromHindi = splitBilingualLine(hindi);
    const fromEnglish = fromHindi ? null : splitBilingualLine(english);
    if (fromHindi) {
      if (!english.trim() || sameText(english, hindi) || sameText(english, fromHindi.en)) options.en[index] = rewrap(english || hindi, fromHindi.en);
      options.hi[index] = rewrap(hindi, fromHindi.hi);
    } else if (fromEnglish) {
      if (!hindi.trim() || sameText(hindi, english) || sameText(hindi, fromEnglish.hi)) options.hi[index] = rewrap(hindi || english, fromEnglish.hi);
      options.en[index] = rewrap(english, fromEnglish.en);
    }
  }
  for (const language of LANGUAGES) options[language] = stripOptionLabels(options[language]);

  const changes: Record<string, string> = {};
  for (const language of LANGUAGES) {
    options[language].forEach((value, index) => {
      const key = `option${index + 1}_${language}`;
      if (value !== String(fields[key] ?? '')) changes[key] = value;
    });
  }
  return Object.keys(changes).length ? { ...item, ...changes } : item;
}
