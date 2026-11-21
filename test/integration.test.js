const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { server: ollama, requests, embedRequests, setChatReply } = require('./mock-ollama');
const { makeDocument } = require('./pdf-fixture');
const corpus = require('./fixtures/corpus');

function listen(server) {
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function unusedPort() {
    const probe = http.createServer();
    const port = await listen(probe);
    await new Promise(resolve => probe.close(resolve));
    return port;
}

// The server keeps users, uploads and sessions here, never in the project's own folders.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cerebro-data-'));
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

async function startCerebro(port, ollamaPort) {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            CEREBRO_DATA_DIR: dataDir,
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
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.notEqual(events.at(-1).type, 'error', JSON.stringify(events.at(-1)));
    return events;
}

const block = (answer, type) => JSON.parse(answer.match(new RegExp('```cerebro-' + type + '\\n([\\s\\S]*?)\\n```'))[1]);

test('PDF workspace: upload, grounded answers, follow-ups, scope, study tools, persistence', async () => {
    const ollamaPort = await listen(ollama);
    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    const lastName = `LocalTest${Date.now()}`;
    const computerPdf = makeDocument(corpus.computer);
    let app;
    let sessionId;
    try {
        app = await startCerebro(port, ollamaPort);
        const models = await (await fetch(`${base}/api/models`)).json();
        assert.equal(models.available, true);
        assert.deepEqual(models.models.map(model => model.name), ['llama3.2:latest', 'qwen2.5-coder:3b', 'hf.co/unsloth/Qwen3-4B-GGUF:Q4_K_M']);
        assert.equal(models.embeddingAvailable, true);
        assert.equal((await fetch(`${base}/vendor/fontawesome/css/all.min.css`)).status, 200);

        assert.equal((await post(base, '/api/auth/register', { firstName: 'Local', lastName, email: `${lastName}@example.test`, password: 'test-only-password' })).status, 200);
        sessionId = (await post(base, '/api/auth/login', { username: lastName, password: 'test-only-password' })).body.sessionId;
<<<<<<< HEAD
        const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'users', lastName + '.json'), 'utf8'));
        assert.match(stored.password, /^scrypt:/, 'passwords are stored hashed');
        assert.equal((await post(base, '/api/auth/login', { username: lastName, password: 'wrong-password' })).status, 401);
        assert.equal((await post(base, '/api/auth/forgot-password', { lastName })).status, 404, 'no route reveals a password');
        const badReset = await post(base, '/api/auth/reset-password', { username: lastName, email: 'someone@else.test', password: 'new-password' });
        assert.equal(badReset.status, 400);
        const legacyName = 'Legacy' + Date.now();
        const legacyFile = path.join(dataDir, 'users', legacyName + '.json');
        fs.writeFileSync(legacyFile, JSON.stringify({ id: '1', firstName: 'Old', lastName: legacyName, email: 'old@example.test', password: 'plain-pass', conversations: [] }));
        assert.equal((await post(base, '/api/auth/login', { username: legacyName, password: 'plain-pass' })).status, 200, 'accounts from before hashing still sign in');
        assert.match(JSON.parse(fs.readFileSync(legacyFile, 'utf8')).password, /^scrypt:/, 'and their password is hashed on that sign-in');
        assert.equal((await post(base, '/api/auth/reset-password', { username: legacyName, email: 'OLD@example.test', password: 'brand-new' })).status, 200);
        assert.equal((await post(base, '/api/auth/login', { username: legacyName, password: 'brand-new' })).status, 200);
=======
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d
        assert.ok(sessionId);
        const conversationId = (await post(base, '/api/conversations/create', { sessionId })).body.conversationId;
        assert.ok(conversationId);

        const callsBefore = requests.length;
        const general = await streamChat(base, { message: 'Hello', sessionId, conversationId, model: 'llama3.2:latest' });
        assert.equal(general.at(-1).mode, 'normal');
        assert.match(general.at(-1).answer, /Upload a PDF/);
        assert.equal(requests.length, callsBefore, 'no model call without a PDF');

        const form = new FormData();
        form.append('files', new Blob([computerPdf], { type: 'application/pdf' }), 'computer.pdf');
        form.append('files', new Blob([makeDocument(corpus.networking)], { type: 'application/pdf' }), 'networking.pdf');
        form.append('files', new Blob([makeDocument(corpus.scanned)], { type: 'application/pdf' }), 'scanned.pdf');
        form.append('sessionId', sessionId);
        form.append('conversationId', conversationId);
        const uploadResponse = await fetch(`${base}/api/upload`, { method: 'POST', body: form });
        const upload = await uploadResponse.json();
        assert.equal(uploadResponse.status, 200, `${JSON.stringify(upload)}\n${app.getOutput()}`);
        assert.deepEqual(upload.pdfNames, ['computer.pdf', 'networking.pdf', 'scanned.pdf']);
        assert.deepEqual(upload.extractedPages.map(item => item.pages), [4, 5, 3]);
        assert.deepEqual(upload.extractedPages[2].imagePages, [2, 3]);

        const outline = await (await fetch(`${base}/api/conversations/${sessionId}/${conversationId}/outline`)).json();
        const networkSections = outline.documents.find(doc => doc.name === 'networking.pdf').sections.map(section => section.title);
        assert.ok(networkSections.includes('Network Topologies') && networkSections.includes('Star Topology'));

        await post(base, `/api/conversations/${sessionId}/focus-pdf`, { conversationId, pdfNames: ['computer.pdf', 'networking.pdf'] });

        const ram = await streamChat(base, { message: 'What is RAM?', sessionId, conversationId, model: 'llama3.2' });
        assert.ok(ram.some(event => event.type === 'status'), 'status events stream while working');
        assert.ok(ram.some(event => event.type === 'draft'), 'draft text streams before verification');
        const ramDone = ram.at(-1);
        assert.equal(ramDone.mode, 'answer');
        assert.match(ramDone.answer, /main working memory/);
        const citation = ramDone.answer.match(/\[computer\.pdf, p\. 2\]\(cerebro:([a-f0-9]{64}):2\)/);
        assert.ok(citation, ramDone.answer);
        assert.ok(block(ramDone.answer, 'sources').some(source => source.doc === 'computer.pdf' && source.page === 2));
        const fetchSource = () => fetch(base + '/api/source', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, conversationId, digest: citation[1] }) });
        assert.deepEqual(Buffer.from(await (await fetchSource()).arrayBuffer()), computerPdf);

        const topologies = await streamChat(base, { message: 'Explain network topologies.', sessionId, conversationId });
        assert.equal(topologies.at(-1).topic.label, 'Network Topologies');
        const examples = await streamChat(base, { message: 'Give me examples', sessionId, conversationId });
        assert.equal(examples.at(-1).mode, 'answer');
        assert.match(examples.at(-1).answer, /networking\.pdf/);
        assert.match(examples.at(-1).answer, /\*\*Beyond your PDF\*\*/);
        assert.equal(examples.at(-1).topic.label, 'Network Topologies');
        const restoredContext = await (await fetch(`${base}/api/conversations/${sessionId}/${conversationId}`)).json();
        assert.equal(restoredContext.context.activeTopic.label, 'Network Topologies');

        const unrelated = await streamChat(base, { message: 'What is photosynthesis?', sessionId, conversationId });
        assert.equal(unrelated.at(-1).mode, 'unrelated');
        assert.match(unrelated.at(-1).answer, /couldn't find that/);

        setChatReply('Networks were invented in 1969 by Vint Cerf [1]. Plants grow toward light [9].');
        const fabricated = await streamChat(base, { message: 'Who invented networks?', sessionId, conversationId });
        assert.doesNotMatch(JSON.stringify(fabricated.at(-1)), /1969|Vint Cerf|Plants grow/);
        setChatReply(null);

        const invalid = await post(base, '/api/chat', { message: 'Hello', sessionId, conversationId, model: 'missing-model' });
        assert.equal(invalid.status, 422);
        assert.match(invalid.body.error, /ollama pull missing-model/);

        const quiz = await streamChat(base, { message: 'Make a 3 question quiz about network topologies', sessionId, conversationId });
        const quizSet = block(quiz.at(-1).answer, 'quiz');
        assert.ok(quizSet.items.length >= 1);
        assert.ok(quizSet.items.every(item => item.source.doc === 'networking.pdf' && item.choices.length === 4 && item.choices[item.correct] === item.answer));
        const cards = await streamChat(base, { message: 'Create flashcards about storage devices', sessionId, conversationId });
        const deck = block(cards.at(-1).answer, 'flashcards');
        assert.ok(deck.items.length >= 1 && deck.items.every(card => card.front && card.back && card.source.doc === 'computer.pdf'));

        const practice = await streamChat(base, { message: 'Quiz me on network topologies, one question at a time', sessionId, conversationId });
        assert.equal(practice.at(-1).mode, 'practice');
        assert.match(practice.at(-1).answer, /Question 1 of (\d+)/);
        const total = Number(practice.at(-1).answer.match(/Question 1 of (\d+)/)[1]);
        assert.match((await streamChat(base, { message: 'hint', sessionId, conversationId })).at(-1).answer, /Hint:/);
        assert.match((await streamChat(base, { message: 'banana', sessionId, conversationId })).at(-1).answer, /option letter/);
        let last;
        for (let i = 0; i < total; i++) last = await streamChat(base, { message: 'skip', sessionId, conversationId });
        assert.match(last.at(-1).answer, new RegExp(`First-try score: 0 of ${total}`));

        assert.match((await streamChat(base, { message: 'quiz from missing.pdf', sessionId, conversationId })).at(-1).answer, /not available/);

        const focus = await post(base, `/api/conversations/${sessionId}/focus-pdf`, { conversationId, pdfNames: ['networking.pdf'] });
        assert.equal(focus.status, 200);
        assert.deepEqual(focus.body.activePdfNames, ['networking.pdf']);
        assert.equal((await fetchSource()).status, 404, 'unselected PDFs are not served');
        const isolated = await streamChat(base, { message: 'What is RAM?', sessionId, conversationId });
        assert.doesNotMatch(isolated.at(-1).answer, /computer\.pdf|main working memory/);
        assert.match((await streamChat(base, { message: 'Summarize computer.pdf', sessionId, conversationId })).at(-1).answer, /Select the named PDF/);

        await stopCerebro(app);
        app = await startCerebro(port, ollamaPort);
<<<<<<< HEAD
        // Sign-in survives a server restart (nodemon reloads used to log users out).
=======
        sessionId = (await post(base, '/api/auth/login', { username: lastName, password: 'test-only-password' })).body.sessionId;
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d
        const restored = await (await fetch(`${base}/api/conversations/${sessionId}/${conversationId}`)).json();
        assert.deepEqual(restored.activePdfNames, ['networking.pdf']);
        const embedsBefore = embedRequests.length;
        const resumed = await streamChat(base, { message: 'Explain star topology', sessionId, conversationId });
        assert.equal(resumed.at(-1).mode, 'answer');
        assert.match(resumed.at(-1).answer, /central switch/);
        assert.equal(embedRequests.length - embedsBefore, 1, 'the saved index is reused; only the question is embedded');

<<<<<<< HEAD
        const reasoning = await streamChat(base, { message: 'Explain star topology', sessionId, conversationId, model: 'hf.co/unsloth/Qwen3-4B-GGUF:Q4_K_M' });
        assert.doesNotMatch(JSON.stringify(reasoning), /<think>|Let me look at the passages/);
        assert.match(reasoning.at(-1).answer, /central switch/);
        assert.equal(requests.at(-1).think, false, 'reasoning is turned off for thinking-capable models');

=======
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d
        assert.equal((await post(base, `/api/conversations/${sessionId}/clear-pdfs`, { conversationId })).status, 200);
        const normalAgain = await streamChat(base, { message: 'Hello again', sessionId, conversationId });
        assert.equal(normalAgain.at(-1).mode, 'normal');
        await post(base, '/api/auth/delete-account', { sessionId });
    } finally {
        setChatReply(null);
        if (app && sessionId) await post(base, '/api/auth/delete-account', { sessionId }).catch(() => {});
        await stopCerebro(app);
        await new Promise(resolve => ollama.close(resolve));
    }
});
