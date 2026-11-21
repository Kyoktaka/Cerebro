const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { extractDocument, EXTRACTION_VERSION } = require('./pdf');

<<<<<<< HEAD
// CEREBRO_DATA_DIR moves all stored data (tests point it at a temp folder).
const ROOT = process.env.CEREBRO_DATA_DIR ? path.resolve(process.env.CEREBRO_DATA_DIR) : path.join(__dirname, '..');
=======
const ROOT = path.join(__dirname, '..');
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d

// Text lives in one string with per-document offsets, so marker-like text
// inside a PDF cannot split documents and older conversations still load.
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

function parsePdfContent(content, names, meta) {
    if (Array.isArray(meta) && names.every(name => meta.some(doc => doc.name === name))) {
        return meta.filter(doc => names.includes(doc.name)).map(doc => ({ ...doc, text: content.slice(doc.start, doc.end) }));
    }
    let cursor = 0;
    const documents = [];
    for (let i = 0; i < names.length; i++) {
        const marker = `\n\n--- ${names[i]} ---\n\n`;
        const start = content.indexOf(marker, cursor);
        if (start === -1) continue;
        const textStart = start + marker.length;
        const nextMarker = i + 1 < names.length ? `\n\n--- ${names[i + 1]} ---\n\n` : null;
        const end = nextMarker ? content.indexOf(nextMarker, textStart) : -1;
        documents.push({ name: names[i], text: content.slice(textStart, end === -1 ? undefined : end) });
        cursor = end === -1 ? content.length : end;
    }
    return documents;
}

function originalDir(user, conversationId) {
    const hash = createHash('sha256').update(JSON.stringify([user.id, conversationId])).digest('hex');
    return path.join(ROOT, 'uploads', 'originals', hash);
}

function saveOriginals(user, conversationId, files, documents) {
    const dir = originalDir(user, conversationId);
    fs.mkdirSync(dir, { recursive: true });
    documents.forEach((doc, i) => fs.copyFileSync(files[i].path, path.join(dir, doc.digest)));
}

// Older uploads were extracted line by line without page structure. When the
// original PDF is still stored, extract it again with the current reader.
async function upgradeDocuments(user, conversationId, documents, maxChars) {
    if (!documents.some(doc => (doc.version || 1) < EXTRACTION_VERSION && doc.digest)) return null;
    const dir = originalDir(user, conversationId);
    let budget = maxChars;
    const upgraded = [];
    let changed = false;
    for (const doc of documents) {
        const file = doc.digest && path.join(dir, doc.digest);
        if ((doc.version || 1) >= EXTRACTION_VERSION || !file || !fs.existsSync(file)) {
            upgraded.push(doc);
            budget -= doc.text.length;
            continue;
        }
        const fresh = await extractDocument(await fs.promises.readFile(file), doc.name, Math.max(0, budget));
        if (!fresh.text.trim() || fresh.digest !== doc.digest) {
            upgraded.push(doc);
            budget -= doc.text.length;
            continue;
        }
        upgraded.push(fresh);
        budget -= fresh.text.length;
        changed = true;
    }
    return changed ? upgraded : null;
}

module.exports = { packDocuments, parsePdfContent, originalDir, saveOriginals, upgradeDocuments };
