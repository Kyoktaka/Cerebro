const http = require('node:http');
const { createOracle, hashEmbed } = require('./oracle');

const requests = [];
const embedRequests = [];
const oracle = createOracle();
function setChatReply(reply) { oracle.reply = reply; }
<<<<<<< HEAD
const models = ['llama3.2:latest', 'qwen2.5-coder:3b', 'hf.co/unsloth/Qwen3-4B-GGUF:Q4_K_M', 'nomic-embed-text:latest', 'mxbai-embed-large:latest'];
const thinking = name => name.startsWith('hf.co/');
=======
const models = ['llama3.2:latest', 'qwen2.5-coder:3b', 'nomic-embed-text:latest', 'mxbai-embed-large:latest'];
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d

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
<<<<<<< HEAD
        return res.end(JSON.stringify({ capabilities: thinking(name) ? ['completion', 'thinking'] : /^(?:llama3\.2|qwen2\.5-coder)/.test(name) ? ['completion'] : ['embedding'] }));
=======
        return res.end(JSON.stringify({ capabilities: /^(?:llama3\.2|qwen2\.5-coder)/.test(name) ? ['completion'] : ['embedding'] }));
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d
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
<<<<<<< HEAD
        // Reasoning models that ignore think:false still wrap reasoning in tags.
        const answer = (thinking(body.model) ? '<think>Let me look at the passages.</think>\n' : '') + await oracle.text(system, user);
=======
        const answer = await oracle.text(system, user);
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d
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
