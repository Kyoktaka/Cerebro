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

function questionHasEvidence(question, chunks) {
    if (/^\s*who\s+is\s+(?:he|she|the person)\s*[?.!]*\s*$/i.test(question)) return true;
    const words = question.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const stop = new Set(['what', 'whats', 'that', 'this', 'about', 'tell', 'please', 'could', 'would', 'should', 'does', 'have', 'from', 'with', 'your', 'their', 'which', 'where', 'when', 'into', 'explain', 'describe', 'summarize', 'summary', 'document', 'documents', 'pdf', 'file', 'files', 'content', 'uploaded', 'question', 'based', 'according', 'can', 'you', 'the', 'and', 'for', 'are', 'all', 'how', 'who', 'why', 'was', 'again']);
    const terms = words.filter(word => word.length > 2 && !stop.has(word));
    if (!terms.length) return /\b(summar(?:y|ize|ise)|about|overview)\b/i.test(question);
    const tokens = new Set(chunks.flatMap(chunk => chunk.text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []));
    return terms.every(term => tokens.has(term));
}

function quizRequest(question) {
    if (!/\b(?:quiz|quizzes|reviewer|flashcards?)\b/i.test(question)) return null;
    const topic = question.toLowerCase().replace(/\b(?:create|make|generate|give|build|prepare|write|please|could|would|can|you|me|a|an|the|some|quiz|quizzes|reviewer|flashcards|flashcard|questions|question|about|on|from|using|based|of|for|this|these|my|pdf|pdfs|document|documents|file|files|uploaded)\b/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return { topic };
}

function makeSourceQuiz(chunks, limit = 5) {
    const seen = new Set();
    const questions = [];
    for (const chunk of chunks) {
        const sentences = chunk.text.split(/\n+|(?<=[.!?])\s+/u);
        for (const raw of sentences) {
            const sentence = raw.replace(/^\s*[•\-*]\s*/, '').trim();
            if (sentence.length < 25 || sentence.length > 240 || !/[.!?]$/.test(sentence)) continue;
            const words = [...sentence.matchAll(/\b[A-Za-z]{5,}\b/g)];
            if (words.length < 3 || seen.has(sentence.toLowerCase())) continue;
            const word = words.at(-1);
            seen.add(sentence.toLowerCase());
            questions.push({ prompt: sentence.slice(0, word.index) + '_____' + sentence.slice(word.index + word[0].length), answer: word[0], source: chunk.pdfName });
            if (questions.length === limit) return questions;
        }
    }
    return questions;
}

module.exports = { chunkText, cosineSimilarity, retrieveChunks, questionHasEvidence, quizRequest, makeSourceQuiz };
