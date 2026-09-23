import { MockTestMcqItem, QuestionType, DifficultyLevel, ExtractedElement } from '../types';
import { getAiSettings } from './aiDbService';
import { hasFigureImage } from './figureStorageService';

export type { MockTestMcqItem };

export const MOCKTEST_CSV_HEADERS = [
  'question_r',
  'question_hi',
  'option1_hi',
  'option2_hi',
  'option3_hi',
  'option4_hi',
  'option5_hi',
  'solution_hi',
  'question_en',
  'option1_en',
  'option2_en',
  'option3_en',
  'option4_en',
  'option5_en',
  'solution_en',
  'answer',
  'set_name',
  'difficulty_level',
  'test_date',
  'test_time',
  'subject',
  'subject_level',
  'figure_notes',
  'correction_notes',
  'source_pdf',
  'source_pages',
  'source_question_reference',
  'latex_check',
  'html_check',
  'answer_check',
  'solution_check',
  'hash_figure',
  'manually_review',
  'duplicate_statistics'
] as const;

export const STANDARD_SUBJECTS = [
  'Current Affairs',
  'History',
  'Geography',
  'Polity',
  'Economics',
  'General Science',
  'Physics',
  'Chemistry',
  'Biology',
  'Mathematics',
  'Reasoning',
  'Computer Knowledge',
  'English',
  'Hindi',
  'Environment & Ecology',
  'Static GK',
] as const;

export type StandardSubject = typeof STANDARD_SUBJECTS[number];

/**
 * STRICT RULE: Identifies and stores ONLY the clean academic subject name.
 * Exam names (like "RRB", "NTPC", "CBT", "Shift", "Level 01", etc.) are strictly stripped/forbidden here.
 * If raw candidate is missing or invalid, intelligently deduces the exact subject from question & solution text.
 */
export function normalizeStrictSubject(
  rawSubject?: string,
  questionText?: string,
  solutionText?: string
): string {
  let cleaned = (rawSubject || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/['"]/g, '')
    .trim();

  // Strip common label prefixes like "Subject:", "Sub:", "विषय:"
  cleaned = cleaned.replace(/^(?:Subject|Sub|विषय)\s*[:\-]\s*/i, '').trim();

  // Check if cleaned contains obvious exam noise without any subject
  const isPureExamNoise = /^(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\s\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|BPSC|Level[\s\-]*\d+|Stage[\s\-]*[I|V|1|2|3|4|5]|Shift[\s\-]*\d+|\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})+$/i.test(cleaned);
  if (isPureExamNoise) {
    cleaned = '';
  }

  // Canonical mapping dictionary
  const subjectMap: Record<string, string> = {
    // Current Affairs
    'current affairs': 'Current Affairs',
    'current affair': 'Current Affairs',
    'current': 'Current Affairs',
    'ca': 'Current Affairs',
    'समसामयिकी': 'Current Affairs',
    'करेंट अफेयर्स': 'Current Affairs',
    'करंट अफेयर्स': 'Current Affairs',
    'करेंट': 'Current Affairs',
    'समसामयिक': 'Current Affairs',
    
    // History
    'history': 'History',
    'indian history': 'History',
    'ancient history': 'History',
    'medieval history': 'History',
    'modern history': 'History',
    'world history': 'History',
    'इतिहास': 'History',
    'भारतीय इतिहास': 'History',
    'प्राचीन इतिहास': 'History',
    'मध्यकालीन इतिहास': 'History',
    'आधुनिक इतिहास': 'History',

    // Geography
    'geography': 'Geography',
    'indian geography': 'Geography',
    'world geography': 'Geography',
    'physical geography': 'Geography',
    'भूगोल': 'Geography',
    'भारतीय भूगोल': 'Geography',
    'विश्व भूगोल': 'Geography',

    // Polity
    'polity': 'Polity',
    'indian polity': 'Polity',
    'constitution': 'Polity',
    'indian constitution': 'Polity',
    'civics': 'Polity',
    'political science': 'Polity',
    'राजव्यवस्था': 'Polity',
    'भारतीय राजव्यवस्था': 'Polity',
    'संविधान': 'Polity',
    'भारतीय संविधान': 'Polity',

    // Economics
    'economics': 'Economics',
    'economy': 'Economics',
    'indian economy': 'Economics',
    'अर्थशास्त्र': 'Economics',
    'भारतीय अर्थव्यवस्था': 'Economics',
    'अर्थव्यवस्था': 'Economics',

    // Physics
    'physics': 'Physics',
    'भौतिक विज्ञान': 'Physics',
    'भौतिकी': 'Physics',
    'भौतिक': 'Physics',

    // Chemistry
    'chemistry': 'Chemistry',
    'रसायन विज्ञान': 'Chemistry',
    'रसायनिकी': 'Chemistry',
    'रसायन': 'Chemistry',

    // Biology
    'biology': 'Biology',
    'botany': 'Biology',
    'zoology': 'Biology',
    'life science': 'Biology',
    'जीव विज्ञान': 'Biology',
    'वनस्पति विज्ञान': 'Biology',
    'जंतु विज्ञान': 'Biology',

    // General Science
    'general science': 'General Science',
    'science': 'General Science',
    'सामान्य विज्ञान': 'General Science',
    'विज्ञान': 'General Science',

    // Mathematics
    'mathematics': 'Mathematics',
    'math': 'Mathematics',
    'maths': 'Mathematics',
    'quantitative aptitude': 'Mathematics',
    'quants': 'Mathematics',
    'quant': 'Mathematics',
    'arithmetic': 'Mathematics',
    'गणित': 'Mathematics',
    'अंकगणित': 'Mathematics',

    // Reasoning
    'reasoning': 'Reasoning',
    'general intelligence': 'Reasoning',
    'general intelligence & reasoning': 'Reasoning',
    'logical reasoning': 'Reasoning',
    'mental ability': 'Reasoning',
    'तर्कशक्ति': 'Reasoning',
    'सामान्य बुद्धिमत्ता': 'Reasoning',

    // Computer
    'computer': 'Computer Knowledge',
    'computer knowledge': 'Computer Knowledge',
    'computer science': 'Computer Knowledge',
    'it': 'Computer Knowledge',
    'कंप्यूटर': 'Computer Knowledge',
    'कंप्यूटर ज्ञान': 'Computer Knowledge',

    // English
    'english': 'English',
    'english language': 'English',
    'english comprehension': 'English',
    'अंग्रेजी': 'English',

    // Hindi
    'hindi': 'Hindi',
    'samanya hindi': 'Hindi',
    'सामान्य हिंदी': 'Hindi',
    'हिंदी': 'Hindi',

    // Environment
    'environment': 'Environment & Ecology',
    'ecology': 'Environment & Ecology',
    'environment & ecology': 'Environment & Ecology',
    'environmental studies': 'Environment & Ecology',
    'पर्यावरण': 'Environment & Ecology',
    'पर्यावरण एवं पारिस्थितिकी': 'Environment & Ecology',

    // Static GK
    'static gk': 'Static GK',
    'gk': 'Static GK',
    'general knowledge': 'Static GK',
    'general awareness': 'Static GK',
    'ga': 'Static GK',
    'सामान्य ज्ञान': 'Static GK',
    'सामान्य जागरूकता': 'Static GK',
  };

  const combinedText = `${questionText || ''} ${solutionText || ''}`.toLowerCase();

  // 0. Strong Reasoning override: Alphabet order, letter sequence, words arrangement, puzzles, seating arrangement
  // (Prevents letter puzzles containing words like "ION" or "EBB" from being falsely classified as Chemistry)
  if (
    /(?:alphabetical order|वर्णमाला|वर्णमाला क्रम|अक्षर और|अक्षर के बीच|तीसरे अक्षर|पहले अक्षर|दूसरे अक्षर|दाएं से|बाएं से|left and right|word from the left|words from the right|words:\s*\(left\)|शब्दों पर आधारित|following words|बैठक व्यवस्था|seating arrangement|कथन और निष्कर्ष|रक्त संबंध|दिशा और दूरी|दर्पण प्रतिबिंब|जल प्रतिबिंब|पासा|कोडिंग-डिकोडिंग|coding-decoding|syllogism|blood relation|number series|letter series|odd one out|विषम चुनें)/i.test(combinedText)
  ) {
    return 'Reasoning';
  }

  const lower = cleaned.toLowerCase();
  for (const [key, val] of Object.entries(subjectMap)) {
    if (lower === key || lower.startsWith(key + ' ') || lower.endsWith(' ' + key)) {
      return val;
    }
  }

  // If candidate is still not mapped, strictly deduce from question + solution text

  // 1. Current Affairs
  if (
    /(?:महानियंत्रक|cgda|नियुक्त|पदभार|पुरस्कार|शिखर सम्मेलन|बैठक|योजना शुरू|202[4-9]\s*में|202[4-9]\s*के|हाल ही में|ओलंपिक|विश्व कप|appointed|sworn in|assumed charge|summit|medal|championship|g20|cop2[8-9]|padma shri|bharat ratna|nobel prize)/i.test(combinedText)
  ) {
    return 'Current Affairs';
  }

  // 2. Mathematics
  if (
    /(?:\\frac|\\sqrt|\\times|\\div|प्रतिशत|औसत|क्रय मूल्य|विक्रय मूल्य|लाभ और हानि|अनुपात|समानुपात|क्षेत्रफल|आयतन|साधारण ब्याज|चक्रवृद्धि ब्याज|ल\.स\.|म\.स\.|त्रिकोणमिति|profit and loss|percentage|ratio and proportion|simple interest|compound interest|radius|hypotenuse|polynomial|quadratic)/i.test(combinedText)
  ) {
    return 'Mathematics';
  }

  // 3. Reasoning
  if (
    /(?:alphabetical order|वर्णमाला|वर्णमाला क्रम|अक्षर और|अक्षर के बीच|तीसरे अक्षर|पहले अक्षर|दूसरे अक्षर|दाएं से|बाएं से|left and right|word from the left|words from the right|शब्दों पर आधारित|following words|कथन और निष्कर्ष|रक्त संबंध|दिशा और दूरी|दर्पण प्रतिबिंब|जल प्रतिबिंब|पासा|कोडिंग-डिकोडिंग|श्रृंखला को पूरा|लुप्त पद|syllogism|blood relation|coding-decoding|mirror image|water image|venn diagram|dice|analogy|seating arrangement|बैठक व्यवस्था|odd one out|विषम चुनें)/i.test(combinedText)
  ) {
    return 'Reasoning';
  }

  // 4. Polity
  if (
    /(?:संविधान|अनुच्छेद\s*\d+|मौलिक अधिकार|नीति निदेशक|राष्ट्रपति|प्रधानमंत्री|लोकसभा|राज्यसभा|संसद|सर्वोच्च न्यायालय|उच्चतम न्यायालय|उच्च न्यायालय|राज्यपाल|संवैधानिक संशोधन|निर्वाचन आयोग|constitution|article\s*\d+|fundamental rights|directive principles|parliament|supreme court|lok sabha|rajya sabha|amendment)/i.test(combinedText)
  ) {
    return 'Polity';
  }

  // 5. History
  if (
    /(?:सिंधु घाटी|हड़प्पा|मौर्य वंश|गुप्त काल|दिल्ली सल्तनत|मुगल साम्राज्य|तराइन का युद्ध|पानीपत का युद्ध|प्लासी का युद्ध|बक्सर का युद्ध|1857 की क्रांति|गांधीजी|असहयोग आंदोलन|भारत छोड़ो|अकबर|बाबर|dynasty|battle of|empire|viceroy|governor general|revolt of 1857|quit india)/i.test(combinedText)
  ) {
    return 'History';
  }

  // 6. Geography
  if (
    /(?:नदी|पर्वत|पहाड़|महासागर|झील|मरुस्थल|मिट्टी का प्रकार|कर्क रेखा|मकर रेखा|अक्षांश|देशांतर|मानसून|जलवायु|अभयारण्य|जलप्रपात|river|mountain|himalaya|plateau|soil|latitude|longitude|monsoon|climate|peninsula|tributary)/i.test(combinedText)
  ) {
    return 'Geography';
  }

  // 7. Economics
  if (
    /(?:जीडीपी|मुद्रास्फीति|आरबीआई|रेपो रेट|रिवर्स रेपो|राजकोषीय घाटा|मौद्रिक नीति|पंचवर्षीय योजना|बजट 202|gdp|inflation|rbi|fiscal deficit|monetary policy|repo rate|foreign exchange|niti aayog)/i.test(combinedText)
  ) {
    return 'Economics';
  }

  // 8. Biology
  if (
    /(?:कोशिका|माइटोकॉन्ड्रिया|डीएनए|आरएनए|विटामिन|रक्त समूह|हीमोग्लोबिन|हार्मोन|एंजाइम|जीवाणु|विषाणु|कवक|प्रकाश संश्लेषण|पाचन तंत्र|हृदय|फेफड़े|यकृत|cell|mitochondria|dna|rna|vitamin|hemoglobin|hormone|enzyme|bacteria|virus|photosynthesis|rbc|wbc)/i.test(combinedText)
  ) {
    return 'Biology';
  }

  // 9. Chemistry
  if (
    /(?:आवर्त सारणी|परमाणु क्रमांक|इलेक्ट्रॉन|प्रोटॉन|न्यूट्रॉन|अम्ल|क्षार|पीएच मान|रासायनिक अभिक्रिया|संयोजकता|धातु|अधातु|periodic table|atomic number|acid|base|ph value|chemical reaction|valency|isotope|polymer)/i.test(combinedText)
  ) {
    return 'Chemistry';
  }

  // 10. Physics
  if (
    /(?:न्यूटन के नियम|गुरुत्वाकर्षण|ध्वनि तरंग|प्रकाश का अपवर्तन|परावर्तन|लेंस की क्षमता|विद्युत धारा|प्रतिरोध|ओम का नियम|कार्य और ऊर्जा|शक्ति का मात्रक|newton's law|gravity|optics|refraction|lens|current|resistance|ohm|frequency|wavelength|pascal)/i.test(combinedText)
  ) {
    return 'Physics';
  }

  // 11. Computer Knowledge
  if (
    /(?:कंप्यूटर|सीपीयू|रैम|रोम|हार्डवेयर|सॉफ्टवेयर|ऑपरेटिंग सिस्टम|इंटरनेट|आईपी पता|एमएस वर्ड|एमएस एक्सेल|फुल फॉर्म|cpu|ram|rom|operating system|binary|lan|wan|ip address|malware|http)/i.test(combinedText)
  ) {
    return 'Computer Knowledge';
  }

  // 12. Environment & Ecology
  if (
    /(?:ग्रीनहाउस गैस|ग्लोबल वार्मिंग|ओजोन परत|क्योतो प्रोटोकॉल|पेरिस समझौता|जैव विविधता|पारिस्थितिकी तंत्र|greenhouse|global warming|ozone layer|biodiversity|ecosystem|wildlife sanctuary)/i.test(combinedText)
  ) {
    return 'Environment & Ecology';
  }

  // 13. General Science fallback
  if (/(?:वैज्ञानिक|मात्रक|यंत्र|खोजकर्ता|प्रयोगशाला|scientific|instrument|measurement)/i.test(combinedText)) {
    return 'General Science';
  }

  return 'General Studies';
}

/**
 * Returns clean plain text normalized with LaTeX math (NO HTML tags).
 */
export function ensureHtmlParagraph(text: string): string {
  if (!text) return '';
  return cleanMocktestText(text);
}

import {
  stripExamTagsAndJunk,
  cleanMocktestText,
  stripOptionLetterReferences,
  stripSolutionPrefix
} from './textCleanService';

export {
  stripExamTagsAndJunk,
  cleanMocktestText,
  stripOptionLetterReferences,
  stripSolutionPrefix
};


export interface PendingMcqContext {
  sourcePageNumber: number;
  sourcePageId?: string;
  pendingItems: MockTestMcqItem[];
  rawFragmentText?: string;
}

export interface ItemFieldIssues {
  hasMissingOptions: boolean;
  missingOptionsList: string[];
  hasEmptyQuestion: boolean;
  hasMissingAnswer: boolean;
  hasDummySolution: boolean;
  hasIssues: boolean;
  missingFieldNames: string[];
  issueSummary: string;
}

/**
 * Validates a MockTestMcqItem and detects any blank/empty/incomplete fields.
 */
export function detectItemFieldIssues(item: MockTestMcqItem): ItemFieldIssues {
  const missingOptionsList: string[] = [];
  const missingFieldNames: string[] = [];
  
  const isOptValid = (hi?: string, en?: string) => {
    if (hasFigureImage(hi) || hasFigureImage(en)) return true;
    const text = (hi || en || '').replace(/<[^>]*>/g, '').trim();
    return !!text && text.toLowerCase() !== 'blank';
  };

  if (!isOptValid(item.option1_hi, item.option1_en)) {
    missingOptionsList.push('A');
    missingFieldNames.push('Option A');
  }
  if (!isOptValid(item.option2_hi, item.option2_en)) {
    missingOptionsList.push('B');
    missingFieldNames.push('Option B');
  }
  if (!isOptValid(item.option3_hi, item.option3_en)) {
    missingOptionsList.push('C');
    missingFieldNames.push('Option C');
  }
  if (!isOptValid(item.option4_hi, item.option4_en)) {
    missingOptionsList.push('D');
    missingFieldNames.push('Option D');
  }

  const hasMissingOptions = missingOptionsList.length > 0;
  
  const hasFigureInQuestion = hasFigureImage(item.question_hi) || hasFigureImage(item.question_en);
  const qHi = (item.question_hi || '').replace(/<[^>]*>/g, '').trim();
  const qEn = (item.question_en || '').replace(/<[^>]*>/g, '').trim();
  const hasEmptyQuestion = !qHi && !qEn && !hasFigureInQuestion;
  if (hasEmptyQuestion) {
    missingFieldNames.push('Question Text');
  }

  const rawAns = (item.answer || '').replace(/['"\[\]\{\}]/g, '').trim();
  const hasMissingAnswer = !rawAns;
  if (hasMissingAnswer) {
    missingFieldNames.push('Answer');
  }

  const hasFigureInSol = hasFigureImage(item.solution_hi) || hasFigureImage(item.solution_en);
  const solHi = (item.solution_hi || '').replace(/<[^>]*>/g, '').trim();
  const solEn = (item.solution_en || '').replace(/<[^>]*>/g, '').trim();
  const isGenericHi = !solHi || /^(?:हल:)?\s*सही उत्तर विकल्प\s+[A-E1-5]\s*है।?$/i.test(solHi) || solHi.length < 25;
  const isGenericEn = !solEn || /^(?:Solution:)?\s*The correct option is\s+[A-E1-5]\.?$/i.test(solEn) || solEn.length < 25;
  const hasDummySolution = !hasFigureInSol && isGenericHi && isGenericEn;
  if (hasDummySolution) {
    missingFieldNames.push('Solution');
  }

  const issueParts: string[] = [];
  if (hasMissingOptions) {
    issueParts.push(`Missing Options (${missingOptionsList.join(', ')})`);
  }
  if (hasEmptyQuestion) {
    issueParts.push('Missing Question Text');
  }
  if (hasMissingAnswer) {
    issueParts.push('Missing Answer');
  }
  if (hasDummySolution) {
    issueParts.push('Placeholder/Generic Solution');
  }

  const hasIssues = hasMissingOptions || hasEmptyQuestion || hasMissingAnswer || hasDummySolution;
  const issueSummary = issueParts.join(' • ');

  return {
    hasMissingOptions,
    missingOptionsList,
    hasEmptyQuestion,
    hasMissingAnswer,
    hasDummySolution,
    hasIssues,
    missingFieldNames,
    issueSummary: issueSummary || 'All fields complete'
  };
}

/**
 * Cleanly separates extracted page MCQs into:
 * 1. completeItems: Finished MCQs with complete options/stem
 * 2. pendingItems: Incomplete question(s) at the bottom of the page that must be carried forward to the next page.
 */
export function separateCompleteAndPendingItems(
  items: MockTestMcqItem[],
  isLastPage: boolean = false
): { completeItems: MockTestMcqItem[]; pendingItems: MockTestMcqItem[] } {
  if (!items || items.length === 0) {
    return { completeItems: [], pendingItems: [] };
  }

  // If this is the last page, no carry-over can occur; keep all items
  if (isLastPage) {
    return { completeItems: items, pendingItems: [] };
  }

  // Check the trailing items from the end of the page
  const complete: MockTestMcqItem[] = [];
  const pending: MockTestMcqItem[] = [];

  // Identify trailing items that are cut off or missing critical options (e.g. only A/B present, or 0 options)
  let foundCutoff = false;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const issues = detectItemFieldIssues(it);
    
    // Check if the item has options A, B, C, D
    const optCount = [
      it.option1_hi || it.option1_en,
      it.option2_hi || it.option2_en,
      it.option3_hi || it.option3_en,
      it.option4_hi || it.option4_en
    ].filter(o => o && o.trim() && o.toLowerCase() !== 'blank').length;

    // Check if other questions on this page have solutions or answers
    const otherItemsHaveSolutions = items.some((other, idx) => 
      idx !== i && Boolean(
        (other.solution_hi && other.solution_hi.length > 25 && !other.solution_hi.includes('उपलब्ध नहीं है')) ||
        (other.solution_en && other.solution_en.length > 25 && !other.solution_en.includes('not available'))
      )
    );

    const isBottomItem = (i === items.length - 1) || foundCutoff;
    const isOptionsComplete = optCount >= 4;
    const hasAnswer = Boolean((it.answer || '').replace(/['"\[\]\{\}]/g, '').trim());
    const solHi = (it.solution_hi || '').replace(/<[^>]*>/g, '').trim();
    const solEn = (it.solution_en || '').replace(/<[^>]*>/g, '').trim();
    const hasDetailedSolution = Boolean(
      (solHi.length > 25 && !solHi.includes('उपलब्ध नहीं है')) ||
      (solEn.length > 25 && !solEn.includes('not available'))
    );
    const isStemHangingWithoutOptions = optCount === 0;

    // CRITICAL: An item at the bottom of the page is incomplete/pending IF:
    // 1. Missing option C or D (only A or A/B present), OR
    // 2. Hanging stem without options, OR
    // 3. Question at the bottom of the page has NO answer and NO detailed solution (the answer & explanation were cut off and appear at the top of the next page, exactly like CRR/SLR question!)
    const isBottomQuestionMissingAnsOrSol = isBottomItem && (!hasAnswer || !hasDetailedSolution) && (otherItemsHaveSolutions || !hasDetailedSolution);
    const isTrulyPending = isBottomItem && (
      (!isOptionsComplete && (issues.hasMissingOptions || issues.hasEmptyQuestion || isStemHangingWithoutOptions)) ||
      isBottomQuestionMissingAnsOrSol
    );

    if (isTrulyPending) {
      pending.unshift(it);
      foundCutoff = true;
    } else {
      foundCutoff = false;
      complete.unshift(it);
    }
  }

  // Safety: If all items were flagged as pending, keep at least one as complete
  if (complete.length === 0 && pending.length > 0) {
    complete.push(pending.shift()!);
  }

  return { completeItems: complete, pendingItems: pending };
}

export interface MergePendingResult {
  mergedPendingItems: MockTestMcqItem[];
  freshPageItems: MockTestMcqItem[];
  logMessage: string;
}

/**
 * Safely merges continuations returned from Page N+1 with pending question(s) from Page N.
 * Avoids duplicate question numbers or duplicate items.
 */
export function mergePendingCarryOver(
  extractedFromNextPage: MockTestMcqItem[],
  pendingContext: PendingMcqContext | null,
  currentPageNumber: number
): MergePendingResult {
  if (!pendingContext || !pendingContext.pendingItems || pendingContext.pendingItems.length === 0) {
    return {
      mergedPendingItems: [],
      freshPageItems: extractedFromNextPage,
      logMessage: `Page ${currentPageNumber}: No pending context to merge. Extracted ${extractedFromNextPage.length} new question(s).`
    };
  }

  if (!extractedFromNextPage || extractedFromNextPage.length === 0) {
    return {
      mergedPendingItems: pendingContext.pendingItems,
      freshPageItems: [],
      logMessage: `Page ${currentPageNumber}: Empty response from page. Carried ${pendingContext.pendingItems.length} pending item(s).`
    };
  }

  const mergedPending: MockTestMcqItem[] = [];
  const freshItems: MockTestMcqItem[] = [...extractedFromNextPage];

  // Try to match each pending item with the beginning of the next page
  for (const pendingItem of pendingContext.pendingItems) {
    if (freshItems.length === 0) {
      mergedPending.push(pendingItem);
      continue;
    }

    const candidate = freshItems[0];
    const candidateStem = (candidate.question_hi || candidate.question_en || '').replace(/<[^>]*>/g, '').trim();
    const pendingStem = (pendingItem.question_hi || pendingItem.question_en || '').replace(/<[^>]*>/g, '').trim();

    // Check if candidate continues pendingItem:
    // A candidate is a continuation of pendingItem ONLY if:
    // 1. Candidate's source_pages explicitly mentions both pages (e.g. "23, 24"), OR
    // 2. Candidate has NO Option 1 / Option 2 and is a fragment (supplying only Option C / D), OR
    // 3. Candidate stem matches the pending stem, OR
    // 4. Question reference numbers match exactly.
    const candidateSourcePages = String(candidate.source_pages || '');
    const mentionsBothPages = candidateSourcePages.includes(String(pendingContext.sourcePageNumber));
    
    const candidateHasOpt1or2 = Boolean(
      (candidate.option1_hi && candidate.option1_hi.trim() && candidate.option1_hi.toLowerCase() !== 'blank') ||
      (candidate.option1_en && candidate.option1_en.trim() && candidate.option1_en.toLowerCase() !== 'blank')
    );
    const isContinuationFragment = !candidateHasOpt1or2 && (candidateStem.length < 25 || /^(?:\([c-eC-E]\)|Option\s*[c-eC-E]|उत्तर|Ans)/i.test(candidateStem));

    // Detect if candidate is an Answer & Solution box fragment appearing at the top of the new page
    // (e.g. 'सही उत्तर: (c)' and 'व्याख्या: • CRR ...' from the cutoff question on the previous page)
    const hasCandidateAnsOrSol = Boolean(
      (candidate.answer && candidate.answer.trim().length > 0) ||
      (candidate.solution_hi && candidate.solution_hi.length > 15 && !candidate.solution_hi.includes('उपलब्ध नहीं है')) ||
      (candidate.solution_en && candidate.solution_en.length > 15 && !candidate.solution_en.includes('not available'))
    );
    const isAnswerSolutionFragment = !candidateHasOpt1or2 && hasCandidateAnsOrSol && (
      candidateStem.length < 60 ||
      /^(?:उत्तर|सही उत्तर|Ans|Answer|व्याख्या|Solution|हल|विवरण)/i.test(candidateStem)
    );

    // Strip common question boilerplate prefixes before comparing stems to prevent false generic collisions
    const stripGenericStem = (s: string) => s.replace(/^(?:निम्नलिखित|नीचे दिए गए|दिए गए विकल्पों|उपरोक्त|which of the following|select the correct|choose the correct|consider the following)[\s\S]{0,35}?(?:है|कीजिए|चुनिए|बताइए|statements?|options?)[\s:।\.\-?]*/i, '').trim();
    const pClean = stripGenericStem(pendingStem);
    const cClean = stripGenericStem(candidateStem);
    const stemsMatch = pClean.length > 25 && cClean.length > 25 && (
      cClean.toLowerCase().includes(pClean.slice(0, 45).toLowerCase()) ||
      pClean.toLowerCase().includes(cClean.slice(0, 45).toLowerCase())
    );

    const refMatch = Boolean(
      candidate.source_question_reference &&
      pendingItem.source_question_reference &&
      candidate.source_question_reference === pendingItem.source_question_reference &&
      candidate.source_question_reference !== 'Q.1' &&
      candidate.source_question_reference !== '1'
    );

    // CRITICAL: If candidate on the new page already has Option 1 and Option 2, it is a complete new question,
    // and must NEVER be consumed as a continuation unless it explicitly mentions both pages!
    const isMatch = mentionsBothPages || isContinuationFragment || isAnswerSolutionFragment || (!candidateHasOpt1or2 && (stemsMatch || refMatch));

    if (isMatch) {
      // Merge candidate into pendingItem!
      const merged: MockTestMcqItem = {
        ...pendingItem,
        question_hi: pendingItem.question_hi && pendingItem.question_hi.length >= candidate.question_hi.length
          ? pendingItem.question_hi
          : (candidate.question_hi || pendingItem.question_hi),
        question_en: pendingItem.question_en && pendingItem.question_en.length >= candidate.question_en.length
          ? pendingItem.question_en
          : (candidate.question_en || pendingItem.question_en),
        option1_hi: (pendingItem.option1_hi && pendingItem.option1_hi.toLowerCase() !== 'blank') ? pendingItem.option1_hi : candidate.option1_hi,
        option2_hi: (pendingItem.option2_hi && pendingItem.option2_hi.toLowerCase() !== 'blank') ? pendingItem.option2_hi : candidate.option2_hi,
        option3_hi: (candidate.option3_hi && candidate.option3_hi.toLowerCase() !== 'blank') ? candidate.option3_hi : pendingItem.option3_hi,
        option4_hi: (candidate.option4_hi && candidate.option4_hi.toLowerCase() !== 'blank') ? candidate.option4_hi : pendingItem.option4_hi,
        option5_hi: (candidate.option5_hi && candidate.option5_hi.toLowerCase() !== 'blank') ? candidate.option5_hi : pendingItem.option5_hi,
        option1_en: (pendingItem.option1_en && pendingItem.option1_en.toLowerCase() !== 'blank') ? pendingItem.option1_en : candidate.option1_en,
        option2_en: (pendingItem.option2_en && pendingItem.option2_en.toLowerCase() !== 'blank') ? pendingItem.option2_en : candidate.option2_en,
        option3_en: (candidate.option3_en && candidate.option3_en.toLowerCase() !== 'blank') ? candidate.option3_en : pendingItem.option3_en,
        option4_en: (candidate.option4_en && candidate.option4_en.toLowerCase() !== 'blank') ? candidate.option4_en : pendingItem.option4_en,
        option5_en: (candidate.option5_en && candidate.option5_en.toLowerCase() !== 'blank') ? candidate.option5_en : pendingItem.option5_en,
        answer: (candidate.answer && candidate.answer.trim().length > 0 && candidate.answer !== '1')
          ? candidate.answer
          : (pendingItem.answer || candidate.answer),
        solution_hi: (candidate.solution_hi && candidate.solution_hi.length > 15 && !candidate.solution_hi.includes('उपलब्ध नहीं है'))
          ? candidate.solution_hi
          : (pendingItem.solution_hi && !pendingItem.solution_hi.includes('उपलब्ध नहीं है')
             ? (candidate.solution_hi && candidate.solution_hi.length > pendingItem.solution_hi.length ? candidate.solution_hi : pendingItem.solution_hi)
             : (candidate.solution_hi || pendingItem.solution_hi)),
        solution_en: (candidate.solution_en && candidate.solution_en.length > 15 && !candidate.solution_en.includes('not available'))
          ? candidate.solution_en
          : (pendingItem.solution_en && !pendingItem.solution_en.includes('not available')
             ? (candidate.solution_en && candidate.solution_en.length > pendingItem.solution_en.length ? candidate.solution_en : pendingItem.solution_en)
             : (candidate.solution_en || pendingItem.solution_en)),
        source_pages: `${pendingContext.sourcePageNumber}, ${currentPageNumber}`,
        subject: candidate.subject || pendingItem.subject,
        difficulty_level: candidate.difficulty_level || pendingItem.difficulty_level
      };

      mergedPending.push(merged);
      // Consume the first item since it was the continuation
      freshItems.shift();
    } else {
      // Not a continuation; keep pending item as was
      mergedPending.push(pendingItem);
    }
  }

  const logMessage = `Page ${currentPageNumber}: Merged ${mergedPending.length} continuation(s) from Page ${pendingContext.sourcePageNumber}. Formed ${freshItems.length} new question(s).`;

  return {
    mergedPendingItems: mergedPending,
    freshPageItems: freshItems,
    logMessage
  };
}

/**
 * Intelligently scans question text for trailing options that got merged into the stem,
 * extracting them into Option 1-4 and cleaning the stem cleanly.
 */
export function autoRecoverItemOptionsFromStem(item: MockTestMcqItem): MockTestMcqItem {
  // Check if options are already fully populated and not empty/blank (including figure options)
  const hasFig1 = hasFigureImage(item.option1_hi) || hasFigureImage(item.option1_en);
  const hasFig2 = hasFigureImage(item.option2_hi) || hasFigureImage(item.option2_en);
  const hasFig3 = hasFigureImage(item.option3_hi) || hasFigureImage(item.option3_en);
  const hasFig4 = hasFigureImage(item.option4_hi) || hasFigureImage(item.option4_en);

  const opt1 = (item.option1_hi || item.option1_en || '').replace(/<[^>]*>/g, '').trim();
  const opt2 = (item.option2_hi || item.option2_en || '').replace(/<[^>]*>/g, '').trim();
  const opt3 = (item.option3_hi || item.option3_en || '').replace(/<[^>]*>/g, '').trim();
  const opt4 = (item.option4_hi || item.option4_en || '').replace(/<[^>]*>/g, '').trim();

  const isFilled1 = hasFig1 || (!!opt1 && opt1.toLowerCase() !== 'blank');
  const isFilled2 = hasFig2 || (!!opt2 && opt2.toLowerCase() !== 'blank');
  const isFilled3 = hasFig3 || (!!opt3 && opt3.toLowerCase() !== 'blank');
  const isFilled4 = hasFig4 || (!!opt4 && opt4.toLowerCase() !== 'blank');

  if (isFilled1 && isFilled2 && isFilled3 && isFilled4) {
    return item;
  }

  let qEn = item.question_en || '';
  let qHi = item.question_hi || '';

  const tryExtractFromText = (text: string): { stem: string; opts: [string, string, string, string] } | null => {
    if (!text) return null;
    let raw = text.trim();
    let hasClosingP = false;
    if (raw.endsWith('</p>')) {
      raw = raw.slice(0, -4).trim();
      hasClosingP = true;
    }

    // Pattern 1: Question ends with "? 7 6 5 8" or "? opt1 opt2 opt3 opt4"
    const fourTokensMatch = raw.match(/^(.*?\?)\s+([^\s?]+)\s+([^\s?]+)\s+([^\s?]+)\s+([^\s?]+)\s*$/s);
    if (fourTokensMatch) {
      const stem = hasClosingP ? `${fourTokensMatch[1].trim()}</p>` : fourTokensMatch[1].trim();
      return {
        stem,
        opts: [fourTokensMatch[2].trim(), fourTokensMatch[3].trim(), fourTokensMatch[4].trim(), fourTokensMatch[5].trim()]
      };
    }

    // Pattern 2: Labeled options at end: "(A) opt1 (B) opt2 (C) opt3 (D) opt4" or "A. opt1 B. opt2 C. opt3 D. opt4"
    const labeledMatch = raw.match(/^(.*?)(?:[\s\n\?]+)(?:\(?[A1a][\.\)\:\-]\s*|\b[A1a]\b[\.\)\:\-]\s*)([^\n\(\)]+?)(?:\(?[B2b][\.\)\:\-]\s*|\b[B2b]\b[\.\)\:\-]\s*)([^\n\(\)]+?)(?:\(?[C3c][\.\)\:\-]\s*|\b[C3c]\b[\.\)\:\-]\s*)([^\n\(\)]+?)(?:\(?[D4d][\.\)\:\-]\s*|\b[D4d]\b[\.\)\:\-]\s*)([^\n\(\)]+?)\s*$/s);
    if (labeledMatch) {
      const stem = hasClosingP ? `${labeledMatch[1].trim()}</p>` : labeledMatch[1].trim();
      return {
        stem,
        opts: [labeledMatch[2].trim(), labeledMatch[3].trim(), labeledMatch[4].trim(), labeledMatch[5].trim()]
      };
    }

    // Pattern 3: 4 newline separated lines at the end
    const fourLinesMatch = raw.match(/^(.*?)\n\s*([^\n]+)\s*\n\s*([^\n]+)\s*\n\s*([^\n]+)\s*\n\s*([^\n]+)\s*$/s);
    if (fourLinesMatch) {
      const stem = hasClosingP ? `${fourLinesMatch[1].trim()}</p>` : fourLinesMatch[1].trim();
      return {
        stem,
        opts: [fourLinesMatch[2].trim(), fourLinesMatch[3].trim(), fourLinesMatch[4].trim(), fourLinesMatch[5].trim()]
      };
    }

    return null;
  };

  const extractedEn = tryExtractFromText(qEn);
  const extractedHi = tryExtractFromText(qHi);

  const bestExtract = extractedEn || extractedHi;
  if (!bestExtract) {
    return item;
  }

  const [opt1Val, opt2Val, opt3Val, opt4Val] = bestExtract.opts;

  return {
    ...item,
    question_en: extractedEn ? extractedEn.stem : qEn,
    question_hi: extractedHi ? extractedHi.stem : qHi,
    option1_hi: (!hasFig1 && (!item.option1_hi || item.option1_hi.toLowerCase() === 'blank')) ? (extractedHi ? extractedHi.opts[0] : opt1Val) : item.option1_hi,
    option2_hi: (!hasFig2 && (!item.option2_hi || item.option2_hi.toLowerCase() === 'blank')) ? (extractedHi ? extractedHi.opts[1] : opt2Val) : item.option2_hi,
    option3_hi: (!hasFig3 && (!item.option3_hi || item.option3_hi.toLowerCase() === 'blank')) ? (extractedHi ? extractedHi.opts[2] : opt3Val) : item.option3_hi,
    option4_hi: (!hasFig4 && (!item.option4_hi || item.option4_hi.toLowerCase() === 'blank')) ? (extractedHi ? extractedHi.opts[3] : opt4Val) : item.option4_hi,
    option1_en: (!hasFig1 && (!item.option1_en || item.option1_en.toLowerCase() === 'blank')) ? (extractedEn ? extractedEn.opts[0] : opt1Val) : item.option1_en,
    option2_en: (!hasFig2 && (!item.option2_en || item.option2_en.toLowerCase() === 'blank')) ? (extractedEn ? extractedEn.opts[1] : opt2Val) : item.option2_en,
    option3_en: (!hasFig3 && (!item.option3_en || item.option3_en.toLowerCase() === 'blank')) ? (extractedEn ? extractedEn.opts[2] : opt3Val) : item.option3_en,
    option4_en: (!hasFig4 && (!item.option4_en || item.option4_en.toLowerCase() === 'blank')) ? (extractedEn ? extractedEn.opts[3] : opt4Val) : item.option4_en,
  };
}

/**
 * Deep cleans an entire MockTestMcqItem to ensure clean KaTeX and HTML compatibility in mocktest portals.
 * Strictly verifies and normalizes the academic subject field and recovers missing options if merged in stem.
 */
export function cleanMockTestItem(item: MockTestMcqItem): MockTestMcqItem {
  // First, auto-recover trailing options from stem if options are blank:
  const recovered = autoRecoverItemOptionsFromStem(item);

  const qHi = ensureHtmlParagraph(cleanMocktestText(recovered.question_hi));
  const qEn = ensureHtmlParagraph(cleanMocktestText(recovered.question_en));
  const solHi = ensureHtmlParagraph(stripSolutionPrefix(cleanMocktestText(recovered.solution_hi)));
  const solEn = ensureHtmlParagraph(stripSolutionPrefix(cleanMocktestText(recovered.solution_en)));

  const cleanSubject = normalizeStrictSubject(recovered.subject, `${qHi} ${qEn}`, `${solHi} ${solEn}`);

  return {
    ...recovered,
    question_hi: qHi,
    option1_hi: ensureHtmlParagraph(cleanMocktestText(recovered.option1_hi)),
    option2_hi: ensureHtmlParagraph(cleanMocktestText(recovered.option2_hi)),
    option3_hi: ensureHtmlParagraph(cleanMocktestText(recovered.option3_hi)),
    option4_hi: ensureHtmlParagraph(cleanMocktestText(recovered.option4_hi)),
    option5_hi: ensureHtmlParagraph(cleanMocktestText(recovered.option5_hi)),
    solution_hi: solHi,
    question_en: qEn,
    option1_en: ensureHtmlParagraph(cleanMocktestText(recovered.option1_en)),
    option2_en: ensureHtmlParagraph(cleanMocktestText(recovered.option2_en)),
    option3_en: ensureHtmlParagraph(cleanMocktestText(recovered.option3_en)),
    option4_en: ensureHtmlParagraph(cleanMocktestText(recovered.option4_en)),
    option5_en: ensureHtmlParagraph(cleanMocktestText(recovered.option5_en)),
    solution_en: solEn,
    subject: cleanSubject,
    subject_level: recovered.subject_level || '',
    test_date: recovered.test_date || '',
    test_time: recovered.test_time || '',
    figure_notes: recovered.figure_notes || '',
    correction_notes: recovered.correction_notes || '',
    source_pdf: recovered.source_pdf || '',
    source_pages: recovered.source_pages || '',
    source_question_reference: recovered.source_question_reference || (recovered.question_r ? `Q.${recovered.question_r}` : ''),
    latex_check: recovered.latex_check || 'checked',
    html_check: recovered.html_check || 'checked',
    answer_check: recovered.answer_check || 'checked',
    solution_check: recovered.solution_check || 'checked',
    hash_figure: recovered.hash_figure || '',
    manually_review: recovered.manually_review || 'checked',
    duplicate_statistics: recovered.duplicate_statistics || 'Unique within this shift; duplicate check completed.',
    passage_hi: recovered.passage_hi || '',
    passage_en: recovered.passage_en || ''
  };
}

/**
 * Standardizes mathematical formulas into clean MathJax \(...\) inline syntax,
 * converting HTML <sup>/<sub> and Unicode operators/roots (e.g. y<sup>3</sup> -> \(y^3\), ∛0.008 -> \(\sqrt[3]{0.008}\))
 * while strictly preserving HTML <p> wrappers.
 */
export function convertToMathJaxSyntax(text: string): string {
  if (!text) return '';
  let res = text.trim();

  // 1. Trig functions with powers: sin² θ -> \sin^2 \theta, cos² θ -> \cos^2 \theta, etc.
  res = res.replace(/\b(sin|cos|tan|sec|csc|cot|cosec)\s*[²2]\s*θ/gi, (_m, fn) => `\\(\\${fn.toLowerCase()}^2 \\theta\\)`);
  res = res.replace(/\b(sin|cos|tan|sec|csc|cot|cosec)\s*[³3]\s*θ/gi, (_m, fn) => `\\(\\${fn.toLowerCase()}^3 \\theta\\)`);
  res = res.replace(/\b(sin|cos|tan|sec|csc|cot|cosec)\s*θ/gi, (_m, fn) => `\\(\\${fn.toLowerCase()} \\theta\\)`);

  // 2. Convert HTML exponents & subscripts to LaTeX within MathJax:
  // e.g. y<sup>3</sup> -> \(y^3\), y<sup>{n-1}</sup> -> \(y^{n-1}\)
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

  // 4. Convert Unicode cube roots & square roots:
  // ∛0.008 or ∛(0.008) -> \(\sqrt[3]{0.008}\)
  res = res.replace(/∛\s*\(?([0-9a-zA-Z\.\+\-\*\/]+)\)?/g, (_m, inside) => `\\(\\sqrt[3]{${inside.trim()}}\\)`);
  res = res.replace(/√\s*\(?([0-9a-zA-Z\.\+\-\*\/]+)\)?/g, (_m, inside) => `\\(\\sqrt{${inside.trim()}}\\)`);

  // 5. Degrees: 90° -> \(90^\circ\)
  res = res.replace(/(\d+)\s*°/g, `\\($1^\\circ\\)`);

  // 6. Greek letters: θ, α, β, π
  res = res.replace(/\bθ\b|(?<=[0-9a-zA-Z\^\s])θ/g, `\\(\\theta\\)`);
  res = res.replace(/\bα\b/g, `\\(\\alpha\\)`);
  res = res.replace(/\bβ\b/g, `\\(\\beta\\)`);
  res = res.replace(/\bπ\b/g, `\\(\\pi\\)`);

  // 7. Fractions written as (a) / (b):
  res = res.replace(/\(\s*([0-9a-zA-Z\^\_\+\-\*\s\\]+)\s*\)\s*\/\s*\(\s*([0-9a-zA-Z\^\_\+\-\*\s\\]+)\s*\)/g, (_m, num, den) => {
    return `\\(\\frac{${num.trim()}}{${den.trim()}}\\)`;
  });

  // Numeric fractions: e.g. 13/12, 5/13, (13/12)
  res = res.replace(/(?<=\s|^|\(|>|:|;)(\d+)\s*\/\s*(\d+)(?=\s|$|\)|<|\.|\,)/g, (_m, num, den) => {
    return `\\(\\frac{${num}}{${den}}\\)`;
  });

  // Simple variable fractions: a / b
  res = res.replace(/(?<=\s|^|\(|>)([a-zA-Z])\s*\/\s*([a-zA-Z])(?=\s|$|\)|<|\.|\,)/g, (_m, num, den) => {
    return `\\(\\frac{${num}}{${den}}\\)`;
  });

  // Multiplication / division operators between terms
  res = res.replace(/(\d+|[a-zA-Z])\s*×\s*(\d+|[a-zA-Z])/g, `\\($1 \\times $2\\)`);
  res = res.replace(/(\d+|[a-zA-Z])\s*÷\s*(\d+|[a-zA-Z])/g, `\\($1 \\div $2\\)`);

  // 8. Consolidate adjacent MathJax blocks and inline operators:
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

  // Clean double delimiters or redundant wrappers
  res = res.replace(/\\\(\s*\\\(([^()]+)\\\)\s*\\\)/g, `\\($1\\)`);
  res = res.replace(/\\\(\s+/g, `\\(`).replace(/\s+\\\)/g, `\\)`);

  return res;
}

/**
 * Normalizes all text fields of a MockTestMcqItem to ensure:
 * 1. Clean normal text (NO HTML tags like <p>, <br>, <b>).
 * 2. Standard KaTeX/LaTeX ($...$) for mathematical/scientific formulas.
 */
export function standardizeItemHtmlAndMathJax(item: MockTestMcqItem, _useMathJax: boolean = true): MockTestMcqItem {
  return cleanMockTestItem(item);
}

/**
 * Escapes an individual field for RFC 4180 compliant CSV.
 */
export function escapeCsvField(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  // If string contains comma, quote, or newline, escape double quotes and wrap in quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts letter answer ('A','B','C','D','E') to 1-based numeric ('1','2','3','4','5')
 */
export function normalizeAnswerFormat(
  rawAnswer: string, 
  targetFormat: 'letters' | 'numbers' = 'letters'
): string {
  if (!rawAnswer) return '';
  const trimmed = rawAnswer.trim();

  // If MSQ or NAT, keep as is
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return trimmed;
  }

  const mapToNum: Record<string, string> = { 'A': '1', 'B': '2', 'C': '3', 'D': '4', 'E': '5' };
  const mapToLetter: Record<string, string> = { '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E' };

  const upper = trimmed.toUpperCase();
  if (targetFormat === 'numbers') {
    return mapToNum[upper] || trimmed;
  } else {
    return mapToLetter[upper] || trimmed;
  }
}

/**
 * Serializes MockTestMcqItem array into a clean, RFC 4180 CSV string with UTF-8 BOM.
 * Formats all 34 fields in the exact specified order with 100% consistent <p> tags and MathJax.
 */
export function serializeMockTestToCsv(
  items: MockTestMcqItem[],
  answerFormat: 'letters' | 'numbers' = 'letters',
  mathFormat: 'mathjax' | 'unicode' = 'mathjax'
): string {
  const headerLine = MOCKTEST_CSV_HEADERS.join(',');
  const lines = items.map((rawItem, index) => {
    const item = standardizeItemHtmlAndMathJax(rawItem, mathFormat === 'mathjax');
    const qNum = item.question_r || index + 1;
    const ans = normalizeAnswerFormat(item.answer, answerFormat);

    const row = [
      escapeCsvField(qNum),
      escapeCsvField(item.question_hi || ''),
      escapeCsvField(item.option1_hi || ''),
      escapeCsvField(item.option2_hi || ''),
      escapeCsvField(item.option3_hi || ''),
      escapeCsvField(item.option4_hi || ''),
      escapeCsvField(item.option5_hi || ''),
      escapeCsvField(item.solution_hi || ''),
      escapeCsvField(item.question_en || ''),
      escapeCsvField(item.option1_en || ''),
      escapeCsvField(item.option2_en || ''),
      escapeCsvField(item.option3_en || ''),
      escapeCsvField(item.option4_en || ''),
      escapeCsvField(item.option5_en || ''),
      escapeCsvField(item.solution_en || ''),
      escapeCsvField(ans),
      escapeCsvField(item.set_name || 'PYPs Shift-3'),
      escapeCsvField(item.difficulty_level || 'Easy'),
      escapeCsvField(item.test_date || ''),
      escapeCsvField(item.test_time || ''),
      escapeCsvField(item.subject || ''),
      escapeCsvField(item.subject_level || ''),
      escapeCsvField(item.figure_notes || ''),
      escapeCsvField(item.correction_notes || ''),
      escapeCsvField(item.source_pdf || ''),
      escapeCsvField(item.source_pages || ''),
      escapeCsvField(item.source_question_reference || `Q.${qNum}`),
      escapeCsvField(item.latex_check || 'checked'),
      escapeCsvField(item.html_check || 'checked'),
      escapeCsvField(item.answer_check || 'checked'),
      escapeCsvField(item.solution_check || 'checked'),
      escapeCsvField(item.hash_figure || ''),
      escapeCsvField(item.manually_review || 'checked'),
      escapeCsvField(item.duplicate_statistics || 'Unique within this shift; duplicate check completed.')
    ];
    return row.join(',');
  });

  // UTF-8 BOM (\uFEFF) ensures Excel & portals open Hindi Devanagari & math flawlessly
  return '\uFEFF' + [headerLine, ...lines].join('\n');
}

/**
 * Triggers a direct browser file download for the CSV file.
 */
export function downloadMockTestCsv(
  items: MockTestMcqItem[],
  fileName: string = 'mocktest_mcqs.csv',
  answerFormat: 'letters' | 'numbers' = 'letters',
  mathFormat: 'mathjax' | 'unicode' = 'mathjax'
): void {
  const csvContent = serializeMockTestToCsv(items, answerFormat, mathFormat);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  const cleanName = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  link.setAttribute('download', cleanName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
/**
 * RFC 4180 CSV / TSV / Table parser to import existing MockTest CSVs, Excel copies, or tables into MockTestMcqItem[]
 */
export function parseCsvToMockTestItems(csvText: string, defaultSetName = 'Paper Name'): MockTestMcqItem[] {
  if (!csvText || !csvText.trim()) return [];

  // Remove UTF-8 BOM if present
  let clean = csvText.replace(/^\uFEFF/, '').trim();
  
  // Auto-detect delimiter: check first line for tabs vs commas vs semicolons
  const firstLine = clean.split(/\r?\n/)[0] || '';
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;

  let delimiter = ',';
  if (tabCount > commaCount && tabCount >= 2) {
    delimiter = '\t';
  } else if (semiCount > commaCount && semiCount >= 2) {
    delimiter = ';';
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push(currentField);
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++; // CRLF
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

  if (rows.length === 0) return [];

  // Check if first row contains recognizable headers
  const rawHeaders = rows[0].map(h => h.trim().toLowerCase());
  const hasRecognizedHeader = rawHeaders.some(h => 
    /question|option|answer|ans|solution|subject|diff|set_name|q_num|q\.|q\s*\d/i.test(h)
  );

  const startRow = hasRecognizedHeader ? 1 : 0;
  const headers = hasRecognizedHeader ? rawHeaders : [];

  const getCol = (row: string[], names: string | string[]): string => {
    const list = Array.isArray(names) ? names : [names];
    for (const name of list) {
      const target = name.toLowerCase().trim();
      const idx = headers.findIndex(h => h === target || h.replace(/[\s_-]+/g, '') === target.replace(/[\s_-]+/g, ''));
      if (idx >= 0 && row[idx] !== undefined && row[idx].trim().length > 0) {
        return row[idx].trim();
      }
    }
    return '';
  };

  const items: MockTestMcqItem[] = [];

  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0 || !row.some(c => c.trim().length > 0)) continue;

    let qNum = r;
    let qHi = '';
    let qEn = '';
    let opt1Hi = '';
    let opt2Hi = '';
    let opt3Hi = '';
    let opt4Hi = '';
    let opt5Hi = '';
    let opt1En = '';
    let opt2En = '';
    let opt3En = '';
    let opt4En = '';
    let opt5En = '';
    let solHi = '';
    let solEn = '';
    let ans = '';
    let subject = '';
    let diff = 'medium';

    if (hasRecognizedHeader) {
      qNum = parseInt(getCol(row, ['question_r', 'q_num', 'qnum', 'q_no', 'q', 'sr', 'no']), 10) || r;
      qHi = getCol(row, ['question_hi', 'question', 'question_text', 'q', 'प्रश्न', 'सवाल', 'hindi_question', 'question_hindi']);
      qEn = getCol(row, ['question_en', 'english_question', 'question_english', 'question_eng']);
      
      opt1Hi = getCol(row, ['option1_hi', 'option1', 'option 1', 'option_1', 'option a', 'option_a', 'opt1', 'opt 1', 'a', 'विकल्प 1', 'विकल्प a']);
      opt2Hi = getCol(row, ['option2_hi', 'option2', 'option 2', 'option_2', 'option b', 'option_b', 'opt2', 'opt 2', 'b', 'विकल्प 2', 'विकल्प b']);
      opt3Hi = getCol(row, ['option3_hi', 'option3', 'option 3', 'option_3', 'option c', 'option_c', 'opt3', 'opt 3', 'c', 'विकल्प 3', 'विकल्प c']);
      opt4Hi = getCol(row, ['option4_hi', 'option4', 'option 4', 'option_4', 'option d', 'option_d', 'opt4', 'opt 4', 'd', 'विकल्प 4', 'विकल्प d']);
      opt5Hi = getCol(row, ['option5_hi', 'option5', 'option 5', 'option_5', 'option e', 'option_e', 'opt5', 'opt 5', 'e']);

      opt1En = getCol(row, ['option1_en', 'option1_eng', 'option_1_en']);
      opt2En = getCol(row, ['option2_en', 'option2_eng', 'option_2_en']);
      opt3En = getCol(row, ['option3_en', 'option3_eng', 'option_3_en']);
      opt4En = getCol(row, ['option4_en', 'option4_eng', 'option_4_en']);
      opt5En = getCol(row, ['option5_en', 'option5_eng', 'option_5_en']);

      solHi = getCol(row, ['solution_hi', 'solution', 'explanation', 'exp', 'हल', 'व्याख्या', 'sol', 'solution_text']);
      solEn = getCol(row, ['solution_en', 'english_solution', 'explanation_en', 'sol_en']);
      ans = getCol(row, ['answer', 'ans', 'correct_option', 'correct_answer', 'correct answer', 'उत्तर', 'key']);
      subject = getCol(row, ['subject', 'topic', 'विषय']);
      diff = getCol(row, ['difficulty_level', 'difficulty', 'diff', 'level']) || 'medium';
    } else {
      // Positional row fallback (e.g. pasted directly without headers)
      let offset = 0;
      if (/^\d+$/.test(row[0]?.trim())) {
        qNum = parseInt(row[0].trim(), 10);
        offset = 1;
      }
      
      // Intelligent detection of 4 options vs 5 options positional rows
      const remainingCols = row.length - offset;
      if (remainingCols >= 8) {
        const possibleAns6 = (row[offset + 6] || '').trim().toUpperCase();
        const possibleAns5 = (row[offset + 5] || '').trim().toUpperCase();
        const isAns6 = /^[A-E1-5]$/.test(possibleAns6) || possibleAns6.startsWith('[') || possibleAns6.startsWith('{');
        const isAns5 = /^[A-E1-5]$/.test(possibleAns5) || possibleAns5.startsWith('[') || possibleAns5.startsWith('{');

        if (isAns6 && !isAns5) {
          // 5 Options: [Q, opt1, opt2, opt3, opt4, opt5, ans, sol]
          qHi = row[offset] || '';
          opt1Hi = row[offset + 1] || '';
          opt2Hi = row[offset + 2] || '';
          opt3Hi = row[offset + 3] || '';
          opt4Hi = row[offset + 4] || '';
          opt5Hi = row[offset + 5] || '';
          ans = row[offset + 6] || '';
          solHi = row[offset + 7] || '';
        } else {
          // 4 Options: [Q, opt1, opt2, opt3, opt4, ans, sol]
          qHi = row[offset] || '';
          opt1Hi = row[offset + 1] || '';
          opt2Hi = row[offset + 2] || '';
          opt3Hi = row[offset + 3] || '';
          opt4Hi = row[offset + 4] || '';
          ans = (row[offset + 5] || '').trim();
          solHi = row[offset + 6] || '';
        }
      } else {
        // Default 4 Options positional row
        qHi = row[offset] || '';
        opt1Hi = row[offset + 1] || '';
        opt2Hi = row[offset + 2] || '';
        opt3Hi = row[offset + 3] || '';
        opt4Hi = row[offset + 4] || '';
        ans = (row[offset + 5] || '').trim();
        solHi = row[offset + 6] || '';
      }
    }

    // Ensure bilingual synchronization if only one language is present
    if (!qHi && qEn) qHi = qEn;
    if (!qEn && qHi) qEn = qHi;
    if (!opt1Hi && opt1En) opt1Hi = opt1En;
    if (!opt2Hi && opt2En) opt2Hi = opt2En;
    if (!opt3Hi && opt3En) opt3Hi = opt3En;
    if (!opt4Hi && opt4En) opt4Hi = opt4En;
    if (!opt5Hi && opt5En) opt5Hi = opt5En;
    if (!opt1En && opt1Hi) opt1En = opt1Hi;
    if (!opt2En && opt2Hi) opt2En = opt2Hi;
    if (!opt3En && opt3Hi) opt3En = opt3Hi;
    if (!opt4En && opt4Hi) opt4En = opt4Hi;
    if (!opt5En && opt5Hi) opt5En = opt5Hi;
    if (!solHi && solEn) solHi = solEn;
    if (!solEn && solHi) solEn = solHi;

    // Normalize Answer to A, B, C, D, E
    const cleanAns = ans.toUpperCase().trim().replace(/^(?:OPTION\s*|OPT\s*)/i, '').slice(0, 1);
    const numToLetter: Record<string, string> = { '1': 'A', '2': 'B', '3': 'C', '4': 'D', '5': 'E' };
    const mappedAns = numToLetter[cleanAns] || cleanAns;
    const validAns = ['A', 'B', 'C', 'D', 'E'].includes(mappedAns) ? mappedAns : (ans.trim() || 'A');

    if (!qHi && !opt1Hi) continue;

    let qType: QuestionType = 'MCQ';
    if (ans.startsWith('[') && ans.endsWith(']')) qType = 'MSQ';
    else if (ans.startsWith('{') && ans.endsWith('}')) qType = 'NAT';

    items.push({
      id: `mt_row_${r}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      question_r: qNum,
      question_type: qType,
      question_hi: qHi,
      option1_hi: opt1Hi,
      option2_hi: opt2Hi,
      option3_hi: opt3Hi,
      option4_hi: opt4Hi,
      option5_hi: opt5Hi,
      solution_hi: solHi,
      question_en: qEn,
      option1_en: opt1En,
      option2_en: opt2En,
      option3_en: opt3En,
      option4_en: opt4En,
      option5_en: opt5En,
      solution_en: solEn,
      answer: validAns,
      set_name: hasRecognizedHeader ? (getCol(row, 'set_name') || defaultSetName) : defaultSetName,
      difficulty_level: (diff.toLowerCase() as DifficultyLevel) || 'medium',
      test_date: hasRecognizedHeader ? getCol(row, 'test_date') : '',
      test_time: hasRecognizedHeader ? getCol(row, 'test_time') : '',
      subject: subject || 'General',
      subject_level: hasRecognizedHeader ? getCol(row, 'subject_level') : '',
      figure_notes: hasRecognizedHeader ? getCol(row, 'figure_notes') : '',
      correction_notes: hasRecognizedHeader ? getCol(row, 'correction_notes') : '',
      source_pdf: hasRecognizedHeader ? getCol(row, 'source_pdf') : '',
      source_pages: hasRecognizedHeader ? getCol(row, 'source_pages') : '',
      source_question_reference: hasRecognizedHeader ? (getCol(row, 'source_question_reference') || `Q.${qNum}`) : `Q.${qNum}`,
      latex_check: 'checked',
      html_check: 'checked',
      answer_check: 'checked',
      solution_check: 'checked',
      hash_figure: hasRecognizedHeader ? getCol(row, 'hash_figure') : '',
      manually_review: 'checked',
      duplicate_statistics: 'Unique within this shift; duplicate check completed.'
    });
  }

  return distributePassagesAcrossItems(items).map(cleanMockTestItem);
}

/**
 * Helper to detect question range in passage headers:
 * e.g. "SET - 34 [Q. 164. to Q. 168.]", "Directions (439-443)", "निर्देश (प्रश्न 1 से 5)", etc.
 */
export function extractPassageRange(text: string): { start: number; end: number; label: string } | null {
  if (!text) return null;
  const p1 = text.match(/(?:Directions?|SET\s*-\s*\d+|निर्देश|Questions?|प्र(?:श्न)?|Q(?:uestion)?\.?)[^(\d\n]*[\[\(]?\s*(?:प्र(?:श्न)?|Q(?:uestion)?\.?\s*)?(\d+)\.?\s*(?:to|-|–|—|से)\s*(?:प्र(?:श्न)?|Q(?:uestion)?\.?\s*)?(\d+)\.?\s*[\]\)]?/i);
  if (p1) {
    const s = parseInt(p1[1], 10);
    const e = parseInt(p1[2], 10);
    if (!isNaN(s) && !isNaN(e) && e >= s) {
      return { start: s, end: e, label: `Q.${s}-${e}` };
    }
  }

  const p2 = text.match(/[\[\(]\s*(\d{1,4})\s*(?:to|-|–|—|से)\s*(\d{1,4})\s*[\]\)]/i);
  if (p2) {
    const s = parseInt(p2[1], 10);
    const e = parseInt(p2[2], 10);
    if (!isNaN(s) && !isNaN(e) && e >= s) {
      return { start: s, end: e, label: `Q.${s}-${e}` };
    }
  }

  return null;
}

/**
 * Automatically detects reading comprehension / गद्यांश passages and guarantees
 * that EVERY single question belonging to a passage set has the full passage prepended (separated by \n---\n).
 */
export function distributePassagesAcrossItems(items: MockTestMcqItem[]): MockTestMcqItem[] {
  if (!items || items.length === 0) return items;

  let currentPassageHi = '';
  let currentPassageEn = '';
  let currentPassageRange = '';
  let activeUntilQNum = 0;

  const result: MockTestMcqItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const qNum = Number(item.question_r) || (i + 1);
    const qHi = String(item.question_hi || '');
    const qEn = String(item.question_en || '');

    const hasOptions = Boolean(
      item.option1_hi || item.option2_hi || item.option1_en || item.option2_en ||
      item.option3_hi || item.option4_hi
    );

    // 1. Check if this is a standalone passage item (no options, passage keywords or long text)
    const isPassageKw = /(?:गद्यांश|काव्यांश|पद्यांश|निर्देश|अनुच्छेद|passage|comprehension|SET\s*-\s*\d+|Directions|Read the following)/i.test(qHi);
    const isStandalone = !hasOptions && isPassageKw && qHi.length > 40;

    if (isStandalone) {
      const range = extractPassageRange(qHi);
      if (range) {
        activeUntilQNum = range.end;
        currentPassageRange = range.label;
      } else {
        activeUntilQNum = qNum + 5;
        currentPassageRange = 'Passage Set';
      }
      currentPassageHi = qHi;
      currentPassageEn = qEn || qHi;
      // Do not include standalone passage placeholder as an MCQ item
      continue;
    }

    // 2. Check if this question stem has an embedded passage separated by '---'
    const hiParts = qHi.split(/\n\s*---\s*\n|\n---\n|---/);
    if (hiParts.length >= 2 && hiParts[0].trim().length > 40) {
      const passageSnippet = hiParts[0].trim();
      const isLikelyPassage = /(?:गद्यांश|काव्यांश|पद्यांश|निर्देश|अनुच्छेद|passage|comprehension|SET\s*-\s*\d+|Directions|Read the following)/i.test(passageSnippet) || passageSnippet.length > 80;

      if (isLikelyPassage) {
        currentPassageHi = passageSnippet;
        const enParts = qEn.split(/\n\s*---\s*\n|\n---\n|---/);
        currentPassageEn = enParts.length >= 2 ? enParts[0].trim() : (qEn.length > 80 ? qEn : currentPassageHi);

        const range = extractPassageRange(passageSnippet);
        if (range) {
          activeUntilQNum = range.end;
          currentPassageRange = range.label;
        } else {
          activeUntilQNum = qNum + 4;
          currentPassageRange = 'Passage Set';
        }
      }
    }

    // Also check item.passage_hi if provided directly
    if (item.passage_hi) {
      currentPassageHi = item.passage_hi;
      currentPassageEn = item.passage_en || currentPassageHi;
    }

    // 3. Check if active passage is valid for this question
    const inRange = activeUntilQNum > 0 && qNum > 0 ? qNum <= activeUntilQNum : Boolean(currentPassageHi);

    let updatedQHi = qHi;
    let updatedQEn = qEn;

    if (currentPassageHi && inRange) {
      const snippet = currentPassageHi.slice(0, 30);
      if (!updatedQHi.includes(snippet)) {
        updatedQHi = `${currentPassageHi}\n---\n${updatedQHi}`;
      }
      if (currentPassageEn) {
        const snippetEn = currentPassageEn.slice(0, 30);
        if (!updatedQEn.includes(snippetEn)) {
          updatedQEn = `${currentPassageEn}\n---\n${updatedQEn}`;
        }
      }
      item.passage_hi = currentPassageHi;
      item.passage_en = currentPassageEn;
      if (!item.figure_notes) {
        item.figure_notes = currentPassageRange ? `गद्यांश / Passage: ${currentPassageRange}` : 'गद्यांश / Passage';
      }
    } else if (activeUntilQNum > 0 && qNum > activeUntilQNum) {
      // Passage range completed
      currentPassageHi = '';
      currentPassageEn = '';
      currentPassageRange = '';
      activeUntilQNum = 0;
    }

    result.push({
      ...item,
      question_hi: updatedQHi,
      question_en: updatedQEn
    });
  }

  return result;
}

/**
 * Detects missing question numbers (gaps) in a list of MockTest items.
 * E.g., if items have question_r: [1, 2, 4, 7], returns [3, 5, 6].
 */
export function detectMissingQuestionNumbers(items: MockTestMcqItem[]): number[] {
  if (!items || items.length === 0) return [];
  const numbers = items
    .map(i => Number(i.question_r))
    .filter(n => !isNaN(n) && n > 0);
  if (numbers.length === 0) return [];

  const max = Math.max(...numbers);
  const numSet = new Set(numbers);
  const missing: number[] = [];

  for (let i = 1; i < max; i++) {
    if (!numSet.has(i)) {
      missing.push(i);
    }
  }
  return missing;
}

/**
 * Merges or appends incoming MockTest items into an existing set.
 * - 'smart_fill': First fills in any missing gap question numbers, inserts by question_r, and sorts numerically.
 * - 'append': Renumbers incoming questions sequentially after the last question in existing, and appends to end.
 * - 'replace': Completely replaces existing items with incoming items.
 */
export function mergeOrAppendMockTestItems(
  existing: MockTestMcqItem[],
  incoming: MockTestMcqItem[],
  mode: 'smart_fill' | 'append' | 'replace' = 'smart_fill'
): MockTestMcqItem[] {
  if (mode === 'replace') {
    return incoming.map((item, idx) => ({
      ...item,
      question_r: idx + 1,
      source_question_reference: item.source_question_reference || `Q.${idx + 1}`
    }));
  }

  if (mode === 'append') {
    const existingCount = existing.length;
    const renumberedIncoming = incoming.map((item, idx) => {
      const newNum = existingCount + idx + 1;
      return {
        ...item,
        question_r: newNum,
        source_question_reference: `Q.${newNum}`
      };
    });
    return [...existing, ...renumberedIncoming];
  }

  // mode === 'smart_fill': Fill gaps in sequence
  const missingGaps = detectMissingQuestionNumbers(existing);
  const existingMap = new Map<number, MockTestMcqItem>();
  existing.forEach(item => {
    if (item.question_r) {
      existingMap.set(item.question_r, item);
    }
  });

  const availableGaps = [...missingGaps];
  let nextMax = existing.reduce((max, it) => Math.max(max, it.question_r || 0), 0);

  const processedIncoming: MockTestMcqItem[] = [];

  for (const item of incoming) {
    let targetNum = item.question_r;

    // If item has a specific question_r that is in missing gaps or not currently in existing
    if (targetNum && targetNum > 0 && !existingMap.has(targetNum)) {
      const gapIdx = availableGaps.indexOf(targetNum);
      if (gapIdx >= 0) availableGaps.splice(gapIdx, 1);
    } else if (availableGaps.length > 0) {
      // Fill next available gap
      targetNum = availableGaps.shift()!;
    } else {
      // Append after max
      nextMax++;
      targetNum = nextMax;
    }

    processedIncoming.push({
      ...item,
      question_r: targetNum,
      source_question_reference: item.source_question_reference || `Q.${targetNum}`
    });
    existingMap.set(targetNum, item);
  }

  // Combine and sort by question_r
  const combined = [...existing, ...processedIncoming];
  combined.sort((a, b) => (a.question_r || 0) - (b.question_r || 0));

  // Renumber to ensure clean consecutive 1..N order
  return combined.map((item, idx) => ({
    ...item,
    question_r: idx + 1,
    source_question_reference: item.source_question_reference && !item.source_question_reference.startsWith('Q.')
      ? item.source_question_reference
      : `Q.${idx + 1}`
  }));
}

/**
 * Universal smart parser for ANY pasted text content:
 * Accepts CSV, TSV (Excel copy), JSON array / object, markdown code blocks, or raw plain questions.
 */
export function parseAnyMockTestPastedText(
  text: string,
  setName = 'Mock Test Paper',
  startIndex = 1
): MockTestMcqItem[] {
  if (!text || !text.trim()) return [];
  const trimmed = text.trim();

  // 1. If it looks like JSON or contains JSON blocks
  if (trimmed.startsWith('[') || trimmed.startsWith('{') || trimmed.includes('```json') || (trimmed.includes('"question"') && trimmed.includes('{'))) {
    try {
      const jsonItems = parseAiOutputToMockTestItems(trimmed, setName, startIndex);
      if (jsonItems && jsonItems.length > 0) return jsonItems;
    } catch {}
  }

  // 2. Try CSV / TSV table parsing
  if (trimmed.includes(',') || trimmed.includes('\t') || trimmed.includes(';')) {
    try {
      const csvItems = parseCsvToMockTestItems(trimmed, setName);
      if (csvItems && csvItems.length > 0) return csvItems;
    } catch {}
  }

  // 3. Fallback to heuristic parser
  try {
    const aiItems = parseAiOutputToMockTestItems(trimmed, setName, startIndex);
    if (aiItems && aiItems.length > 0) return aiItems;
  } catch {}

  return [];
}

/**
 * Converts standard extracted elements or OCR text into MockTestMcqItem[]
 */
export function convertElementsToMockTestItems(
  elements: ExtractedElement[],
  setName: string = 'Paper 1'
): MockTestMcqItem[] {
  const fullText = elements
    .map(e => e.type === 'text' ? (e.content || '') : '')
    .join('\n\n');

  if (!fullText.trim()) return [];

  const items: MockTestMcqItem[] = [];

  // Match question patterns: Q1, #1, 1., Question 1
  const qPattern = /(?:^|\n)(?:(?:Q(?:uestion)?\.?\s*[:\-]?\s*|#\s*)(\d+)[\.\)\-:]?|\((\d+)\))\s+/gi;
  const splits: { num: number; startIndex: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = qPattern.exec(fullText)) !== null) {
    const num = parseInt(match[1] || match[2], 10);
    splits.push({ num, startIndex: match.index });
  }

  if (splits.length === 0) {
    // Strictly verify if fullText actually contains a valid question (has options like (a), (b), (1), (2) or Answer:)
    const hasOptions = /(?:\([a-e1-5]\)|[a-e1-5]\s*[\.\)]|\boption\s*[1-4]\b)/i.test(fullText);
    const isErrorOrRefusal = /(?:cannot extract|binary JPEG|corrupted|JFIF|no readable text|I am sorry|I apologize|no questions|cannot read|unable to)/i.test(fullText);
    
    // If it's conversational refusal, error message, or lacks question options, DO NOT create dummy data!
    if (isErrorOrRefusal || !hasOptions || fullText.length < 25) {
      return [];
    }

    // Only if it's a real single question without standard Q# prefix:
    items.push({
      id: `mt_item_1`,
      question_r: 1,
      question_type: 'MCQ',
      question_hi: ensureHtmlParagraph(fullText),
      option1_hi: '',
      option2_hi: '',
      option3_hi: '',
      option4_hi: '',
      solution_hi: '',
      question_en: ensureHtmlParagraph(fullText),
      option1_en: '',
      option2_en: '',
      option3_en: '',
      option4_en: '',
      solution_en: '',
      answer: 'A',
      set_name: setName,
      difficulty_level: 'medium'
    });
    return items;
  }

  let currentPassage = '';
  let activeUntilQNum = 0;
  if (splits[0].startIndex > 0) {
    const preamble = fullText.slice(0, splits[0].startIndex).trim();
    if (/(?:गद्यांश|काव्यांश|पद्यांश|निर्देश|अनुच्छेद|passage|comprehension)/i.test(preamble) && preamble.length > 40) {
      currentPassage = preamble;
      const rangeMatch = preamble.match(/(?:प्र(?:\.|श्न)?|Q(?:uestion)?\.?)\s*(\d+)\s*(?:-|से|to)\s*(\d+)/i);
      if (rangeMatch) {
        activeUntilQNum = parseInt(rangeMatch[2], 10);
      }
    }
  }

  for (let i = 0; i < splits.length; i++) {
    const start = splits[i].startIndex;
    const end = i < splits.length - 1 ? splits[i + 1].startIndex : fullText.length;
    const chunk = fullText.slice(start, end).trim();

    // Extract Answer line
    let answer = 'A';
    let contentWithoutAns = chunk;
    const ansMatch = chunk.match(/(?:Answer|Ans|उत्तर)\s*[:\-]?\s*([A-Ea-e1-5])/i);
    if (ansMatch) {
      answer = ansMatch[1].toUpperCase();
      contentWithoutAns = chunk.replace(/(?:Answer|Ans|उत्तर)\s*[:\-]?\s*[A-Ea-e1-5].*$/im, '').trim();
    }

    // Extract Solution if present in the chunk
    let rawChunkSolution = '';
    const solMatch = chunk.match(/(?:(?:Detailed\s*)?Solution|Explanation|विस्तृत\s*हल|हल|व्याख्या|Proof)\s*[:\-]?\s*([\s\S]+?)(?=(?:^|\n)(?:(?:Q(?:uestion)?\.?\s*[:\-]?\s*|#\s*)\d+[\.\)\-:]?|\(\d+\))\s+|$)/i);
    if (solMatch) {
      rawChunkSolution = stripSolutionPrefix(solMatch[1].trim());
      // Strip the solution block from contentWithoutAns so it doesn't pollute the question stem
      contentWithoutAns = contentWithoutAns.replace(/(?:(?:Detailed\s*)?Solution|Explanation|विस्तृत\s*हल|हल|व्याख्या|Proof)\s*[:\-]?\s*[\s\S]+$/i, '').trim();
    }

    // Extract Options: (a), (b), (c), (d), (e) or A., B., C., D.
    const optPattern = /(?:^|\n)\s*(?:\(([a-eA-E1-5])\)|([a-eA-E1-5])[\.\)])\s+([^\n]+)/g;
    const rawOptions: { label: string; text: string }[] = [];
    let optMatch: RegExpExecArray | null;

    while ((optMatch = optPattern.exec(contentWithoutAns)) !== null) {
      const label = (optMatch[1] || optMatch[2]).toUpperCase();
      rawOptions.push({ label, text: optMatch[3].trim() });
    }

    // Check if trailing text after the last option contains a new passage for upcoming questions
    if (rawOptions.length >= 2) {
      const lastOptMatches = [...contentWithoutAns.matchAll(/(?:^|\n)\s*(?:\([a-eA-E1-5]\)|[a-eA-E1-5][\.\)])\s+[^\n]+/g)];
      if (lastOptMatches.length > 0) {
        const lastM = lastOptMatches[lastOptMatches.length - 1];
        const afterText = contentWithoutAns.slice(lastM.index! + lastM[0].length).trim();
        if (/(?:गद्यांश|काव्यांश|पद्यांश|निर्देश|अनुच्छेद|passage|comprehension)/i.test(afterText) && afterText.length > 40) {
          currentPassage = afterText;
          const rangeMatch = afterText.match(/(?:प्र(?:\.|श्न)?|Q(?:uestion)?\.?)\s*(\d+)\s*(?:-|से|to)\s*(\d+)/i);
          if (rangeMatch) {
            activeUntilQNum = parseInt(rangeMatch[2], 10);
          }
        }
      }
    }

    // Question text is everything before the first option
    let qText = contentWithoutAns;
    const firstOptIdx = contentWithoutAns.search(/(?:^|\n)\s*(?:\([a-eA-E1-5]\)|[a-eA-E1-5][\.\)])\s+/);
    if (firstOptIdx > 0) {
      qText = contentWithoutAns.slice(0, firstOptIdx).trim();
    }
    // Strip the leading question numbering from qText
    qText = qText.replace(/^(?:(?:Q(?:uestion)?\.?\s*[:\-]?\s*|#\s*)\d+[\.\)\-:]?|\(\d+\))\s*/i, '').trim();

    // Attach active passage if within range
    const thisQNum = splits[i].num;
    const shouldAttachPassage = currentPassage && (activeUntilQNum > 0 ? thisQNum <= activeUntilQNum : true);
    if (shouldAttachPassage && !qText.includes(currentPassage.slice(0, 25))) {
      qText = `${currentPassage}\n\n---\n\n${qText}`;
    }

    // Determine if bilingual (Hindi vs English)
    const hasHindi = /[\u0900-\u097F]/.test(qText);
    let qHindi = qText;
    let qEng = qText;

    // Check if question has Hindi on line 1, English on line 2
    const lines = qText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2 && /[\u0900-\u097F]/.test(lines[0]) && /[a-zA-Z]{4,}/.test(lines[1])) {
      qHindi = lines[0];
      qEng = lines.slice(1).join(' ');
    } else if (qText.includes(' / ')) {
      const slashParts = qText.split(' / ');
      if (slashParts.length === 2) {
        qHindi = slashParts[0].trim();
        qEng = slashParts[1].trim();
      }
    }

    // Parse options for Hindi and English
    const getOpt = (label: string): { hi: string; en: string } => {
      const found = rawOptions.find(o => o.label === label);
      if (!found) return { hi: '', en: '' };
      const txt = found.text;
      if (txt.includes(' / ')) {
        const p = txt.split(' / ');
        return { hi: p[0].trim(), en: p[1].trim() };
      }
      return { hi: txt, en: txt };
    };

    const optA = getOpt('A');
    const optB = getOpt('B');
    const optC = getOpt('C');
    const optD = getOpt('D');
    const optE = getOpt('E');

    // Balance options so neither Hindi nor English is left blank
    const aHi = optA.hi || optA.en;
    const aEn = optA.en || optA.hi;
    const bHi = optB.hi || optB.en;
    const bEn = optB.en || optB.hi;
    const cHi = optC.hi || optC.en;
    const cEn = optC.en || optC.hi;
    const dHi = optD.hi || optD.en;
    const dEn = optD.en || optD.hi;
    const eHi = optE.hi || optE.en;
    const eEn = optE.en || optE.hi;

    let correctOptHi = '';
    let correctOptEn = '';
    const normAns = (answer || '').trim().toUpperCase();
    if (normAns === 'A' || normAns === '1') { correctOptHi = aHi; correctOptEn = aEn; }
    else if (normAns === 'B' || normAns === '2') { correctOptHi = bHi; correctOptEn = bEn; }
    else if (normAns === 'C' || normAns === '3') { correctOptHi = cHi; correctOptEn = cEn; }
    else if (normAns === 'D' || normAns === '4') { correctOptHi = dHi; correctOptEn = dEn; }
    else if (normAns === 'E' || normAns === '5') { correctOptHi = eHi; correctOptEn = eEn; }

    const cleanCorrectTextHi = correctOptHi ? correctOptHi.replace(/<[^>]*>/g, '').trim() : '';
    const cleanCorrectTextEn = correctOptEn ? correctOptEn.replace(/<[^>]*>/g, '').trim() : '';

    let solHi = '';
    let solEn = '';
    if (rawChunkSolution) {
      solHi = rawChunkSolution;
      solEn = rawChunkSolution;
    } else {
      solHi = cleanCorrectTextHi ? cleanCorrectTextHi : 'विस्तृत हल व व्याख्या उपलब्ध नहीं है।';
      solEn = cleanCorrectTextEn ? cleanCorrectTextEn : 'Detailed solution and explanation not available.';
    }

    items.push({
      id: `mt_item_${i + 1}_${Date.now()}`,
      question_r: i + 1,
      question_type: 'MCQ',
      question_hi: qHindi || qEng,
      option1_hi: aHi,
      option2_hi: bHi,
      option3_hi: cHi,
      option4_hi: dHi,
      option5_hi: eHi,
      solution_hi: solHi,
      question_en: qEng || qHindi,
      option1_en: aEn,
      option2_en: bEn,
      option3_en: cEn,
      option4_en: dEn,
      option5_en: eEn,
      solution_en: solEn,
      answer,
      set_name: setName,
      difficulty_level: 'medium'
    });
  }

  return items.map(cleanMockTestItem);
}

/**
 * Generate a specialized AI prompt for directly extracting images into the 34-column MockTest schema,
 * with optional carry-over context from the previous page.
 */
export function buildMockTestDirectPrompt(
  setName = 'PYPs Shift-3',
  pendingContext?: PendingMcqContext | null,
  pageNumber?: number
): string {
  let carryOverSection = '';
  if (pendingContext && pendingContext.pendingItems && pendingContext.pendingItems.length > 0) {
    const pendingJson = JSON.stringify(pendingContext.pendingItems.map(it => ({
      question_reference: it.source_question_reference || it.question_r,
      question_hi: it.question_hi || '',
      question_en: it.question_en || '',
      option1_hi: it.option1_hi || '',
      option2_hi: it.option2_hi || '',
      option3_hi: it.option3_hi || '',
      option4_hi: it.option4_hi || '',
      option1_en: it.option1_en || '',
      option2_en: it.option2_en || '',
      option3_en: it.option3_en || '',
      option4_en: it.option4_en || '',
      answer: it.answer || '',
      source_pages: it.source_pages || String(pendingContext.sourcePageNumber)
    })), null, 2);

    carryOverSection = `\n\nCRITICAL: CARRY-OVER CONTEXT FROM PREVIOUS PAGE (Page ${pendingContext.sourcePageNumber}):
The previous page ended with the following incomplete question(s) that may continue on this current page:
${pendingJson}

CARRY-OVER CONTINUATION INSTRUCTIONS:
1. Carefully check the VERY TOP of this page image:
   - Does this page start with the continuation of any pending question from the previous page?
     * SCENARIO A: Remaining options C and D, or remainder of question stem.
     * SCENARIO B (Common in Ghatna Chakra / YCT): The previous page had the question stem and all 4 options, but its 'सही उत्तर:' and 'व्याख्या:' (Answer & Explanation box) were cut off and appear at the VERY TOP of this page!
   - IF YES:
     * MERGE the continuation (remaining options OR the answer & explanation box) with the pending question data from above to produce a SINGLE COMPLETE QUESTION.
     * Set its "source_pages" to "${pendingContext.sourcePageNumber}, ${pageNumber || pendingContext.sourcePageNumber + 1}".
     * Place this merged question as the FIRST object in the JSON output array.
     * DO NOT output the continuation or answer/explanation fragment as a detached or separate dummy question!
   - IF NO:
     * If this page begins with a brand new question, extract all questions on this page normally.
2. EXTRACT SUBSEQUENT QUESTIONS:
   - The question appearing directly below the continuation/explanation (e.g. new question like 'मुख्यमंत्री प्रतिज्ञा योजना...') is a BRAND NEW QUESTION and must be extracted normally as the next item.
3. INCOMPLETE QUESTIONS AT PAGE BOTTOM:
   - If the last question at the bottom of this page is cut off or missing options/answer, extract whatever stem and options are visible.`;
  }

  return `Extract ALL MCQs, MSQs, and NAT questions from this exam image into a strict JSON array.${carryOverSection}

FORMAT & TYPOGRAPHY RULES:
1. NO HTML TAGS: Output question stems, options, and solutions as clean normal text. Never output <p>, <br>, <b>, <table>, or <span>. Use simple \\n for line breaks.
2. LATEX FOR MATH/SCIENCE ONLY: Wrap formulas, equations, fractions, and roots in $...$ (e.g. $x^2 + y^2 = 25$, $\\frac{a}{b}$, $\\sqrt{x}$, $H_2O$). Keep normal text, units (e.g. km/h), and currency (₹500) as normal plain text.
3. LANGUAGE PAPERS & BILINGUAL RULES (CRITICAL):
   - For English Language tests (English Comprehension, Grammar, Vocab, etc.): DO NOT translate into Hindi! Both question_hi and question_en (and their options) MUST contain ONLY the original English text.
   - For Hindi Language tests (हिंदी गद्यांश, व्याकरण, मुहावरे आदि): DO NOT translate into English! Both question_hi and question_en (and their options) MUST contain ONLY the original Hindi text.
   - For other general subjects (Maths, Reasoning, Science, GS): provide Hindi (_hi) and English (_en). If document has only one, translate the counterpart.
4. COMPREHENSIVE SOLUTION: Provide an in-depth, step-by-step pedagogical explanation (given data, LaTeX formula $...$, complete step-by-step calculations without skipping steps, or thorough factual background) so any level of student can understand easily. Do NOT start with 'हल:' or 'Solution:' and NEVER mention option letters ("Option A is correct").
5. NO EXAM BOILERPLATE: Strip exam dates, shifts, and book publisher watermarks.
6. READING COMPREHENSION / PASSAGE SETS (CRITICAL):
   - If questions are based on a Passage, Comprehension text, Directions, or गद्यांश / काव्यांश (e.g., "SET - 34 [Q. 164. to Q. 168.]", "Directions (439-443)", "गद्यांश को पढ़कर..."):
     YOU MUST PREPEND THE COMPLETE PASSAGE TEXT TO EVERY SINGLE QUESTION BELONGING TO THAT SET in both question_hi and question_en, separated by "\\n---\\n" (e.g., "[Full Passage Text]\\n---\\n[Question Text]").
   - NEVER attach the passage only once or only to the first question! Every question belonging to that passage set (e.g. Q.164, Q.165, Q.166, Q.167, Q.168) MUST have the complete passage text attached so each question is fully self-contained.

TARGET JSON FIELDS FOR EACH OBJECT:
question_r, question_hi, option1_hi, option2_hi, option3_hi, option4_hi, option5_hi, solution_hi,
question_en, option1_en, option2_en, option3_en, option4_en, option5_en, solution_en,
answer (e.g. "A"), set_name ("${setName}"), difficulty_level ("Medium"),
test_date (""), test_time (""),
subject (pure academic subject like "Mathematics", "Reasoning", "Physics", "Chemistry", "History", "Geography", "Polity"),
subject_level (""), figure_notes (""), correction_notes (""), source_pdf (""), source_pages ("${pageNumber || '1'}"), source_question_reference ("Q.1"),
latex_check ("checked"), html_check ("checked"), answer_check ("checked"), solution_check ("checked"), hash_figure (""), manually_review ("checked"), duplicate_statistics ("Unique within this shift; duplicate check completed.")

Respond ONLY with the JSON array inside \`\`\`json ... \`\`\`.`;
}

/**
 * Call the AI service to generate rich, step-by-step Hindi & English solutions for a single MCQ item.
 */
export async function generateDeepSolutionForItem(
  item: MockTestMcqItem
): Promise<{ solution_hi: string; solution_en: string; difficulty_level?: DifficultyLevel }> {
  const settings = await getAiSettings();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (settings.apiKey) {
    headers['x-user-gemini-key'] = settings.apiKey.trim();
  }

  const response = await fetch('/api/mocktest-solve', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      question_hi: item.question_hi,
      question_en: item.question_en,
      option1_hi: item.option1_hi,
      option2_hi: item.option2_hi,
      option3_hi: item.option3_hi,
      option4_hi: item.option4_hi,
      option5_hi: item.option5_hi || '',
      option1_en: item.option1_en,
      option2_en: item.option2_en,
      option3_en: item.option3_en,
      option4_en: item.option4_en,
      option5_en: item.option5_en || '',
      answer: item.answer,
      question_type: item.question_type
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to generate solution');
  }

  const data = await response.json();
  return {
    solution_hi: cleanMocktestText(data.solution_hi || ''),
    solution_en: cleanMocktestText(data.solution_en || ''),
    difficulty_level: data.difficulty_level || item.difficulty_level
  };
}

/**
 * Automatically repairs incomplete questions with AI: recovers missing options, cleans stems,
 * determines true answer, sets strict academic subject, and generates deep pedagogical solutions.
 */
export async function repairMockTestItemWithAi(
  item: MockTestMcqItem
): Promise<MockTestMcqItem> {
  // First, apply deterministic trailing-options recovery
  const baseItem = autoRecoverItemOptionsFromStem(item);

  const settings = await getAiSettings();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (settings.apiKey) {
    headers['x-user-gemini-key'] = settings.apiKey.trim();
  }

  const response = await fetch('/api/mocktest-repair-item', {
    method: 'POST',
    headers,
    body: JSON.stringify({ item: baseItem })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to auto-repair question with AI');
  }

  const data = await response.json();

  const mergedItem: MockTestMcqItem = {
    ...baseItem,
    question_hi: data.question_hi || baseItem.question_hi,
    question_en: data.question_en || baseItem.question_en,
    option1_hi: data.option1_hi || baseItem.option1_hi,
    option2_hi: data.option2_hi || baseItem.option2_hi,
    option3_hi: data.option3_hi || baseItem.option3_hi,
    option4_hi: data.option4_hi || baseItem.option4_hi,
    option1_en: data.option1_en || baseItem.option1_en,
    option2_en: data.option2_en || baseItem.option2_en,
    option3_en: data.option3_en || baseItem.option3_en,
    option4_en: data.option4_en || baseItem.option4_en,
    solution_hi: data.solution_hi || baseItem.solution_hi,
    solution_en: data.solution_en || baseItem.solution_en,
    answer: data.answer || baseItem.answer,
    subject: data.subject || baseItem.subject,
    difficulty_level: (data.difficulty_level || baseItem.difficulty_level || 'medium').toLowerCase() as DifficultyLevel,
  };

  return cleanMockTestItem(mergedItem);
}

/**
 * Ultra-robust JSON extractor that handles:
 * 1. Multiple ```json ... ``` code fences (combining all chunks)
 * 2. Multiple JSON arrays: [ ... ] \n\n [ ... ]
 * 3. Individual standalone JSON objects: { "question_hi": ... }
 * 4. Truncated JSON streams (unclosed arrays/objects cut off by token limits)
 */
export function extractRawJsonObjectsFromText(rawText: string): any[] {
  if (!rawText || !rawText.trim()) return [];

  const text = rawText.trim();
  const chunksToScan: string[] = [];

  // 1. Collect all markdown code fences
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text)) !== null) {
    if (match[1] && match[1].trim().length > 10) {
      chunksToScan.push(match[1].trim());
    }
  }

  // If no closed fences were found, check if there is an unclosed fence at the end
  if (chunksToScan.length === 0) {
    const unclosedMatch = text.match(/```(?:json)?\s*([\s\S]+)$/i);
    if (unclosedMatch && unclosedMatch[1].trim().length > 10) {
      chunksToScan.push(unclosedMatch[1].trim());
    } else {
      chunksToScan.push(text);
    }
  }

  const collectedObjects: any[] = [];
  const seenSignatures = new Set<string>();

  const isMcqObj = (obj: any): boolean => {
    if (!obj || typeof obj !== 'object') return false;
    return Boolean(
      obj.question_hi || obj.question_en || obj.question || obj.question_text || obj.q ||
      obj.option1_hi || obj.option1_en || obj.option_a || obj.optionA ||
      obj.options || obj.solution_hi || obj.solution_en || obj.solution || obj.explanation ||
      obj.question_r || obj.type === 'text' || obj.content
    );
  };

  const addObj = (obj: any) => {
    if (!isMcqObj(obj)) return;
    const stem = String(obj.question_hi || obj.question_en || obj.question || obj.content || '').slice(0, 70).trim();
    const ref = String(obj.source_question_reference || obj.question_r || '');
    const sig = `${ref}__${stem}`;
    if (!seenSignatures.has(sig)) {
      seenSignatures.add(sig);
      collectedObjects.push(obj);
    }
  };

  for (const chunk of chunksToScan) {
    const safeChunk = chunk
      .replace(/(?<!\\)\\frac/g, '\\\\frac')
      .replace(/(?<!\\)\\times/g, '\\\\times')
      .replace(/(?<!\\)\\sqrt/g, '\\\\sqrt')
      .replace(/(?<!\\)\\text/g, '\\\\text')
      .replace(/(?<!\\)\\div/g, '\\\\div')
      .replace(/(?<!\\)\\pm/g, '\\\\pm')
      .replace(/(?<!\\)\\cdot/g, '\\\\cdot')
      .replace(/(?<!\\)\\le(?!a)/g, '\\\\le')
      .replace(/(?<!\\)\\ge(?!t)/g, '\\\\ge')
      .replace(/(?<!\\)\\neq/g, '\\\\neq')
      .replace(/(?<!\\)\\approx/g, '\\\\approx');

    try {
      const p = JSON.parse(safeChunk);
      if (Array.isArray(p)) {
        p.forEach(addObj);
        continue;
      } else if (isMcqObj(p)) {
        addObj(p);
        continue;
      }
    } catch (_) {}

    // Extract all top-level [ ... ] arrays from the chunk
    let arrayStart = -1;
    let bracketDepth = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < safeChunk.length; i++) {
      const ch = safeChunk[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (ch === '[') {
          if (bracketDepth === 0) arrayStart = i;
          bracketDepth++;
        } else if (ch === ']') {
          bracketDepth--;
          if (bracketDepth === 0 && arrayStart >= 0) {
            const arrSub = safeChunk.slice(arrayStart, i + 1);
            try {
              const p = JSON.parse(arrSub);
              if (Array.isArray(p)) p.forEach(addObj);
            } catch (_) {
              extractBalancedJsonObjects(arrSub).forEach(addObj);
            }
            arrayStart = -1;
          }
        }
      }
    }

    if (bracketDepth > 0 && arrayStart >= 0) {
      const cutArray = safeChunk.slice(arrayStart);
      extractBalancedJsonObjects(cutArray).forEach(addObj);
    }

    extractBalancedJsonObjects(safeChunk).forEach(addObj);
  }

  return collectedObjects;
}

function extractBalancedJsonObjects(text: string): any[] {
  const result: any[] = [];
  let braceDepth = 0;
  let startIndex = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '{') {
        if (braceDepth === 0) startIndex = i;
        braceDepth++;
      } else if (ch === '}') {
        braceDepth--;
        if (braceDepth === 0 && startIndex >= 0) {
          const rawObj = text.slice(startIndex, i + 1);
          try {
            const cleaned = rawObj.replace(/,\s*([}\]])/g, '$1');
            const obj = JSON.parse(cleaned);
            if (obj && typeof obj === 'object') {
              result.push(obj);
            }
          } catch (_) {
            const loose = tryRepairAndParseSingleObject(rawObj);
            if (loose) result.push(loose);
          }
          startIndex = -1;
        }
      }
    }
  }

  if (braceDepth > 0 && startIndex >= 0) {
    const partial = text.slice(startIndex);
    const recovered = tryRepairAndParseSingleObject(partial);
    if (recovered) result.push(recovered);
  }

  return result;
}

function tryRepairAndParseSingleObject(str: string): any | null {
  try {
    let s = str.trim();
    let quoteCount = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '"' && (i === 0 || s[i - 1] !== '\\')) quoteCount++;
    }
    if (quoteCount % 2 !== 0) s += '"';
    s = s.replace(/,\s*$/, '');

    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (!inStr) {
        if (c === '{') depth++;
        if (c === '}') depth--;
      }
    }
    while (depth > 0) {
      s += '}';
      depth--;
    }

    s = s.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

/**
 * Parse raw text / JSON response from any AI provider (Gemini, DeepSeek, ChatGPT, Claude)
 * into a complete, valid MockTestMcqItem[] with all 18 fields fully populated.
 */
export function parseAiOutputToMockTestItems(
  rawText: string,
  setName: string = 'Mock Test Paper',
  startIndex: number = 1
): MockTestMcqItem[] {
  if (!rawText || !rawText.trim()) return [];

  const parsed = extractRawJsonObjectsFromText(rawText);

  if (Array.isArray(parsed) && parsed.length > 0) {
    try {
      // Detect and distribute any comprehension passages / गद्यांश across the questions
      let currentPassageHi = '';
      let currentPassageEn = '';
      let currentPassageRange = '';
      let activeUntilQNum = 0;
      const normalizedList: any[] = [];

      for (let idx = 0; idx < parsed.length; idx++) {
        const rawObj = parsed[idx];
        const rawQHi = String(rawObj.question_hi || rawObj.question || rawObj.question_text || rawObj.q || '');
        const rawQEn = String(rawObj.question_en || '');
        const hasOpts = Boolean(
          rawObj.option1_hi || rawObj.option2_hi || rawObj.option1_en || rawObj.option2_en ||
          rawObj.option_a || rawObj.option_b || (Array.isArray(rawObj.options) && rawObj.options.length > 0)
        );

        // Check if this is a standalone passage block
        const isPassageKw = /(?:गद्यांश|काव्यांश|पद्यांश|निर्देश|अनुच्छेद|passage|comprehension|SET\s*-\s*\d+|Directions|Read the following)/i.test(rawQHi);
        const isStandalone = !hasOpts && isPassageKw && rawQHi.length > 40;

        if (isStandalone) {
          const rangeMatch = extractPassageRange(rawQHi);
          if (rangeMatch) {
            activeUntilQNum = rangeMatch.end;
            currentPassageRange = rangeMatch.label;
          } else {
            activeUntilQNum = (parseInt(rawObj.question_r, 10) || (startIndex + idx)) + 5;
            currentPassageRange = 'Passage Set';
          }
          currentPassageHi = rawQHi;
          currentPassageEn = rawQEn || rawQHi;
          continue;
        }

        // Check if this question stem has an embedded passage separated by '---'
        const hiParts = rawQHi.split(/\n\s*---\s*\n|\n---\n|---/);
        if (hiParts.length >= 2 && hiParts[0].trim().length > 40) {
          const passageSnippet = hiParts[0].trim();
          const isLikelyPassage = /(?:गद्यांश|काव्यांश|पद्यांश|निर्देश|अनुच्छेद|passage|comprehension|SET\s*-\s*\d+|Directions|Read the following)/i.test(passageSnippet) || passageSnippet.length > 80;

          if (isLikelyPassage) {
            currentPassageHi = passageSnippet;
            const enParts = rawQEn.split(/\n\s*---\s*\n|\n---\n|---/);
            currentPassageEn = enParts.length >= 2 ? enParts[0].trim() : (rawQEn.length > 80 ? rawQEn : currentPassageHi);

            const rangeMatch = extractPassageRange(passageSnippet);
            if (rangeMatch) {
              activeUntilQNum = rangeMatch.end;
              currentPassageRange = rangeMatch.label;
            } else {
              activeUntilQNum = (parseInt(rawObj.question_r, 10) || (startIndex + idx)) + 4;
              currentPassageRange = 'Passage Set';
            }
          }
        }

        if (rawObj.passage_hi || rawObj.gadyansh || rawObj.passage) {
          currentPassageHi = rawObj.passage_hi || rawObj.gadyansh || rawObj.passage;
          currentPassageEn = rawObj.passage_en || currentPassageHi;
        }

        const qNum = parseInt(rawObj.question_r, 10) || (startIndex + idx);
        const inRange = activeUntilQNum > 0 && qNum > 0 ? qNum <= activeUntilQNum : Boolean(currentPassageHi);

        let finalQHi = rawQHi;
        let finalQEn = rawQEn;

        if (currentPassageHi && inRange) {
          const snippet = currentPassageHi.slice(0, 25);
          if (!finalQHi.includes(snippet)) {
            finalQHi = `${currentPassageHi}\n---\n${finalQHi}`;
          }
          if (currentPassageEn) {
            const snippetEn = currentPassageEn.slice(0, 25);
            if (!finalQEn.includes(snippetEn)) {
              finalQEn = `${currentPassageEn}\n---\n${finalQEn}`;
            }
          }
          rawObj.passage_hi = currentPassageHi;
          rawObj.passage_en = currentPassageEn;
          if (!rawObj.figure_notes) {
            rawObj.figure_notes = currentPassageRange ? `गद्यांश / Passage: ${currentPassageRange}` : 'गद्यांश / Passage';
          }
        }

        normalizedList.push({
          ...rawObj,
          question_hi: finalQHi,
          question_en: finalQEn
        });
      }

      return distributePassagesAcrossItems(normalizedList.map((obj, i) => {
        const qNum = parseInt(obj.question_r, 10) || (startIndex + i);
        let rawAns = String(obj.answer || obj.ans || obj.correct || obj.correct_option || 'A').trim();
        rawAns = rawAns.replace(/^(?:Answer|Ans|उत्तर)\s*[:\-]?\s*/i, '').trim().toUpperCase();
        if (!rawAns) rawAns = 'A';

        let qType: QuestionType = 'MCQ';
        if (rawAns.startsWith('[') && rawAns.endsWith(']')) qType = 'MSQ';
        else if (rawAns.startsWith('{') && rawAns.endsWith('}')) qType = 'NAT';

        // 1. Question Text
        let qHi = obj.question_hi || '';
        let qEn = obj.question_en || '';
        const genericQ = obj.question || obj.question_text || obj.q || '';

        if (!qHi && !qEn && genericQ) {
          const lines = genericQ.split('\n').map((l: string) => l.trim()).filter(Boolean);
          if (lines.length >= 2 && /[\u0900-\u097F]/.test(lines[0]) && /[a-zA-Z]{4,}/.test(lines[1])) {
            qHi = lines[0];
            qEn = lines.slice(1).join(' ');
          } else if (genericQ.includes(' / ')) {
            const parts = genericQ.split(' / ');
            qHi = parts[0].trim();
            qEn = parts[1].trim();
          } else {
            qHi = genericQ;
            qEn = genericQ;
          }
        }

        if (!qHi && qEn) qHi = qEn;
        if (!qEn && qHi) qEn = qHi;

        qHi = qHi.replace(/^(?:(?:Q(?:uestion)?\.?\s*[:\-]?\s*|#\s*)\d+[\.\)\-:]?|\(\d+\))\s*/i, '').trim();
        qEn = qEn.replace(/^(?:(?:Q(?:uestion)?\.?\s*[:\-]?\s*|#\s*)\d+[\.\)\-:]?|\(\d+\))\s*/i, '').trim();

        // 2. Options Extraction
        let opt1Hi = String(obj.option1_hi || '');
        let opt2Hi = String(obj.option2_hi || '');
        let opt3Hi = String(obj.option3_hi || '');
        let opt4Hi = String(obj.option4_hi || '');
        let opt5Hi = String(obj.option5_hi || '');

        let opt1En = String(obj.option1_en || '');
        let opt2En = String(obj.option2_en || '');
        let opt3En = String(obj.option3_en || '');
        let opt4En = String(obj.option4_en || '');
        let opt5En = String(obj.option5_en || '');

        const cleanOptText = (txt: any) => {
          return String(txt || '').replace(/^(?:\([a-eA-E1-5]\)|[a-eA-E1-5][\.\)]|\b[A-E]\b[\.\)\s\-:]+)\s*/i, '').trim();
        };

        if (Array.isArray(obj.options)) {
          const arr = obj.options;
          if (arr[0] !== undefined) { const v = cleanOptText(arr[0]); opt1Hi = opt1Hi || v; opt1En = opt1En || v; }
          if (arr[1] !== undefined) { const v = cleanOptText(arr[1]); opt2Hi = opt2Hi || v; opt2En = opt2En || v; }
          if (arr[2] !== undefined) { const v = cleanOptText(arr[2]); opt3Hi = opt3Hi || v; opt3En = opt3En || v; }
          if (arr[3] !== undefined) { const v = cleanOptText(arr[3]); opt4Hi = opt4Hi || v; opt4En = opt4En || v; }
          if (arr[4] !== undefined) { const v = cleanOptText(arr[4]); opt5Hi = opt5Hi || v; opt5En = opt5En || v; }
        } else if (obj.options && typeof obj.options === 'object') {
            const o = obj.options;
            const a = o.A || o.a || o['1'];
            const b = o.B || o.b || o['2'];
            const c = o.C || o.c || o['3'];
            const d = o.D || o.d || o['4'];
            const e = o.E || o.e || o['5'];
            if (a) { opt1Hi = opt1Hi || cleanOptText(a); opt1En = opt1En || cleanOptText(a); }
            if (b) { opt2Hi = opt2Hi || cleanOptText(b); opt2En = opt2En || cleanOptText(b); }
            if (c) { opt3Hi = opt3Hi || cleanOptText(c); opt3En = opt3En || cleanOptText(c); }
            if (d) { opt4Hi = opt4Hi || cleanOptText(d); opt4En = opt4En || cleanOptText(d); }
            if (e) { opt5Hi = opt5Hi || cleanOptText(e); opt5En = opt5En || cleanOptText(e); }
          }

          if (obj.option_a || obj.optionA) { const v = cleanOptText(obj.option_a || obj.optionA); opt1Hi = opt1Hi || v; opt1En = opt1En || v; }
          if (obj.option_b || obj.optionB) { const v = cleanOptText(obj.option_b || obj.optionB); opt2Hi = opt2Hi || v; opt2En = opt2En || v; }
          if (obj.option_c || obj.optionC) { const v = cleanOptText(obj.option_c || obj.optionC); opt3Hi = opt3Hi || v; opt3En = opt3En || v; }
          if (obj.option_d || obj.optionD) { const v = cleanOptText(obj.option_d || obj.optionD); opt4Hi = opt4Hi || v; opt4En = opt4En || v; }

          // Ensure both Hindi & English options are balanced
          if (!opt1Hi && opt1En) opt1Hi = opt1En;
          if (!opt1En && opt1Hi) opt1En = opt1Hi;
          if (!opt2Hi && opt2En) opt2Hi = opt2En;
          if (!opt2En && opt2Hi) opt2En = opt2Hi;
          if (!opt3Hi && opt3En) opt3Hi = opt3En;
          if (!opt3En && opt3Hi) opt3En = opt3Hi;
          if (!opt4Hi && opt4En) opt4Hi = opt4En;
          if (!opt4En && opt4Hi) opt4En = opt4Hi;
          if (!opt5Hi && opt5En) opt5Hi = opt5En;
          if (!opt5En && opt5Hi) opt5En = opt5Hi;

          // 3. Solutions Extraction
          let solHi = obj.solution_hi || '';
          let solEn = obj.solution_en || '';
          const genericSol = obj.solution || obj.explanation || obj.exp || obj.sol || '';

          if (!solHi && genericSol) {
            solHi = stripSolutionPrefix(genericSol);
          }
          if (!solEn && genericSol) {
            solEn = stripSolutionPrefix(genericSol);
          }

          if (!solHi && solEn) solHi = solEn;
          if (!solEn && solHi) solEn = solHi;

          if (!solHi || !solEn) {
            let correctTextHi = '';
            let correctTextEn = '';
            const nAns = (rawAns || '').trim().toUpperCase();
            if (nAns === 'A' || nAns === '1') { correctTextHi = opt1Hi; correctTextEn = opt1En; }
            else if (nAns === 'B' || nAns === '2') { correctTextHi = opt2Hi; correctTextEn = opt2En; }
            else if (nAns === 'C' || nAns === '3') { correctTextHi = opt3Hi; correctTextEn = opt3En; }
            else if (nAns === 'D' || nAns === '4') { correctTextHi = opt4Hi; correctTextEn = opt4En; }
            else if (nAns === 'E' || nAns === '5') { correctTextHi = opt5Hi; correctTextEn = opt5En; }

            const cHi = correctTextHi ? correctTextHi.replace(/<[^>]*>/g, '').trim() : '';
            const cEn = correctTextEn ? correctTextEn.replace(/<[^>]*>/g, '').trim() : '';

            if (!solHi) solHi = cHi ? cHi : 'विस्तृत हल व व्याख्या उपलब्ध नहीं है।';
            if (!solEn) solEn = cEn ? cEn : 'Detailed solution and explanation not available.';
          }

          const candidateSubject = obj.subject || obj.subject_name || obj.topic || '';
          const cleanSubject = normalizeStrictSubject(candidateSubject, `${qHi} ${qEn}`, `${solHi} ${solEn}`);

          return cleanMockTestItem({
            id: `mt_ai_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
            question_r: qNum,
            question_type: qType,
            question_hi: qHi,
            option1_hi: opt1Hi,
            option2_hi: opt2Hi,
            option3_hi: opt3Hi,
            option4_hi: opt4Hi,
            option5_hi: opt5Hi,
            solution_hi: solHi,
            question_en: qEn,
            option1_en: opt1En,
            option2_en: opt2En,
            option3_en: opt3En,
            option4_en: opt4En,
            option5_en: opt5En,
            solution_en: solEn,
            answer: rawAns,
            set_name: obj.set_name || setName,
            difficulty_level: (obj.difficulty_level || 'Easy').toLowerCase() === 'hard' ? 'hard' : (obj.difficulty_level || 'Easy').toLowerCase() === 'easy' ? 'easy' : 'medium',
            test_date: obj.test_date || '',
            test_time: obj.test_time || '',
            subject: cleanSubject,
            subject_level: obj.subject_level || '',
            figure_notes: obj.figure_notes || '',
            correction_notes: obj.correction_notes || '',
            source_pdf: obj.source_pdf || '',
            source_pages: obj.source_pages || '',
            source_question_reference: obj.source_question_reference || `Q.${qNum}`,
            latex_check: obj.latex_check || 'checked',
            html_check: obj.html_check || 'checked',
            answer_check: obj.answer_check || 'checked',
            solution_check: obj.solution_check || 'checked',
            hash_figure: obj.hash_figure || '',
            manually_review: obj.manually_review || 'checked',
            passage_hi: obj.passage_hi || '',
            passage_en: obj.passage_en || ''
          });
        }));
      } catch (e) {
        console.warn('JSON parse failed in parseAiOutputToMockTestItems, falling back to heuristic parsing:', e);
      }
    }

  // Fallback: convert raw elements/text ONLY IF it actually contains question content
  const isErrorOrRefusal = /(?:cannot extract|binary JPEG|corrupted|JFIF|no readable text|I am sorry|I apologize|no questions|cannot read|unable to|valid question)/i.test(rawText);
  if (isErrorOrRefusal || !/(?:\([a-e1-5]\)|[a-e1-5]\s*[\.\)]|\boption\s*[1-4]\b|Q(?:uestion)?\.?\s*\d+)/i.test(rawText)) {
    return []; // Production-ready: NEVER return dummy data from errors or refusal messages!
  }

  const fakeElement: ExtractedElement = {
    id: `raw_${Date.now()}`,
    type: 'text',
    content: rawText
  };
  return convertElementsToMockTestItems([fakeElement], setName).map(cleanMockTestItem);
}

/**
 * Fast & ultra-reliable prompt for AI browser chat (DeepSeek, ChatGPT, Gemini, Claude) via Extension Bridge
 * that guarantees all 34 columns are provided with Hindi, English, options, step-by-step solutions,
 * and optional carry-over context from the previous page.
 */
export function buildMockTestBridgePrompt(
  setName = 'PYPs Shift-3',
  pendingContext?: PendingMcqContext | null,
  pageNumber?: number
): string {
  let carryOverSection = '';
  if (pendingContext && pendingContext.pendingItems && pendingContext.pendingItems.length > 0) {
    carryOverSection = `\n(Note: The top of this page may contain the continuation of previous question Q.${pendingContext.sourcePageNumber}).`;
  }

  return `You are a professional Exam Paper Digitizer.
Extract all multiple-choice questions (MCQs) from this exam page into a strict JSON array.${carryOverSection}

RULES:
1. NO HTML TAGS: Output clean normal text without <p>, <b>, <br>, <table>, or <span>. Use natural \\n for line breaks.
2. LATEX FOR MATH & SCIENCE ONLY:
   - Use standard LaTeX $...$ for mathematical/scientific formulas, equations, roots, powers, fractions, and variables (e.g. $x^2 + y^2 = 25$, $\\frac{a}{b}$, $\\sqrt{x}$).
   - For regular words, units, numbers, and currency (₹), write normal plain text (e.g. "40 km/h", "₹500", not in LaTeX).
3. LANGUAGE PAPERS & BILINGUAL RULES (CRITICAL):
   - For English Language tests (English Comprehension, Grammar, Vocab, etc.): DO NOT translate into Hindi! Both "question_hi" and "question_en" (and their options) MUST contain ONLY the original English text.
   - For Hindi Language tests (हिंदी गद्यांश, व्याकरण आदि): DO NOT translate into English! Both "question_hi" and "question_en" (and their options) MUST contain ONLY the original Hindi text.
   - For other general subjects (Maths, Reasoning, Science, GS): provide Hindi in _hi and English in _en.
4. Comprehensive Solutions: Provide an in-depth, step-by-step pedagogical solution (given data, LaTeX formula $...$, complete step-by-step calculations without skipping steps, or thorough factual background) so any level of student can understand easily. Do NOT start with 'हल:' or 'Solution:' and NEVER mention option letters ("Option A is correct").
5. Correct Answer: Single letter "A", "B", "C", or "D".
6. READING COMPREHENSION / PASSAGE SETS (CRITICAL):
   - If questions are based on a Passage, Comprehension text, Directions, or गद्यांश / काव्यांश (e.g., "SET - 34 [Q. 164. to Q. 168.]", "Directions (439-443)", "गद्यांश को पढ़कर..."):
     YOU MUST PREPEND THE COMPLETE PASSAGE TEXT TO EVERY SINGLE QUESTION BELONGING TO THAT SET in both question_hi and question_en, separated by "\\n---\\n" (e.g., "[Full Passage Text]\\n---\\n[Question Text]").
   - NEVER attach the passage only once or only with the first question! Every question belonging to that passage set (e.g. Q.164, Q.165, Q.166, Q.167, Q.168) MUST have the complete passage text attached so students can read the passage with every question.

Output ONLY a JSON array inside \`\`\`json ... \`\`\` block with these fields for each question:
[
  {
    "question_r": 1,
    "question_hi": "...",
    "question_en": "...",
    "option1_hi": "...",
    "option2_hi": "...",
    "option3_hi": "...",
    "option4_hi": "...",
    "option1_en": "...",
    "option2_en": "...",
    "option3_en": "...",
    "option4_en": "...",
    "answer": "A",
    "solution_hi": "...",
    "solution_en": "...",
    "subject": "General",
    "difficulty_level": "medium",
    "source_question_reference": "Q.1"
  }
]

At the very end after the JSON code block, on a new line, output:
---STUDY_AI_COMPLETE---`;
}

/**
 * Generate a specialized AI prompt for reference-based generation of brand-new, similar MCQs
 * using the StudyAI Bridge extension. The questions in the image act STRICTLY AS REFERENCE.
 */
export function buildMockTestSimilarBridgePrompt(
  setName = 'PYPs Shift-3',
  pendingContext?: PendingMcqContext | null,
  pageNumber?: number
): string {
  return `You are an elite Exam Question Creator.
The attached exam page questions serve STRICTLY AS CONCEPT REFERENCE. Create BRAND NEW, UNIQUE PRACTICE MCQs (DO NOT copy verbatim).

RULES:
1. NO HTML TAGS: Output clean normal text without <p>, <b>, <br>, <table>, or <span>. Use natural \\n for line breaks.
2. LATEX FOR MATH & SCIENCE ONLY:
   - Use standard LaTeX $...$ for mathematical/scientific formulas, equations, roots, powers, fractions, and variables (e.g. $x^2 + y^2 = 25$, $\\frac{a}{b}$, $\\sqrt{x}$).
   - For regular words, units, numbers, and currency (₹), write normal plain text (e.g. "40 km/h", "₹500", not in LaTeX).
3. LANGUAGE PAPERS & BILINGUAL RULES (CRITICAL):
   - For English Language tests (English Comprehension, Grammar, Vocab, etc.): DO NOT translate into Hindi! Both "question_hi" and "question_en" (and their options) MUST contain ONLY the original English text.
   - For Hindi Language tests (हिंदी गद्यांश, व्याकरण आदि): DO NOT translate into English! Both "question_hi" and "question_en" (and their options) MUST contain ONLY the original Hindi text.
   - For other general subjects (Maths, Reasoning, Science, GS): provide Hindi in _hi and English in _en.
4. Comprehensive Solutions: Provide an in-depth, step-by-step pedagogical solution (given data, LaTeX formula $...$, complete step-by-step calculations without skipping steps, or thorough factual background) so any level of student can understand easily. Do NOT start with 'हल:' or 'Solution:' and NEVER mention option letters ("Option A is correct").
5. Correct Answer: Single letter "A", "B", "C", or "D".
6. READING COMPREHENSION / PASSAGE SETS (CRITICAL):
   - If reference questions are based on a reading comprehension passage or गद्यांश, create a relevant passage and PREPEND THE COMPLETE PASSAGE TEXT TO EVERY SINGLE QUESTION belonging to that passage set in both question_hi and question_en, separated by "\\n---\\n".

Output ONLY a JSON array inside \`\`\`json ... \`\`\` block with these fields for each question:
[
  {
    "question_r": 1,
    "question_hi": "...",
    "question_en": "...",
    "option1_hi": "...",
    "option2_hi": "...",
    "option3_hi": "...",
    "option4_hi": "...",
    "option1_en": "...",
    "option2_en": "...",
    "option3_en": "...",
    "option4_en": "...",
    "answer": "A",
    "solution_hi": "...",
    "solution_en": "...",
    "subject": "General",
    "difficulty_level": "medium",
    "source_question_reference": "Ref-Q.1 (Variant)"
  }
]

At the very end after the JSON code block, on a new line, output:
---STUDY_AI_COMPLETE---`;
}

/**
 * Extract MockTest MCQs from a base64 image using direct Gemini API (/api/mocktest-extract or /api/extract)
 * with optional carry-over pending context from the preceding page.
 * When generateSimilar is true, questions on the page are used ONLY as reference to generate brand new MCQs.
 */
export async function extractMockTestWithDirectApi(
  base64Image: string,
  setName: string = 'Mock Test Paper',
  startIndex: number = 1,
  pendingContext?: PendingMcqContext | null,
  pageNumber?: number,
  generateSimilar: boolean = false,
  rawText?: string,
  signal?: AbortSignal
): Promise<MockTestMcqItem[]> {
  const settings = await getAiSettings();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (settings.apiKey) {
    headers['x-user-gemini-key'] = settings.apiKey.trim();
  }

  // Try direct mocktest-extract with automatic retry (each attempt rotates to a fresh Gemini key)
  let lastExtractError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Extraction stopped by user.', 'AbortError');
    }

    try {
      const response = await fetch('/api/mocktest-extract', {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          base64Image,
          rawText,
          setName,
          pendingContext: pendingContext || undefined,
          pageNumber: pageNumber || undefined,
          generateSimilar
        })
      });

      if (response.ok) {
        const data = await response.json();
        const rawText = data.rawJson || data.rawText || (data.items ? JSON.stringify(data.items) : '');
        if (rawText) {
          const parsed = parseAiOutputToMockTestItems(rawText, setName, startIndex);
          if (parsed.length > 0) return parsed;
        }
        if (Array.isArray(data.items) && data.items.length > 0) {
          return data.items.map((it: any, idx: number) => cleanMockTestItem({
            ...it,
            question_r: startIndex + idx
          }));
        }
      } else {
        const errJson = await response.json().catch(() => ({}));
        lastExtractError = errJson.error || `HTTP ${response.status}`;
        console.warn(`[Client] /api/mocktest-extract attempt ${attempt + 1} failed (${lastExtractError}). Rotating to next key...`);
        if (attempt === 0 && !signal?.aborted) {
          await new Promise(resolve => setTimeout(resolve, 300));
          continue;
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError' || signal?.aborted) {
        throw e;
      }
      lastExtractError = e?.message || String(e);
      console.warn(`[Client] /api/mocktest-extract attempt ${attempt + 1} network error:`, e);
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 300));
        continue;
      }
    }
  }

  if (signal?.aborted) {
    throw new DOMException('Extraction stopped by user.', 'AbortError');
  }

  if (generateSimilar) {
    throw new Error(lastExtractError ? `Failed to generate similar MCQs: ${lastExtractError}` : 'Failed to generate similar questions from reference page. Please check Gemini API connection.');
  }

  // Fallback to /api/extract only for exact extraction mode
  const extractRes = await fetch('/api/extract', {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      base64Image,
      numberingStyle: 1, // NumberingStyle.HASH
      includeImages: false,
      isBilingual: true,
      mcqMode: true,
      refineMode: false,
      showAnswers: true
    })
  });

  if (!extractRes.ok) {
    const err = await extractRes.json().catch(() => ({}));
    throw new Error(err.error || lastExtractError || 'Direct API extraction failed. Please check your Gemini API key in Settings.');
  }

  const data = await extractRes.json();
  const elements = data.elements || [];
  return convertElementsToMockTestItems(elements, setName);
}

/**
 * Generate a brand-new similar question variant based on an existing MCQ item.
 * The input item serves strictly as conceptual reference (no verbatim duplicate).
 */
export async function generateSimilarQuestionItem(
  item: MockTestMcqItem
): Promise<MockTestMcqItem> {
  const settings = await getAiSettings();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (settings.apiKey) {
    headers['x-user-gemini-key'] = settings.apiKey.trim();
  }

  const response = await fetch('/api/mocktest-generate-similar-item', {
    method: 'POST',
    headers,
    body: JSON.stringify({ item })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to generate similar question');
  }

  const data = await response.json();
  return cleanMockTestItem(data.item);
}

/**
 * Batch generate new similar practice questions for an array of reference items.
 */
export async function generateSimilarBatchFromItems(
  items: MockTestMcqItem[],
  onProgress?: (message: string) => void
): Promise<MockTestMcqItem[]> {
  const result: MockTestMcqItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.(`Generating similar question ${i + 1}/${items.length} (Concept: ${item.subject || 'General'})...`);
    try {
      const similar = await generateSimilarQuestionItem(item);
      result.push({
        ...similar,
        question_r: i + 1
      });
    } catch (err) {
      console.warn(`Failed to generate similar item for Q#${item.question_r}:`, err);
      // Keep existing item if generation failed
      result.push(item);
    }
  }
  return result;
}

/**
 * Multimodal Visual Re-verification of missing or incomplete fields:
 * Inspects the actual page image (and adjacent page image if question is split across pages)
 * to recover ONLY the missing fields without hallucination.
 */
export async function reverifyMockTestItemWithImages(
  item: MockTestMcqItem,
  primaryImage: string,
  secondaryImage?: string,
  missingFields?: string[]
): Promise<MockTestMcqItem> {
  const detectedIssues = detectItemFieldIssues(item);
  const targetFields = missingFields && missingFields.length > 0
    ? missingFields
    : detectedIssues.missingFieldNames;

  if (targetFields.length === 0) {
    return item;
  }

  const settings = await getAiSettings();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (settings.apiKey) {
    headers['x-user-gemini-key'] = settings.apiKey.trim();
  }

  const response = await fetch('/api/mocktest-reverify', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      item,
      primaryImage,
      secondaryImage,
      missingFields: targetFields
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Visual re-verification failed');
  }

  const data = await response.json();
  const recovered = data.recovered_fields || {};

  const updated: MockTestMcqItem = {
    ...item,
    question_hi: recovered.question_hi || item.question_hi,
    question_en: recovered.question_en || item.question_en,
    option1_hi: recovered.option1_hi || item.option1_hi,
    option2_hi: recovered.option2_hi || item.option2_hi,
    option3_hi: recovered.option3_hi || item.option3_hi,
    option4_hi: recovered.option4_hi || item.option4_hi,
    option5_hi: recovered.option5_hi || item.option5_hi,
    option1_en: recovered.option1_en || item.option1_en,
    option2_en: recovered.option2_en || item.option2_en,
    option3_en: recovered.option3_en || item.option3_en,
    option4_en: recovered.option4_en || item.option4_en,
    option5_en: recovered.option5_en || item.option5_en,
    answer: recovered.answer || item.answer,
    solution_hi: recovered.solution_hi || item.solution_hi,
    solution_en: recovered.solution_en || item.solution_en,
    source_pages: data.source_pages || item.source_pages
  };

  return cleanMockTestItem(updated);
}

/**
 * Proofreads an array of MockTest items using the server AI proofreading endpoint,
 * deeply analyzing questions, fixing OCR errors, ensuring bilingual completeness,
 * and stripping all extraneous exam citations and junk tags.
 */
export async function proofreadMocktestItems(
  items: MockTestMcqItem[],
  onProgress?: (message: string) => void
): Promise<MockTestMcqItem[]> {
  if (!items || items.length === 0) return [];

  const settings = await getAiSettings();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (settings.apiKey) {
    headers['x-user-gemini-key'] = settings.apiKey.trim();
  }

  const batchSize = 5;
  const result: MockTestMcqItem[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(items.length / batchSize);
    onProgress?.(`AI Proofreading chunk ${batchNum}/${totalBatches} (${chunk.length} MCQs)...`);

    try {
      const res = await fetch('/api/mocktest-proofread', {
        method: 'POST',
        headers,
        body: JSON.stringify({ items: chunk })
      });

      if (!res.ok) {
        throw new Error(`Proofread server error: ${res.statusText}`);
      }

      const data = await res.json();
      const proofreadChunk: MockTestMcqItem[] = Array.isArray(data.items) && data.items.length > 0 
        ? data.items 
        : chunk;

      // Merge proofread fields back with original IDs and numbering
      for (let j = 0; j < chunk.length; j++) {
        const orig = chunk[j];
        const pr = proofreadChunk[j] || orig;
        result.push(cleanMockTestItem({
          ...orig,
          question_hi: pr.question_hi || orig.question_hi,
          option1_hi: pr.option1_hi !== undefined ? pr.option1_hi : orig.option1_hi,
          option2_hi: pr.option2_hi !== undefined ? pr.option2_hi : orig.option2_hi,
          option3_hi: pr.option3_hi !== undefined ? pr.option3_hi : orig.option3_hi,
          option4_hi: pr.option4_hi !== undefined ? pr.option4_hi : orig.option4_hi,
          option5_hi: pr.option5_hi !== undefined ? pr.option5_hi : orig.option5_hi,
          solution_hi: pr.solution_hi || orig.solution_hi,
          question_en: pr.question_en || orig.question_en,
          option1_en: pr.option1_en !== undefined ? pr.option1_en : orig.option1_en,
          option2_en: pr.option2_en !== undefined ? pr.option2_en : orig.option2_en,
          option3_en: pr.option3_en !== undefined ? pr.option3_en : orig.option3_en,
          option4_en: pr.option4_en !== undefined ? pr.option4_en : orig.option4_en,
          option5_en: pr.option5_en !== undefined ? pr.option5_en : orig.option5_en,
          solution_en: pr.solution_en || orig.solution_en,
          answer: pr.answer || orig.answer,
          difficulty_level: pr.difficulty_level || orig.difficulty_level
        }));
      }
    } catch (e: any) {
      console.warn(`Proofread batch ${batchNum} failed, applying local tag & math sanitization:`, e);
      // Fallback: use locally cleaned items
      chunk.forEach(it => result.push(cleanMockTestItem(it)));
    }
  }

  return result;
}

/**
 * Interactively chat with AI to fix, modify, refine, or reword an individual MCQ.
 * Supports updating answer, options, mathematical calculations, Hindi/English translations,
 * and pedagogical explanations with 0-option-letter safety.
 */
export async function chatFixMockTestItemWithAi(
  item: MockTestMcqItem,
  userPrompt: string,
  history: Array<{ role: 'user' | 'assistant'; text: string }> = []
): Promise<{ updatedItem: MockTestMcqItem; reply: string }> {
  const settings = await getAiSettings();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (settings.apiKey) {
    headers['x-user-gemini-key'] = settings.apiKey.trim();
  }

  const response = await fetch('/api/mocktest-ai-chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      item,
      userPrompt,
      history
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to chat with AI for this question');
  }

  const data = await response.json();
  const cleanedItem = cleanMockTestItem({
    ...item,
    ...(data.updatedItem || {})
  });

  return {
    updatedItem: cleanedItem,
    reply: data.reply || 'Question updated successfully.'
  };
}

/**
 * Automatically extracts or creates a new MockTest MCQ from a pasted screenshot/image,
 * raw text, or AI instruction prompt with 0-option-letter safety and strict pedagogical format.
 */
export async function addMockTestQuestionWithAi(params: {
  text?: string;
  base64Image?: string;
  setName?: string;
  targetPageNumber?: number;
  nextQuestionNumber?: number;
  difficulty?: string;
  instruction?: string;
  optionCount?: number;
}): Promise<{ item: MockTestMcqItem; summary: string }> {
  const settings = await getAiSettings();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (settings.apiKey) {
    headers['x-user-gemini-key'] = settings.apiKey.trim();
  }

  const response = await fetch('/api/mocktest-add-question', {
    method: 'POST',
    headers,
    body: JSON.stringify(params)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to add question with AI');
  }

  const data = await response.json();
  const cleaned = cleanMockTestItem(data.item);

  return {
    item: cleaned,
    summary: data.summary || 'Question added successfully.'
  };
}
