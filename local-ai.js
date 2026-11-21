const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
// Accept human formatting like "32,768" or "32 768" so a stray comma cannot
// silently collapse the context window to the first two digits (32).
function parseContext(value) {
    const parsed = Number.parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 8192;
}
const OLLAMA_NUM_CTX = parseContext(process.env.OLLAMA_NUM_CTX);

class OllamaError extends Error {
    constructor(message, status = 503) {
        super(message);
        this.status = status;
    }
}

function modelMatches(configured, installed) {
    return configured === installed || `${configured}:latest` === installed;
}

async function request(endpoint, options = {}) {
    let response;
    try {
        response = await fetch(`${OLLAMA_BASE_URL}${endpoint}`, options);
    } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
        throw new OllamaError(`Cannot reach Ollama at ${OLLAMA_BASE_URL}. Start Ollama and check OLLAMA_BASE_URL.`);
    }

    if (!response.ok) {
        let detail = '';
        try {
            const body = await response.json();
            detail = body.error || '';
        } catch {
            detail = response.statusText;
        }
        throw new OllamaError(`Ollama request failed: ${detail || response.status}`, response.status === 404 ? 422 : 502);
    }
    return response;
}

async function listModels() {
    const response = await request('/api/tags', { signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    if (!Array.isArray(body.models)) {
        throw new OllamaError('Ollama returned an invalid model list.', 502);
    }
    return body.models
        .filter(item => !item.remote_model && !item.remote_host)
        .map(item => ({ name: item.name || item.model }))
        .filter(item => item.name && !item.name.endsWith(':cloud'));
}

// Every chat message checks the model, so a short cache saves a round trip
// without hiding a model that was re-pulled for long.
const capabilityCache = new Map();
const CAPABILITY_TTL_MS = 60 * 1000;

async function modelCapabilities(model) {
    const cached = capabilityCache.get(model);
    if (cached && Date.now() - cached.at < CAPABILITY_TTL_MS) return cached.capabilities;
    const response = await request('/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(5000)
    });
    const body = await response.json();
    if (!Array.isArray(body.capabilities)) {
        throw new OllamaError(`Ollama cannot report capabilities for "${model}". Update Ollama.`, 502);
    }
    capabilityCache.set(model, { at: Date.now(), capabilities: body.capabilities });
    return body.capabilities;
}

async function modelsWithCapability(models, capability) {
    const inspected = await Promise.allSettled(models.map(async item => ({
        item,
        capabilities: await modelCapabilities(item.name)
    })));
    const matches = inspected
        .filter(result => result.status === 'fulfilled' && result.value.capabilities.includes(capability))
        .map(result => result.value.item);
    if (!matches.length) {
        const failure = inspected.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
    }
    return matches;
}

async function requireCapability(model, capability) {
    const capabilities = await modelCapabilities(model);
    if (!capabilities.includes(capability)) {
        throw new OllamaError(`"${model}" does not support ${capability}. Select a compatible model.`, 422);
    }
    return capabilities;
}

function installedModel(models, name) {
    if (typeof name !== 'string' || !name.trim()) {
        throw new OllamaError('Select a model.', 400);
    }
    if (name.endsWith(':cloud')) {
        throw new OllamaError('Cloud models are unavailable in Cerebro. Select a locally pulled model.', 422);
    }
    const match = models.find(item => modelMatches(name, item.name));
    if (!match) {
        throw new OllamaError(`Model "${name}" is not installed. Run: ollama pull ${name}`, 422);
    }
    return match.name;
}

async function embedTexts(texts, model = OLLAMA_EMBED_MODEL) {
    const all = [];
    for (let i = 0; i < texts.length; i += 24) {
        const batch = texts.slice(i, i + 24);
        const response = await request('/api/embed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, input: batch }),
            signal: AbortSignal.timeout(120000)
        });
        const body = await response.json();
        if (!Array.isArray(body.embeddings) || body.embeddings.length !== batch.length ||
            body.embeddings.some(vector => !Array.isArray(vector) || !vector.length)) {
            throw new OllamaError('Ollama returned invalid embeddings.', 502);
        }
        all.push(...body.embeddings);
    }
    return all;
}

const timeoutSetting = Number.parseInt(process.env.CEREBRO_LLM_TIMEOUT_MS || '', 10);
const OLLAMA_TIMEOUT_MS = Number.isInteger(timeoutSetting) && timeoutSetting >= 10000 ? timeoutSetting : 300000;

function withTimeout(signal, ms) {
    const timeout = AbortSignal.timeout(ms);
    if (!signal) return timeout;
    return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal;
}

// `think` is sent only for models that report the thinking capability:
// false keeps reasoning models (Qwen3, DeepSeek-R1) from spending the time
// budget on hidden reasoning and from breaking JSON output.
async function openChat(model, messages, stream, signal, format, options = {}, think) {
    try {
        return await request('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model, messages, stream, ...(format ? { format } : {}), ...(typeof think === 'boolean' ? { think } : {}),
                options: { num_ctx: OLLAMA_NUM_CTX, ...(format ? { temperature: 0 } : {}), ...options }
            }),
            signal: withTimeout(signal, OLLAMA_TIMEOUT_MS)
        });
    } catch (error) {
        if (error?.name === 'TimeoutError' || (signal?.aborted === false && error?.name === 'AbortError')) {
            throw new OllamaError(`The local model took longer than ${Math.round(OLLAMA_TIMEOUT_MS / 1000)} seconds. Try a smaller model or a shorter request.`, 504);
        }
        throw error;
    }
}

async function readChatStream(response, onDelta) {
    const decoder = new TextDecoder();
    let pending = '';
    let answer = '';
    let finished = false;

    function consume(line) {
        if (!line.trim()) return;
        let event;
        try {
            event = JSON.parse(line);
        } catch {
            throw new OllamaError('Ollama returned an invalid stream.', 502);
        }
        if (event.error) throw new OllamaError(`Ollama request failed: ${event.error}`, 502);
        if (event.message?.content) {
            answer += event.message.content;
            onDelta(event.message.content);
        }
        if (event.done) finished = true;
    }

    for await (const chunk of response.body) {
        pending += decoder.decode(chunk, { stream: true });
        let newline;
        while ((newline = pending.indexOf('\n')) !== -1) {
            consume(pending.slice(0, newline));
            pending = pending.slice(newline + 1);
        }
    }
    pending += decoder.decode();
    consume(pending);
    if (!finished || !answer.trim()) {
        throw new OllamaError('Ollama ended without an answer.', 502);
    }
    return answer;
}

module.exports = {
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    OLLAMA_EMBED_MODEL,
    OLLAMA_NUM_CTX,
    OLLAMA_TIMEOUT_MS,
    parseContext,
    OllamaError,
    modelMatches,
    listModels,
    modelCapabilities,
    modelsWithCapability,
    requireCapability,
    installedModel,
    embedTexts,
    openChat,
    readChatStream
};
