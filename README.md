<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/1561db90-d310-4d01-9f12-2f667c9038df

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Universal CSV Converter

The personal-use converter opens directly at `/csv-converter`, with no additional login, and is linked from the existing tool picker. See the [updated PRD, workflow, and verification notes](UNIVERSAL_CSV_CONVERTER.md). Run its regression suite with `npm run test:csv`.
