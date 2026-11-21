require('dotenv').config();

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const {
    OLLAMA_MODEL,
    OLLAMA_EMBED_MODEL,
    OllamaError,
    modelMatches,
    listModels,
    modelCapabilities,
    modelsWithCapability,
    requireCapability,
    installedModel,
    embedTexts
} = require('./local-ai');
const { documentAnswer } = require('./document-answers');
<<<<<<< HEAD
const { createSessionStore } = require('./sessions');
const { hashPassword, checkPassword, createThrottle } = require('./passwords');
=======
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d
const { extractDocument } = require('./engine/pdf');
const { packDocuments, parsePdfContent, originalDir, saveOriginals, upgradeDocuments } = require('./engine/documents');
const { buildIndex, indexCovers, dropDocument, embeddingPrefixes } = require('./engine/indexer');
const { analyzeDocument } = require('./engine/structure');
const { resolveDocumentScope } = require('./engine/scope');
const { respond, classify } = require('./engine');
const { createModel } = require('./engine/llm');
const { advancePractice } = require('./engine/study');
const { historyFor } = require('./engine/answer');

const app = express();
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/vendor/fontawesome', express.static(path.join(__dirname, 'node_modules', '@fortawesome', 'fontawesome-free')));
app.use(express.static(path.join(__dirname, 'public')));

const dataDir = process.env.CEREBRO_DATA_DIR ? path.resolve(process.env.CEREBRO_DATA_DIR) : __dirname;
const usersDir = path.join(dataDir, 'users');
const uploadsDir = path.join(dataDir, 'uploads');
const indexesDir = path.join(dataDir, 'indexes');
for (const dir of [usersDir, uploadsDir, indexesDir]) fs.mkdirSync(dir, { recursive: true });

<<<<<<< HEAD
const MAX_PDFS_PER_CONVERSATION = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_CHARS = 1000000;
const MAX_MESSAGE_CHARS = 4000;
=======
const userSessions = new Map();
const MAX_PDFS_PER_CONVERSATION = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_CHARS = 1000000;
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d

function getUserFilePath(lastName) {
    return path.join(usersDir, `${lastName.replace(/[^a-zA-Z0-9.]/g, '')}.json`);
}

function loadUser(lastName) {
    if (typeof lastName !== 'string') return null;
    const filePath = getUserFilePath(lastName);
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('User file error:', filePath, error.message);
        return null;
    }
}

// Write to a temp file and rename, so a crash mid-write never leaves a
// half-written account file behind.
function saveUser(user) {
    const filePath = getUserFilePath(user.lastName);
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(user, null, 2));
    fs.renameSync(tempPath, filePath);
}

const sessions = createSessionStore(path.join(dataDir, 'sessions'), loadUser);

function getAllUsers() {
    const users = [];
    const files = fs.readdirSync(usersDir);
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
            users.push(JSON.parse(fs.readFileSync(path.join(usersDir, file), 'utf8')));
        } catch (error) {
            console.error('User file error:', file, error.message);
        }
    }
    return users;
}

function getIndexPath(user, conversationId) {
    if (!user || !conversationId) return null;
    const userId = String(user.id).replace(/[^a-zA-Z0-9_-]/g, '');
    const id = String(conversationId).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!userId || !id) return null;
    return path.join(indexesDir, `${userId}-${id}.json`);
}

// Parsed indexes are cached by path and modification time: an index with
// embeddings can be many megabytes, and its keyword statistics are cached on
// the object itself, so re-reading it on every message is wasted work.
const indexCache = new Map();
const INDEX_CACHE_SIZE = 12;

function remember(filePath, mtimeMs, index) {
    indexCache.delete(filePath);
    indexCache.set(filePath, { mtimeMs, index });
    if (indexCache.size > INDEX_CACHE_SIZE) indexCache.delete(indexCache.keys().next().value);
}

function loadIndex(user, conversationId) {
    const filePath = getIndexPath(user, conversationId);
    if (!filePath) return null;
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch {
        indexCache.delete(filePath);
        return null;
    }
    const cached = indexCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.index;
    try {
        const index = JSON.parse(fs.readFileSync(filePath, 'utf8'));
<<<<<<< HEAD
        if (!Array.isArray(index.chunks)) return null;
        remember(filePath, stat.mtimeMs, index);
        return index;
=======
        return Array.isArray(index.chunks) ? index : null;
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d
    } catch (error) {
        console.error('PDF index load error:', error);
        return null;
    }
}

function saveIndex(user, conversationId, index) {
    const filePath = getIndexPath(user, conversationId);
    if (!filePath) return;
    const tempPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(index));
    fs.renameSync(tempPath, filePath);
    remember(filePath, fs.statSync(filePath).mtimeMs, index);
}

function deleteIndex(user, conversationId) {
    const filePath = getIndexPath(user, conversationId);
<<<<<<< HEAD
    if (!filePath) return;
    indexCache.delete(filePath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
=======
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d
}

function setSessionConversation(session, conversation, conversationId) {
    session.pdfMeta = conversation?.pdfMeta;
    session.currentConversationId = conversationId;
    session.pdfContent = conversation?.pdfContent || '';
    session.pdfNames = conversation?.pdfNames || [];
    session.activePdfNames = conversation?.activePdfNames || [...session.pdfNames];
    session.uploadedPDFs = [...session.pdfNames];
    session.pdfIndex = loadIndex(session.user, conversationId);
}

function syncRequestedConversation(session, conversationId) {
    if (!conversationId) return true;
    const user = session.user && loadUser(session.user.lastName);
    const conversation = user?.conversations?.find(item => item.id === conversationId);
    if (!conversation) return false;
    setSessionConversation(session, conversation, conversationId);
    return true;
}

async function ensurePdfIndex(session, conversationId, models) {
    const storedIndex = session.pdfIndex || loadIndex(session.user, conversationId);
    if (indexCovers(storedIndex, session.pdfNames, session.pdfMeta, OLLAMA_EMBED_MODEL)) {
        session.pdfIndex = storedIndex;
        return storedIndex;
    }
    installedModel(models, OLLAMA_EMBED_MODEL);
    const documents = parsePdfContent(session.pdfContent, session.pdfNames, session.pdfMeta);
    const index = await buildIndex(documents, { embed: embedTexts, model: OLLAMA_EMBED_MODEL, previous: storedIndex });
    if (conversationId) {
        const current = loadUser(session.user.lastName)?.conversations?.find(item => item.id === conversationId);
        if (!current || current.pdfContent !== session.pdfContent || JSON.stringify(current.pdfMeta) !== JSON.stringify(session.pdfMeta))
            throw new OllamaError('PDFs changed during indexing. Please retry.', 409);
        saveIndex(session.user, conversationId, index);
    }
    session.pdfIndex = index;
    return index;
}

// Conversations uploaded before the structured PDF reader are re-read from
// their stored originals once, so old chats get headings and clean paragraphs.
async function upgradeConversation(session, conversationId) {
    if (!conversationId || !session.pdfNames.length) return false;
    const documents = parsePdfContent(session.pdfContent, session.pdfNames, session.pdfMeta);
    const upgraded = await upgradeDocuments(session.user, conversationId, documents, MAX_TOTAL_CHARS);
    if (!upgraded) return false;
    const { content, meta } = packDocuments(upgraded);
    const user = loadUser(session.user.lastName);
    const conversation = user?.conversations?.find(item => item.id === conversationId);
    if (!conversation || conversation.pdfContent !== session.pdfContent) return false;
    conversation.pdfContent = content;
    conversation.pdfMeta = meta;
    saveUser(user);
    setSessionConversation(session, conversation, conversationId);
    return true;
}

const analysisCache = new Map();

function documentOutline(doc, index) {
    const indexed = index?.documents?.find(item => item.name === doc.name && (item.digest || null) === (doc.digest || null));
    const key = (doc.digest || doc.name) + ':' + (doc.version || 1);
    let analysis = indexed || analysisCache.get(key);
    if (!analysis) {
        const { chunks: _chunks, ...rest } = analyzeDocument(doc);
        analysis = rest;
        analysisCache.set(key, analysis);
        if (analysisCache.size > 200) analysisCache.delete(analysisCache.keys().next().value);
    }
    return {
        name: doc.name,
        digest: doc.digest || null,
        pageCount: doc.pageCount || analysis.pageCount || null,
        readablePages: doc.readablePages ?? analysis.readablePages ?? null,
        imagePages: doc.imagePages || analysis.imagePages || [],
        truncated: Boolean(doc.truncated),
        sections: analysis.sections.filter(section => section.title).map(section => ({
            id: section.id, title: section.title, level: Math.min(section.path.length, 3), page: section.pageStart ?? null, pageEnd: section.pageEnd ?? null
        })),
        terms: analysis.terms.slice(0, 16).map(term => term.term)
    };
}

function errorStatus(error) {
    return error instanceof OllamaError ? error.status : 500;
}

function errorMessage(error) {
    return error instanceof OllamaError ? error.message : 'Internal server error.';
}

app.get('/api/models', async (req, res) => {
    try {
        const models = await listModels();
        const chatModels = await modelsWithCapability(models, 'completion');
        const embeddingModel = models.find(item => modelMatches(OLLAMA_EMBED_MODEL, item.name));
        let embeddingAvailable = false;
        if (embeddingModel) {
            try {
                embeddingAvailable = (await modelCapabilities(embeddingModel.name)).includes('embedding');
            } catch (error) {
                console.warn('Embedding model check failed:', errorMessage(error));
            }
        }
        const configured = chatModels.find(item => modelMatches(OLLAMA_MODEL, item.name));
        const error = chatModels.length ? undefined : `No chat model installed. Run: ollama pull ${OLLAMA_MODEL}`;
        res.json({
            available: chatModels.length > 0,
            models: chatModels,
            defaultModel: configured?.name || chatModels[0]?.name || OLLAMA_MODEL,
            embeddingModel: OLLAMA_EMBED_MODEL,
            embeddingAvailable,
            ...(error ? { error } : {})
        });
    } catch (error) {
        res.json({
            available: false,
            models: [],
            defaultModel: OLLAMA_MODEL,
            embeddingModel: OLLAMA_EMBED_MODEL,
            embeddingAvailable: false,
            error: errorMessage(error)
        });
    }
});

// AUTH ENDPOINTS
const signInThrottle = createThrottle();
const text = value => (typeof value === 'string' ? value.trim() : '');
const usernameKey = name => name.replace(/[^a-zA-Z0-9.]/g, '').toLowerCase();

app.post('/api/auth/register', (req, res) => {
    const firstName = text(req.body.firstName);
    const lastName = text(req.body.lastName);
    const email = text(req.body.email).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!firstName || !lastName || !email || !password) {
        return res.status(400).json({ error: 'Fill in every field.' });
    }
    if (!usernameKey(lastName)) {
        return res.status(400).json({ error: 'Your last name needs at least one letter or number.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Use at least 6 characters for your password.' });
    }
    if (loadUser(lastName)) {
        return res.status(400).json({ error: 'Username already exists. Try adding your middle initial (e.g., ' + lastName + 'J)' });
    }
    if (getAllUsers().some(user => String(user.email || '').toLowerCase() === email)) {
        return res.status(400).json({ error: 'Email already registered. Please use a different email.' });
    }

    const user = {
        id: Date.now().toString(),
        firstName,
        lastName,
        email,
        password: hashPassword(password),
        createdAt: new Date().toISOString(),
        conversations: []
    };

    try {
        saveUser(user);
        res.json({ success: true });
    } catch (error) {
        console.error('Save user error:', error);
        res.status(500).json({ error: 'Failed to save user data' });
    }
});

app.post('/api/auth/login', (req, res) => {
    const username = text(req.body.username);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const key = usernameKey(username);
    if (!key || !password) return res.status(401).json({ error: 'Invalid credentials' });
    if (signInThrottle.blocked(key)) {
        return res.status(429).json({ error: 'Too many attempts. Wait 10 minutes and try again.' });
    }
    const user = loadUser(username);
    const check = user && user.lastName === username ? checkPassword(user.password, password) : { ok: false };
    if (!check.ok) {
        signInThrottle.miss(key);
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    signInThrottle.clear(key);
    if (check.legacy) {
        user.password = hashPassword(password);
        saveUser(user);
    }

    const sessionId = sessions.create(user);

    res.json({
        success: true,
        sessionId,
        user: { firstName: user.firstName, lastName: user.lastName, email: user.email }
    });
});

// Offline there is no email to send a reset link to, so the account's email
// address is the proof. The old password is never shown.
app.post('/api/auth/reset-password', (req, res) => {
    const username = text(req.body.username);
    const email = text(req.body.email).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const key = usernameKey(username);
    if (!key || !email) return res.status(400).json({ error: 'Enter your username and the email on your account.' });
    if (password.length < 6) return res.status(400).json({ error: 'Use at least 6 characters for your new password.' });
    if (signInThrottle.blocked(key)) {
        return res.status(429).json({ error: 'Too many attempts. Wait 10 minutes and try again.' });
    }
    const user = loadUser(username);
    if (!user || user.lastName !== username || String(user.email || '').toLowerCase() !== email) {
        signInThrottle.miss(key);
        return res.status(400).json({ error: "That username and email don't match an account." });
    }
    signInThrottle.clear(key);
    user.password = hashPassword(password);
    saveUser(user);
    sessions.removeUser(user.lastName);
    res.json({ success: true });
});

app.post('/api/auth/logout', (req, res) => {
    sessions.remove(req.body.sessionId);
    res.json({ success: true });
});

app.post('/api/auth/delete-account', (req, res) => {
    const session = sessions.get(req.body.sessionId);
    if (session && session.user) {
        const user = loadUser(session.user.lastName);
        for (const conversation of user?.conversations || []) {
            deleteIndex(session.user, conversation.id);
            fs.rmSync(originalDir(session.user, conversation.id), { recursive: true, force: true });
        }
        const filePath = getUserFilePath(session.user.lastName);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        sessions.removeUser(session.user.lastName);
    }
    res.json({ success: true });
});

// CONVERSATION MANAGEMENT
app.get('/api/conversations/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session || !session.user) {
        return res.json({ conversations: [] });
    }

    const user = loadUser(session.user.lastName);
    const conversations = user?.conversations || [];

    res.json({ conversations: conversations.map(({ practice, ...conversation }) => conversation).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)) });
});

app.post('/api/conversations/create', (req, res) => {
    const session = sessions.get(req.body.sessionId);
    if (!session || !session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = loadUser(session.user.lastName);
    const newConversation = {
        id: Date.now().toString(),
        title: 'New Conversation',
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    user.conversations = user.conversations || [];
    user.conversations.push(newConversation);
    saveUser(user);

    session.pdfMeta = [];
    session.pdfContent = '';
    session.pdfNames = [];
    session.activePdfNames = [];
    session.uploadedPDFs = [];
    session.pdfIndex = null;
    session.currentConversationId = newConversation.id;

    res.json({ success: true, conversationId: newConversation.id });
});

app.post('/api/conversations/:sessionId/clear-pdfs', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(401).json({ error: 'Session not found' });
    const convId = req.body.conversationId;
    if (!syncRequestedConversation(session, convId)) {
        return res.status(404).json({ error: 'Conversation not found.' });
    }
    session.pdfMeta = [];
    session.pdfContent = '';
    session.pdfNames = [];
    session.activePdfNames = [];
    session.uploadedPDFs = [];
    session.pdfIndex = null;

    deleteIndex(session.user, convId);
    if (convId) fs.rmSync(originalDir(session.user, convId), { recursive: true, force: true });
    if (convId && session.user) {
        const user = loadUser(session.user.lastName);
        const conversation = user.conversations?.find(c => c.id === convId);
        if (conversation) {
            delete conversation.practice;
            delete conversation.context;
            delete conversation.pdfMeta;
            delete conversation.pdfContent;
            delete conversation.pdfNames;
            delete conversation.activePdfNames;
            saveUser(user);
        }
    }
    res.json({ success: true });
});

app.post('/api/conversations/:sessionId/focus-pdf', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(401).json({ error: 'Session not found' });

    const { conversationId, pdfNames: namesToKeep } = req.body;
    if (!syncRequestedConversation(session, conversationId)) {
        return res.status(404).json({ error: 'Conversation not found.' });
    }
    if (!Array.isArray(namesToKeep) || !namesToKeep.length ||
        namesToKeep.some(name => !session.pdfNames.includes(name))) {
        return res.status(400).json({ error: 'Select at least one uploaded PDF.' });
    }
    const activePdfNames = [...new Set(namesToKeep)];
    session.activePdfNames = activePdfNames;

    if (conversationId && session.user) {
        try {
            const user = loadUser(session.user.lastName);
            const conversation = user.conversations?.find(c => c.id === conversationId);
            if (conversation) {
                if (JSON.stringify(conversation.activePdfNames) !== JSON.stringify(activePdfNames)) {
                    delete conversation.practice;
                    delete conversation.context;
                }
                conversation.activePdfNames = activePdfNames;
                saveUser(user);
            }
        } catch (e) { console.error('Focus PDF disk save error:', e); }
    }

    res.json({ success: true, pdfNames: session.pdfNames, activePdfNames, pdfCount: session.pdfNames.length });
});

app.post('/api/conversations/:sessionId/delete-pdf', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(401).json({ error: 'Session not found' });

    const { conversationId, pdfName } = req.body;
    if (!syncRequestedConversation(session, conversationId)) {
        return res.status(404).json({ error: 'Conversation not found.' });
    }
    if (!pdfName) return res.status(400).json({ error: 'pdfName required' });

    if (!session.pdfNames.includes(pdfName)) return res.status(404).json({ error: 'PDF not found.' });

    const updatedNames = (session.pdfNames || []).filter(n => n !== pdfName);
    const remainingDocuments = parsePdfContent(session.pdfContent, session.pdfNames, session.pdfMeta)
        .filter(document => document.name !== pdfName);
    const { content: allContent, meta } = packDocuments(remainingDocuments);
    const removed = session.pdfMeta?.find(doc => doc.name === pdfName);
    session.pdfMeta = meta;
    session.pdfContent = allContent;
    session.pdfNames = updatedNames;
    session.activePdfNames = (session.activePdfNames || []).filter(n => n !== pdfName);
    if (!session.activePdfNames.length) session.activePdfNames = [...updatedNames];
    session.uploadedPDFs = updatedNames;
    const storedIndex = session.pdfIndex || loadIndex(session.user, conversationId);
    if (storedIndex) {
        const index = Array.isArray(storedIndex.documents) ? dropDocument(storedIndex, pdfName) : null;
        session.pdfIndex = index;
        if (index && updatedNames.length) saveIndex(session.user, conversationId, index);
        else deleteIndex(session.user, conversationId);
    }

    if (conversationId && session.user) {
        try {
            const user = loadUser(session.user.lastName);
            const conversation = user.conversations?.find(c => c.id === conversationId);
            if (conversation) {
                delete conversation.practice;
                delete conversation.context;
                conversation.pdfMeta = meta;
                if (removed?.digest && !meta.some(doc => doc.digest === removed.digest)) fs.rmSync(path.join(originalDir(session.user, conversationId), removed.digest), { force: true });
                if (updatedNames.length === 0) {
                    delete conversation.pdfContent;
                    delete conversation.pdfNames;
                    delete conversation.activePdfNames;
                } else {
                    conversation.pdfNames = updatedNames;
                    conversation.pdfContent = allContent;
                    conversation.activePdfNames = session.activePdfNames;
                }
                saveUser(user);
            }
        } catch (e) { console.error('Delete PDF disk save error:', e); }
    }

    res.json({ success: true, pdfName, remainingPDFs: updatedNames,
        activePdfNames: session.activePdfNames, pdfCount: updatedNames.length });
});

app.get('/api/conversations/:sessionId/:conversationId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session || !session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = loadUser(session.user.lastName);
    const conversation = user.conversations?.find(c => c.id === req.params.conversationId);

    if (!conversation) {
        return res.json({ messages: [] });
    }
    setSessionConversation(session, conversation, req.params.conversationId);

    res.json({
        messages: conversation.messages || [],
        pdfNames: conversation.pdfNames || [],
        activePdfNames: conversation.activePdfNames || conversation.pdfNames || [],
        pdfCount: (conversation.pdfNames || []).length,
        context: conversation.context || null
    });
});

app.get('/api/conversations/:sessionId/:conversationId/outline', async (req, res) => {
<<<<<<< HEAD
    const session = sessions.get(req.params.sessionId);
=======
    const session = userSessions.get(req.params.sessionId);
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d
    if (!session || !session.user) return res.status(401).json({ error: 'Unauthorized' });
    const conversation = loadUser(session.user.lastName)?.conversations?.find(c => c.id === req.params.conversationId);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });
    try {
        setSessionConversation(session, conversation, req.params.conversationId);
        await upgradeConversation(session, req.params.conversationId);
        const documents = parsePdfContent(session.pdfContent, session.pdfNames, session.pdfMeta);
        res.json({ documents: documents.map(doc => documentOutline(doc, session.pdfIndex)) });
    } catch (error) {
        console.error('Outline error:', error);
        res.status(500).json({ error: 'Could not read the PDF outline.' });
    }
});


app.put('/api/conversations/:sessionId/:conversationId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session || !session.user) return res.status(401).json({ error: 'Unauthorized' });

    const user = loadUser(session.user.lastName);
    const conversation = user.conversations?.find(c => c.id === req.params.conversationId);

    if (conversation && req.body.title) {
        conversation.title = req.body.title;
        conversation.updatedAt = new Date().toISOString();
        saveUser(user);
    }

    res.json({ success: true });
});

app.delete('/api/conversations/:sessionId/:conversationId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session || !session.user) return res.status(401).json({ error: 'Unauthorized' });

    const user = loadUser(session.user.lastName);
    user.conversations = user.conversations?.filter(c => c.id !== req.params.conversationId);
    saveUser(user);
    deleteIndex(session.user, req.params.conversationId);
    fs.rmSync(originalDir(session.user, req.params.conversationId), { recursive: true, force: true });
    if (session.currentConversationId === req.params.conversationId) {
        session.pdfMeta = [];
        session.pdfContent = '';
        session.pdfNames = [];
        session.activePdfNames = [];
        session.uploadedPDFs = [];
        session.pdfIndex = null;
        session.currentConversationId = null;
    }

    res.json({ success: true });
});

// PDF UPLOAD
const upload = multer({
    dest: uploadsDir,
    limits: { fileSize: MAX_FILE_SIZE, files: MAX_PDFS_PER_CONVERSATION },
    fileFilter(req, file, callback) {
        if (!file.originalname.toLowerCase().endsWith('.pdf')) {
            callback(new Error('Only PDF files are supported.'));
        } else {
            callback(null, true);
        }
    }
});
const acceptPDFs = upload.array('files');

app.post('/api/upload', (req, res, next) => {
    // Refuse before writing anything to disk when the sign-in is gone.
    const header = req.get('x-session-id');
    if (header && !sessions.get(header)) return res.status(401).json({ error: 'Session not found' });
    acceptPDFs(req, res, error => {
        if (!error) return next();
        for (const file of req.files || []) {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        }
        const message = error.code === 'LIMIT_FILE_SIZE'
            ? 'Each PDF must be 10 MB or smaller.'
            : error.code === 'LIMIT_FILE_COUNT'
                ? `You can only upload ${MAX_PDFS_PER_CONVERSATION} PDFs per conversation.`
                : error.message;
        res.status(400).json({ error: message });
    });
}, async (req, res) => {
    try {
        const session = sessions.get(req.get('x-session-id') || req.body.sessionId);
        if (!session) return res.status(401).json({ error: 'Session not found' });
        if (!req.files?.length) return res.status(400).json({ error: 'Choose at least one PDF.' });

        const conversationId = req.body.conversationId;
        let user = null;
        let conversation = null;
        if (conversationId && session.user) {
            user = loadUser(session.user.lastName);
            conversation = user?.conversations?.find(c => c.id === conversationId);
            if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });
            setSessionConversation(session, conversation, conversationId);
        }
        const state = {
            pdfContent: session.pdfContent,
            pdfMeta: session.pdfMeta,
            pdfNames: [...session.pdfNames],
            activePdfNames: [...(session.activePdfNames || [])],
            pdfIndex: session.pdfIndex,
            currentConversationId: session.currentConversationId
        };

        if (req.files.some(file => file.size > MAX_FILE_SIZE)) {
            return res.status(400).json({ error: 'Each PDF must be 10 MB or smaller.' });
        }
        if (state.pdfNames.length + req.files.length > MAX_PDFS_PER_CONVERSATION) {
            return res.status(400).json({ error: `You can only upload ${MAX_PDFS_PER_CONVERSATION} PDFs per conversation.` });
        }
        const incomingNames = req.files.map(file => file.originalname);
        if (new Set([...state.pdfNames, ...incomingNames]).size !== state.pdfNames.length + incomingNames.length) {
            return res.status(400).json({ error: 'PDF names must be unique within a conversation.' });
        }

        const existingDocuments = parsePdfContent(state.pdfContent || '', state.pdfNames, state.pdfMeta);
        let totalChars = existingDocuments.reduce((sum, document) => sum + document.text.length, 0);
        const newDocuments = [];
        let truncated = false;

        for (const file of req.files) {
            const dataBuffer = await fs.promises.readFile(file.path);
            if (dataBuffer.subarray(0, 5).toString() !== '%PDF-') {
                return res.status(400).json({ error: `File ${file.originalname} is not a PDF.` });
            }
            const remaining = MAX_TOTAL_CHARS - totalChars;
            if (remaining <= 0) return res.status(400).json({ error: 'Conversation text limit reached.' });
            const doc = await extractDocument(dataBuffer, file.originalname, remaining);
            if (!doc.text.trim()) return res.status(400).json({ error: `File ${file.originalname} contains no readable text within the remaining limit. Try a text-based PDF or OCR.` });
            if (!conversationId) delete doc.digest;
            truncated ||= doc.truncated;
            newDocuments.push(doc);
            totalChars += doc.text.length;
        }

        const models = await listModels();
        const embeddingModel = installedModel(models, OLLAMA_EMBED_MODEL);
        await requireCapability(embeddingModel, 'embedding');
        const storedIndex = state.pdfIndex || loadIndex(session.user, conversationId);
        const documents = [...existingDocuments, ...newDocuments];
        const index = await buildIndex(documents, { embed: embedTexts, model: OLLAMA_EMBED_MODEL, previous: storedIndex });
        const { content: allText, meta } = packDocuments(documents);
        const fileNames = documents.map(document => document.name);
        let activePdfNames = [...new Set([...state.activePdfNames, ...incomingNames])];

        if (conversation) {
            const latestUser = loadUser(session.user.lastName);
            const latestConversation = latestUser?.conversations?.find(item => item.id === conversationId);
            if (!latestConversation || (latestConversation.pdfContent || '') !== state.pdfContent) {
                throw new OllamaError('Conversation changed during upload. Please retry.', 409);
            }
            activePdfNames = [...new Set([
                ...(latestConversation.activePdfNames || latestConversation.pdfNames || []),
                ...incomingNames
            ])];
            saveOriginals(session.user, conversationId, req.files, newDocuments);
            latestConversation.pdfMeta = meta;
            delete latestConversation.practice;
            latestConversation.pdfNames = fileNames;
            latestConversation.activePdfNames = activePdfNames;
            latestConversation.pdfContent = allText;
            saveUser(latestUser);
            saveIndex(session.user, conversationId, index);
        } else if (session.currentConversationId !== state.currentConversationId ||
            session.pdfContent !== state.pdfContent) {
            throw new OllamaError('Conversation changed during upload. Please retry.', 409);
        } else {
            activePdfNames = [...new Set([...(session.activePdfNames || []), ...incomingNames])];
        }
        if (session.currentConversationId === state.currentConversationId && session.pdfContent === state.pdfContent) {
            session.pdfMeta = meta;
            session.pdfContent = allText;
            session.pdfNames = fileNames;
            session.activePdfNames = activePdfNames;
            session.uploadedPDFs = [...fileNames];
            session.pdfIndex = index;
        }

        res.json({
            success: true,
            pdfNames: fileNames,
            activePdfNames,
            charCount: totalChars,
            pdfCount: fileNames.length,
            maxPDFs: MAX_PDFS_PER_CONVERSATION,
            truncated: truncated,
            extractedPages: newDocuments.map(doc => ({ name: doc.name, pages: doc.pageCount, readablePages: doc.readablePages, imagePages: doc.imagePages }))
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(errorStatus(error)).json({ error: error instanceof OllamaError ? error.message : 'Failed to process PDF.' });
    } finally {
        for (const file of req.files || []) {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        }
    }
});

app.post('/api/source', (req, res) => {
    const { sessionId, conversationId, digest } = req.body;
    const session = sessions.get(sessionId);
    if (!session) return res.status(401).end();
    const conversation = loadUser(session.user.lastName)?.conversations?.find(c => c.id === conversationId);
    const selected = conversation?.activePdfNames || conversation?.pdfNames || [];
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest) || !conversation?.pdfMeta?.some(doc => doc.digest === digest && selected.includes(doc.name))) return res.status(404).end();
    res.set('Cache-Control','no-store').type('application/pdf').sendFile(path.join(originalDir(session.user, conversationId), digest));
});

function saveChatMessage(session, conversationId, message, answer, update) {
    if (!conversationId || !session.user) {
        if (update && 'context' in update) session.chatContext = update.context;
        return;
    }
    const user = loadUser(session.user.lastName);
    const conversation = user?.conversations?.find(c => c.id === conversationId);
    if (!conversation) throw new OllamaError('Conversation was deleted.', 409);
    if (update) {
        if (conversation.pdfContent !== update.content || JSON.stringify(conversation.activePdfNames || conversation.pdfNames) !== JSON.stringify(update.names) ||
            conversation.messages?.length !== update.turn) throw new OllamaError('Conversation changed. Please retry.', 409);
        if (update.practice) conversation.practice = update.practice;
        else delete conversation.practice;
        if ('context' in update) {
            if (update.context) conversation.context = update.context;
            else delete conversation.context;
        }
    }
    conversation.messages = conversation.messages || [];
    conversation.messages.push({ role: 'user', content: message, timestamp: new Date().toISOString() });
    conversation.messages.push({ role: 'assistant', content: answer, topic: update?.topic, scope: update?.scope, timestamp: new Date().toISOString() });
    conversation.updatedAt = new Date().toISOString();
    if (conversation.messages.length === 2 && conversation.title === 'New Conversation') {
        conversation.title = message.substring(0, 40) + (message.length > 40 ? '...' : '');
    }
    saveUser(user);
}

// NDJSON stream: status and draft events while the local model works, then
// the verified answer as one delta and a done event. Clients that only know
// delta/done/error keep working.
function responder(res, stream) {
    let started = false;
    const write = event => {
        if (!stream || res.destroyed) return;
        if (!started) {
            res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.flushHeaders?.();
            started = true;
        }
        res.write(`${JSON.stringify(event)}\n`);
    };
    return {
        status: status => write({ type: 'status', stage: status.stage, detail: status.detail }),
        draft: delta => write(delta === null ? { type: 'draft', reset: true } : { type: 'draft', content: delta }),
        done(answer, mode, extra = {}) {
            if (!stream) return res.json({ answer, mode, ...extra });
            write({ type: 'delta', content: answer });
            return res.end(`${JSON.stringify({ type: 'done', answer, mode, ...extra })}\n`);
        }
    };
}

// While a practice quiz is open, short replies are answers. A real question
// ends the practice instead of being graded.
function isPracticeReply(practice, text) {
    if (/^(?:\(?[A-D]\)?[.)]?|hint|help|skip|pass|next|stop|end|cancel|quit|idk|i don'?t know)(?:\s+quiz)?[.!?]?$/i.test(text.trim())) return true;
    const item = practice.items?.[practice.index];
    if (!item) return false;
    if (item.choices?.length) {
        return item.choices.some(choice => choice.toLowerCase() === text.trim().toLowerCase()) ||
            (!text.includes('?') && text.trim().split(/\s+/).length <= 4);
    }
    return !text.includes('?') && text.trim().split(/\s+/).length <= 12 && !['quiz', 'flashcards', 'summary', 'study-guide'].includes(classify(text).intent);
}

function publicMeta(meta = {}) {
    const { evidence, report, passages: _passages, rejected: _rejected, ...rest } = meta;
    return {
        ...rest,
        ...(evidence ? { evidence: { strength: evidence.strength, coverage: Number(evidence.coverage?.toFixed?.(2) ?? evidence.coverage) } } : {}),
        ...(report ? { checks: { cited: report.cited, supported: report.supported, removed: report.removed } } : {})
    };
}

app.post('/api/chat', async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
        const { message, sessionId, conversationId, stream, sourceMode, topicReset } = req.body;
        if (typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: 'Enter a message.' });
        }
        if (message.length > MAX_MESSAGE_CHARS) {
            return res.status(400).json({ error: `Keep questions under ${MAX_MESSAGE_CHARS.toLocaleString('en')} characters. Upload long text as a PDF instead.` });
        }
        const session = sessions.get(sessionId);
        if (!session) return res.status(401).json({ error: 'Session not found' });
        let conversation = null;
        if (conversationId && session.user) {
            const user = loadUser(session.user.lastName);
            conversation = user?.conversations?.find(c => c.id === conversationId);
            if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });
            setSessionConversation(session, conversation, conversationId);
        }
        const out = responder(res, stream === true);
        const finish = (answer, mode, update, extra) => {
            saveChatMessage(session, conversationId, message, answer, update);
            return out.done(answer, mode, extra);
        };
        if (!session.pdfNames.length) {
            return finish('Upload a PDF to ask questions or create study materials.', 'normal');
        }
        const models = await listModels();
        const selectedModel = installedModel(models, req.body.model || OLLAMA_MODEL);
<<<<<<< HEAD
        const capabilities = await requireCapability(selectedModel, 'completion');
=======
        await requireCapability(selectedModel, 'completion');
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d

        if (await upgradeConversation(session, conversationId)) {
            conversation = loadUser(session.user.lastName)?.conversations?.find(c => c.id === conversationId) || conversation;
        }
        const pdfContext = {
            user: session.user,
            pdfContent: session.pdfContent,
            pdfMeta: session.pdfMeta,
            pdfNames: [...session.pdfNames],
            activePdfNames: [...(session.activePdfNames || session.pdfNames)],
            pdfIndex: session.pdfIndex
        };
        const scope = resolveDocumentScope(message, pdfContext.pdfNames, pdfContext.activePdfNames);
        const update = { content: pdfContext.pdfContent, names: pdfContext.activePdfNames, turn: conversation?.messages?.length, scope: scope.names };
        if (scope.error) return finish(scope.error, 'study', update);
        if (!scope.names.length) return finish('Select a PDF in Sources before asking a question.', 'study', update);

<<<<<<< HEAD
        const model = createModel(selectedModel, controller.signal, { thinking: capabilities.includes('thinking') });
=======
        const model = createModel(selectedModel, controller.signal);
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d
        const practice = conversation?.practice;
        if (practice && practice.names.every(name => scope.names.includes(name)) && isPracticeReply(practice, scope.query)) {
            const result = await advancePractice(model, practice, scope.query);
            return finish(result.text, 'practice', { ...update, practice: result.state });
        }

        const docs = parsePdfContent(pdfContext.pdfContent, pdfContext.pdfNames, pdfContext.pdfMeta).filter(doc => scope.names.includes(doc.name));
        // The registration form's table parser is deterministic arithmetic,
        // more reliable than any model for counting rows and units.
        const direct = documentAnswer(scope.query, docs);
        if (direct && /Registration summary|distinct subject codes|subject-code table|Subject codes found/.test(direct)) {
            const pages = docs.filter(doc => doc.digest).map(doc => `[${doc.name}, p. 1](cerebro:${doc.digest}:1)`);
            return finish(direct + (pages.length ? '\n\nSource: ' + pages.join(' ') : ''), 'answer', update);
        }

        const embeddingModel = installedModel(models, OLLAMA_EMBED_MODEL);
        await requireCapability(embeddingModel, 'embedding');
        out.status({ stage: 'indexing', detail: 'Preparing your PDFs' });
        const index = await ensurePdfIndex(pdfContext, conversationId, models);
        if (!index.chunks.some(chunk => scope.names.includes(chunk.pdfName))) {
            return finish('No readable text was found in the selected PDF. If it is a scan, run it through OCR and upload it again.', 'study', update);
        }
        const prefix = embeddingPrefixes(OLLAMA_EMBED_MODEL).query;
        const vectorFor = async text => {
            try {
                return (await embedTexts([prefix + text], OLLAMA_EMBED_MODEL))[0];
            } catch (error) {
                if (controller.signal.aborted) throw error;
                console.warn('Query embedding failed, using keyword search:', errorMessage(error));
                return null;
            }
        };
<<<<<<< HEAD
        let summariesChanged = false;
=======
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d
        const context = topicReset ? {} : conversation ? (conversation.context || {}) : (session.chatContext || {});
        const result = await respond({
            index,
            names: scope.names,
            query: scope.query,
            context,
            model,
            vectorFor,
            history: historyFor(conversation?.messages || []),
            sourceMode: sourceMode === 'pdf-only' ? 'pdf-only' : null,
            onStatus: out.status,
            onDraft: out.draft,
<<<<<<< HEAD
            onCache: () => { summariesChanged = true; }
        });
        if (summariesChanged && conversationId) saveIndex(session.user, conversationId, index);
=======
            onCache: () => conversationId && saveIndex(session.user, conversationId, index)
        });
        if (index.summaries && conversationId) saveIndex(session.user, conversationId, index);
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d
        const nextContext = result.topic ? { activeTopic: result.topic, updatedAt: new Date().toISOString() } : null;
        return finish(result.text, result.mode, {
            ...update,
            practice: result.state || null,
            topic: result.topic?.label,
            context: nextContext
        }, { topic: result.topic || null, meta: publicMeta(result.meta) });
    } catch (error) {
        console.error('Chat error:', error);
        if (res.headersSent) {
            if (!res.destroyed) res.end(`${JSON.stringify({ type: 'error', error: errorMessage(error) })}\n`);
        } else {
            res.status(errorStatus(error)).json({ error: errorMessage(error) });
        }
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Cerebro backend is running' });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Bad JSON bodies and anything unexpected still get a JSON reply the page can show.
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request was not valid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.' });
    console.error('Unexpected error:', error);
    res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, HOST, async () => {
    console.log(`Cerebro running at http://${HOST}:${PORT}`);
    try {
        const models = await listModels();
        const chatModel = models.find(item => modelMatches(OLLAMA_MODEL, item.name));
        const embedModel = models.find(item => modelMatches(OLLAMA_EMBED_MODEL, item.name));
        if (chatModel && (await modelCapabilities(chatModel.name)).includes('completion')) {
            console.log(`Ollama chat model ready: ${chatModel.name}`);
        } else {
            console.warn(`Chat model missing or incompatible. Run: ollama pull ${OLLAMA_MODEL}`);
        }
        if (embedModel && (await modelCapabilities(embedModel.name)).includes('embedding')) {
            console.log(`Ollama embedding model ready: ${embedModel.name}`);
        } else {
            console.warn(`Embedding model missing or incompatible. Run: ollama pull ${OLLAMA_EMBED_MODEL}`);
        }
    } catch (error) {
        console.warn(errorMessage(error));
    }
});
