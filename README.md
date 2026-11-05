# Cerebro

Cerebro is a local PDF chat app. It extracts text from your PDFs, finds relevant passages with local embeddings, and sends your question and those passages to a model running in Ollama. General chat is also available when no PDF is active. No cloud API key is required.

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

- Upload a text-based PDF in a conversation. Cerebro extracts the text locally, divides it into passages, and embeds the passages through Ollama. Questions search those passages before the chat model responds.
- Upload up to 10 PDFs per conversation, at most 10 MB each. Extracted text across the conversation is limited to 1,000,000 characters.
- Select which uploaded PDFs to focus on, remove a PDF, or exit PDF mode. With no active PDF, Cerebro uses general chat.
- General chat answers stream from the local model. With PDFs selected, Cerebro returns verbatim passages with source names and refuses questions whose key words are absent. Conversations are saved locally.
- Use the theme button in the header to switch between light and dark mode. Cerebro remembers your choice and starts in dark mode.

PDF answers quote retrieved text rather than generating a summary. Word matching can miss paraphrases, and a matching passage may not fully answer the question. Check the original documents. Image-only or scanned PDFs need OCR before Cerebro can read their text.

Account and conversation records live in `users/`; PDF search indexes live in `indexes/`. These directories are local and ignored by Git. Passwords are stored in plaintext, and the password recovery endpoint can return them. Use a unique password and do not expose Cerebro to the public internet.

## API

Cerebro exposes these local endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Check the Cerebro server. |
| `GET /api/models` | Check the Ollama connection and list pulled chat models. Returns `available`, `models`, `defaultModel`, `embeddingModel`, and `embeddingAvailable`; may include `error`. |
| `POST /api/upload` | Upload PDFs for a session and conversation. |
| `POST /api/chat` | Ask a question. Accepts `message`, `sessionId`, `conversationId`, optional `model`, and `stream: true`. |

With `stream: true`, `/api/chat` returns newline-delimited JSON. `delta` events contain a `content` fragment; a `done` event contains the completed `answer` and chat `mode`; an `error` event reports a failure. Cerebro checks each pulled model with Ollama's `/api/show` and lists only models that advertise the `completion` capability, excluding embedding-only models. Ollama's own API uses [`/api/tags`](https://docs.ollama.com/api/tags) to list models, [`/api/chat`](https://docs.ollama.com/api/chat) for chat, and [`/api/embed`](https://docs.ollama.com/api/embed) for embeddings.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Ollama unavailable | Start Ollama. Check `http://localhost:11434/api/tags` or the URL in `OLLAMA_BASE_URL`. If `localhost` fails but `127.0.0.1` works, set `OLLAMA_BASE_URL=http://127.0.0.1:11434`. |
| No chat model in the picker | Run `ollama list`, pull a chat model such as `ollama pull llama3.2`, then refresh the app. |
| PDF indexing fails | Run `ollama pull nomic-embed-text`, or pull the model named by `OLLAMA_EMBED_MODEL`. Check that Ollama is running. |
| PDF has no readable text | Use a text-based PDF or run OCR on the scanned PDF first. |
| The first answer is slow | Ollama may need to load the model into memory. Smaller pulled models can help on lower-memory machines. |

## License

[MIT](LICENSE)
