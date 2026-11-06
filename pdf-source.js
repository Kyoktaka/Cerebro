const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const pdfParse = require('pdf-parse');
const { renderPageText } = require('./pdf-text');
const { chunkText } = require('./rag');

async function extractDocument(buffer, name, remaining) {
    const pages = [];
    const pdf = await pdfParse(new Uint8Array(buffer), { pagerender: async page => {
        const text = await renderPageText(page);
        pages[page.pageNumber - 1] = text.trim();
        return text;
    } });
    const parts = Array.from({ length: pdf.numpages }, (_, i) => pages[i] || '');
    const full = parts.join('\n\n');
    const text = full.slice(0, remaining);
    let offset = 0;
    const layout = parts.map((part, i) => {
        const start = offset;
        offset += part.length + 2;
        return { page: i + 1, start, end: Math.min(start + part.length, text.length) };
    }).filter(page => page.end > page.start);
    const truncated = full.length > text.length;
    return { name, text, layout, truncated, incomplete: truncated || parts.some(part => !part),
        digest: createHash('sha256').update(buffer).digest('hex') };
}

function documentChunks(doc) {
    const ranges = doc.layout || [{ start: 0, end: doc.text.length }];
    return ranges.flatMap(({ start, end, page }) => chunkText(doc.text.slice(start,end))
        .map(text => ({ pdfName: doc.name, page, digest: doc.digest, text })));
}

// Store offsets separately so older text-only conversations still work and marker-like PDF text is safe.
function packDocuments(documents) {
    let content = '';
    const meta = documents.map(({ text, ...doc }) => {
        content += '\n\n--- ' + doc.name + ' ---\n\n';
        const start = content.length;
        content += text;
        return { ...doc, start, end: content.length };
    });
    return { content, meta };
}

function originalDir(user, conversationId) {
    const hash = createHash('sha256').update(JSON.stringify([user.id, conversationId])).digest('hex');
    return path.join(__dirname, 'uploads', 'originals', hash);
}

function saveOriginals(user, conversationId, files, documents) {
    const dir = originalDir(user, conversationId);
    fs.mkdirSync(dir, { recursive: true });
    documents.forEach((doc, i) => fs.copyFileSync(files[i].path, path.join(dir, doc.digest)));
}

module.exports = { extractDocument, documentChunks, packDocuments, originalDir, saveOriginals };
