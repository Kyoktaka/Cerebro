const http = require('node:http');
const { createOracle, hashEmbed } = require('./oracle');

const requests = [];
const embedRequests = [];
const oracle = createOracle();
function setChatReply(reply) { oracle.reply = reply; }
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
        return res.end(JSON.stringify({ capabilities: /^(?:llama3\.2|qwen2\.5-coder)/.test(name) ? ['completion'] : ['embedding'] }));
    }
    if (req.url === '/api/embed') {
        embedRequests.push(body);
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        return res.end(JSON.stringify({ embeddings: inputs.map(text => hashEmbed(text)) }));
    }
    if (req.url === '/api/chat') {
        requests.push(body);
        const system = body.messages.find(message => message.role === 'system')?.content || '';
        const user = body.messages.at(-1).content;
        if (body.format) {
            const result = await oracle.json(system, user, body.format);
            return res.end(JSON.stringify({ message: { role: 'assistant', content: JSON.stringify(result) }, done: true }));
        }
        const answer = await oracle.text(system, user);
        if (body.stream === false) return res.end(JSON.stringify({ message: { role: 'assistant', content: answer }, done: true }));
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.write(`${JSON.stringify({ message: { role: 'assistant', content: answer.slice(0, 7) }, done: false })}\n`);
        setTimeout(() => {
            res.write(`${JSON.stringify({ message: { role: 'assistant', content: answer.slice(7) }, done: false })}\n`);
            res.end(`${JSON.stringify({ done: true })}\n`);
        }, 20);
        return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
});

if (require.main === module && process.argv.includes('--serve')) {
    const port = Number(process.env.MOCK_OLLAMA_PORT || 11435);
    server.listen(port, '127.0.0.1', () => console.log(`Mock Ollama at http://127.0.0.1:${port}`));
}

module.exports = { server, requests, embedRequests, setChatReply, oracle };
