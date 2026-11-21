const { openChat, readChatStream, OllamaError, OLLAMA_NUM_CTX, OLLAMA_TIMEOUT_MS } = require('../local-ai');

function intEnv(name, fallback) {
    const parsed = Number.parseInt(String(process.env[name] || '').replace(/[^\d]/g, ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// Roughly 3.2 characters per token for English study text, keeping half of
// the window for instructions, history and the answer itself.
const CONTEXT_CHARS = Math.min(intEnv('CEREBRO_CONTEXT_CHARS', 12000), Math.floor(OLLAMA_NUM_CTX * 3.2 * 0.5));

function timeoutError(error) {
    if (error?.name === 'TimeoutError') {
        return new OllamaError(`The local model took longer than ${Math.round(OLLAMA_TIMEOUT_MS / 1000)} seconds. Try a smaller model or a shorter request.`, 504);
    }
    return error;
}

// Some GGUF chat templates put reasoning inline as <think>…</think> even
// when thinking is off. It is never part of the answer.
function stripThinking(text) {
    let value = String(text || '');
    const close = value.lastIndexOf('</think>');
    if (close !== -1 && !value.slice(0, close).includes('<think>')) value = value.slice(close + 8);
    return value.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim();
}

// Hides streamed reasoning from the live draft. A partial "<think" tag is
// held back; if reasoning turns out to have been shown, the draft restarts.
function thinkingFilter(onDelta) {
    let buffer = '';
    let shown = '';
    return delta => {
        buffer += delta;
        if (/<think>(?![\s\S]*<\/think>)/.test(buffer)) return;
        let visible = stripThinking(buffer);
        const tag = visible.lastIndexOf('<');
        if (tag !== -1 && '<think>'.startsWith(visible.slice(tag))) visible = visible.slice(0, tag);
        if (visible.startsWith(shown)) {
            if (visible.length > shown.length) onDelta(visible.slice(shown.length));
        } else {
            onDelta(null);
            if (visible) onDelta(visible);
        }
        shown = visible;
    };
}

function parseJson(text) {
    const clean = stripThinking(text);
    try {
        return JSON.parse(clean);
    } catch {
        const start = clean.indexOf('{');
        const end = clean.lastIndexOf('}');
        if (start === -1 || end <= start) return null;
        try { return JSON.parse(clean.slice(start, end + 1)); } catch { return null; }
    }
}

// Qwen-style models honour this switch when their template ignores think:false.
const NO_THINK = '\n\n/no_think';

function createModel(model, signal, { thinking = false } = {}) {
    let calls = 0;
    const think = thinking ? false : undefined;
    const messages = (system, user) => [{ role: 'system', content: system }, { role: 'user', content: user }];

    async function streamText(system, user, onDelta, options) {
        const response = await openChat(model, messages(system, user), true, signal, undefined, options, think);
        const filter = onDelta ? thinkingFilter(onDelta) : null;
        const raw = await readChatStream(response, delta => filter?.(delta));
        return { raw, answer: stripThinking(raw) };
    }

    async function askJson(system, user, schema, options) {
        const response = await openChat(model, messages(system, user), false, signal, schema, options, think);
        const body = await response.json();
        if (body.error) throw new OllamaError('Local model request failed.', 502);
        const raw = body.message?.content || '';
        return { raw, value: parseJson(raw) };
    }

    return {
        model,
        get calls() { return calls; },
        async text(system, user, { onDelta, temperature = 0.3, maxTokens = 900 } = {}) {
            calls++;
            try {
                let { raw, answer } = await streamText(system, user, onDelta, { temperature, num_predict: maxTokens });
                if (!answer && raw.includes('<think>')) {
                    // Reasoning used up the token budget: ask again with reasoning switched off.
                    calls++;
                    onDelta?.(null);
                    ({ answer } = await streamText(system, user + NO_THINK, onDelta, { temperature, num_predict: maxTokens * 2 }));
                }
                if (!answer) throw new OllamaError('The model returned only hidden reasoning and no answer. Try again or pick another model.', 502);
                return answer;
            } catch (error) {
                throw timeoutError(error);
            }
        },
        async json(system, user, schema, { temperature = 0, maxTokens = 1600 } = {}) {
            calls++;
            try {
                const first = await askJson(system, user, schema, { temperature, num_predict: maxTokens });
                if (first.value !== null || !first.raw.includes('<think>')) return first.value;
                calls++;
                return (await askJson(system, user + NO_THINK, schema, { temperature, num_predict: maxTokens * 2 })).value;
            } catch (error) {
                throw timeoutError(error);
            }
        }
    };
}

module.exports = { createModel, CONTEXT_CHARS, stripThinking, thinkingFilter, parseJson };
