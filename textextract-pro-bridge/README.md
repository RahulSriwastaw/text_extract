# TextExtract Pro Bridge — v2.5.1

Extract MCQs and document text through Gemini, ChatGPT, DeepSeek or Claude using your signed-in browser session. Provider usage limits and upload capabilities still apply.

## Install or update

1. Open `chrome://extensions` and enable Developer mode.
2. Load this folder with **Load unpacked**, or click **Reload** on an existing installation.
3. Refresh TextExtract and existing AI chat tabs. App and extension must both use protocol v2.
4. Sign in to your chosen provider, select Extension mode in TextExtract, and start extraction.

## Pipeline

- **Verified handshake:** correlated PING/PONG, bounded retries and protocol checking. Script injection alone does not count as a connection.
- **Per-provider queue:** one active job per provider; different providers run independently. Duplicate request IDs do not submit duplicate prompts.
- **Separate sessions:** fresh extractions open their own chat tab; later pages reuse the requesting app tab's provider session.
- **Continuous pages:** current chat URLs, unique markers and adjacent-page carry-over keep pages associated correctly. Failed pages stop the batch; completed pages remain available for retry/resume.
- **Complete output:** extraction requires complete JSON, including text elements, bilingual MCQs or empty arrays, after generation stops and output settles. Partial objects are not silently accepted. Missing markers are never fabricated. Explanations explicitly use text responses.
- **Result recovery:** the app polls every ten seconds. Jobs survive worker suspension in session storage; undelivered results remain in local storage until acknowledged. Lost send acknowledgements are checked against the adapter before failure is reported.
- **Cancellation:** aborts and deadlines cancel queued work and adapter waits. Late results are ignored. A response already submitted to the provider may continue generating in its chat.
- **Scoped delivery:** results go only to the requesting app tab. Other tabs cannot read or cancel its jobs.

## Recovery and limits

Extraction defaults to a five-minute deadline including queue time, configurable up to 15 minutes. Adapter response waiting is capped at three minutes; Capture has a 90-second deadline. Terminal metadata and unacknowledged results expire after ten minutes, with cleanup during status/handshake activity. Images are removed on completion or cancellation.

A worker restart can recover a running chat or saved result. Reloading the AI tab interrupts its adapter: retry that page or Capture its existing response. Reloading TextExtract requires restoring the document and resuming remaining pages. Automatic resume across browser restarts is not provided.

Login challenges, provider limits, unsupported uploads, incomplete JSON and changed provider UI selectors need attention in the AI tab. Full-chat Capture remains a manual recovery tool and may include earlier attempts.

Persistence follows [Chrome's service-worker lifecycle guidance](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

## Verify

Run `npm run test:bridge`, `npm run lint`, and `npm run build` from the project root.

Tests simulate messaging, storage, output validation and worker restarts. For a live smoke test, extract two pages with a split question in MCQ and text modes, cancel once, and retry. Verify upload and capture on each signed-in provider you use.
