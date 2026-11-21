# Cerebro audit and rebuild report

Date: 2026-11-20. Scope: the full repository as uploaded (Node/Express server, PDF pipeline, retrieval, prompting, verification, study tools, all five pages). The `.env` file was not changed.

## 1. What was there

| Layer | Before | After |
| --- | --- | --- |
| PDF reading | `pdf-text.js`: one output line per text-item y change; no rotation handling; no paragraphs, headings or header/footer removal | `engine/pdf.js`: baseline-aware lines (rotated pages work), font-size headings and outline, paragraph reflow, de-hyphenation, aligned-column table detection (`a \| b`), running header/footer and page-number removal, scanned-page detection |
| Chunking | `rag.chunkText`: per page, character windows with overlap; best-effort heading | `engine/structure.js`: blocks → sections (heading paths, repeated slide titles merged) → chunks packed by section with page spans, sentence overlap, tables split with the header row repeated; key terms, definitions and acronym aliases per document |
| Index | `{embeddingModel, chunks}`; no version; raw chunk text embedded | `engine/indexer.js`: versioned index with document analyses, reuse of unchanged documents' embeddings, task prefixes for nomic/mxbai/bge, context headers in embedded text, cached summary notes |
| Retrieval | `hybrid.js`: cosine + raw term overlap, top 4 / 6000 chars; one keyword fallback | `engine/retrieve.js`: embeddings + BM25 + phrase + section-title + definition boosts, typo and compound-word expansion, acronym expansion, neighbor passages, section retrieval; `engine/answer.js` adds staged recovery (relaxed terms → section boost → model keyword expansion) and evidence assessment |
| Intent and context | Regex `isFollowup` for a few phrasings; only the previous message's topic | `engine/intent.js`: 15 intents, topic extraction, counts/difficulty/kinds, PDF-only and general-knowledge flags; active topic persisted per conversation; pronouns and elliptical requests resolve to it; new subjects switch it |
| Answering | `tutor.js`: answer written inside JSON at temperature 0; exact-quote check; a second model call scoring 5 criteria that all had to reach 9/10; otherwise a fixed refusal | `engine/prompts.js` + `engine/answer.js`: streamed teaching answer with `[n]` citations and a labeled "Beyond your PDF" part, shapes per intent, gap words pointed out; `engine/verify.js`: claim-level checks, one batched yes/no judge for uncertain claims, one bounded revision |
| Summaries | Overview sampled 8 chunks per PDF; failed reviews fell back to raw excerpts | Topic summary reads the whole matched section; long documents get verified, cached section notes in document order plus an overview |
| Quiz / flashcards | One review call per item with the same 9/10 gate; items needed exact quotes | Coverage plan across sections or the topic's section, difficulty mix, deterministic validation, independent solve check per batch, interactive rendering |
| UI | Generic chat layout, warm accent, FontAwesome brain logo, sources hidden in a popover | New design system (see `DESIGN.md`), sources panel with contents, page-tab citations, interactive study blocks, streaming status and drafts, settings dialog, offline fonts |

## 2. Root causes, with evidence

The saved conversations in the uploaded `users/` folder (model `qwen2.5-coder:3b`) show the failure pattern directly: every document summary fell back to "could not verify a complete AI summary" excerpts, every quiz and flashcard request answered "could not find suitable passages", and "hi" received the unsupported-information refusal.

| # | Component | Behavior | Root cause | Fix | Validation |
| --- | --- | --- | --- | --- | --- |
| 1 | `pdf-text.js` | Words of the real "Computer Basics" deck stored one or two per line (318 of 558 lines had ≤ 2 words) | Slides are rotated 90°; the line test compared the y coordinate, which on rotated pages changes between words | Project positions on each item's baseline direction | `engine.test.js` rotated fixture; real PDF now reads as sentences |
| 2 | `tutor.js` anchors | Answers rejected even when correct | Model quotes use normal spacing; stored text had line breaks inside sentences. On the real PDF only **18 of 126 (14%)** clean sentences pass the old exact `includes` check | Whitespace- and punctuation-insensitive quote location with token fallback; claims checked by meaning-bearing terms, not verbatim quotes | `scratch` measurement in this report; `engine.test.js` broken-word quote test |
| 3 | `tutor.js` review | Almost every answer, summary and quiz item rejected | A 3B code model had to score its own draft ≥ 9/10 on five criteria; any miss → refusal | Deterministic citation checks first; the model is only asked narrow yes/no questions about uncertain claims; failure of the judge strips a citation instead of discarding the answer | `verify` unit tests; integration test |
| 4 | Prompts | "Why is RAM important?", "give a real-life example" refused | "Never use outside facts" plus a binary support flag | Three-way provenance: PDF-supported (cited), "Beyond your PDF" (labeled), unrelated (limitation + what the PDF covers) | Eval B, C, H |
| 5 | Follow-ups | "Give me examples" after a topic sometimes answered "Which term…?"; "what are their advantages?" searched literally | Topic only stored after an approved answer; narrow regex | Persisted active topic, anaphora resolution, aspect words | Eval C, E, N; integration test |
| 6 | Quiz pool | Whole-document quizzes came from whichever chunks matched the words "create 10 quiz questions" | Ranking a meta-request semantically | Proportional coverage plan over sections; topic quizzes use the whole section | Eval I |
| 7 | Chunking | Sections split at page boundaries; headings attached only when a chunk started with one | Per-page character windows | Section-aware packing with heading paths and page spans | `engine.test.js` structure tests |
| 8 | Embeddings | Queries and passages embedded the same way | `nomic-embed-text` expects `search_query:` / `search_document:` prefixes | Model-specific prefixes; index version bump triggers rebuild | `engine.test.js` index test |
| 9 | Extraction limits | Scanned pages silently empty; refusal message generic | No image detection | Image operator count on empty pages; reported in upload, outline, answers | Eval L; integration upload check |
| 10 | Scope | Correct already | — | Kept and moved to `engine/scope.js`; retrieval filters by selected names before scoring | Eval G; integration isolation check |
| 11 | Streaming | User waited with a typing indicator for the whole verification | PDF answers buffered | `status` and `draft` events, verified answer replaces the draft | Integration test asserts both event types |

## 3. Files

Added: `engine/` (`pdf`, `structure`, `indexer`, `retrieve`, `intent`, `prompts`, `verify`, `answer`, `study`, `llm`, `scope`, `documents`, `index`, `text`), `public/js/blocks.js`, `public/css/cerebro.css`, `public/css/workspace.css`, `public/fonts/*`, `public/assets/favicon.svg`, `test/engine.test.js`, `test/eval.js`, `test/oracle.js`, `test/harness.js`, `test/fixtures/corpus.js`, this report.

Changed: `server.js` (chat route, indexing, outline endpoint, upgrade of old uploads; all existing routes and response fields kept), `local-ai.js` (generation options, timeouts), `document-answers.js` (accepts `|` column separators), all HTML pages, `public/js/{chat,markdown,auth,main,theme}.js`, `test/{integration,markdown,frontend-contract,mock-ollama,pdf-fixture}.js`, `package.json` scripts, `README.md`, `DESIGN.md`.

Removed (superseded, no remaining callers): `rag.js`, `hybrid.js`, `retrieval.js`, `overview.js`, `tutor.js`, `study.js`, `grounding.js`, `pdf-source.js`, `pdf-text.js`, their tests, `public/css/{style,chat,ultracave}.css`, `public/js/ultracave-chat.js`, `docs/retrieval-engine.md`, `docs/study-engine-validation.md` (described the removed design).

## 4. Tests run and actual results

- `npm test`: 32 tests, 32 pass (engine units, Ollama client, Markdown safety, frontend contract, full HTTP integration with a mock Ollama).
- `npm run eval` (offline stand-in model, lexical stand-in embeddings): 14 of 14 scenarios pass; retrieval hit rate 100% (n=10), citation accuracy 100% (n=5), isolation 100% (n=2), follow-up resolution 100% (n=4), summary section coverage 100%, quiz and flashcard validity 100%. These numbers test pipeline logic only.
- Old vs new retrieval, same fixtures, queries and lexical stand-in embeddings (38 queries, including the real 43-page deck): a relevant passage was retrieved in 37/38 (old) vs 38/38 (new); ranked first in 34/38 vs 32/38; MRR 0.92 vs 0.92; context per question 2,054 vs 2,952 characters. Retrieval recall was not the main problem on these small documents; text quality, verification and prompting were.
- Quote matching on the real deck: 14% of clean model-style quotes passed the old exact check; the new matcher locates all of them.
- Browser review: every page in dark and light, at 1440, 1366, 1180, 820 and 390 px widths (Chrome via Playwright), including upload, answers, follow-ups, sources, viewer, quiz, flashcards, practice, summary, settings and drawers.

Not run: any test against a real Ollama model. Model downloads are blocked in this environment, so answer quality, latency and the removed-claim rate with `qwen2.5-coder:3b` are unmeasured. Run `npm run eval:live` on your machine.

## 5. Remaining limitations

- Lexical claim checks cannot fully detect meaning changes; contrast sentences and re-pointed citations go to the model judge, whose reliability depends on the model.
- Small models may ignore the "Beyond your PDF" convention. Uncited sentences are then shown without a page tab, which is honest but less clear.
- No OCR. Scanned pages are detected and reported, not read.
- Multi-column PDFs depend on the PDF's content order; most are fine, some interleave columns.
- The answer cache and section notes grow the index file for long documents.
- Interactive quiz state is server-side per conversation; quiz sets and flashcard decks keep progress only while the page is open, and say so.

## 6. Second pass: sign-outs, reasoning models, black-and-white theme

### Random sign-outs and "Session not found" on upload

Cause, reproduced: sign-ins lived only in a `Map` in server memory, and `npm run dev` (nodemon) watched every `.json` file in the project. Uploading a PDF writes `users/<name>.json` and `indexes/*.json`, so nodemon restarted the server in the middle of the upload, the `Map` was emptied, the upload answered 401 "Session not found", and the page signed the user out. The next message hit the same empty `Map`.

Fix:
- `sessions.js` keeps sign-ins in `sessions/sessions.json` (random 48-hex ids; account name and timestamps only), rebuilt on demand after a restart, expiring after 30 idle days.
- `nodemon.json` watches only server code and `.env`, never `users/`, `uploads/`, `indexes/`, `sessions/` or `public/`.
- Uploads send the sign-in as an `X-Session-Id` header, so a signed-out upload is refused before multer writes the file.
- A 401 now sends the user to the sign-in page with "You were signed out" instead of a silent reset.

Tests: the integration test restarts the server and keeps using the old session id. A unit test covers reload, removal and idle expiry.

### Reasoning models (`hf.co/unsloth/Qwen3.5-4B-GGUF`)

- Models that report the `thinking` capability get `think: false`.
- `<think>…</think>` text is stripped from answers, JSON and the live draft, even for models whose template does not report thinking.
- If reasoning uses the whole token budget, Cerebro asks once more with `/no_think` and twice the budget.
- Long `hf.co/...` names are shortened in the header.

Covered by an integration test (a thinking-capable mock model) and a unit test of the retry.

### Accounts

- Passwords are now salted scrypt hashes. Old plaintext accounts still sign in once and are upgraded on that sign-in.
- `/api/auth/forgot-password`, which returned the password to anyone who knew a last name, is gone. `/api/auth/reset-password` sets a new password when the username and the account's email match, and signs the account out everywhere.
- Eight wrong attempts lock an account for 10 minutes.
- Registration validates every field on the server.
- User files are written atomically, and an unreadable user file no longer crashes sign-in or registration.
- Unknown `/api` routes and malformed JSON get JSON errors.

### Logic and speed

- Parsed indexes are cached by file modification time, so a message no longer re-reads a multi-megabyte index from disk. The index is saved only when summaries actually changed.
- Model capabilities are cached for 60 seconds, and embedding batches went from 12 to 24 texts.
- Synonym recovery adds passages to what the first search found instead of replacing them.
- An empty retrieval no longer calls the model. A quiz or flashcards on a topic the PDF lacks says so instead of spending model calls.
- Topic labels keep the student's casing ("RAM", not "ram").
- The "what your PDFs cover" list draws from every selected PDF, not only the first.
- Questions are capped at 4,000 characters.
- Tests run the server in a temporary data folder, so `npm test` never touches `users/` or `uploads/`.

### Interface

- Dark mode is AMOLED black and white: `#000` page and panels, white primary actions, greys for hierarchy, and 1px lines where black surfaces meet. Colour is left only on quiz right/wrong, destructive actions and the model status dot.
- Grey text was raised to at least 4.5:1 contrast in both themes.
- Dialogs have a visible edge on black, and the danger button stays readable in dark mode.
- Removed from the public pages: the "How an answer looks" sample, "Built with", and "About the project".

### Results

- `npm test`: 34 of 34 pass.
- `npm run eval`: 14 of 14 scenarios pass.
- Screens reviewed in both themes at desktop, laptop, tablet and phone widths.
- User data and `.env` / `.env.example` were compared byte for byte with the originals and are unchanged.

## 7. Known issues outside this scope

- The session id still travels in some URLs (`GET /api/conversations/:sessionId`), which puts it in local server logs. The app binds to 127.0.0.1 by default.
- The password reset uses the account email as proof because an offline app cannot send email. Anyone who knows both your last name and your email can reset your password on that machine.
