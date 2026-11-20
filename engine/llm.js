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

function createModel(model, signal) {
    let calls = 0;
    return {
        model,
        get calls() { return calls; },
        async text(system, user, { onDelta, temperature = 0.3, maxTokens = 900 } = {}) {
            calls++;
            try {
                const response = await openChat(model, [{ role: 'system', content: system }, { role: 'user', content: user }],
                    true, signal, undefined, { temperature, num_predict: maxTokens });
                return await readChatStream(response, delta => onDelta?.(delta));
            } catch (error) {
                throw timeoutError(error);
            }
        },
        async json(system, user, schema, { temperature = 0, maxTokens = 1600 } = {}) {
            calls++;
            try {
                const response = await openChat(model, [{ role: 'system', content: system }, { role: 'user', content: user }],
                    false, signal, schema, { temperature, num_predict: maxTokens });
                const body = await response.json();
                if (body.error) throw new OllamaError('Local model request failed.', 502);
                try { return JSON.parse(body.message?.content); } catch { return null; }
            } catch (error) {
                throw timeoutError(error);
            }
        }
    };
}

module.exports = { createModel, CONTEXT_CHARS };
