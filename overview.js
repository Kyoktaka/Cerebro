// Document-wide requests should sample across the selected PDFs, not search for
// literal prompt words such as "main concepts" inside a single sentence.
function isDocumentOverview(request) {
    const query = String(request || '').trim().toLowerCase();
    if (!query) return false;
    const broad = /\b(summar(?:ize|ise|y|ise)|overview|main concepts|key concepts|main ideas|key ideas|key points|main topics|important concepts|what (?:is|are) (?:in|inside) (?:the|this|these) (?:pdf|document|documents|files?))\b/i.test(query);
    if (!broad) return false;
    // A question targeting one chapter, page, person or a subject remains a
    // targeted retrieval request, even when it starts with "summarize".
    if (/\b(?:page\s+\d+|chapter\s+\d+|section\s+\d+)\b/i.test(query)) return false;
    if (/^\s*(?:summari[sz]e|explain|give (?:me )?an? overview of)\s+(?:how|why|what|when|where)\b/i.test(query)) return false;
    return true;
}

function selectedOverviewChunks(chunks, names, maxPerDocument = 8) {
    const result = [];
    for (const name of names) {
        const candidates = chunks.filter(chunk => chunk.pdfName === name && chunk.text?.trim());
        // Pick at most one passage per page for a document-wide overview.
        const byPage = new Map();
        for (const chunk of candidates) {
            const page = chunk.page || 1;
            if (!byPage.has(page) || chunk.text.trim().length > byPage.get(page).text.trim().length) {
                byPage.set(page, chunk);
            }
        }
        const pages = [...byPage.entries()].sort((a, b) => a[0] - b[0])
            .map(([, chunk]) => chunk)
            .filter(chunk => chunk.text.trim().length >= 65);
        const pool = pages.length ? pages : candidates.slice(0, 1);
        const count = Math.min(maxPerDocument, pool.length);
        if (count === 1) {
            result.push(pool[0]);
        } else if (count > 1) {
            const picked = new Set();
            for (let i = 0; i < count; i++) {
                picked.add(Math.round(i * (pool.length - 1) / (count - 1)));
            }
            for (const index of picked) result.push(pool[index]);
        }
    }
    return result;
}

function sourceOverview(chunks, names) {
    if (!chunks.length) return null;
    const lines = [];
    for (const name of names) {
        const pages = chunks.filter(chunk => chunk.pdfName === name);
        if (!pages.length) continue;
        lines.push('**' + name.replace(/[*_[\]<>]/g, '') + '**');
        for (const chunk of pages) {
            // Only quote literal text from the selected PDF, never generated claims.
            const text = chunk.text.replace(/\s+/g, ' ').trim();
            if (!text) continue;
            const cut = text.slice(0, 240);
            const excerpt = cut.length < text.length ? cut.replace(/\s+\S*$/, '') + '…' : cut;
            const label = chunk.pdfName + (chunk.page ? ', p. ' + chunk.page : '');
            const citation = chunk.digest && chunk.page
                ? '[' + label + '](cerebro:' + chunk.digest + ':' + chunk.page + ')'
                : label;
            lines.push('- ' + excerpt.replace(/[<>]/g, '') + ' ' + citation);
        }
        lines.push('');
    }
    if (!lines.length) return null;
    return 'I could not verify a complete AI summary. Here are excerpts from the selected PDFs, sampled across their pages. Check the cited pages for context.\n\n' +
        lines.join('\n').trim();
}

module.exports = { isDocumentOverview, selectedOverviewChunks, sourceOverview };