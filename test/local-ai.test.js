const test = require('node:test');
const assert = require('node:assert/strict');
const { ReadableStream } = require('node:stream/web');
const {
    modelMatches,
    listModels,
    installedModel,
    modelsWithCapability,
    requireCapability,
    embedTexts,
    readChatStream,
    parseContext
} = require('../local-ai');

test('context window parsing accepts commas and falls back safely', () => {
    assert.equal(parseContext('32,768'), 32768);
    assert.equal(parseContext('32 768'), 32768);
    assert.equal(parseContext('8192'), 8192);
    assert.equal(parseContext('0'), 8192);
    assert.equal(parseContext(''), 8192);
    assert.equal(parseContext(undefined), 8192);
});

test('model validation accepts installed tags and rejects missing or cloud models', () => {
    const models = [{ name: 'llama3.2:latest' }, { name: 'qwen2.5-coder:3b' }, { name: 'nomic-embed-text:latest' }];
    assert.equal(modelMatches('llama3.2', 'llama3.2:latest'), true);
    assert.equal(installedModel(models, 'llama3.2'), 'llama3.2:latest');
    assert.equal(installedModel(models, 'qwen2.5-coder:3b'), 'qwen2.5-coder:3b');
    assert.throws(() => installedModel(models, 'mistral'), /ollama pull mistral/);
    assert.equal(installedModel(models, 'nomic-embed-text'), 'nomic-embed-text:latest');
    assert.throws(() => installedModel(models, 'remote:cloud'), /Cloud models are unavailable/);
});

test('model discovery excludes remote and cloud models', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(JSON.stringify({ models: [
        { name: 'llama3.2:latest' },
        { name: 'remote:cloud' },
        { name: 'remote-alias:latest', remote_model: 'hosted' }
    ] }), { status: 200 });
    try {
        assert.deepEqual(await listModels(), [{ name: 'llama3.2:latest' }]);
    } finally {
        global.fetch = originalFetch;
    }
});

test('embedding requests use the current batch endpoint', async () => {
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push({ url, body });
        return new Response(JSON.stringify({ embeddings: body.input.map(() => [1, 0]) }), { status: 200 });
    };
    try {
        const vectors = await embedTexts(Array.from({ length: 25 }, (_, i) => `text ${i}`));
        assert.equal(vectors.length, 25);
        assert.equal(calls.length, 2);
        assert.ok(calls.every(call => call.url.endsWith('/api/embed')));
        assert.deepEqual(calls.map(call => call.body.input.length), [24, 1]);
    } finally {
        global.fetch = originalFetch;
    }
});

test('model picker includes every completion model and excludes embedding-only models', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
        assert.ok(url.endsWith('/api/show'));
        const { model } = JSON.parse(options.body);
        const capabilities = model === 'other-embed:latest' ? ['embedding'] : ['completion', 'embedding'];
        return new Response(JSON.stringify({ capabilities }), { status: 200 });
    };
    try {
        const models = [{ name: 'llama3.2:latest' }, { name: 'custom-dual:7b' }, { name: 'other-embed:latest' }];
        assert.deepEqual(await modelsWithCapability(models, 'completion'), [{ name: 'llama3.2:latest' }, { name: 'custom-dual:7b' }]);
        await assert.rejects(() => requireCapability('other-embed:latest', 'completion'), /does not support completion/);
    } finally {
        global.fetch = originalFetch;
    }
});

test('chat stream handles split NDJSON frames and a terminal error', async () => {
    const encoder = new TextEncoder();
    const chunks = [
        '{"message":{"content":"Hel',
        'lo"},"done":false}\n{"message":{"content":" world"},"done":false}\n',
        '{"done":true}\n'
    ];
    const body = new ReadableStream({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        }
    });
    const deltas = [];
    assert.equal(await readChatStream({ body }, delta => deltas.push(delta)), 'Hello world');
    assert.deepEqual(deltas, ['Hello', ' world']);

    const failure = new Response('{"error":"model unloaded"}\n', { status: 200 });
    await assert.rejects(() => readChatStream(failure, () => {}), /model unloaded/);
});

test('reasoning models: hidden reasoning is stripped and a runaway is retried once', async () => {
    const { createModel } = require('../engine/llm');
    const originalFetch = global.fetch;
    const bodies = [];
    const ndjson = parts => new Response(parts.map(content => JSON.stringify({ message: { content }, done: false })).join('\n') + '\n' + JSON.stringify({ done: true }) + '\n', { status: 200 });
    global.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        bodies.push(body);
        const prompt = body.messages.at(-1).content;
        return prompt.endsWith('/no_think') ? ndjson(['RAM is ', 'working memory.']) : ndjson(['<think>Let me think', ' about this at length']);
    };
    try {
        const model = createModel('hf.co/unsloth/Qwen3-4B-GGUF:Q4_K_M', undefined, { thinking: true });
        const shown = [];
        const answer = await model.text('system', 'What is RAM?', { onDelta: delta => shown.push(delta) });
        assert.equal(answer, 'RAM is working memory.');
        assert.equal(bodies.length, 2);
        assert.equal(bodies[0].think, false);
        assert.equal(bodies[1].options.num_predict, 1800, 'the retry gets a larger budget');
        assert.doesNotMatch(shown.filter(Boolean).join(''), /think/);
    } finally {
        global.fetch = originalFetch;
    }
});
