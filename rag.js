const CHUNK_SIZE = 1400;
const CHUNK_OVERLAP = 180;
const MAX_CONTEXT_CHARS = 6000;

function chunkText(text) {
    const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
    const chunks = [];
    let start = 0;

    while (start < normalized.length) {
        let end = Math.min(start + CHUNK_SIZE, normalized.length);
        if (end < normalized.length) {
            const paragraph = normalized.lastIndexOf('\n', end);
            const word = normalized.lastIndexOf(' ', end);
            const boundary = paragraph > start + CHUNK_SIZE * 0.6 ? paragraph : word;
            if (boundary > start + CHUNK_SIZE * 0.6) end = boundary;
        }
        const chunk = normalized.slice(start, end).trim();
        if (chunk) chunks.push(chunk);
        if (end === normalized.length) break;
        start = Math.max(start + 1, end - CHUNK_OVERLAP);
    }
    return chunks;
}

function cosineSimilarity(a, b) {
    if (a.length !== b.length) return -1;
    let dot = 0;
    let aSize = 0;
    let bSize = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        aSize += a[i] * a[i];
        bSize += b[i] * b[i];
    }
    return aSize && bSize ? dot / Math.sqrt(aSize * bSize) : -1;
}

function retrieveChunks(index, activeNames, queryVector) {
    const active = new Set(activeNames);
    const ranked = index.chunks
        .filter(chunk => active.has(chunk.pdfName))
        .map(chunk => ({ ...chunk, score: cosineSimilarity(chunk.embedding, queryVector) }))
        .sort((a, b) => b.score - a.score);
    const selected = [];
    let used = 0;
    for (const chunk of ranked) {
        if (selected.length === 4 || used + chunk.text.length > MAX_CONTEXT_CHARS) break;
        selected.push(chunk);
        used += chunk.text.length;
    }
    return selected;
}

module.exports = { chunkText, cosineSimilarity, retrieveChunks };
