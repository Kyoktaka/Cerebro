const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { server: ollama, requests, embedRequests, setChatReply } = require('./mock-ollama');
const { makePdf } = require('./pdf-fixture');

function listen(server) {
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function unusedPort() {
    const probe = http.createServer();
    const port = await listen(probe);
    await new Promise(resolve => probe.close(resolve));
    return port;
}

async function startCerebro(port, ollamaPort) {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            HOST: '127.0.0.1',
            PORT: String(port),
            OLLAMA_BASE_URL: `http://127.0.0.1:${ollamaPort}`,
            OLLAMA_MODEL: 'llama3.2',
            OLLAMA_EMBED_MODEL: 'nomic-embed-text'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.getOutput = () => output.slice(-5000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error(`Cerebro exited early: ${output}`);
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/health`);
            if (response.ok) return child;
        } catch {}
        await delay(50);
    }
    child.kill();
    throw new Error(`Cerebro did not start: ${output}`);
}

async function stopCerebro(child) {
    if (!child || child.exitCode !== null) return;
    child.kill();
    await once(child, 'exit');
}

async function post(base, route, body) {
    const response = await fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
}

async function streamChat(base, body) {
    const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, stream: true })
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
    return (await response.text()).trim().split('\n').map(line => JSON.parse(line));
}

test('local model discovery, grounded PDF responses, and persisted index', async () => {
    const ollamaPort = await listen(ollama);
    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    const lastName = `LocalTest${Date.now()}`;
    let app;
    let sessionId;
    try {
        app = await startCerebro(port, ollamaPort);
        const models = await (await fetch(`${base}/api/models`)).json();
        assert.equal(models.available, true);
        assert.deepEqual(models.models.map(model => model.name), ['llama3.2:latest', 'qwen2.5-coder:3b']);
        assert.equal(models.embeddingAvailable, true);
        assert.equal((await fetch(`${base}/vendor/fontawesome/css/all.min.css`)).status, 200);

        const registration = await post(base, '/api/auth/register', {
            firstName: 'Local', lastName, email: `${lastName}@example.test`, password: 'test-only-password'
        });
        assert.equal(registration.status, 200);
        const login = await post(base, '/api/auth/login', { username: lastName, password: 'test-only-password' });
        sessionId = login.body.sessionId;
        assert.ok(sessionId);
        const created = await post(base, '/api/conversations/create', { sessionId });
        const conversationId = created.body.conversationId;
        assert.ok(conversationId);

        const general = await streamChat(base, { message: 'Hello', sessionId, conversationId, model: 'llama3.2:latest' });
        assert.ok(general.some(event => event.type === 'delta'));
        assert.equal(general.at(-1).mode, 'normal');
        assert.match(general.at(-1).answer, /Upload a PDF/);
        const callsBeforeGeneral = requests.length;
        const qwen = await streamChat(base, { message: 'Explain a loop', sessionId, conversationId, model: 'qwen2.5-coder:3b' });
        assert.match(qwen.at(-1).answer, /Upload a PDF/);
        assert.equal(requests.length, callsBeforeGeneral);

        const form = new FormData();
        form.append('files', new Blob([makePdf('Alpha document explains cells.')], { type: 'application/pdf' }), 'alpha.pdf');
        form.append('files', new Blob([makePdf('Beta document explains plants.')], { type: 'application/pdf' }), 'beta.pdf');
        form.append('sessionId', sessionId);
        form.append('conversationId', conversationId);
        const uploadResponse = await fetch(`${base}/api/upload`, { method: 'POST', body: form });
        const upload = await uploadResponse.json();
        assert.equal(uploadResponse.status, 200, `${JSON.stringify(upload)}\n${app.getOutput()}`);
        assert.deepEqual(upload.pdfNames, ['alpha.pdf', 'beta.pdf']);

        const invalid = await post(base, '/api/chat', { message: 'Hello', sessionId, conversationId, model: 'missing-model' });
        assert.equal(invalid.status, 422);
        assert.match(invalid.body.error, /ollama pull missing-model/);

        const callsBeforeStudy = requests.length;
        const scoped = await streamChat(base, { message: 'create 10 quiz questions from alpha.pdf', sessionId, conversationId, model: 'llama3.2' });
        assert.match(scoped.at(-1).answer, /1 of 10 requested/);
        assert.match(scoped.at(-1).answer, /alpha\.pdf/);
        assert.doesNotMatch(scoped.at(-1).answer, /beta\.pdf/);
        assert.equal(requests.length, callsBeforeStudy);
        const both = await streamChat(base, { message: 'quiz from alpha.pdf and beta.pdf', sessionId, conversationId, model: 'llama3.2' });
        assert.match(both.at(-1).answer, /alpha\.pdf/);
        assert.match(both.at(-1).answer, /beta\.pdf/);
        const scopedQuestion = await streamChat(base, { message: 'What does alpha explain in alpha.pdf?', sessionId, conversationId, model: 'llama3.2' });
        assert.match(scopedQuestion.at(-1).answer, /Alpha document explains cells/);
        assert.doesNotMatch(scopedQuestion.at(-1).answer, /beta\.pdf/);
        const missing = await streamChat(base, { message: 'quiz from missing.pdf', sessionId, conversationId, model: 'llama3.2' });
        assert.match(missing.at(-1).answer, /not available/);

        const focus = await post(base, `/api/conversations/${sessionId}/focus-pdf`, {
            conversationId, pdfNames: ['beta.pdf']
        });
        assert.equal(focus.status, 200);
        assert.deepEqual(focus.body.pdfNames, ['alpha.pdf', 'beta.pdf']);
        assert.deepEqual(focus.body.activePdfNames, ['beta.pdf']);
        const unfocused = await streamChat(base, { message: 'quiz from alpha.pdf', sessionId, conversationId, model: 'llama3.2' });
        assert.match(unfocused.at(-1).answer, /alpha\.pdf/);
        assert.doesNotMatch(unfocused.at(-1).answer, /beta\.pdf/);
        const study = await streamChat(base, { message: 'What does beta explain?', sessionId, conversationId, model: 'llama3.2' });
        assert.equal(study.at(-1).mode, 'study');
        const studyAnswer = study.at(-1).answer;
        assert.match(studyAnswer, /beta\.pdf/);
        assert.doesNotMatch(studyAnswer, /alpha\.pdf/);
        assert.match(studyAnswer, /Beta document explains plants/);
        assert.doesNotMatch(studyAnswer, /Alpha document explains cells/);
        const qwenStudy = await streamChat(base, { message: 'What does beta explain?', sessionId, conversationId, model: 'qwen2.5-coder:3b' });
        assert.match(qwenStudy.at(-1).answer, /Beta document explains plants/);
        assert.equal(requests.at(-1).model, 'qwen2.5-coder:3b');
        assert.equal(requests.at(-1).format.type, 'object');
        assert.deepEqual(requests.at(-1).format.properties.evidence.items.required, ['source', 'quote']);
        assert.equal(requests.at(-1).options.temperature, 0);
        for (const reply of [
            'fabricated response',
            JSON.stringify({ evidence: [{ source: 'beta.pdf', quote: 'Beta document invented something fictional.' }] }),
            JSON.stringify({ evidence: [{ source: 'alpha.pdf', quote: 'Beta document explains plants.' }] })
        ]) {
            setChatReply(reply);
            const blocked = await streamChat(base, { message: 'What does beta explain?', sessionId, conversationId, model: 'llama3.2' });
            assert.match(blocked.at(-1).answer, /cannot answer/i);
            assert.doesNotMatch(JSON.stringify(blocked), /fabricated|fictional/);
        }
        setChatReply(null);
        const unrelated = await streamChat(base, { message: 'What is science?', sessionId, conversationId, model: 'llama3.2' });
        assert.match(unrelated.at(-1).answer, /cannot answer/i);
        const quiz = await streamChat(base, { message: 'create me a quiz', sessionId, conversationId, model: 'llama3.2' });
        assert.match(quiz.at(-1).answer, /Answer key:/);
        assert.match(quiz.at(-1).answer, /beta\.pdf/);
        assert.doesNotMatch(quiz.at(-1).answer, /alpha\.pdf/);
        const unrelatedQuiz = await streamChat(base, { message: 'create a quiz about science', sessionId, conversationId, model: 'llama3.2' });
        assert.match(unrelatedQuiz.at(-1).answer, /cannot answer/i);

        await stopCerebro(app);
        app = await startCerebro(port, ollamaPort);
        const secondLogin = await post(base, '/api/auth/login', { username: lastName, password: 'test-only-password' });
        sessionId = secondLogin.body.sessionId;
        const restored = await (await fetch(`${base}/api/conversations/${sessionId}/${conversationId}`)).json();
        assert.deepEqual(restored.activePdfNames, ['beta.pdf']);
        const embedsBefore = embedRequests.length;
        const resumed = await streamChat(base, { message: 'Explain beta again', sessionId, conversationId, model: 'llama3.2' });
        assert.equal(resumed.at(-1).mode, 'study');
        assert.equal(embedRequests.length - embedsBefore, 1);

        const cleared = await post(base, `/api/conversations/${sessionId}/clear-pdfs`, { conversationId });
        assert.equal(cleared.status, 200);
        const normalAgain = await streamChat(base, { message: 'Hello again', sessionId, conversationId, model: 'llama3.2' });
        assert.equal(normalAgain.at(-1).mode, 'normal');
        assert.match(normalAgain.at(-1).answer, /Upload a PDF/);
        await post(base, '/api/auth/delete-account', { sessionId });
    } finally {
        setChatReply(null);
        if (app && sessionId) await post(base, '/api/auth/delete-account', { sessionId }).catch(() => {});
        await stopCerebro(app);
        await new Promise(resolve => ollama.close(resolve));
    }
});
