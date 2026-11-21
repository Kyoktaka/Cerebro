# Cerebro

Cerebro is an offline study assistant for the PDFs you learn from. It reads their structure, answers questions with page citations, explains ideas in plain words, and builds quizzes, flashcards and study guides from them. Everything runs on your computer through Ollama. No cloud API key is required.

## Start locally

1. Install [Node.js 18 or later](https://nodejs.org/) and [Ollama](https://ollama.com/download).
2. Pull a chat model and an embedding model:

   ```sh
   ollama pull llama3.2:3b   # or a larger model if your computer can run it
   ollama pull nomic-embed-text
   ```

   `llama3.2` is the default chat model. `nomic-embed-text` handles PDF search and cannot answer chat questions. Cerebro lists only locally pulled chat models; Ollama cloud models are excluded. See their [chat model](https://ollama.com/library/llama3.2) and [embedding model](https://ollama.com/library/nomic-embed-text) pages for sizes and alternatives.

   To test with [Qwen 2.5 Coder 3B](https://ollama.com/library/qwen2.5-coder:3b), run `ollama pull qwen2.5-coder:3b` and select it in Cerebro. There is no model whitelist: every locally pulled model that Ollama reports as chat-capable appears in the picker. Embedding-only models cannot answer chat questions. PDF study still needs a separate embedding-capable model.

3. Clone Cerebro and install its dependencies:

   ```sh
   git clone https://github.com/Kyoktaka/Cerebro.git
   cd Cerebro
   npm install
   ```

4. Start Ollama if it is not already running, then start Cerebro:

   ```sh
   npm start
   ```

   `npm run dev` restarts the server when you edit its code. It ignores the data folders, so uploading a PDF or sending a message no longer restarts it, and sign-ins survive restarts either way.

5. Open [http://127.0.0.1:8080](http://127.0.0.1:8080). Create a local account, open a chat, and select an installed chat model from the model picker.

Ollama, the two models, Node.js, and npm dependencies must be installed while you have internet access. After that, normal local use does not need an internet connection. Ollama also offers cloud models; if you need to disable its cloud features, set `OLLAMA_NO_CLOUD=1` in Ollama's environment and restart Ollama. See [Ollama's local-only instructions](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features).

## Configuration

Cerebro reads environment variables and an optional `.env` file in the project root. The defaults are:

```env
HOST=127.0.0.1
PORT=8080
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
OLLAMA_EMBED_MODEL=nomic-embed-text
OLLAMA_NUM_CTX=8192
```

Optional tuning, all with safe defaults:

| Variable | Default | Effect |
| --- | --- | --- |
| `CEREBRO_CONTEXT_CHARS` | `12000` | Upper bound on passage text sent per model call. Also capped at about half of `OLLAMA_NUM_CTX`. |
| `CEREBRO_LLM_TIMEOUT_MS` | `300000` | Longest time one model call may run before Cerebro stops it with a clear message. |
| `CEREBRO_CHUNK_SIZE` | `1400` | Target characters per indexed passage. |
| `CEREBRO_CHUNK_OVERLAP` | `180` | Characters of the previous passage repeated at the start of the next one in a section. |
| `CEREBRO_DATA_DIR` | project folder | Where `users/`, `uploads/`, `indexes/` and `sessions/` are kept. |

Changing `OLLAMA_EMBED_MODEL` or the chunk settings rebuilds each conversation's index the next time it is used.

**Model choice matters more than any setting.** Cerebro works with any chat model Ollama lists, but code models such as `qwen2.5-coder:3b` were trained for programming, not explanation. For studying, a general instruction model teaches better and follows the citation rules more reliably, for example `qwen2.5:7b`, `llama3.1:8b` or `gemma2:9b` if your computer has the memory, or `llama3.2:3b` / `qwen2.5:3b` on smaller machines. Measure the difference with `npm run eval:live` (see Testing).

**Reasoning models** such as Qwen3 or Qwen3.5 GGUF builds (`hf.co/unsloth/...`) work too. Cerebro turns their reasoning off (`think: false`) so the token budget goes to the answer, hides any `<think>…</think>` text a template still emits, and asks once more with `/no_think` if reasoning used up the whole budget. Long model names are shortened in the header; hover to see the full name.

## Use Cerebro

- **Add PDFs** with the paperclip or by dropping them on the workspace. Cerebro keeps headings, paragraphs, lists, tables and page numbers, removes running headers and footers, and reads rotated slide pages. Pages that are scanned images are listed as unreadable; run OCR on those first.
- **Sources panel**: tick the PDFs an answer may use. Unticked PDFs are never searched. Open *Contents* to see the sections Cerebro found, with page numbers. Pick a section to focus your questions and tools on it; pick its page number to open the PDF there.
- **Ask in your own words.** Questions are matched by meaning, exact terms, acronyms ("RAM" and "Random Access Memory") and section titles. Follow-ups such as "give me examples", "what are their advantages?" or "make it simpler" stay on the current topic, shown above the question box. A new subject switches the topic; the × clears it.
- **Reading an answer**: highlighted page tabs mark statements that come from your PDF; tap one to open the page. Text under *Beyond your PDF* is extra explanation or examples from the model's general knowledge, never presented as the PDF's words. *Sources* below an answer shows the supporting sentence for each page.
- **When your PDF doesn't cover a question**, Cerebro says so and lists what the PDF does cover. If pages were unreadable scans, it tells you the answer may be on those pages. Add "use general knowledge" to a question for a general answer, or choose *PDF only* in Settings to turn off supplementary explanations.
- **Study tools** under the question box act on the focused topic, or on the selected PDFs when no topic is set:
  - *Explain* and *Summarize*. Summaries of a whole document cover every section in order; a topic summary reads that whole section.
  - *Quiz*: a set of questions you answer in place, with the correct answer, an explanation and the supporting quote after each choice.
  - *Practice*: one question at a time with hints, a retry, and a first-try score that lists what to review.
  - *Flashcards*: a deck you flip, marking each card as known or to study again.
  - *Study guide* and *Key terms*.
  You can also type requests such as `Make 5 hard true or false questions about normalization`.
- **Limits**: 10 PDFs per conversation, 10 MB each, 1,000,000 extracted characters per conversation.
- **Settings** (gear at the bottom left, or the model name at the top): theme (black or white), answer mode, chat model, sign out and account deletion.

## How answers are checked

1. The question is classified (explain, define, examples, compare, steps, summary, quiz, …) and its topic is resolved against the conversation and the PDFs' section titles.
2. Passages are ranked by embedding similarity, BM25 keyword scoring, exact phrases, section titles and key-term definitions, only within the selected PDFs. Neighboring passages in the same section are added for context. If the evidence is thin, Cerebro retries with relaxed term matching and section boosts, then asks the model for synonyms and searches again.
3. The model writes a teaching answer and cites passage numbers. Words from the question that never appear in the passages are pointed out to it, so it can admit gaps.
4. Every cited sentence is compared with its passage: key terms must overlap, numbers and names must appear in the passage, and negations must agree. Uncertain or re-pointed citations go to one batched yes/no check by the model. Fabricated passage numbers are removed, unsupported citations are stripped, and unsupported numbers or names are dropped. If problems remain after the first draft, the model gets one revision attempt. A note under the answer says how many statements were removed.
5. Quiz and flashcard items need an exact quote from the passage, an answer the passage supports, four distinct choices with no "all of the above", and no duplicates. The model then answers each multiple-choice question without seeing the key; a different answer or a second defensible choice rejects the question.

These checks reduce unsupported statements; they do not make a small model infallible. Open the page when an answer matters.

### Optional Python Ollama wrapper

The application itself uses Node.js. [grounded_ollama.py](examples/python/grounded_ollama.py) is a separate LangChain/Ollama example for callers that already have retrieved PDF passages. With Python 3.12, install its dependencies while online with `python -m pip install -r examples/python/requirements.txt`, then provide a UTF-8 JSON file:

```json
{
  "question": "What is a computer?",
  "selected_sources": ["computer.pdf"],
  "passages": [{"source": "computer.pdf", "text": "A computer is an electronic device that processes data according to instructions."}]
}
```

Run `python examples/python/grounded_ollama.py context.json`. The wrapper uses `OLLAMA_BASE_URL` and `OLLAMA_MODEL`, disables LangSmith tracing in its CLI, and validates that each returned quote exactly appears in the selected source. It does not extract PDFs or build a vector index. The model can still select an irrelevant genuine quote, so quotation validation is not a guarantee of relevance or entailment. Check important answers in the PDF. The wrapper sends the provided context to the configured Ollama endpoint; choose a trusted local endpoint.

## Data

Account and conversation records live in `users/`; search indexes live in `indexes/`; original PDFs live in `uploads/originals/` for the viewer; sign-ins live in `sessions/sessions.json`. Removing a PDF, clearing sources, or deleting a conversation or account removes the associated originals. Conversations uploaded with older versions are re-read from their stored originals the first time they are opened, so they get the new structure and citations.

**Sign-ins** last until you sign out or stop using Cerebro for 30 days, and they survive server restarts. Only the account name and timestamps are stored in `sessions/`.

**Passwords** are stored as salted scrypt hashes. Accounts created before this change still sign in with their old password, which is then replaced by a hash. *Forgot password?* on the sign-in page sets a new password when you enter your username and the email on the account; the old password is never shown. After eight wrong attempts an account is locked for 10 minutes. Cerebro is still a local app: do not expose it to a network you do not trust.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Check the Cerebro server. |
| `GET /api/models` | Ollama connection and pulled chat models: `available`, `models`, `defaultModel`, `embeddingModel`, `embeddingAvailable`, optional `error`. |
| `POST /api/upload` | Upload PDFs to a conversation. Send the sign-in as the `X-Session-Id` header so a signed-out upload is refused before anything is stored. `extractedPages` reports pages, readable pages and `imagePages` per file. |
| `GET /api/conversations/:sessionId/:conversationId/outline` | Sections, page ranges, key terms and unreadable pages for each PDF in a conversation. |
| `POST /api/source` | Return a selected original PDF by citation digest. |
| `POST /api/auth/register`, `/login`, `/logout`, `/reset-password`, `/delete-account` | Local accounts. `reset-password` takes `username`, `email` and the new `password`. |
| `POST /api/chat` | Ask a question. Accepts `message`, `sessionId`, `conversationId`, optional `model`, `stream: true`, `sourceMode: "pdf-only"` and `topicReset: true`. |

With `stream: true`, `/api/chat` returns newline-delimited JSON: `status` events (`stage`, `detail`) while it searches, writes and checks; `draft` events with unverified model text (`reset: true` starts a revision); then one `delta` with the verified answer and a `done` event with `answer`, `mode`, the active `topic` and `meta` (intent, answerability class, evidence strength and citation-check counts). An `error` event reports a failure. Clients that only read `delta`, `done` and `error` keep working.

## Testing

```sh
npm test          # unit and integration tests with a stand-in model; no Ollama needed
npm run eval      # scenarios A–N on fixture PDFs with the stand-in model
npm run eval:live # the same scenarios against your Ollama models from .env
```

Tests run the server against a temporary data folder, never your `users/` or `uploads/`.

`npm run eval` checks the pipeline: retrieval, selected-document isolation, follow-up topics, citation checks, summary coverage and quiz validation. Its stand-in model copies sentences from passages, so it says nothing about answer quality. `npm run eval:live` runs the real models and reports pass/fail per scenario, citation accuracy, removed-claim rate and seconds per turn; add `--verbose` to read every answer.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Signed out right after uploading or sending a message | Older versions kept sign-ins in memory, and `nodemon` restarted the server whenever a PDF or index was saved. Update to this version; sign-ins are now saved and `nodemon.json` ignores the data folders. |
| Ollama unavailable | Start Ollama. Check `http://localhost:11434/api/tags` or the URL in `OLLAMA_BASE_URL`. If `localhost` fails but `127.0.0.1` works, set `OLLAMA_BASE_URL=http://127.0.0.1:11434`. |
| No chat model in the picker | Run `ollama list`, pull a chat model such as `ollama pull llama3.2`, then choose *Check again*. |
| PDF indexing fails | Run `ollama pull nomic-embed-text`, or pull the model named by `OLLAMA_EMBED_MODEL`. |
| "Pages are scanned images" | Run OCR on the PDF (for example with your scanner software or `ocrmypdf`) and upload it again. |
| "The model returned only hidden reasoning" | The reasoning model spent its whole budget thinking, even after a retry. Pick a non-reasoning model or a smaller question. |
| Answers are slow | The first answer loads the model into memory. Large `OLLAMA_NUM_CTX` values and long PDFs make prompts longer; summaries of long documents take one call per part. Lower `CEREBRO_CONTEXT_CHARS` on slow machines. |
| A quiz has fewer questions than asked | Questions that fail the checks are dropped rather than shown. Name a specific section or use a stronger model. |

## License

[MIT](LICENSE). Bundled fonts (Atkinson Hyperlegible Next, Literata) are under the SIL Open Font License; see `public/fonts/OFL.txt`.
