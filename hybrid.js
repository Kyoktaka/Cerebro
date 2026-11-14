// Hybrid passage ranking.
//
// Cerebro previously ranked passages by raw cosine similarity only, which
// misses technical terminology, acronyms, names, dates and exact phrases that
// embeddings can overlook. This module combines several retrieval signals,
// normalizes each before combining, and then selects passages with a
// coverage-aware pass that avoids near-duplicate overlapping chunks.
//
// Signals:
//   - semantic similarity (embedding cosine, normalized to [0, 1])
//   - keyword overlap   (normalized share of meaningful query terms present)
//   - exact phrase match (multi-word query run appearing verbatim in the text)
//
// Weights are configurable so callers can bias toward keyword recall (the
// progressive fallback) or semantic precision (the primary pass). No score
// threshold is hard-coded: results are ranked and capped by count and context
// budget instead.

const { cosineSimilarity } = require('./rag');

const STOP = new Set([
    'what', 'whats', 'that', 'this', 'these', 'those', 'about', 'tell', 'please',
    'could', 'would', 'should', 'does', 'do', 'did', 'have', 'has', 'had', 'from',
    'with', 'your', 'their', 'which', 'where', 'when', 'into', 'explain', 'describe',
    'summarize', 'summary', 'document', 'documents', 'pdf', 'file', 'files', 'content',
    'uploaded', 'question', 'based', 'according', 'can', 'you', 'the', 'and', 'for',
    'are', 'all', 'how', 'who', 'why', 'was', 'were', 'again', 'is', 'to', 'me', 'of',
    'as', 'it', 'in', 'on', 'at', 'by', 'or', 'be', 'he', 'she', 'we', 'if', 'am',
    'an', 'i', 'a', 'give', 'list', 'name', 'identify', 'provide', 'write', 'show',
    'state', 'mention', 'discuss', 'compare', 'contrast', 'difference', 'between',
    'versus', 'vs', 'examples', 'example', 'its', 'his', 'her', 'using', 'use',
    'the', 'there', 'here', 'any', 'some', 'get', 'lets', 'let', 'doesnt', 'dont'
]);

function normalizeTerm(word) {
    word = word.toLowerCase();
    if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
    if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
}

function termSet(text) {
    return new Set((String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).map(normalizeTerm));
}

function meaningfulTerms(text) {
    return [...termSet(text)].filter(term => term.length > 1 && !STOP.has(term));
}

// Return 1 when a contiguous run of 2-3 meaningful query words appears verbatim
// in the passage, which is a strong signal for definitions and terminology.
function phraseBonus(query, text) {
    const words = (String(query || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
    const compact = ' ' + String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ') + ' ';
    for (let len = Math.min(3, words.length); len >= 2; len--) {
        for (let i = 0; i + len <= words.length; i++) {
            const gram = words.slice(i, i + len);
            if (gram.every(word => word.length > 1 && !STOP.has(word)) &&
                compact.includes(' ' + gram.join(' ') + ' ')) return 1;
        }
    }
    return 0;
}

function keywordScore(query, text) {
    const qTerms = meaningfulTerms(query);
    if (!qTerms.length) return 0;
    const tTerms = termSet(text);
    const matched = qTerms.filter(term => tTerms.has(term)).length;
    const overlap = matched / qTerms.length;
    return Math.min(1, overlap * 0.75 + phraseBonus(query, text) * 0.25);
}

function semanticScore(vector, embedding) {
    if (!vector || !embedding) return 0;
    const cosine = cosineSimilarity(embedding, vector);
    if (cosine < 0) return 0;
    return (cosine + 1) / 2; // normalize [-1, 1] to [0, 1]
}

function hybridScore(vector, chunk, query, weights) {
    const semantic = semanticScore(vector, chunk.embedding);
    const keyword = keywordScore(query, chunk.text);
    return weights.semantic * semantic + weights.keyword * keyword;
}

function nearDuplicate(chunk, selected) {
    const terms = termSet(chunk.text);
    if (!terms.size) return false;
    for (const previous of selected) {
        const other = termSet(previous.text);
        if (!other.size) continue;
        const union = new Set([...terms, ...other]);
        let shared = 0;
        for (const term of terms) if (other.has(term)) shared++;
        if (union.size && shared / union.size > 0.85) return true;
    }
    return false;
}

// Rank passages for `names` using semantic + keyword signals, then select a
// coverage-aware set of at most `top` chunks within `maxChars`. When `query` is
// omitted the ranking degrades to pure (normalized) cosine similarity, which
// preserves the previous behavior for callers that only have a vector.
function rankPassages(chunks, names, vector, query, options = {}) {
    const top = options.top || 4;
    const maxChars = options.maxChars || 6000;
    const weights = options.weights || { semantic: 0.7, keyword: 0.3 };
    const active = new Set(names);
    const hasQuery = typeof query === 'string' && query.trim().length > 0;

    const ranked = chunks
        .filter(chunk => active.has(chunk.pdfName))
        .map(chunk => ({
            ...chunk,
            score: hasQuery
                ? hybridScore(vector, chunk, query, weights)
                : semanticScore(vector, chunk.embedding)
        }))
        .sort((a, b) => b.score - a.score);

    const selected = [];
    let used = 0;
    for (const chunk of ranked) {
        if (selected.length === top || used + chunk.text.length > maxChars) break;
        if (nearDuplicate(chunk, selected)) continue;
        selected.push(chunk);
        used += chunk.text.length;
    }
    return selected;
}

// Keyword-only ranking used by the progressive fallback when semantic retrieval
// fails to produce a supported answer. Returned chunks always share at least one
// meaningful term with the query.
function rankByKeywords(chunks, names, query, top = 6, maxChars = 9000) {
    const active = new Set(names);
    const ranked = chunks
        .filter(chunk => active.has(chunk.pdfName))
        .map(chunk => ({ ...chunk, score: keywordScore(query, chunk.text) }))
        .filter(chunk => chunk.score > 0)
        .sort((a, b) => b.score - a.score);
    const selected = [];
    let used = 0;
    for (const chunk of ranked) {
        if (selected.length === top || used + chunk.text.length > maxChars) break;
        if (nearDuplicate(chunk, selected)) continue;
        selected.push(chunk);
        used += chunk.text.length;
    }
    return selected;
}

module.exports = { rankPassages, rankByKeywords, keywordScore, semanticScore, phraseBonus, meaningfulTerms, normalizeTerm };
