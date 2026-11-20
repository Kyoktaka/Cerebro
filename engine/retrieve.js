const { terms, contentTerms, stem, words, jaccard, STOP } = require('./text');

const LEXICON = Symbol('lexicon');

function cosine(a, b) {
    if (!a || !b || a.length !== b.length) return null;
    let dot = 0;
    let left = 0;
    let right = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        left += a[i] * a[i];
        right += b[i] * b[i];
    }
    return left && right ? dot / Math.sqrt(left * right) : null;
}

// Term statistics are derived data: cached on the in-memory index object and
// never written to disk.
function lexicon(index) {
    if (index[LEXICON]) return index[LEXICON];
    const docs = new Map();
    const df = new Map();
    let total = 0;
    for (const chunk of index.chunks) {
        const tf = new Map();
        const tokens = terms(chunk.text + ' ' + (chunk.sectionPath || []).join(' '));
        for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
        for (const token of tf.keys()) df.set(token, (df.get(token) || 0) + 1);
        docs.set(chunk.id, { tf, length: tokens.length, titles: new Set(terms((chunk.sectionPath || []).join(' '))) });
        total += tokens.length;
    }
    const aliases = new Map();
    for (const doc of index.documents || []) {
        for (const [short, long] of doc.aliases || []) {
            const shortKey = stem(short.toLowerCase());
            const longTerms = contentTerms(long);
            aliases.set(shortKey, [...new Set([...(aliases.get(shortKey) || []), ...longTerms])]);
            const longKey = longTerms.join(' ');
            aliases.set(longKey, [...new Set([...(aliases.get(longKey) || []), shortKey])]);
        }
    }
    const value = { docs, df, count: index.chunks.length || 1, average: total / (index.chunks.length || 1), aliases, vocabulary: new Set(df.keys()) };
    Object.defineProperty(index, LEXICON, { value, enumerable: false });
    return value;
}

function oneEdit(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    if (a.length < b.length) return a.slice(i) === b.slice(i + 1);
    if (b.length < a.length) return b.slice(i) === a.slice(i + 1);
    return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
}

// Query terms plus acronym expansions and unambiguous one-letter typo fixes,
// both taken only from the selected documents' own vocabulary.
function expandQuery(index, text, { relaxed = false } = {}) {
    const lex = lexicon(index);
    const base = contentTerms(text);
    const expanded = new Set(base);
    const phrase = base.join(' ');
    for (const [key, values] of lex.aliases) {
        if (base.includes(key) || (key.includes(' ') && phrase.includes(key))) values.forEach(value => expanded.add(value));
    }
    // "back up" in a question, "backup" in the PDF.
    const tokens = words(text);
    for (let i = 0; i + 1 < tokens.length; i++) {
        const joined = stem(tokens[i] + tokens[i + 1]);
        if (joined.length >= 5 && lex.vocabulary.has(joined)) expanded.add(joined);
    }
    for (const term of base) {
        if (lex.vocabulary.has(term) || term.length < 4) continue;
        const near = [...lex.vocabulary].filter(word => oneEdit(term, word));
        if (near.length === 1) expanded.add(near[0]);
        if (relaxed && term.length >= 5) {
            for (const word of lex.vocabulary) if (word.length >= 5 && (word.startsWith(term.slice(0, 5)) || term.startsWith(word))) expanded.add(word);
        }
    }
    return { base, terms: [...expanded] };
}

function bm25(lex, chunkId, queryTerms) {
    const doc = lex.docs.get(chunkId);
    if (!doc) return 0;
    let score = 0;
    for (const term of queryTerms) {
        const tf = doc.tf.get(term);
        if (!tf) continue;
        const df = lex.df.get(term) || 0;
        const idf = Math.log(1 + (lex.count - df + 0.5) / (df + 0.5));
        score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * doc.length / lex.average));
    }
    return score;
}

function phraseHit(text, query) {
    const tokens = words(query).filter(word => !STOP.has(word));
    const flat = ' ' + words(text).join(' ') + ' ';
    for (let size = Math.min(4, tokens.length); size >= 2; size--) {
        for (let i = 0; i + size <= tokens.length; i++) {
            if (flat.includes(' ' + tokens.slice(i, i + size).join(' ') + ' ')) return 1;
        }
    }
    return 0;
}

// Section titles and key terms that the question names.
function matchTopics(index, names, text) {
    const query = new Set(contentTerms(text));
    if (!query.size) return [];
    const results = [];
    for (const doc of index.documents || []) {
        if (!names.includes(doc.name)) continue;
        for (const section of doc.sections || []) {
            if (!section.title) continue;
            const title = contentTerms(section.title);
            if (!title.length) continue;
            const hits = title.filter(term => query.has(term)).length;
            if (!hits) continue;
            const score = hits / title.length * 0.6 + hits / query.size * 0.4;
            results.push({ kind: 'section', doc: doc.name, title: section.title, sectionId: section.id, path: section.path, score, titleCoverage: hits / title.length, chars: section.chars });
        }
        for (const term of doc.terms || []) {
            const termTerms = contentTerms(term.term);
            if (!termTerms.length) continue;
            if (termTerms.every(item => query.has(item))) {
                results.push({ kind: 'term', doc: doc.name, title: term.term, sectionId: term.sectionId, chunkId: term.chunkId, definition: Boolean(term.definition), score: 0.5 + 0.5 * termTerms.length / query.size });
            } else if (term.definition && query.size <= 2 && [...query].every(item => termTerms.includes(item)) && query.has(termTerms.at(-1))) {
                // "What is a network?" should find "A computer network is ...".
                results.push({ kind: 'term', doc: doc.name, title: term.term, sectionId: term.sectionId, chunkId: term.chunkId, definition: true, score: 0.45 });
            }
        }
    }
    return results.sort((a, b) => b.score - a.score);
}

function sectionTree(index, name, sectionId) {
    const doc = index.documents.find(item => item.name === name);
    const section = doc?.sections.find(item => item.id === sectionId);
    if (!section) return [];
    const prefix = section.path.join('/');
    return doc.sections.filter(item => item.id === sectionId ||
        (section.title && item.path.length > section.path.length && item.path.slice(0, section.path.length).join('/') === prefix &&
            item.pageStart >= (section.pageStart ?? 0)));
}

// Every chunk of a section and its subsections, in document order.
function sectionChunks(index, names, sectionIds) {
    const ids = new Set();
    for (const doc of index.documents || []) {
        if (!names.includes(doc.name)) continue;
        for (const sectionId of sectionIds) for (const section of sectionTree(index, doc.name, sectionId)) ids.add(section.id);
    }
    return index.chunks.filter(chunk => names.includes(chunk.pdfName) && chunk.sectionIds?.some(id => ids.has(id)));
}

function nearDuplicate(chunk, selected) {
    const mine = new Set(terms(chunk.text));
    return selected.some(other => jaccard(mine, new Set(terms(other.text))) > 0.85);
}

function neighbors(index, chunk) {
    const siblings = index.chunks.filter(item => item.pdfName === chunk.pdfName);
    const position = siblings.findIndex(item => item.id === chunk.id);
    return [siblings[position - 1], siblings[position + 1]].filter(item => item && item.sectionId === chunk.sectionId);
}

/**
 * Hybrid ranking over the selected documents only.
 * Signals: embedding similarity, BM25, exact phrase, section-title and
 * key-term matches. Each signal is normalized within the candidate set.
 */
function search(index, { names, query, vector, topicText = '', limit = 6, budget = 7000, relaxed = false, boostSections = [], withNeighbors = true, definitional = false }) {
    const lex = lexicon(index);
    const active = new Set(names);
    const candidates = index.chunks.filter(chunk => active.has(chunk.pdfName));
    if (!candidates.length) return { passages: [], terms: [], base: [] };
    const { base, terms: queryTerms } = expandQuery(index, [topicText, query].filter(Boolean).join(' '), { relaxed });
    const topics = matchTopics(index, names, [topicText, query].join(' '));
    const topicSections = new Set([...boostSections, ...topics.filter(topic => topic.score >= 0.5 && (topic.kind !== 'section' || topic.titleCoverage >= 0.66)).map(topic => topic.sectionId)]);
    const topicChunks = new Set(topics.filter(topic => topic.chunkId && (!definitional || topic.definition)).map(topic => topic.chunkId));

    const raw = candidates.map(chunk => ({
        chunk,
        semantic: cosine(vector, chunk.embedding),
        lexical: bm25(lex, chunk.id, queryTerms),
        phrase: phraseHit(chunk.text, query),
        topic: chunk.sectionIds?.some(id => topicSections.has(id)) ? 1 : 0,
        term: topicChunks.has(chunk.id) ? 1 : 0
    }));
    const semantics = raw.map(item => item.semantic).filter(value => value !== null);
    const low = semantics.length ? Math.min(...semantics) : 0;
    const high = semantics.length ? Math.max(...semantics) : 0;
    const lexicalHigh = Math.max(0, ...raw.map(item => item.lexical));
    const hasVector = semantics.length > 0;
    for (const item of raw) {
        const semantic = item.semantic === null || high === low ? 0 : (item.semantic - low) / (high - low);
        const lexical = lexicalHigh ? item.lexical / lexicalHigh : 0;
        item.score = (hasVector ? 0.5 * semantic + 0.32 * lexical : 0.82 * lexical) + 0.06 * item.phrase + 0.08 * item.topic + (definitional ? 0.25 : 0.04) * item.term;
    }
    raw.sort((a, b) => b.score - a.score);

    const selected = [];
    let used = 0;
    for (const item of raw) {
        if (selected.length >= limit || used + item.chunk.text.length > budget) break;
        if (!hasVector && !item.lexical && !item.topic) break;
        if (nearDuplicate(item.chunk, selected.map(entry => entry.chunk))) continue;
        selected.push(item);
        used += item.chunk.text.length;
    }
    if (withNeighbors) {
        for (const item of selected.slice(0, 2)) {
            for (const next of neighbors(index, item.chunk)) {
                if (selected.some(entry => entry.chunk.id === next.id) || used + next.text.length > budget) continue;
                selected.push({ chunk: next, score: item.score * 0.6, semantic: null, lexical: 0, neighbor: true });
                used += next.text.length;
            }
        }
    }
    return {
        passages: selected.map(item => ({ ...item.chunk, score: item.score, semanticScore: item.semantic, lexicalScore: item.lexical, neighbor: Boolean(item.neighbor) })),
        terms: queryTerms,
        base,
        topics,
        topSemantic: hasVector ? high : null
    };
}

/**
 * How well the passages cover the question. This guides the answer mode; it
 * never refuses on its own.
 */
function assess(passages, base, topics = []) {
    if (!base.length) return { strength: passages.length ? 'partial' : 'none', coverage: 0, missing: [] };
    const found = new Set();
    let best = 0;
    for (const passage of passages) {
        const present = new Set(terms(passage.text + ' ' + (passage.sectionPath || []).join(' ')));
        const hits = base.filter(term => present.has(term));
        hits.forEach(term => found.add(term));
        best = Math.max(best, hits.length / base.length);
    }
    const coverage = found.size / base.length;
    const missing = base.filter(term => !found.has(term));
    const titled = topics.some(topic => topic.score >= 0.6);
    let strength = 'none';
    if (best >= 0.75 || (coverage === 1 && passages.length)) strength = 'strong';
    else if (coverage >= 0.5 || titled) strength = 'partial';
    else if (coverage > 0) strength = 'weak';
    return { strength, coverage, missing };
}

module.exports = { cosine, lexicon, expandQuery, matchTopics, sectionChunks, search, assess, oneEdit, neighbors };
