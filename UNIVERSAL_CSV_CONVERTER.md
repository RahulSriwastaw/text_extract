# Product Requirements — Universal CSV Converter

**Version 2.1 — Personal-use add-on correction**

This document updates the existing converter requirements. The feature is an add-on to the existing personal-use website, not a new application. Open `/csv-converter` directly, or select **Universal CSV Converter** in the existing tool picker. The page renders without a login, credential lookup, permission check, or account dependency. Existing website functionality outside this page remains unchanged.

## Scope and page requirements

Provide exactly one separate page at `/csv-converter`, using the website's existing React, styling, components, libraries, and hosting infrastructure. Keep the conversion engine modular and deterministic. Do not introduce a separate dashboard, authentication system, user management, roles, or multi-user features. No new dependencies are required for this correction.

Use the workflow **Upload CSV → Auto Mapping → Conversion Settings → Preview & Validation → Download CSV**. Keep advanced settings collapsible and optional saved conversions tucked away on the same page. Field-mapping presets and conversion snapshots are personal, browser-local data.

Support RRB ALP Reasoning CSV (32 source fields) and RRB General Knowledge Universal CSV (32 source fields). Future source formats use configurable mappings. Upload, automatic detection, manual mapping correction, bilingual passage merging, HTML/LaTeX preservation, question/option/solution images, answers, explanations, validation, source/converted previews, manual corrections, CSV downloads, and validation reports remain required.

## Fixed target schema — unchanged

Export exactly these 34 columns in this order, matching the previously specified Template-Grid view schema. Put additional metadata in the source audit, never in additional target columns.

```text
question_r,question_hi,option1_hi,option2_hi,option3_hi,option4_hi,option5_hi,solution_hi,question_en,option1_en,option2_en,option3_en,option4_en,option5_en,solution_en,answer,set_name,difficulty_level,test_date,test_time,subject,subject_level,figure_notes,correction_notes,source_pdf,source_pages,source_question_reference,latex_check,html_check,answer_check,solution_check,hash_figure,manually_review,duplicate_statistics
```

## Implemented workflow

1. Upload a UTF-8 CSV (with or without BOM), up to 10 MB / 5,000 source records. Parsing and conversion run in a dedicated browser worker. Header signatures detect ALP, GK, the target template, or custom mappings.
2. Review/edit mappings for all 34 target columns and auxiliary passage, directions, metadata, and image fields. Export/import versioned mapping JSON to reuse settings.
3. Configure answer notation, passage merging, explicit generic-direction omission, language-neutral Option_E, formatting, image host policy, required metadata, quality-field vocabulary, duplicate checks, and encoding.
4. Convert and inspect real row-level validation counts. Every parsed source record receives an outcome, including blank and ragged records. Invalid CSV quoting or ambiguous headers reject the file before conversion.
5. Compare original columns, all target fields, and rendered student content. Edit fields, revalidate, accept warnings individually or in filtered batches, exclude/restore rows, and compare duplicate references.
6. Confirm the selected profile matches the destination's requirements, then download ready rows with exactly 34 ordered columns. Download the validation report, source audit, review/rejected CSV, and mapping JSON separately.

## Preservation and validation

- Original headers and cell arrays remain recoverable as JSON inside the source audit, including excess cells in malformed records. The audit records transformations, edits, unmapped fields, explicit sixth-option resolutions, and spreadsheet-protection changes.
- Passage → directions → question order is maintained independently for Hindi and English. Shared context is inherited only from explicit passage IDs; conflicting groups block export.
- Any known populated sixth-option field (including an image) blocks the record even if its mapping is cleared. Edit the target and record an explicit disposition or exclude the record. Source options are never renumbered automatically.
- Question, option, and solution image references stay with their corresponding fields. Only approved HTTPS references survive sanitization. Images unsupported by the profile or removed by sanitization block affected rows.
- HTML uses `sanitize-html` with a restricted educational tag/attribute set. Safe HTML normalization is recorded for review. KaTeX checks and previews math with untrusted commands disabled. Dollar-denominated prose is distinguished from math heuristically.
- The original answer notation is preserved by default. Checks validate option availability per populated question language. Structural checks do not establish educational correctness.
- Exact duplication compares normalized questions/options and image references. Optional text similarity uses token Jaccard similarity (0.85), not an AI semantic model. No duplicate is deleted automatically. Large duplicate groups show up to 50 peer references per row.
- Quality-field output values are blank until an importer profile supplies its vocabulary. `question_r`, hash algorithms, missing exam metadata, and educational content are never invented. Source values in audit remain recoverable when derived quality fields replace them.
- Formula-like prefixes block target export by default. Explicitly choose apostrophe protection if needed; affected fields are listed in the audit. Plain signed numbers remain unchanged. Audit/report CSVs always protect formula-like cells, with raw source cells stored inside JSON.

## History and processing boundaries

Full job snapshots, settings, edits, filenames, timestamps, current outcomes, and last exported row counts are stored in browser IndexedDB without account identifiers or account partitions. Reopening a snapshot restores downloadable reports. Existing local snapshots are preserved during the storage upgrade. There is no automatic pruning; Delete removes a stored job. Download reports before clearing browser data. Storage failures are displayed without discarding current results. Versioned mapping JSON can be saved locally and loaded for the next conversion.

This implementation does not fetch image URLs on the server. Image syntax/host policy is checked locally; loaded previews report failures, and references remain review-required until acknowledged. Optional server-side image reachability verification, processing beyond the current file limits, and true semantic duplicate detection remain future enhancements. Shared cloud history and multi-user workflows are outside this personal-use feature's scope.

## Acceptance requirements

- Opening `/csv-converter` directly renders the converter independently of website sign-in state.
- The existing tool-picker link opens that same page; no additional converter routes or navigation screens are required.
- ALP and GK detection and configurable mappings remain supported.
- Hindi and English passages, directions, questions, options, images, answers, solutions, and formatting follow the preservation rules above.
- Preview corrections revalidate rows; unresolved blocking errors cannot enter the import-ready export.
- Every source record remains accounted for in the results and audit.
- Export preserves Unicode, quoted multiline fields, and exactly the 34 ordered target columns.
- Mapping presets and optional saved conversions remain local and reusable without an account.
- Existing unrelated website features continue to work unchanged.

## Verification

Run `npm run test:csv`, `npm run lint`, and `npm run build`.

The converter suite covers synthetic ALP (37 rows) and GK (123 rows, 32 headers), Unicode/multiline CSV round-trips, strict 34-column exports, passages/group conflicts, sixth options, images/XSS, solutions/answers, math/currency, formula injection, duplicates, settings, and edit/audit preservation. These fixtures are generated tests, not the real source question banks: the supplied attachment contained the PRD only.

Final acceptance still requires the actual ALP/GK files and an import into the actual destination system. No destination import has been performed. Browser visual testing could not run because no browser surface was connected in this environment.
