const http = require('node:http');

const requests = [];
const embedRequests = [];
let chatReplyOverride = null;
function setChatReply(reply) { chatReplyOverride = reply; }
const models = ['llama3.2:latest', 'qwen2.5-coder:3b', 'nomic-embed-text:latest', 'mxbai-embed-large:latest'];

async function readJson(req) {
    let body = '';
    for await (const chunk of req) body += chunk;
    return JSON.parse(body || '{}');
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/api/tags') {
        return res.end(JSON.stringify({ models: models.map(name => ({ name, model: name })) }));
    }
    if (req.method === 'GET' && req.url === '/__requests') {
        return res.end(JSON.stringify(requests));
    }
    if (req.method !== 'POST') {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Not found' }));
    }
    const body = await readJson(req);
    if (req.url === '/api/show') {
        const name = body.model || body.name;
        if (!models.includes(name)) {
            res.writeHead(404);
            return res.end(JSON.stringify({ error: 'model not found' }));
        }
        return res.end(JSON.stringify({ capabilities: name.startsWith('llama3.2') || name.startsWith('qwen2.5-coder') ? ['completion'] : ['embedding'] }));
    }
    if (req.url === '/api/embed') {
        embedRequests.push(body);
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        return res.end(JSON.stringify({ embeddings: inputs.map(text =>
            /beta/i.test(text) ? [0, 1] : [1, 0]) }));
    }
    if (req.url === '/api/chat') {
        requests.push(body);
        let answer = 'Local chat works.';
        if (body.format === 'json' || body.format?.type === 'object') {
            const data = JSON.parse(body.messages.at(-1).content);
            const schema = body.format.properties;
            const { questionHasEvidence, makeSourceQuiz } = require('../rag');
            if (schema.decision) {
                const supported = !data.candidate.answer || questionHasEvidence(data.request.question, data.sources);
                answer = JSON.stringify({ decision: supported ? 'approve' : 'reject',
                    scores: { accuracy: 10, relevance: 10, completeness: 10, citations: 10, clarity: 10 }, feedback: '' });
            } else if (schema.items) {
                const items = data.sources.flatMap(source => makeSourceQuiz([{ pdfName: source.source, text: source.text }], 4, data.format)
                    .map(q => ({ kind: data.format, ...q, choices: q.choices || [], hint: 'Recall the passage.', topic: source.source,
                        explanation: q.evidence, evidence: [{ id: source.id, quote: q.evidence }] })))
                    .filter(item => !data.alreadyAsked.includes(item.prompt));
                answer = JSON.stringify({ items });
            } else if (schema.correct) {
                answer = JSON.stringify({ correct: data.student === data.key });
            } else {
                const first = data.sources[0];
                answer = JSON.stringify({ support: 'direct', answer: first.text, evidence: [{ id: first.id, quote: first.text }] });
            }
            if (chatReplyOverride !== null) answer = chatReplyOverride;
        }
        if (body.stream === false) return res.end(JSON.stringify({ message: { role: 'assistant', content: answer }, done: true }));
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.write(`${JSON.stringify({ message: { role: 'assistant', content: answer.slice(0, 7) }, done: false })}\n`);
        setTimeout(() => {
            res.write(`${JSON.stringify({ message: { role: 'assistant', content: answer.slice(7) }, done: false })}\n`);
            res.end(`${JSON.stringify({ done: true })}\n`);
        }, 50);
        return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
});

if (require.main === module && process.argv.includes('--serve')) {
    const port = Number(process.env.MOCK_OLLAMA_PORT || 11435);
    server.listen(port, '127.0.0.1', () => console.log(`Mock Ollama at http://127.0.0.1:${port}`));
}

module.exports = { server, requests, embedRequests, setChatReply };
