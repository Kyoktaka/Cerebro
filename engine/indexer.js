const { analyzeDocument } = require('./structure');

const INDEX_VERSION = 3;

// Several embedding models were trained with task prefixes. Without them,
// queries and passages land in less comparable parts of the vector space.
function embeddingPrefixes(model) {
    const name = String(model || '').toLowerCase();
    if (name.includes('nomic-embed')) return { document: 'search_document: ', query: 'search_query: ' };
    if (/mxbai-embed|bge-|snowflake-arctic-embed/.test(name)) {
        return { document: '', query: 'Represent this sentence for searching relevant passages: ' };
    }
    return { document: '', query: '' };
}

function embeddingText(chunk, prefix) {
    const context = [chunk.pdfName.replace(/\.pdf$/i, ''), ...(chunk.sectionPath || [])].join(' — ');
    return prefix + context + '\n' + chunk.text;
}

function indexCovers(index, names, meta, model) {
    return index?.version === INDEX_VERSION && index.embeddingModel === model &&
        Array.isArray(index.chunks) && Array.isArray(index.documents) &&
        names.every(name => {
            const doc = index.documents.find(item => item.name === name);
            const source = meta?.find(item => item.name === name);
            return doc && (doc.digest || null) === (source?.digest || null) && (doc.extraction || 1) === (source?.version || 1);
        }) &&
        index.documents.every(doc => names.includes(doc.name));
}

// Reuses embeddings for unchanged documents, so adding one PDF does not
// re-embed the rest of the conversation.
async function buildIndex(documents, { embed, model, previous } = {}) {
    const prefixes = embeddingPrefixes(model);
    const reusable = previous?.version === INDEX_VERSION && previous.embeddingModel === model ? previous : null;
    const analyses = [];
    const chunks = [];
    const pending = [];
    for (const doc of documents) {
        const kept = reusable?.documents.find(item => item.name === doc.name && (item.digest || null) === (doc.digest || null) &&
            (item.extraction || 1) === (doc.version || 1));
        if (kept) {
            analyses.push(kept);
            chunks.push(...reusable.chunks.filter(chunk => chunk.pdfName === doc.name));
            continue;
        }
        const { chunks: docChunks, ...analysis } = analyzeDocument(doc);
        analyses.push({ ...analysis, extraction: doc.version || 1 });
        chunks.push(...docChunks);
        pending.push(...docChunks);
    }
    if (pending.length) {
        const vectors = await embed(pending.map(chunk => embeddingText(chunk, prefixes.document)), model);
        pending.forEach((chunk, i) => { chunk.embedding = vectors[i]; });
    }
    const summaries = {};
    for (const [key, value] of Object.entries(reusable?.summaries || {})) {
        if (analyses.some(doc => key.startsWith((doc.digest || doc.name) + '|'))) summaries[key] = value;
    }
    return { version: INDEX_VERSION, embeddingModel: model, documents: analyses, chunks, summaries };
}

function dropDocument(index, name) {
    return {
        ...index,
        documents: index.documents.filter(doc => doc.name !== name),
        chunks: index.chunks.filter(chunk => chunk.pdfName !== name)
    };
}

module.exports = { INDEX_VERSION, embeddingPrefixes, embeddingText, indexCovers, buildIndex, dropDocument };
