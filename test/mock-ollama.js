const http = require('node:http');

const requests = [];
const embedRequests = [];
const models = ['llama3.2:latest', 'nomic-embed-text:latest', 'mxbai-embed-large:latest'];

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
        return res.end(JSON.stringify({ capabilities: name.startsWith('llama3.2') ? ['completion'] : ['embedding'] }));
    }
    if (req.url === '/api/embed') {
        embedRequests.push(body);
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        return res.end(JSON.stringify({ embeddings: inputs.map(text =>
            /beta/i.test(text) ? [0, 1] : [1, 0]) }));
    }
    if (req.url === '/api/chat') {
        requests.push(body);
        const answer = body.messages.at(-1).content.includes('Document excerpts:')
            ? 'Answer from the focused PDF.' : 'Local chat works.';
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

module.exports = { server, requests, embedRequests };
