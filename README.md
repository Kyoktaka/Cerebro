# Cerebro

Cerebro is a local PDF study app. It extracts text from your PDFs, uses local Ollama embeddings to find passages, and verifies model-selected quotations against the source. It generates answers and study sets, checks cited quotes, and sends each draft to a separate local model call for review. No cloud API key is required.

## Start locally

1. Install [Node.js 18 or later](https://nodejs.org/) and [Ollama](https://ollama.com/download).
2. Pull a chat model and an embedding model:

   ```sh
   ollama pull llama3.2
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

`OLLAMA_BASE_URL` points to the Ollama instance Cerebro's Node server uses. `OLLAMA_MODEL` is the initial chat model; users can choose another pulled chat model in the app. `OLLAMA_EMBED_MODEL` is used for PDF indexing and search. `OLLAMA_NUM_CTX` sets the chat context window; 8192 tokens uses more memory than Ollama's default, so lower it on a constrained machine. Pull any model named here before use. Keep Cerebro and Ollama on a trusted machine or local network.

## Use Cerebro

- Upload a text-based PDF in a conversation. Cerebro extracts the text locally, divides it into passages, and embeds the passages through Ollama. Questions search those passages.
- Upload up to 10 PDFs per conversation, at most 10 MB each. Extracted text across the conversation is limited to 1,000,000 characters.
- Select which uploaded PDFs to focus on or remove a PDF. Without a PDF, Cerebro asks you to upload one instead of answering from general knowledge.
- Ask a question or enter a term. Cerebro checks quoted evidence against selected passages and independently reviews the answer. Each of five review scores must reach 9/10. A requested revision gets one more generation and review attempt.
- Click a page citation to open the original PDF in a new tab. Older uploads without page metadata use filename and passage citations. Upload them again for page links.
- Ask for a quiz, flashcards, or a mixed-format study set. A plain quiz requests 10 four-option multiple-choice questions. For example, try `Create 5 hard identification questions from biology.pdf`. Each item, key, hint, and explanation goes through review. Cerebro shows the number approved if fewer pass.
- Type `Quiz me` for one question at a time. Reply with an answer, `hint`, `skip`, or `end quiz`. The final score uses first attempts and lists topics and cited sections to revisit. Progress is saved with the conversation. Changing the selected PDFs ends the practice session.
- Name a selected PDF to limit the current request to that file. With no file named, Cerebro uses the selected PDFs. It refuses requests for unavailable or unselected PDFs.
- Use the theme button in the header to switch between light and dark mode. Cerebro remembers your choice and starts in dark mode.

Cerebro checks exact quotations in extracted text. Reviews assess meaning and relevance and depend on the selected local model. Scanned pages require OCR. Summaries sample passages from across the selected sources.

Evidence selection uses Ollama's [structured output schema](https://docs.ollama.com/capabilities/structured-outputs) at temperature zero, followed by exact-source validation. Use an Ollama version that supports JSON schemas in the chat endpoint. Model capability discovery does not guarantee that every model follows the task equally well.

The [flashcard template](docs/flashcard-template.md) provides a Markdown reveal-and-recall format. In the chat workspace, use **Show answers** to reveal a study set's answer key.

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

Account and conversation records live in `users/`; PDF search indexes live in `indexes/`. New original PDFs live in `uploads/originals/` for citation viewing. Removing a PDF, clearing the sources, or deleting its conversation or account removes the associated originals. All three directories are local and ignored by Git. Passwords are stored in plaintext, and the password recovery endpoint can return them. Use a unique password and do not expose Cerebro to the public internet.

## API

Cerebro exposes these local endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Check the Cerebro server. |
| `GET /api/models` | Check the Ollama connection and list pulled chat models. Returns `available`, `models`, `defaultModel`, `embeddingModel`, and `embeddingAvailable`; may include `error`. |
| `POST /api/upload` | Upload PDFs for a session and conversation. |
| `POST /api/source` | Open a selected original PDF using the session, conversation, and citation digest. |
| `POST /api/chat` | Ask a question. Accepts `message`, `sessionId`, `conversationId`, optional `model`, and `stream: true`. |

With `stream: true`, `/api/chat` returns newline-delimited JSON. A `delta` event contains the validated response, a `done` event contains the completed `answer` and chat `mode`, and an `error` event reports a failure. PDF responses are buffered until validation completes; model tokens are not streamed directly. Cerebro checks each pulled model with Ollama's `/api/show` and lists only models that advertise the `completion` capability, excluding embedding-only models. Ollama's own API uses [`/api/tags`](https://docs.ollama.com/api/tags) to list models, [`/api/chat`](https://docs.ollama.com/api/chat) for chat, and [`/api/embed`](https://docs.ollama.com/api/embed) for embeddings.

## Troubleshooting

General summary requests use sampled passages from across the selected documents. For registration forms with a readable subject/unit/description table and a total-units line, Cerebro instead summarizes the distinct courses and checks parsed unit totals against the reported total. Subject-code listing and counting use the main course rows, not repeated permit or signature tables; evidence shows each code, unit count, and description. Counts describe recognized codes, not a guarantee that every subject was extracted. Unreadable tables receive an extraction-specific message. Re-upload older PDFs to use the updated extraction that separates table columns and rows; this is not OCR and complex layouts may still need a text-based export.

| Symptom | Check |
| --- | --- |
| Ollama unavailable | Start Ollama. Check `http://localhost:11434/api/tags` or the URL in `OLLAMA_BASE_URL`. If `localhost` fails but `127.0.0.1` works, set `OLLAMA_BASE_URL=http://127.0.0.1:11434`. |
| No chat model in the picker | Run `ollama list`, pull a chat model such as `ollama pull llama3.2`, then refresh the app. |
| PDF indexing fails | Run `ollama pull nomic-embed-text`, or pull the model named by `OLLAMA_EMBED_MODEL`. Check that Ollama is running. |
| PDF has no readable text | Use a text-based PDF or run OCR on the scanned PDF first. |
| The first answer is slow | Ollama may need to load the model into memory. Smaller pulled models can help on lower-memory machines. |

## License

[MIT](LICENSE)
