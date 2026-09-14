# PRODUCT REQUIREMENTS DOCUMENT (PRD)
# AI-Powered Bilingual MCQ & Mock Test Extraction System (TextExtract Pro / MockTest Suite)

**Document Version:** 2.0.0  
**Status:** Approved & Complete Technical Specification  
**Target Audience:** Engineering Leads, Full-Stack Developers, AI/ML Engineers, Product Designers  
**Project Goal:** Complete architectural and functional blueprint to engineer, develop, and deploy a next-generation AI-powered Bilingual MCQ Extraction and Mock Test Management Platform from scratch.

---

## 1. Executive Summary & Vision

### 1.1 Overview
The **AI-Powered Bilingual MCQ Extraction System** is an enterprise-grade web application designed to automatically extract, parse, clean, standardize, solve, and structure Multiple Choice Questions (MCQs) from raw, complex exam PDFs, scanned papers, images, and screenshots into a standardized 34-column bilingual format (Hindi & English) ready for online CBT (Computer-Based Test) platforms.

### 1.2 Core Value Proposition
- **Zero Manual Formatting**: Completely automates the detection and extraction of bilingual question stems, multiple options (A, B, C, D, E), answer keys, academic subjects, and detailed explanations.
- **Native LaTeX / KaTeX / MathJax Support**: Automatically recognizes and wraps mathematical equations, fractions ($\frac{a}{b}$), powers ($x^2$), square roots ($\sqrt{x}$), and Greek symbols, rendering them with typographic perfection.
- **CBT Shuffled-Options Compatibility**: Ensures solutions NEVER refer to option letters (e.g., "Option A is correct"), allowing test portals to safely shuffle options for different candidates without invalidating explanations.
- **Dual-Engine Architecture**: Operates either via direct cloud API (Google Gemini 2.5 Flash) or a **Zero-Cost Chrome Extension Bridge** that taps into browser-based web AI interfaces (Gemini / ChatGPT) with zero API charges.
- **Self-Healing & Quality Auditing**: Employs built-in heuristics and AI repair systems to auto-fill missing options, reconstruct truncated questions across page boundaries, and audit LaTeX, HTML, and answer integrity.

---

## 2. System Architecture & High-Level Design

```
+----------------------------------------------------------------------------------------------------+
|                                      CLIENT BROWSER (React + Vite)                                 |
|                                                                                                    |
|  [PDF Ingestion & Page Renderer] ---> [HTML5 Canvas 300 DPI Rendering] ---> [Image Chunking]      |
|                                                                                                    |
|  +-----------------------------------+               +-------------------------------------------+ |
|  |     MOCKTEST EXTRACTOR VIEW       | <-----------> |           MOCKTEST STUDIO VIEW            | |
|  | - Page-by-page scan manager       |               | - 34-Column CSV Grid View                 | |
|  | - Split bilingual inspection      |               | - Interactive Cards View                  | |
|  | - Cross-page chunk stitcher       |               | - Rich KaTeX Preview vs Source Edit       | |
|  | - Live LaTeX / HTML renderer      |               | - Bulk Auto-Solve & Auto-Repair           | |
|  | - Single Q AI Chat & Debugger     |               | - AI Add / Paste Screenshot Modal         | |
|  +-----------------------------------+               +-------------------------------------------+ |
+----------------------------------------------------------------------------------------------------+
                                      |                                   |
                +---------------------+                                   +-------------------+
                |                                                                             |
                v                                                                             v
+------------------------------------+                                     +------------------------------------+
|     BACKEND ENGINE (Node.js API)   |                                     |    CHROME EXTENSION BRIDGE         |
|                                    |                                     |    (Manifest V3 - Zero Cost)       |
| - Express Server (/api/*)          |                                     |                                    |
| - Gemini 2.5 Flash SDK Integration |                                     | - Content Script: Gemini Web Chat  |
| - LaTeX & Semantic HTML Sanitizer  |                                     | - Content Script: ChatGPT Web Chat |
| - Strict Academic Subject Normalizer|                                    | - DOM Mutation Observer            |
| - RFC-4180 CSV Serializer / Parser |                                     | - High-Res Image Transfer (Base64) |
| - AI Chat & Similar Q Generators   |                                     | - Automatic Retry & Stream Parser  |
+------------------------------------+                                     +------------------------------------+
```

---

## 3. The 34-Column Enterprise MockTest Schema

The platform structures every extracted question into an immutable 34-column CSV schema strictly aligned with national competitive exam portals (RRB, SSC, UPSC, State PSC, Banking, GATE, JEE).

### 3.1 Field-by-Field Specification Table

| Col # | Field Name | Type | Description & Constraints | Example Value |
|---|---|---|---|---|
| **1** | `question_r` | `number` | Serial order of the question in the test set (1, 2, 3...) | `1` |
| **2** | `question_hi` | `string (HTML)` | Question stem in Hindi, wrapped in `<p>...</p>`. Inline math in `$...$` | `<p>यदि $x + \frac{1}{x} = 5$ है, तो $x^2 + \frac{1}{x^2}$ का मान क्या होगा?</p>` |
| **3** | `option1_hi` | `string` | Option A in Hindi. Math in `$...$`. Plain or wrapped in `<p>` | `23` |
| **4** | `option2_hi` | `string` | Option B in Hindi. Math in `$...$`. Plain or wrapped in `<p>` | `25` |
| **5** | `option3_hi` | `string` | Option C in Hindi. Math in `$...$`. Plain or wrapped in `<p>` | `27` |
| **6** | `option4_hi` | `string` | Option D in Hindi. Math in `$...$`. Plain or wrapped in `<p>` | `20` |
| **7** | `option5_hi` | `string` | Option E in Hindi (Used for Banking/BPSC; empty string for standard 4-option MCQs) | `इनमें से कोई नहीं` |
| **8** | `solution_hi` | `string (HTML)` | Detailed step-by-step proof/explanation in Hindi. Strict No-Option-Letter rule | `<p>हम जानते हैं कि $(a+b)^2 = a^2 + b^2 + 2ab$ होता है। अतः $x^2 + \frac{1}{x^2} = 5^2 - 2 = 23$ प्राप्त होता है।</p>` |
| **9** | `question_en` | `string (HTML)` | Question stem in English, wrapped in `<p>...</p>`. Inline math in `$...$` | `<p>If $x + \frac{1}{x} = 5$, what is the value of $x^2 + \frac{1}{x^2}$?</p>` |
| **10** | `option1_en` | `string` | Option A in English. Math in `$...$` | `23` |
| **11** | `option2_en` | `string` | Option B in English. Math in `$...$` | `25` |
| **12** | `option3_en` | `string` | Option C in English. Math in `$...$` | `27` |
| **13** | `option4_en` | `string` | Option D in English. Math in `$...$` | `20` |
| **14** | `option5_en` | `string` | Option E in English (Optional, default empty string) | `None of these` |
| **15** | `solution_en` | `string (HTML)` | Detailed step-by-step proof/explanation in English. Strict No-Option-Letter rule | `<p>Using the algebraic identity $(a+b)^2 = a^2 + b^2 + 2ab$, we get $x^2 + \frac{1}{x^2} = 5^2 - 2 = 23$.</p>` |
| **16** | `answer` | `string` | Correct answer representation: single letter (`A`), number (`1`), JSON array for MSQ (`["1","3"]`), or range for NAT (`{"start":"86","end":"86"}`) | `A` |
| **17** | `set_name` | `string` | Distinct Mock Test batch or shift identifier | `RRB NTPC CBT-1 Stage I Shift 01` |
| **18** | `difficulty_level` | `'easy' \| 'medium' \| 'hard'` | Cognitive difficulty assessment | `medium` |
| **19** | `test_date` | `string` | Date of original exam administration (DD/MM/YYYY or YYYY-MM-DD) | `15/01/2025` |
| **20** | `test_time` | `string` | Shift timing / slot of original test | `09:00 AM - 10:30 AM` |
| **21** | `subject` | `string` | **Strict Academic Subject ONLY** (forbidden from holding exam names) | `Mathematics` |
| **22** | `subject_level` | `string` | Target exam level, stage, and conducting body | `RRB Level 01 Stage I 2025` |
| **23** | `figure_notes` | `string` | Notes on embedded diagrams, charts, circuit schematics, or maps | `Contains triangle geometry diagram` |
| **24** | `correction_notes` | `string` | Audit log of automated or manual repairs made to the question | `Auto-filled blank Option C via AI` |
| **25** | `source_pdf` | `string` | Filename of the source document | `RRB_Group_D_Shift1_2025.pdf` |
| **26** | `source_pages` | `string \| number` | Source page number(s) where the question appeared | `3-4` |
| **27** | `source_question_reference` | `string` | Original paper question number | `Q.14` |
| **28** | `latex_check` | `string` | Validation flag indicating mathematical delimiter integrity | `checked` |
| **29** | `html_check` | `string` | Validation flag indicating semantic `<p>` / `<table>` integrity | `checked` |
| **30** | `answer_check` | `string` | Validation flag confirming answer key exists and matches options | `checked` |
| **31** | `solution_check` | `string` | Validation flag verifying solution presence and depth | `checked` |
| **32** | `hash_figure` | `string` | SHA-256 hash of extracted image cropped bounding box (if any) | `a8f5c2...` |
| **33** | `manually_review` | `string` | Flag indicating whether question requires human educator intervention | `auto-verified` or `needs-review` |
| **34** | `duplicate_statistics` | `string` | Uniqueness audit within the test set | `Unique within shift; duplicate check completed.` |

---

## 4. Academic Subjects Taxonomy & Normalization Engine

### 4.1 Strict Subject Whitelist
The platform enforces a strict separation between **Academic Subject** (`subject`) and **Exam Metadata** (`subject_level`). The `subject` column MUST contain ONLY one of the 16 approved subjects:
1. `Current Affairs`
2. `History`
3. `Geography`
4. `Polity`
5. `Economics`
6. `General Science`
7. `Physics`
8. `Chemistry`
9. `Biology`
10. `Mathematics`
11. `Reasoning`
12. `Computer Knowledge`
13. `English`
14. `Hindi`
15. `Environment & Ecology`
16. `Static GK`

### 4.2 Automated Subject Normalization Logic (`normalizeStrictSubject`)
- **Exam Noise Stripping**: Automatically detects and purges exam keywords (`RRB`, `SSC`, `CBT`, `NTPC`, `Shift 1`, `Level 01`, `Tier 1`, `Paper 2`, dates) from the subject candidate and reroutes them to `subject_level`.
- **Multilingual Alias Mapping**: Normalizes Hindi, abbreviations, and informal subject terms (e.g., `करेंट अफेयर्स` $\rightarrow$ `Current Affairs`, `गणित` / `Quant` $\rightarrow$ `Mathematics`, `तर्कशक्ति` $\rightarrow$ `Reasoning`, `संविधान` $\rightarrow$ `Polity`).
- **Contextual Fallback Deduction**: If the extracted subject is empty or noise, a regex keyword analyzer evaluates the question stem and solution to deduce the subject with high precision (e.g., presence of `sin`, `cos`, `प्रतिशत`, `त्रिभुज` maps to `Mathematics`).

---

## 5. Detailed Functional Specifications

### 5.1 Document Ingestion & Chunking Pipeline
1. **PDF Rendering**:
   - Uses `pdfjs-dist` to render PDF pages onto an off-screen HTML5 `<canvas>` at a high rendering scale (2.0 to 2.5x, yielding 300 DPI crispness).
   - Extracts both full-page images (PNG/JPEG) and text content layers.
2. **Dynamic Chunking with Overlap**:
   - For long pages or two-column exam formats, splits the page into vertical or columnar chunks.
   - **Cross-Page Stitching**: Evaluates questions cut off at the bottom of Page $N$ and completed at the top of Page $N+1$. Matches truncated stems, rejoins options, and merges them into a single coherent `MockTestMcqItem` with `source_pages: "N-(N+1)"`.

---

### 5.2 Dual AI Extraction Engines

#### Mode A: Direct Cloud API (Gemini 2.5 Flash)
- **Endpoint**: `/api/extract-page`, `/api/mocktest-solve`, `/api/mocktest-proofread-item`
- **Model**: `gemini-2.5-flash` with fallback to `gemini-2.0-flash`
- **Parameters**: `temperature: 0.1` (deterministic, hallucination-free), `response_mime_type: "application/json"`, high token budget (up to 8,192 tokens).
- **Execution Flow**: Sends base64 image data alongside the comprehensive extraction prompt; parses returned JSON directly into `MockTestMcqItem[]`.

#### Mode B: Zero-Cost Chrome Extension Bridge (`textextract-pro-bridge`)
- **Architecture**: A Manifest V3 Chrome Extension injects content scripts into active web tabs of `gemini.google.com` or `chatgpt.com`.
- **Communication Protocol**:
  - The web app posts a DOM event (`window.postMessage`) with high-resolution image data and the extraction prompt.
  - The extension background worker locates the open AI tab and executes `chrome.scripting.executeScript`.
  - The content script (`content-gemini.js` / `content-bridge-generic.js`):
    1. Pastes the image into the AI chat input box via simulated clipboard event.
    2. Types the strict JSON prompt.
    3. Triggers the Send button.
    4. Attaches a `MutationObserver` to watch for generation completion (`streaming-complete` class or cursor disappearance).
    5. Extracts the raw markdown code block containing JSON.
    6. Sends the payload back via `chrome.runtime.sendMessage` $\rightarrow$ Web App.
  - **Fail-Safe & Timeout**: Configured with a 60-second watchdog timer. If the AI chat stalls, automatically re-focuses the tab or triggers an auto-retry.

---

### 5.3 Mathematical Notation & KaTeX / MathJax Engine

#### Requirements
- All math MUST be formatted for KaTeX / MathJax rendering without requiring manual human correction.
- **Inline Equations**: Delimited by `$ ... $` (e.g., `$E = mc^2$`).
- **Block Equations**: Delimited by `$$ ... $$` (e.g., `$$\int_{0}^{\infty} e^{-x^2} dx = \frac{\sqrt{\pi}}{2}$$`).
- **Fractions**: MUST use `$\frac{numerator}{denominator}$`. Naked fractions without dollars are automatically wrapped.
- **Powers & Subscripts**: MUST use `$x^2$`, `$H_2O$`, `$a_n$`.
- **Roots**: MUST use `$\sqrt{x}$` or `$\sqrt[3]{x}$`.
- **Greek & Symbols**: `$\alpha$`, `$\beta$`, `$\theta$`, `$\pi$`, `$\times$`, `$\div$`, `$\pm$`, `$\le$`, `$\ge$`, `$\neq$`, `$\approx$`, `$\degree$`, `$\Delta$`.
- **Currency Protection**: Indian Rupee symbols (`₹`, `Rs.`) and percentages (`%`) outside equations must NEVER be converted into math dollars.
- **Vulgar Fractions Converter**: Converts Unicode characters (`½`, `¼`, `¾`, `⅓`, `⅔`, `⅕`) into `$\frac{1}{2}$`, `$\frac{1}{4}$`, etc.

#### Sanitizer Implementation (`cleanMocktestText`)
- Eliminates brackets `\(...\)` and `\[...\]`, standardizing them to `$...$` and `$$...$$`.
- Detects orphaned `\frac{...}{...}` and wraps them with `$`.
- Normalizes HTML tags to valid semantic subsets (`<p>`, `<b>`, `<i>`, `<sup>`, `<sub>`, `<table>`, `<tr>`, `<th>`, `<td>`, `<br>`).

---

### 5.4 Strict CBT Shuffled-Options Rule Enforcement

#### The Problem
In modern online Computer-Based Tests (CBT), options are randomized per student. If Student 1 sees the answer as **Option A** and Student 2 sees the answer as **Option C**, any solution stating *"अतः विकल्प (A) सही उत्तर है"* or *"Option A is correct"* causes extreme confusion and portal rejection.

#### The Enforcement Rule
- **Prompt Mandate**: Explicitly forbids mentioning option letters (`A`, `B`, `C`, `D`, `E`) or numbers (`1`, `2`, `3`, `4`) inside `solution_hi` and `solution_en`.
- **Value-Based Assertion**: Solutions MUST conclude with the actual name, term, formula, or calculated value (e.g., *"अतः कुल समय = 160 मिनट प्राप्त होता है"* or *"Therefore, the Battle of Plassey was fought in 1757"*).
- **Automated Solution Sanitizer**: Scans and strips legacy phrases matching `/^(अतः|इसलिए)?\s*विकल्प\s*\(?[A-D1-4]\)?\s*(सही|उत्तर)?/i` and replaces them with direct value assertions.

---

### 5.5 Intelligent Anomaly Detection & Self-Healing Auto-Repair

#### Detection Engine (`detectItemFieldIssues`)
Automatically flags any extracted MCQ that contains:
1. Blank options (`option1` through `option4` is empty or literal `"Blank"`).
2. Missing or truncated question stem.
3. Missing or placeholder solution.
4. Mismatch between answer key and available options.

#### Self-Healing Capabilities
1. **Stem Regex Recovery (`autoRecoverItemOptionsFromStem`)**:
   - If options were accidentally bundled inside the question stem by OCR (e.g., *"Q. Who was President? (A) Rajendra Prasad (B) Radhakrishnan..."*), a regex extracts options A-D, assigns them to `option1_hi`...`option4_hi`, and trims the question stem cleanly.
2. **AI Auto-Repair Single / Bulk (`repairMockTestItemWithAi`)**:
   - Dedicated endpoint `/api/mocktest-proofread-item` inspects the broken item and original page image.
   - Re-OCR's the exact question region to retrieve omitted options and computes the authoritative mathematical solution.

---

### 5.6 Deep Step-by-Step Multilingual Solution Generator

- **Trigger**: Click **"Generate Deep Solution"** on an individual card or **"Auto-Solve All (AI)"** across the entire batch.
- **Endpoint**: `/api/mocktest-solve`
- **Output Requirements**:
  1. Complete derivation from first principles.
  2. Clear listing of Given Data and Formulae Used.
  3. Intermediate calculation steps with KaTeX equations.
  4. Final calculated value in bold.
  5. Explanatory concepts in `<p>` tags; comparison tables in `<table>` tags.
  6. Strict adherence to the No-Option-Letter rule.

---

### 5.7 Similar Questions Generator with 1-Year Temporal Filter

- **Functionality**: Given an existing question, generates $N$ pedagogical variants of equal difficulty and subject matter.
- **Mathematical Questions**: Modifies numbers, variables, and dimensions while maintaining identical underlying theorem/formula logic.
- **Current Affairs Rule (Critical Constraint)**:
  - When generating variants for **Current Affairs**, the AI prompt strictly restricts data research and events to a **maximum 1-year lookback window** from the reference test date.
  - Strictly forbids generating outdated schemes, retired dignitaries, or obsolete statistics.

---

### 5.8 Interactive AI Chat for Individual Questions (`MocktestAiChatModal`)

- **Purpose**: Enables educators to have an interactive, conversational dialogue with the AI to refine, recalculate, rephrase, or audit any single question without losing context.
- **Capabilities**:
  - Chat history persistence within the question's session.
  - Image context: Automatically sends the cropped question screenshot alongside user instructions.
  - Action buttons: "Recalculate Steps", "Simplify Explanation", "Translate to Hindi", "Verify Answer Key".
  - **"Apply Changes to Question"**: Directly commits the AI's updated bilingual stem, options, and solution back into the active mock test dataset.

---

### 5.9 AI Add / Screenshot Paste Modal (`MocktestAddQuestionModal`)

- **Purpose**: Allows teachers and content operators to instantly inject new questions into an existing set.
- **Input Methods**:
  1. **Paste Screenshot (Ctrl + V)**: Captures clipboard image, displays instant thumbnail preview, and sends to AI OCR.
  2. **Text / Prompt Input**: Type a rough concept, paste unformatted text, or describe a question.
  3. **File Upload**: Upload PNG, JPEG, or WebP snippets.
- **Processing**: The AI parses the input, generates the complete bilingual MCQ (Hindi + English), computes the deep solution, determines the subject and difficulty, and inserts the item into the studio.

---

### 5.10 MockTest Studio Suite (`MocktestStudioModal`)

- **Cards View**:
  - Visual cards layout with side-by-side bilingual display (Hindi on left, English on right).
  - **"Rich KaTeX View"**: Renders math equations, tables, and HTML live with crisp typography.
  - **"Edit Source"**: Turns questions, options, and solutions into multi-line textareas for direct manual tweaking.
  - Individual card **Preview / Edit** toggle for focused editing.
  - Warning banner on cards with detected issues, accompanied by an instant **"⚡ Auto-Fill"** button.
- **CSV Grid View**:
  - High-density spreadsheet interface displaying all 34 columns.
  - Real-time cell inspection, answer key verification, difficulty pills, and set name tracking.
- **Toolbar Actions**:
  - Global Search and Subject Filter.
  - "Auto-Solve All (AI)" with real-time progress indicator.
  - "Import CSV" (RFC-4180 compliant with automatic header mapping).
  - "Download CSV" & "Copy to Clipboard".

---

### 5.11 Import/Export & Deduplication Engine

- **Export Engine (`serializeMockTestToCsv` & `downloadMockTestCsv`)**:
  - Strict RFC-4180 compliance. Escapes quotes (`"` $\rightarrow$ `""`), encloses multi-line text, and formats UTF-8 with BOM (`\uFEFF`) so Excel opens Hindi Devanagari text flawlessly without garbling.
- **Import Engine (`parseCsvToMockTestItems`)**:
  - Robust state-machine CSV parser capable of handling embedded line breaks, escaped quotes, and missing trailing columns.
  - Auto-assigns UUIDs and standardizes subjects during import.
- **Deduplication Engine**:
  - Computes normalized string hashes of question stems to flag potential duplicate questions within the same shift or set.

---

## 6. AI Prompts Specification & Engineering

### 6.1 Extraction Master Prompt (Direct & Bridge)
```text
You are an Elite Academic Exam Extraction Specialist. 
Analyze the provided high-resolution exam page image and extract EVERY MCQ into valid JSON.

CRITICAL RULES:
1. EXTRACT ALL MCQS: Preserve all questions found on the page.
2. BILINGUAL EXTRACTION: Extract both Hindi and English question stems, options, and solutions. If only one language is present, accurately translate into the other.
3. MATHEMATICAL NOTATION (STRICT KATEX / LATEX):
   - Wrap ALL formulas, variables, numbers with units, fractions, square roots in standard LaTeX delimiters ($...$ for inline, $$...$$ for block).
   - Use \frac{a}{b} for fractions, x^2 for powers, \sqrt{x} for roots.
   - Symbols: \times, \div, \pm, \le, \ge, \neq, \approx, \theta, \pi, \Delta, \degree.
   - DO NOT wrap Indian Rupee currency in dollars (write '₹4,800').
4. HTML FORMATTING:
   - Wrap question stems in <p>...</p>.
   - Preserve comparison tables in <table>...</table> format.
5. STRICT NO-OPTION-LETTER IN SOLUTIONS:
   - NEVER write "विकल्प A सही है" or "Option B is correct".
   - State the final calculated value or factual term directly.
6. SUBJECT RULE:
   - 'subject' MUST be one of: Current Affairs, History, Geography, Polity, Economics, General Science, Physics, Chemistry, Biology, Mathematics, Reasoning, Computer Knowledge, English, Hindi, Environment & Ecology, Static GK.
   - Put exam names (RRB, SSC, Shift) in 'subject_level'.

Output valid JSON matching MockTestMcqItem[].
```

---

## 7. Technology Stack & Implementation Blueprint

### 7.1 Recommended Tech Stack
- **Client Framework**: React 19 + TypeScript + Vite
- **UI & Styling**: Vanilla CSS + TailwindCSS (for utility layout), Glassmorphism dark-theme palette
- **Icons**: Lucide React
- **Animations**: Motion (`motion/react`)
- **PDF Engine**: `pdfjs-dist` (Worker-based canvas rendering)
- **Mathematical Rendering**:
  - `react-markdown`
  - `remark-math`
  - `rehype-katex`
  - `remark-gfm` (for tables and lists)
  - `katex/dist/katex.min.css`
- **Backend API**: Node.js + Express + TypeScript
- **AI SDK**: `@google/genai` (Gemini 2.5 Flash)
- **Chrome Extension**: Manifest V3, Web Content Scripts, Message Passing

### 7.2 Directory Structure Blueprint
```
text_extract/
├── api/
│   └── index.ts                 # Express REST Endpoints (Solve, Extract, Chat, Similar)
├── components/
│   ├── MocktestExtractor.tsx    # Main extraction page, page list, LatexRenderer
│   ├── MocktestStudioModal.tsx  # Studio suite: Cards view, CSV grid, KaTeX preview
│   ├── MocktestAiChatModal.tsx  # Per-question conversational AI assistant
│   ├── MocktestAddQuestionModal.tsx # Screenshot paste (Ctrl+V) & AI Add modal
│   └── PdfConverter.tsx         # Legacy PDF to Word/Image pipeline
├── services/
│   ├── mocktestService.ts       # CSV parser, LaTeX sanitizer, subject normalizer
│   ├── studyAiBridgeService.ts  # Chrome extension bridge dispatcher
│   └── aiDbService.ts           # Local storage AI API settings
├── textextract-pro-bridge/      # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js
│   ├── content-gemini.js        # Gemini Web Chat DOM driver
│   └── content-bridge-generic.js # ChatGPT / Claude DOM driver
├── types.ts                     # TypeScript definitions (MockTestMcqItem, etc.)
├── server.ts                    # Node.js Express server bootstrap
└── package.json
```

---

## 8. Non-Functional Requirements (NFRs)

1. **Performance**:
   - PDF Page Rendering: $< 800\text{ ms}$ per page at 300 DPI.
   - Direct API Extraction: $< 8\text{ seconds}$ per page.
   - Chrome Bridge Extraction: $< 25\text{ seconds}$ per page (including simulated typing and DOM polling).
2. **Reliability & Fault Tolerance**:
   - Zero crash guarantee on corrupted CSV imports.
   - Built-in fallback to alternative Gemini models (`gemini-2.5-flash` $\rightarrow$ `gemini-2.0-flash`).
3. **Data Integrity & Export Accuracy**:
   - 100% adherence to UTF-8 BOM encoding for Hindi Devanagari stability across Microsoft Excel, Google Sheets, and LibreOffice.
4. **Security & Privacy**:
   - API keys stored securely in local browser storage; zero server-side credential logging.

---

## 9. Next Steps for New Development

1. **Setup Core Structure**: Initialize Vite + React + TypeScript and configure `rehype-katex` and `remark-math`.
2. **Implement Data Models**: Establish `types.ts` with the complete 34-column schema.
3. **Build LaTeX / KaTeX Engine**: Port `cleanMocktestText` and `LatexRenderer`.
4. **Deploy Backend API**: Implement Express endpoints for Gemini 2.5 Flash and subject normalization.
5. **Build Chrome Extension Bridge**: Deploy Manifest V3 scripts for zero-cost browser extraction.
6. **Implement Studio Suite**: Construct the bilingual interactive Cards, CSV Grid, and KaTeX preview interfaces.
7. **Integrate Modals**: Add `MocktestAiChatModal` and `MocktestAddQuestionModal`.
8. **End-to-End Test**: Validate with sample multi-page exam PDFs containing complex mathematical formulas.
