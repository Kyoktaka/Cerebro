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
            if (body.format?.properties?.supported) {
                const prompt = body.messages.at(-1).content;
                const question = JSON.parse(prompt.split('QUESTION: ')[1].split('\nVERIFIED PDF QUOTES:')[0]);
                const quotes = JSON.parse(prompt.split('VERIFIED PDF QUOTES: ')[1].split('\nDoes this evidence')[0]);
                const { questionHasEvidence } = require('../rag');
                answer = JSON.stringify({ supported: questionHasEvidence(question, quotes.map(item => ({ text: item.quote }))) });
            } else {
                const prompt = body.messages.at(-1).content;
                const context = prompt.split('=== START RETRIEVED PDF CONTEXT ===\n')[1]?.split('\n=== END RETRIEVED PDF CONTEXT ===')[0];
                const passages = JSON.parse(context);
                answer = JSON.stringify({ evidence: passages.length ? [{ source: passages[0].source, quote: passages[0].text }] : [] });
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
