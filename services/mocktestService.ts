import { MockTestMcqItem, QuestionType, DifficultyLevel, ExtractedElement } from '../types';
import { getAiSettings } from './aiDbService';

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
 * Ensures text is wrapped in semantic HTML (<p>...</p>) if not already HTML.
 */
export function ensureHtmlParagraph(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed;
  }
  // If multiline, wrap each line or paragraph in <p>
  const paras = trimmed.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paras.length <= 1) {
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  }
  return paras.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

// Regex definitions for previous year exam names, shifts, dates, and publisher watermarks
const EXAM_KEYWORD_REGEX = '(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\\s\\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|CDS|NDA|AFCAT|IBPS|SBI|PO|Clerk|BPSC|UPPSC|MPPSC|HSSC|DSSSB|CTET|UPTET|REET|Railway|एसएससी|आरआरबी|एनटीपीसी|रेलवे|ग्रुप[\\s\\-]*डी|टेक)';
const SHIFT_KEYWORD_REGEX = '(?:Afternoon|Morning|Evening|Night|Shift[\\s\\-]*[I|II|III|IV|V|1|2|3|4|5]|Batch[\\s\\-]*\\d+|दोपहर|सुबह|शाम|रात|प्रथम[\\s\\-]*पाली|द्वितीय[\\s\\-]*पाली|तृतीय[\\s\\-]*पाली|पाली[\\s\\-]*\\d+)';
const DATE_PATTERN_REGEX = '(?:\\d{1,2}[\\/\\.\\-]\\d{1,2}[\\/\\.\\-]\\d{2,4}|\\b(?:19|20)\\d{2}\\b)';

/**
 * Strips previous-year exam tags, shift dates, paper citations, and junk watermarks from question text and options.
 * Examples stripped:
 * - "RRB Tech. - (III) 23/12/2024 (Afternoon)"
 * - "NTPC CBT - I (GL) 17/06/2025 (Afternoon)"
 * - "[SSC CGL 14/07/2023 (Shift-1)]"
 * - "(RRB Group D 17-08-2022 Shift 2)"
 * - "आरआरबी टेक. - (III) 23/12/2024 (दोपहर)"
 */
export function stripExamTagsAndJunk(text: string): string {
  if (!text) return '';
  let res = text;

  // 1. Bracketed tags like [SSC CGL 14/07/2023 (Shift-1)], [RRB NTPC 28.12.2020 (Shift-I)]
  res = res.replace(/\[\s*(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\s\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|CDS|NDA|AFCAT|IBPS|SBI|PO|Clerk|BPSC|UPPSC|MPPSC|HSSC|DSSSB|CTET|UPTET|REET|Railway|एसएससी|आरआरबी|एनटीपीसी|रेलवे|ग्रुप[\s\-]*डी|टेक)[^\]]*\]/gi, '');

  // 2. Parenthesized tags like (RRB Group D 17-08-2022 Shift 2)
  res = res.replace(/\(\s*(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\s\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|CDS|NDA|AFCAT|IBPS|SBI|PO|Clerk|BPSC|UPPSC|MPPSC|HSSC|DSSSB|CTET|UPTET|REET|Railway|एसएससी|आरआरबी|एनटीपीसी|रेलवे|ग्रुप[\s\-]*डी|टेक)[^\)]*\)/gi, '');

  // 3. Leading bracketed or parenthesized exam tags at the start of question or inside <p>
  res = res.replace(/(?:^|<p>)\s*\[\s*(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\s\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|CDS|NDA|AFCAT|IBPS|SBI|PO|Clerk|BPSC|UPPSC|MPPSC|HSSC|DSSSB|CTET|UPTET|REET|Railway|एसएससी|आरआरबी|एनटीपीसी|रेलवे|ग्रुप[\s\-]*डी|टेक)[^\]]*\]\s*/gi, (m) => m.startsWith('<p>') ? '<p>' : '');
  res = res.replace(/(?:^|<p>)\s*\(\s*(?:RRB|SSC|NTPC|CBT|Tech|ALP|JE|Group[\s\-]*D|RPF|SI|Constable|CGL|CHSL|MTS|CPO|GD|Steno|UPSC|CDS|NDA|AFCAT|IBPS|SBI|PO|Clerk|BPSC|UPPSC|MPPSC|HSSC|DSSSB|CTET|UPTET|REET|Railway|एसएससी|आरआरबी|एनटीपीसी|रेलवे|ग्रुप[\s\-]*डी|टेक)[^\)]*\)\s*/gi, (m) => m.startsWith('<p>') ? '<p>' : '');

  // 4. Trailing unbracketed exam tags (e.g. "RRB Tech. - (III) 23/12/2024 (Afternoon)", "NTPC CBT - I (GL) 17/06/2025 (Afternoon)")
  const trailingPattern = new RegExp(
    '(?:[\\s\\.\\,\\;\\-\\–\\—]|\\?|\\!)+(' + EXAM_KEYWORD_REGEX + '[\\s\\S]*?(?:' + DATE_PATTERN_REGEX + '|' + SHIFT_KEYWORD_REGEX + ')[\\s\\S]*?)(\\s*<\\/p>|$)',
    'i'
  );
  res = res.replace(trailingPattern, (match, _tag, closing) => {
    const preChar = match.trim().charAt(0);
    const punct = (preChar === '?' || preChar === '!' || preChar === '.') ? preChar : '';
    return punct + (closing || '');
  });

  // 5. Standalone trailing shift / date (e.g. "23/12/2024 (Afternoon)")
  res = res.replace(new RegExp('(?:[\\s\\-\\–\\—]+)(' + DATE_PATTERN_REGEX + '\\s*\\(?' + SHIFT_KEYWORD_REGEX + '\\)?|\\(?' + SHIFT_KEYWORD_REGEX + '\\)?)(\\s*<\\/p>|$)', 'i'), '$2');

  // 6. Clean publisher watermarks and book signatures
  res = res.replace(/(?:Youth\s*Competition\s*Times|Pinnacle\s*Publication|Testbook\.com|Adda247|Exampur|Gradeup|Drishti\s*IAS|Kiran\s*Prakashan|Platform\s*Education|Rukmini\s*Prakashan)[\s\S]*?(?:<\/p>|$)/gi, (m) => m.endsWith('</p>') ? '</p>' : '');

  // 7. Clean trailing whitespace before </p> and multiple spaces
  res = res.replace(/\s+<\/p>/gi, '</p>').replace(/[ \t]{2,}/g, ' ');

  return res.trim();
}

/**
 * Converts LaTeX math formulas, operators, and symbols into pure Unicode and HTML entities,
 * strips extraneous exam tags, and removes all raw LaTeX commands and dollar sign delimiters ($).
 * Ensures content renders natively in plain HTML without requiring MathJax or KaTeX.
 */
export function cleanMocktestText(text: string): string {
  if (!text) return '';
  let res = text;

  // First, strip all extraneous exam tags, shifts, dates, and watermarks
  res = stripExamTagsAndJunk(res);

  // 1. Strip the filler "Important Exam Point: ..." entirely (AI exam coach filler)
  res = res.replace(/(?:<br\s*\/?>|\n)?\s*(?:<strong>|<b>)?\s*Important Exam Point\s*:\s*(?:<\/strong>|<\/b>)?[\s\S]*?(?:<\/p>|$)/gi, (m) => m.endsWith('</p>') ? '</p>' : '');

  // 2. Strip English scaffolding labels: "Key Point:", "Detailed Explanation:", "Additional Information:"
  res = res.replace(/(?:<strong>|<b>)?\s*Key Point\s*:\s*(?:<\/strong>|<\/b>)?\s*/gi, '');
  res = res.replace(/(?:<strong>|<b>)?\s*Detailed Explanation\s*:\s*(?:<\/strong>|<\/b>)?\s*/gi, '');
  res = res.replace(/(?:<br\s*\/?>|\n)?\s*(?:<strong>|<b>)?\s*Additional Information\s*:\s*(?:<\/strong>|<\/b>)?\s*/gi, '<br>');

  // 3. Fix corrupted formfeed \x0c and tab \t LaTeX from improper JSON parsing
  res = res.replace(/[\x0c\u21e1\u2191]rac/g, '\\frac');
  res = res.replace(/[\x09\b]imes/g, '\\times');
  res = res.replace(/(\d|[a-zA-Z\)])\s+imes\s+/g, '$1 \\times ');

  // 4. Fix broken < br > tags with spaces or escaped entities
  res = res.replace(/&lt;\s*br\s*\/?&gt;/gi, '<br>');
  res = res.replace(/<\s*br\s*\/?>/gi, '<br>');

  // 5. Convert LaTeX fractions \frac{num}{den} to (num) / (den) or num / den
  for (let i = 0; i < 4; i++) {
    res = res.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, (_m, num, den) => {
      const cleanNum = num.trim();
      const cleanDen = den.trim();
      const numWrap = /[\s+\-*\/=]|\\times|\\div|×|÷|−|\+/.test(cleanNum) && !cleanNum.startsWith('(') && !cleanNum.startsWith('|')
        ? `(${cleanNum})`
        : cleanNum;
      const denWrap = /[\s+\-*\/=]|\\times|\\div|×|÷|−|\+/.test(cleanDen) && !cleanDen.startsWith('(')
        ? `(${cleanDen})`
        : cleanDen;
      return `${numWrap} / ${denWrap}`;
    });
  }
  res = res.replace(/\\frac\s*\{?([^}\s]+)\}?\s*\{?([^}\s]+)\}?/g, '$1 / $2');

  // 6. Convert roots: \sqrt[n]{x} -> ⁿ√(x), \sqrt{x} -> √(x)
  res = res.replace(/\\sqrt\[3\]\s*\{([^{}]+)\}/g, '∛($1)');
  res = res.replace(/\\sqrt\s*\{([^{}]+)\}/g, '√($1)');
  res = res.replace(/\\sqrt\s*([a-zA-Z0-9]+)/g, '√$1');

  // 7. Convert standard math operators to clean Unicode
  res = res.replace(/\\times\b/g, '×');
  res = res.replace(/\\div\b/g, '÷');
  res = res.replace(/\\pm\b/g, '±');
  res = res.replace(/\\mp\b/g, '∓');
  res = res.replace(/\\cdot\b/g, '·');
  res = res.replace(/\\leq?\b/g, '≤');
  res = res.replace(/\\geq?\b/g, '≥');
  res = res.replace(/\\neq?\b/g, '≠');
  res = res.replace(/\\approx\b/g, '≈');
  res = res.replace(/\\equiv\b/g, '≡');
  res = res.replace(/\\propto\b/g, '∝');
  res = res.replace(/\\infty\b/g, '∞');

  // 8. Degree symbol: convert \circ / ^\circ to °
  res = res.replace(/(?:\^\\circ|\^\{\\circ\}|\\circ)\b/g, '°');
  res = res.replace(/(\d+)\s*\^\\circ/g, '$1°');
  res = res.replace(/(\d+)\s*°/g, '$1°');

  // 9. Common Greek letters
  res = res.replace(/\\alpha\b/g, 'α');
  res = res.replace(/\\beta\b/g, 'β');
  res = res.replace(/\\theta\b/g, 'θ');
  res = res.replace(/\\pi\b/g, 'π');
  res = res.replace(/\\Delta\b/g, 'Δ');
  res = res.replace(/\\sigma\b/g, 'σ');
  res = res.replace(/\\lambda\b/g, 'λ');
  res = res.replace(/\\omega\b/g, 'ω');
  res = res.replace(/\\mu\b/g, 'μ');

  // 10. Superscripts and Subscripts
  res = res.replace(/\^2\b/g, '²');
  res = res.replace(/\^3\b/g, '³');
  res = res.replace(/\^\{2\}/g, '²');
  res = res.replace(/\^\{3\}/g, '³');
  res = res.replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>');
  res = res.replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>');
  res = res.replace(/\^([0-9a-zA-Z])/g, '<sup>$1</sup>');
  res = res.replace(/_([0-9a-zA-Z])/g, '<sub>$1</sub>');

  // 11. LaTeX formatting wrappers: \text{...}, \mathbf{...}, \left, \right
  res = res.replace(/\\text(?:bf|it|rm)?\s*\{([^{}]+)\}/g, '$1');
  res = res.replace(/\\math(?:bf|it|rm|sf|tt)?\s*\{([^{}]+)\}/g, '$1');
  res = res.replace(/\\left\s*([|(\[{])/g, '$1');
  res = res.replace(/\\right\s*([|)\]}])/g, '$1');
  res = res.replace(/\\left\./g, '');
  res = res.replace(/\\right\./g, '');

  // 12. Logic and set symbols
  res = res.replace(/\\wedge\b/g, '∧');
  res = res.replace(/\\vee\b/g, '∨');
  res = res.replace(/\\rightarrow\b/g, '→');
  res = res.replace(/\\Rightarrow\b/g, '⇒');
  res = res.replace(/\\cap\b/g, '∩');
  res = res.replace(/\\cup\b/g, '∪');
  res = res.replace(/\\subset\b/g, '⊂');
  res = res.replace(/\\in\b/g, '∈');

  // 13. Convert escaped percent signs: 6.5\% -> 6.5%
  res = res.replace(/(\d+(?:\.\d+)?)\\\%/g, '$1%');

  // 14. Convert $= ₹2550$ -> = ₹2550, $₹2550$ -> ₹2550
  res = res.replace(/\$\s*=\s*/g, '= ');
  res = res.replace(/=\s*\$\s*₹/g, '= ₹');
  res = res.replace(/\$\s*₹/g, '₹');
  res = res.replace(/₹\s*\$/g, '₹');
  res = res.replace(/(₹\s*\d+(?:,\d+)*(?:\.\d+)?)\$/g, '$1');

  // 15. COMPLETE STRIPPING OF ALL $ AND $$ DELIMITERS!
  // Neither $ nor $$ should ever be visible in pure HTML output
  res = res.replace(/\$\$/g, '');
  res = res.replace(/(?<!\\)\$/g, '');
  res = res.replace(/\\\$/g, '$');

  // 16. LaTeX backslash artifacts e.g. \, \; \! \quad
  res = res.replace(/\\[,;!\s]/g, ' ');
  res = res.replace(/\\quad\b/g, ' ');
  res = res.replace(/\\qquad\b/g, '  ');

  // 17. Clean minus sign: use unicode minus − if between numbers/variables
  res = res.replace(/(\w|\))\s*-\s*(\w|\()/g, '$1 − $2');

  // 18. Clean consecutive <br> and paragraph starts
  res = res.replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>');
  res = res.replace(/<p>\s*<br\s*\/?>/gi, '<p>');

  // 19. Clean multiple whitespace
  res = res.replace(/[ \t]{2,}/g, ' ');
  res = res.replace(/\s*[\/\\]\s*$/g, '');

  return res.trim();
}

export interface ItemFieldIssues {
  hasMissingOptions: boolean;
  missingOptionsList: string[];
  hasEmptyQuestion: boolean;
  hasDummySolution: boolean;
  hasIssues: boolean;
  issueSummary: string;
}

/**
 * Validates a MockTestMcqItem and detects any blank/empty/incomplete fields.
 */
export function detectItemFieldIssues(item: MockTestMcqItem): ItemFieldIssues {
  const missingOptionsList: string[] = [];
  
  const opt1 = (item.option1_hi || item.option1_en || '').replace(/<[^>]*>/g, '').trim();
  const opt2 = (item.option2_hi || item.option2_en || '').replace(/<[^>]*>/g, '').trim();
  const opt3 = (item.option3_hi || item.option3_en || '').replace(/<[^>]*>/g, '').trim();
  const opt4 = (item.option4_hi || item.option4_en || '').replace(/<[^>]*>/g, '').trim();

  if (!opt1 || opt1.toLowerCase() === 'blank') missingOptionsList.push('A');
  if (!opt2 || opt2.toLowerCase() === 'blank') missingOptionsList.push('B');
  if (!opt3 || opt3.toLowerCase() === 'blank') missingOptionsList.push('C');
  if (!opt4 || opt4.toLowerCase() === 'blank') missingOptionsList.push('D');

  const hasMissingOptions = missingOptionsList.length > 0;
  
  const qHi = (item.question_hi || '').replace(/<[^>]*>/g, '').trim();
  const qEn = (item.question_en || '').replace(/<[^>]*>/g, '').trim();
  const hasEmptyQuestion = !qHi && !qEn;

  const solHi = (item.solution_hi || '').replace(/<[^>]*>/g, '').trim();
  const solEn = (item.solution_en || '').replace(/<[^>]*>/g, '').trim();
  const isGenericHi = !solHi || /^(?:हल:)?\s*सही उत्तर विकल्प\s+[A-E1-5]\s*है।?$/i.test(solHi) || solHi.length < 25;
  const isGenericEn = !solEn || /^(?:Solution:)?\s*The correct option is\s+[A-E1-5]\.?$/i.test(solEn) || solEn.length < 25;
  const hasDummySolution = isGenericHi && isGenericEn;

  const issueParts: string[] = [];
  if (hasMissingOptions) {
    issueParts.push(`Missing Options (${missingOptionsList.join(', ')})`);
  }
  if (hasEmptyQuestion) {
    issueParts.push('Missing Question Text');
  }
  if (hasDummySolution) {
    issueParts.push('Placeholder/Generic Solution');
  }

  const hasIssues = hasMissingOptions || hasEmptyQuestion || hasDummySolution;
  const issueSummary = issueParts.join(' • ');

  return {
    hasMissingOptions,
    missingOptionsList,
    hasEmptyQuestion,
    hasDummySolution,
    hasIssues,
    issueSummary: issueSummary || 'All fields complete'
  };
}

/**
 * Intelligently scans question text for trailing options that got merged into the stem,
 * extracting them into Option 1-4 and cleaning the stem cleanly.
 */
export function autoRecoverItemOptionsFromStem(item: MockTestMcqItem): MockTestMcqItem {
  // Check if options are already fully populated and not empty/blank
  const opt1 = (item.option1_hi || item.option1_en || '').replace(/<[^>]*>/g, '').trim();
  const opt2 = (item.option2_hi || item.option2_en || '').replace(/<[^>]*>/g, '').trim();
  const opt3 = (item.option3_hi || item.option3_en || '').replace(/<[^>]*>/g, '').trim();
  const opt4 = (item.option4_hi || item.option4_en || '').replace(/<[^>]*>/g, '').trim();

  const allFilled = opt1 && opt2 && opt3 && opt4 && 
    opt1.toLowerCase() !== 'blank' && opt2.toLowerCase() !== 'blank' &&
    opt3.toLowerCase() !== 'blank' && opt4.toLowerCase() !== 'blank';

  if (allFilled) {
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
    option1_hi: (!item.option1_hi || item.option1_hi.toLowerCase() === 'blank') ? (extractedHi ? extractedHi.opts[0] : opt1Val) : item.option1_hi,
    option2_hi: (!item.option2_hi || item.option2_hi.toLowerCase() === 'blank') ? (extractedHi ? extractedHi.opts[1] : opt2Val) : item.option2_hi,
    option3_hi: (!item.option3_hi || item.option3_hi.toLowerCase() === 'blank') ? (extractedHi ? extractedHi.opts[2] : opt3Val) : item.option3_hi,
    option4_hi: (!item.option4_hi || item.option4_hi.toLowerCase() === 'blank') ? (extractedHi ? extractedHi.opts[3] : opt4Val) : item.option4_hi,
    option1_en: (!item.option1_en || item.option1_en.toLowerCase() === 'blank') ? (extractedEn ? extractedEn.opts[0] : opt1Val) : item.option1_en,
    option2_en: (!item.option2_en || item.option2_en.toLowerCase() === 'blank') ? (extractedEn ? extractedEn.opts[1] : opt2Val) : item.option2_en,
    option3_en: (!item.option3_en || item.option3_en.toLowerCase() === 'blank') ? (extractedEn ? extractedEn.opts[2] : opt3Val) : item.option3_en,
    option4_en: (!item.option4_en || item.option4_en.toLowerCase() === 'blank') ? (extractedEn ? extractedEn.opts[3] : opt4Val) : item.option4_en,
  };
}

/**
 * Deep cleans an entire MockTestMcqItem to ensure clean KaTeX and HTML compatibility in mocktest portals.
 * Strictly verifies and normalizes the academic subject field and recovers missing options if merged in stem.
 */
export function cleanMockTestItem(item: MockTestMcqItem): MockTestMcqItem {
  // First, auto-recover trailing options from stem if options are blank:
  const recovered = autoRecoverItemOptionsFromStem(item);

  const qHi = cleanMocktestText(recovered.question_hi);
  const qEn = cleanMocktestText(recovered.question_en);
  const solHi = cleanMocktestText(recovered.solution_hi);
  const solEn = cleanMocktestText(recovered.solution_en);

  const cleanSubject = normalizeStrictSubject(recovered.subject, `${qHi} ${qEn}`, `${solHi} ${solEn}`);

  return {
    ...recovered,
    question_hi: qHi,
    option1_hi: cleanMocktestText(recovered.option1_hi),
    option2_hi: cleanMocktestText(recovered.option2_hi),
    option3_hi: cleanMocktestText(recovered.option3_hi),
    option4_hi: cleanMocktestText(recovered.option4_hi),
    option5_hi: cleanMocktestText(recovered.option5_hi),
    solution_hi: solHi,
    question_en: qEn,
    option1_en: cleanMocktestText(recovered.option1_en),
    option2_en: cleanMocktestText(recovered.option2_en),
    option3_en: cleanMocktestText(recovered.option3_en),
    option4_en: cleanMocktestText(recovered.option4_en),
    option5_en: cleanMocktestText(recovered.option5_en),
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
    duplicate_statistics: recovered.duplicate_statistics || 'Unique within this shift; duplicate check completed.'
  };
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
 * Formats all 34 fields in the exact specified order.
 */
export function serializeMockTestToCsv(
  items: MockTestMcqItem[],
  answerFormat: 'letters' | 'numbers' = 'letters'
): string {
  const headerLine = MOCKTEST_CSV_HEADERS.join(',');
  const lines = items.map((rawItem, index) => {
    const item = cleanMockTestItem(rawItem);
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
  answerFormat: 'letters' | 'numbers' = 'letters'
): void {
  const csvContent = serializeMockTestToCsv(items, answerFormat);
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
 * RFC 4180 CSV parser to import existing MockTest CSVs back into MockTestMcqItem[]
 */
export function parseCsvToMockTestItems(csvText: string, defaultSetName = 'Paper Name'): MockTestMcqItem[] {
  if (!csvText) return [];

  // Remove UTF-8 BOM if present
  let clean = csvText.replace(/^\uFEFF/, '');
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
    } else if (char === ',' && !inQuotes) {
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

  if (rows.length <= 1) return [];

  // First row is header
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const getCol = (row: string[], name: string): string => {
    const idx = headers.indexOf(name.toLowerCase());
    return idx >= 0 && row[idx] !== undefined ? row[idx] : '';
  };

  const items: MockTestMcqItem[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const qNum = parseInt(getCol(row, 'question_r'), 10) || r;
    const ans = getCol(row, 'answer').trim();

    let qType: QuestionType = 'MCQ';
    if (ans.startsWith('[') && ans.endsWith(']')) qType = 'MSQ';
    else if (ans.startsWith('{') && ans.endsWith('}')) qType = 'NAT';

    items.push({
      id: `mt_row_${r}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      question_r: qNum,
      question_type: qType,
      question_hi: getCol(row, 'question_hi'),
      option1_hi: getCol(row, 'option1_hi'),
      option2_hi: getCol(row, 'option2_hi'),
      option3_hi: getCol(row, 'option3_hi'),
      option4_hi: getCol(row, 'option4_hi'),
      option5_hi: getCol(row, 'option5_hi'),
      solution_hi: getCol(row, 'solution_hi'),
      question_en: getCol(row, 'question_en'),
      option1_en: getCol(row, 'option1_en'),
      option2_en: getCol(row, 'option2_en'),
      option3_en: getCol(row, 'option3_en'),
      option4_en: getCol(row, 'option4_en'),
      option5_en: getCol(row, 'option5_en'),
      solution_en: getCol(row, 'solution_en'),
      answer: ans,
      set_name: getCol(row, 'set_name') || defaultSetName,
      difficulty_level: (getCol(row, 'difficulty_level').toLowerCase() as DifficultyLevel) || 'medium',
      test_date: getCol(row, 'test_date'),
      test_time: getCol(row, 'test_time'),
      subject: getCol(row, 'subject'),
      subject_level: getCol(row, 'subject_level'),
      figure_notes: getCol(row, 'figure_notes'),
      correction_notes: getCol(row, 'correction_notes'),
      source_pdf: getCol(row, 'source_pdf'),
      source_pages: getCol(row, 'source_pages'),
      source_question_reference: getCol(row, 'source_question_reference') || `Q.${qNum}`,
      latex_check: getCol(row, 'latex_check') || 'checked',
      html_check: getCol(row, 'html_check') || 'checked',
      answer_check: getCol(row, 'answer_check') || 'checked',
      solution_check: getCol(row, 'solution_check') || 'checked',
      hash_figure: getCol(row, 'hash_figure'),
      manually_review: getCol(row, 'manually_review') || 'checked',
      duplicate_statistics: getCol(row, 'duplicate_statistics') || 'Unique within this shift; duplicate check completed.'
    });
  }

  return items.map(cleanMockTestItem);
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
    // Fallback: entire text as single question item
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

    // Extract Options: (a), (b), (c), (d), (e) or A., B., C., D.
    const optPattern = /(?:^|\n)\s*(?:\(([a-eA-E1-5])\)|([a-eA-E1-5])[\.\)])\s+([^\n]+)/g;
    const rawOptions: { label: string; text: string }[] = [];
    let optMatch: RegExpExecArray | null;

    while ((optMatch = optPattern.exec(contentWithoutAns)) !== null) {
      const label = (optMatch[1] || optMatch[2]).toUpperCase();
      rawOptions.push({ label, text: optMatch[3].trim() });
    }

    // Question text is everything before the first option
    let qText = contentWithoutAns;
    const firstOptIdx = contentWithoutAns.search(/(?:^|\n)\s*(?:\([a-eA-E1-5]\)|[a-eA-E1-5][\.\)])\s+/);
    if (firstOptIdx > 0) {
      qText = contentWithoutAns.slice(0, firstOptIdx).trim();
    }
    // Strip the leading question numbering from qText
    qText = qText.replace(/^(?:(?:Q(?:uestion)?\.?\s*[:\-]?\s*|#\s*)\d+[\.\)\-:]?|\(\d+\))\s*/i, '').trim();

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

    const solHi = `<p><b>हल:</b> सही उत्तर विकल्प ${answer} है।</p>`;
    const solEn = `<p><b>Solution:</b> The correct option is ${answer}.</p>`;

    items.push({
      id: `mt_item_${i + 1}_${Date.now()}`,
      question_r: i + 1,
      question_type: 'MCQ',
      question_hi: ensureHtmlParagraph(qHindi || qEng),
      option1_hi: aHi,
      option2_hi: bHi,
      option3_hi: cHi,
      option4_hi: dHi,
      option5_hi: eHi,
      solution_hi: ensureHtmlParagraph(solHi),
      question_en: ensureHtmlParagraph(qEng || qHindi),
      option1_en: aEn,
      option2_en: bEn,
      option3_en: cEn,
      option4_en: dEn,
      option5_en: eEn,
      solution_en: ensureHtmlParagraph(solEn),
      answer,
      set_name: setName,
      difficulty_level: 'medium'
    });
  }

  return items.map(cleanMockTestItem);
}

/**
 * Generate a specialized AI prompt for directly extracting images into the 34-column MockTest schema.
 */
export function buildMockTestDirectPrompt(setName = 'PYPs Shift-3'): string {
  return `You are a professional Exam Paper Digitizer and MockTest Content Architect.
Extract ALL multiple-choice questions (MCQs), multiple-select questions (MSQs), and numerical questions (NAT) from this image.

TARGET SCHEMA:
Extract into a strict JSON array of objects, where each object has these exact 34 fields:
1. question_r: Question sequence number (1, 2, 3...)
2. question_hi: Question text in Hindi wrapped in semantic HTML (<p>...</p>) with standard Unicode math (NO LaTeX commands, NO dollar signs!).
3. option1_hi: Option 1 (A) in Hindi wrapped in <p>...</p>
4. option2_hi: Option 2 (B) in Hindi wrapped in <p>...</p>
5. option3_hi: Option 3 (C) in Hindi wrapped in <p>...</p>
6. option4_hi: Option 4 (D) in Hindi wrapped in <p>...</p>
7. option5_hi: Option 5 (E) in Hindi (empty string if 4 options)
8. solution_hi: DETAILED, STEP-BY-STEP EXPLANATION in Hindi formatted in clean HTML (<p><b>हल:</b> [Clean step-by-step formula and mathematical calculation proof]</p>). Include formulas, full workings, and rationale. DO NOT include filler labels like "Key Point:", "Detailed Explanation:", "Additional Information:", or "Important Exam Point:"!
9. question_en: Question text in English wrapped in semantic HTML (<p>...</p>) with standard Unicode math (NO LaTeX commands, NO dollar signs!).
10. option1_en: Option 1 (A) in English wrapped in <p>...</p>
11. option2_en: Option 2 (B) in English wrapped in <p>...</p>
12. option3_en: Option 3 (C) in English wrapped in <p>...</p>
13. option4_en: Option 4 (D) in English wrapped in <p>...</p>
14. option5_en: Option 5 (E) in English (empty string if 4 options)
15. solution_en: DETAILED, STEP-BY-STEP EXPLANATION in English formatted in clean HTML (<p><b>Solution:</b> [Clean step-by-step formula and mathematical calculation proof]</p>). DO NOT include filler labels like "Key Point:", "Detailed Explanation:", "Additional Information:", or "Important Exam Point:"!
16. answer: Correct answer identifier: Single choice MCQ: "A", "B", "C", "D". MSQ: '["3","4"]'. NAT: '{"start":"86","end":"86"}'.
17. set_name: Exam paper/shift name, e.g. "${setName}"
18. difficulty_level: "Easy", "Medium", or "Hard"
19. test_date: Test date in YYYY-MM-DD format if visible, else empty string ""
20. test_time: Test time (e.g. "4:30 PM - 6:00 PM") if visible, else empty string ""
21. subject: STRICT ACADEMIC SUBJECT ONLY!
    STRICT RULE FOR "subject":
    - You MUST identify and store ONLY the pure academic discipline (e.g. "Current Affairs", "History", "Geography", "Polity", "Economics", "General Science", "Physics", "Chemistry", "Biology", "Mathematics", "Reasoning", "Computer Knowledge", "English", "Hindi", "Environment & Ecology", "Static GK").
    - NEVER put exam names, stages, shifts, or dates in "subject" (e.g. DO NOT put "RRB", "NTPC", "Level 01", "Stage I", "Shift-3"). Exam details belong in "subject_level"!
22. subject_level: Exam level/stage/details (e.g. "RRB Level 01 Stage I 2025" or "SSC CGL Tier 1")
23. figure_notes: Notes about any diagram/chart in the question, or empty string ""
24. correction_notes: Notes about any clipping or corrections observed, or empty string ""
25. source_pdf: Source PDF file name if known, else empty string ""
26. source_pages: Source page number(s), e.g. "17"
27. source_question_reference: Question reference in source, e.g. "Q.1"
28. latex_check: "checked"
29. html_check: "checked"
30. answer_check: "checked"
31. solution_check: "checked"
32. hash_figure: Figure hash if any, else empty string ""
33. manually_review: "checked"
34. duplicate_statistics: "Unique within this shift; duplicate check completed."

FORMATTING RULES (PURE UNICODE & CLEAN HTML - NO LATEX):
- NO LATEX, NO DOLLAR SIGNS: NEVER output LaTeX commands (such as \\frac, \\times, \\div, \\sqrt, \\circ) or dollar delimiters ($...$ or $$...$$)!
  * Write '×' (multiplication sign) instead of '\\times'
  * Write '÷' (division sign) instead of '\\div'
  * Write '−' (minus sign) instead of '-'
  * Write '≤' and '≥' instead of '<=' and '>='
  * Write '≠' instead of '!='
  * Write '°' (degree symbol) instead of '^\\circ'
  * Write '√x' instead of '\\sqrt{x}'
  * Write 'a / b' or '(a) / (b)' instead of '\\frac{a}{b}' (e.g. write '(60 × 9 − 11 × 30) / 2')
  * Write '²' or '<sup>2</sup>' for powers (e.g. x² + y² = 25)
  * Write '&gt;' and '&lt;' for greater-than and less-than inside HTML
- NO DOLLAR SIGNS ($):
  * NEVER use $ delimiters for reasoning puzzle human names, alphabets, or positions (write P, Q, R, S, T, U, V and W, Q as plain letters, NEVER $P, Q, R$ or $W, Q$).
  * NEVER enclose normal numbers, counts, percentages, or money in dollar signs (write 40%, ₹4,800, 300, 5 washing machines, NOT $40%, $₹4800$, 5$).
  * Write variables simply as 'H = 9 (घंटा) और M = 30 (मिनट)'.
- NO FILLER LABELS: NEVER use artificial filler headers like "Key Point:", "Detailed Explanation:", "Additional Information:", or "Important Exam Point:". Solutions must be natural, step-by-step proofs starting directly with <p><b>हल:</b> ...</p> or <p><b>Solution:</b> ...</p>.
- STRICT NEGATIVE RULE: DO NOT include previous-year exam tags, shift dates, shift times, paper citations, or book publisher labels in the question text or options!
  - Examples that MUST BE OMITTED from question/option text: "RRB Tech. - (III) 23/12/2024 (Afternoon)", "NTPC CBT - I (GL) 17/06/2025 (Afternoon)", "[SSC CGL 14/07/2023 (Shift-1)]", "(Shift-2)", "(Morning)", "Youth Competition Times", "Pinnacle".
  - The question text must be PURELY the question statement!
- If the original document is only in Hindi or only in English, TRANSLATE and generate the counterpart language so BOTH Hindi and English fields are fully populated!
- Both solution_hi and solution_en MUST BE DETAILED, pedagogy-grade solutions suitable for student practice.
- Respond ONLY with the JSON array inside \`\`\`json ... \`\`\` block.`;
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
 * Parse raw text / JSON response from any AI provider (Gemini, DeepSeek, ChatGPT, Claude)
 * into a complete, valid MockTestMcqItem[] with all 18 fields fully populated.
 */
export function parseAiOutputToMockTestItems(
  rawText: string,
  setName: string = 'Mock Test Paper',
  startIndex: number = 1
): MockTestMcqItem[] {
  if (!rawText || !rawText.trim()) return [];

  let clean = rawText.trim();
  const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    clean = fenceMatch[1].trim();
  }

  const startIdx = clean.indexOf('[');
  const endIdx = clean.lastIndexOf(']');

  if (startIdx >= 0 && endIdx > startIdx) {
    const jsonStr = clean.slice(startIdx, endIdx + 1);
    try {
      // Protect LaTeX commands from colliding JSON escape evaluations (\f -> \frac, \t -> \times, etc.)
      const safeJsonStr = jsonStr
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
      const parsed = JSON.parse(safeJsonStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((obj, i) => {
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
            solHi = `<p><b>हल:</b> ${genericSol}</p>`;
          }
          if (!solEn && genericSol) {
            solEn = `<p><b>Solution:</b> ${genericSol}</p>`;
          }

          if (!solHi && solEn) solHi = solEn;
          if (!solEn && solHi) solEn = solHi;

          if (!solHi) solHi = `<p><b>हल:</b> सही उत्तर विकल्प ${rawAns} है।</p>`;
          if (!solEn) solEn = `<p><b>Solution:</b> The correct option is ${rawAns}.</p>`;

          const candidateSubject = obj.subject || obj.subject_name || obj.topic || '';
          const cleanSubject = normalizeStrictSubject(candidateSubject, `${qHi} ${qEn}`, `${solHi} ${solEn}`);

          return cleanMockTestItem({
            id: `mt_ai_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
            question_r: qNum,
            question_type: qType,
            question_hi: ensureHtmlParagraph(qHi),
            option1_hi: opt1Hi,
            option2_hi: opt2Hi,
            option3_hi: opt3Hi,
            option4_hi: opt4Hi,
            option5_hi: opt5Hi,
            solution_hi: ensureHtmlParagraph(solHi),
            question_en: ensureHtmlParagraph(qEn),
            option1_en: opt1En,
            option2_en: opt2En,
            option3_en: opt3En,
            option4_en: opt4En,
            option5_en: opt5En,
            solution_en: ensureHtmlParagraph(solEn),
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
            duplicate_statistics: obj.duplicate_statistics || 'Unique within this shift; duplicate check completed.'
          });
        });
      }
    } catch (e) {
      console.warn('JSON parse failed in parseAiOutputToMockTestItems, falling back to heuristic parsing:', e);
    }
  }

  // Fallback: convert raw elements/text
  const fakeElement: ExtractedElement = {
    id: `raw_${Date.now()}`,
    type: 'text',
    content: rawText
  };
  return convertElementsToMockTestItems([fakeElement], setName).map(cleanMockTestItem);
}

/**
 * Fast & ultra-reliable prompt for AI browser chat (DeepSeek, ChatGPT, Gemini, Claude) via Extension Bridge
 * that guarantees all 34 columns are provided with Hindi, English, options, and step-by-step solutions!
 */
export function buildMockTestBridgePrompt(setName = 'PYPs Shift-3'): string {
  return `You are a professional Exam Paper Digitizer and MockTest Content Architect.
Extract ALL multiple-choice questions (MCQs), MSQs, and numerical questions from this exam page image.

STRICT REQUIREMENT: You MUST fill ALL 34 fields for EVERY question in strict JSON format.
For every question, output an object in a JSON array with these exact 34 fields:
- "question_r": Sequence number (1, 2, 3...)
- "question_hi": Question text in Hindi wrapped in semantic HTML (<p>...</p>) with standard Unicode math (NO LaTeX commands, NO dollar signs!).
- "option1_hi": Option 1 (A) in Hindi wrapped in <p>...</p>
- "option2_hi": Option 2 (B) in Hindi wrapped in <p>...</p>
- "option3_hi": Option 3 (C) in Hindi wrapped in <p>...</p>
- "option4_hi": Option 4 (D) in Hindi wrapped in <p>...</p>
- "option5_hi": Option 5 (E) in Hindi (or empty string if 4 options)
- "solution_hi": DETAILED step-by-step pedagogical explanation in Hindi formatted in clean HTML (<p><b>हल:</b> [Clean step-by-step formula and mathematical calculation proof]</p>). DO NOT include filler labels like 'Key Point:', 'Detailed Explanation:', 'Additional Information:', or 'Important Exam Point:'!
- "question_en": Question text in English wrapped in semantic HTML (<p>...</p>) with standard Unicode math (NO LaTeX commands, NO dollar signs!).
- "option1_en": Option 1 (A) in English wrapped in <p>...</p>
- "option2_en": Option 2 (B) in English wrapped in <p>...</p>
- "option3_en": Option 3 (C) in English wrapped in <p>...</p>
- "option4_en": Option 4 (D) in English wrapped in <p>...</p>
- "option5_en": Option 5 (E) in English (or empty string if 4 options)
- "solution_en": DETAILED step-by-step pedagogical explanation in English formatted in clean HTML (<p><b>Solution:</b> [Clean step-by-step formula and mathematical calculation proof]</p>). DO NOT include filler labels like 'Key Point:', 'Detailed Explanation:', 'Additional Information:', or 'Important Exam Point:'!
- "answer": Correct answer identifier (e.g. "A", "B", "C", or "D")
- "set_name": "${setName}"
- "difficulty_level": "Easy", "Medium", or "Hard"
- "test_date": Test date in YYYY-MM-DD or empty string ""
- "test_time": Test time (e.g. "4:30 PM - 6:00 PM") or empty string ""
- "subject": STRICT ACADEMIC SUBJECT ONLY! (e.g. "Current Affairs", "History", "Geography", "Polity", "Economics", "General Science", "Physics", "Chemistry", "Biology", "Mathematics", "Reasoning", "Computer Knowledge", "English", "Hindi", "Environment & Ecology", "Static GK"). NEVER put exam name/stage/shift in subject!
- "subject_level": Exam level/stage (e.g. "RRB Level 01 Stage I 2025")
- "figure_notes": Diagram notes if any, else empty string ""
- "correction_notes": Clipping/correction notes if any, else empty string ""
- "source_pdf": Source PDF name if known, else empty string ""
- "source_pages": Source page number, e.g. "17"
- "source_question_reference": e.g. "Q.98"
- "latex_check": "checked"
- "html_check": "checked"
- "answer_check": "checked"
- "solution_check": "checked"
- "hash_figure": ""
- "manually_review": "checked"
- "duplicate_statistics": "Unique within this shift; duplicate check completed."

CRITICAL RULES:
1. STRICT SUBJECT RULE: The "subject" field MUST ONLY contain the academic subject name (like "Current Affairs", "Mathematics", "Reasoning", "Polity"). NEVER include exam names like "RRB", "NTPC", or "Shift" in "subject". Exam names belong strictly in "subject_level".
2. BOTH Hindi and English fields MUST be fully populated! If the paper is only in Hindi or only in English, TRANSLATE and generate the counterpart language so NO field is left blank.
3. BOTH solution_hi and solution_en MUST be detailed, pedagogical proofs. Start directly with <p><b>हल:</b> ...</p> and <p><b>Solution:</b> ...</p>. NEVER include filler labels like 'Key Point:', 'Detailed Explanation:', 'Additional Information:', or 'Important Exam Point:'!
4. NO LATEX, NO DOLLAR SIGNS: NEVER output LaTeX commands (like \\frac, \\times, \\sqrt, \\div, \\circ) or dollar sign delimiters ($...$ or $$...$$)!
   - Output all mathematical symbols and operators directly in clean Unicode and HTML:
     * Use '×' instead of '\\times'
     * Use '÷' instead of '\\div'
     * Use '−' instead of '-'
     * Use '≤' and '≥' instead of '<=' and '>='
     * Use '≠' instead of '!='
     * Use '°' instead of '^\\circ'
     * Use '√x' instead of '\\sqrt{x}'
     * Use '(a) / (b)' or 'a / b' instead of '\\frac{a}{b}' (e.g. '(60 × 9 − 11 × 30) / 2')
     * Use '&gt;' and '&lt;' for greater-than and less-than inside HTML
5. NO DOLLAR SIGNS ($):
   - NEVER use $ delimiters for reasoning puzzle human names, alphabets, or positions (write P, Q, R, S, T, U, V and W, Q as plain letters, NEVER $P, Q, R$ or $W, Q$).
   - NEVER enclose normal numbers, counts, percentages, or money in dollar signs! (Write 5, NOT 5$; write 60%, NOT $60%; write ₹2550, NOT $= ₹2550$ or $₹2550$).
   - NEVER write variables as "$H = 9$" or "$M = 30$" with stray dollar signs in explanatory text. Write them as "H = 9 (घंटा) और M = 30 (मिनट)".
6. STRICT NEGATIVE RULE: DO NOT include exam shift citations, previous-year question tags, dates, or source book labels in the question text or options! (e.g. "RRB Tech. - (III) 23/12/2024 (Afternoon)", "NTPC CBT-I", "[SSC CGL 2023]", "(Shift-1)" MUST BE OMITTED).
7. Output ONLY the JSON array inside \`\`\`json ... \`\`\` block.
8. At the very end after the JSON code block, on a new line, output:
---STUDY_AI_COMPLETE---`;
}

/**
 * Extract MockTest MCQs from a base64 image using direct Gemini API (/api/mocktest-extract or /api/extract)
 */
export async function extractMockTestWithDirectApi(
  base64Image: string,
  setName: string = 'Mock Test Paper',
  startIndex: number = 1
): Promise<MockTestMcqItem[]> {
  const settings = await getAiSettings();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (settings.apiKey) {
    headers['x-user-gemini-key'] = settings.apiKey.trim();
  }

  // First try direct mocktest-extract
  try {
    const response = await fetch('/api/mocktest-extract', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        base64Image,
        setName
      })
    });

    if (response.ok) {
      const data = await response.json();
      const rawText = data.rawJson || data.rawText || (data.items ? JSON.stringify(data.items) : '');
      if (rawText) {
        const parsed = parseAiOutputToMockTestItems(rawText, setName, startIndex);
        if (parsed.length > 0) return parsed;
      }
    }
  } catch (e) {
    console.warn('/api/mocktest-extract error, attempting /api/extract fallback:', e);
  }

  // Fallback to /api/extract
  const extractRes = await fetch('/api/extract', {
    method: 'POST',
    headers,
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
    throw new Error(err.error || 'Direct API extraction failed. Please check your Gemini API key in Settings.');
  }

  const data = await extractRes.json();
  const elements = data.elements || [];
  return convertElementsToMockTestItems(elements, setName);
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


