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
    readChatStream
} = require('../local-ai');

test('model validation accepts latest tags and rejects missing or embedding-only models', () => {
    const models = [{ name: 'llama3.2:latest' }, { name: 'nomic-embed-text:latest' }];
    assert.equal(modelMatches('llama3.2', 'llama3.2:latest'), true);
    assert.equal(installedModel(models, 'llama3.2'), 'llama3.2:latest');
    assert.throws(() => installedModel(models, 'mistral'), /ollama pull mistral/);
    assert.throws(() => installedModel(models, 'nomic-embed-text'), /embedding model/);
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
        const vectors = await embedTexts(Array.from({ length: 13 }, (_, i) => `text ${i}`));
        assert.equal(vectors.length, 13);
        assert.equal(calls.length, 2);
        assert.ok(calls.every(call => call.url.endsWith('/api/embed')));
        assert.deepEqual(calls.map(call => call.body.input.length), [12, 1]);
    } finally {
        global.fetch = originalFetch;
    }
});

test('model picker excludes embedding-only models by reported capability', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
        assert.ok(url.endsWith('/api/show'));
        const { model } = JSON.parse(options.body);
        const capabilities = model === 'llama3.2:latest' ? ['completion'] : ['embedding'];
        return new Response(JSON.stringify({ capabilities }), { status: 200 });
    };
    try {
        const models = [{ name: 'llama3.2:latest' }, { name: 'other-embed:latest' }];
        assert.deepEqual(await modelsWithCapability(models, 'completion'), [{ name: 'llama3.2:latest' }]);
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
