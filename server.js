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
const { resolveDocumentScope } = require('./rag');
const { queryVariants, choosePassages } = require('./retrieval');
const { isDocumentOverview, selectedOverviewChunks, sourceOverview } = require('./overview');
const { modelCaller, tutorAnswer, review, passages, location } = require('./tutor');
const { studyRequest, buildStudy, studySet, advanceQuiz, questionAt, shortfall } = require('./study');
const { documentAnswer } = require('./document-answers');
const { extractDocument, documentChunks, packDocuments, originalDir, saveOriginals } = require('./pdf-source');

const app = express();
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '127.0.0.1';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/vendor/fontawesome', express.static(path.join(__dirname, 'node_modules', '@fortawesome', 'fontawesome-free')));
app.use(express.static(path.join(__dirname, 'public')));

const usersDir = path.join(__dirname, 'users');
const uploadsDir = path.join(__dirname, 'uploads');
const indexesDir = path.join(__dirname, 'indexes');
if (!fs.existsSync(usersDir)) fs.mkdirSync(usersDir);
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(indexesDir)) fs.mkdirSync(indexesDir);

const userSessions = new Map();

function getUserFilePath(lastName) {
    return path.join(usersDir, `${lastName.replace(/[^a-zA-Z0-9.]/g, '')}.json`);
}

function loadUser(lastName) {
    const filePath = getUserFilePath(lastName);
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    return null;
}

function saveUser(user) {
    fs.writeFileSync(getUserFilePath(user.lastName), JSON.stringify(user, null, 2));
}

function getAllUsers() {
    const users = [];
    const files = fs.readdirSync(usersDir);
    for (const file of files) {
        if (file.endsWith('.json')) {
            users.push(JSON.parse(fs.readFileSync(path.join(usersDir, file), 'utf8')));
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

function loadIndex(user, conversationId) {
    const filePath = getIndexPath(user, conversationId);
    if (!filePath || !fs.existsSync(filePath)) return null;
    try {
        const index = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return index.embeddingModel === OLLAMA_EMBED_MODEL && Array.isArray(index.chunks) ? index : null;
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
}

function deleteIndex(user, conversationId) {
    const filePath = getIndexPath(user, conversationId);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
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

async function indexDocuments(documents) {
    const chunks = documents.flatMap(documentChunks);
    const vectors = await embedTexts(chunks.map(chunk => chunk.text));
    return chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i] }));
}

function indexCoversDocuments(index, names, meta) {
    return index?.embeddingModel === OLLAMA_EMBED_MODEL && Array.isArray(index.chunks) &&
        index.chunks.every(chunk => names.includes(chunk.pdfName) &&
            chunk.digest === meta?.find(doc => doc.name === chunk.pdfName)?.digest) &&
        names.every(name => index.chunks.some(chunk => chunk.pdfName === name));
}

async function ensurePdfIndex(session, conversationId, models) {
    const storedIndex = session.pdfIndex || loadIndex(session.user, conversationId);
    if (indexCoversDocuments(storedIndex, session.pdfNames, session.pdfMeta)) {
        session.pdfIndex = storedIndex;
        return storedIndex;
    }
    installedModel(models, OLLAMA_EMBED_MODEL);
    const documents = parsePdfContent(session.pdfContent, session.pdfNames, session.pdfMeta);
    const index = { embeddingModel: OLLAMA_EMBED_MODEL, chunks: await indexDocuments(documents) };
    if (conversationId) {
        const current = loadUser(session.user.lastName)?.conversations?.find(item => item.id === conversationId);
        if (!current || current.pdfContent !== session.pdfContent || JSON.stringify(current.pdfMeta) !== JSON.stringify(session.pdfMeta))
            throw new OllamaError('PDFs changed during indexing. Please retry.', 409);
        saveIndex(session.user, conversationId, index);
    }
    session.pdfIndex = index;
    return index;
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
app.post('/api/auth/register', (req, res) => {
    const { firstName, lastName, email, password } = req.body;

    if (loadUser(lastName)) {
        return res.status(400).json({ error: 'Username already exists. Try adding your middle initial (e.g., ' + lastName + 'J)' });
    }
    const allUsers = getAllUsers();
    const emailExists = allUsers.some(user => user.email === email);
    if (emailExists) {
        return res.status(400).json({ error: 'Email already registered. Please use a different email.' });
    }

    const user = {
        id: Date.now().toString(),
        firstName,
        lastName,
        email,
        password,
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
    const { username, password } = req.body;
    const user = getAllUsers().find(u => u.lastName === username && u.password === password);

    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const sessionId = Date.now().toString() + Math.random().toString(36);
    userSessions.set(sessionId, {
        user,
        pdfContent: '',
        pdfNames: [],
        activePdfNames: [],
        uploadedPDFs: [],
        pdfIndex: null,
        currentConversationId: null
    });

    res.json({
        success: true,
        sessionId,
        user: { firstName: user.firstName, lastName: user.lastName, email: user.email }
    });
});

app.post('/api/auth/logout', (req, res) => {
    userSessions.delete(req.body.sessionId);
    res.json({ success: true });
});

app.post('/api/auth/delete-account', (req, res) => {
    const session = userSessions.get(req.body.sessionId);
    if (session && session.user) {
        const user = loadUser(session.user.lastName);
        for (const conversation of user?.conversations || []) {
            deleteIndex(session.user, conversation.id);
            fs.rmSync(originalDir(session.user, conversation.id), { recursive: true, force: true });
        }
        const filePath = getUserFilePath(session.user.lastName);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        userSessions.delete(req.body.sessionId);
    }
    res.json({ success: true });
});

app.post('/api/auth/forgot-password', (req, res) => {
    const user = loadUser(req.body.lastName);
    if (user) {
        res.json({ success: true, password: user.password });
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

// CONVERSATION MANAGEMENT
app.get('/api/conversations/:sessionId', (req, res) => {
    const session = userSessions.get(req.params.sessionId);
    if (!session || !session.user) {
        return res.json({ conversations: [] });
    }

    const user = loadUser(session.user.lastName);
    const conversations = user?.conversations || [];

    res.json({ conversations: conversations.map(({ practice, ...conversation }) => conversation).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)) });
});

app.post('/api/conversations/create', (req, res) => {
    const session = userSessions.get(req.body.sessionId);
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
    const session = userSessions.get(req.params.sessionId);
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
    const session = userSessions.get(req.params.sessionId);
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
                if (JSON.stringify(conversation.activePdfNames) !== JSON.stringify(activePdfNames)) delete conversation.practice;
                conversation.activePdfNames = activePdfNames;
                saveUser(user);
            }
        } catch (e) { console.error('Focus PDF disk save error:', e); }
    }

    res.json({ success: true, pdfNames: session.pdfNames, activePdfNames, pdfCount: session.pdfNames.length });
});

app.post('/api/conversations/:sessionId/delete-pdf', (req, res) => {
    const session = userSessions.get(req.params.sessionId);
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
    const index = session.pdfIndex || loadIndex(session.user, conversationId);
    if (index) {
        index.chunks = index.chunks.filter(chunk => chunk.pdfName !== pdfName);
        session.pdfIndex = index;
        if (updatedNames.length) saveIndex(session.user, conversationId, index);
        else deleteIndex(session.user, conversationId);
    }

    if (conversationId && session.user) {
        try {
            const user = loadUser(session.user.lastName);
            const conversation = user.conversations?.find(c => c.id === conversationId);
            if (conversation) {
                delete conversation.practice;
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
    const session = userSessions.get(req.params.sessionId);
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
        pdfCount: (conversation.pdfNames || []).length
    });
});

app.put('/api/conversations/:sessionId/:conversationId', (req, res) => {
    const session = userSessions.get(req.params.sessionId);
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
    const session = userSessions.get(req.params.sessionId);
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
const MAX_PDFS_PER_CONVERSATION = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_CHARS = 1000000;
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
        const session = userSessions.get(req.body.sessionId);
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
        const existingChunks = indexCoversDocuments(storedIndex, state.pdfNames, state.pdfMeta)
            ? storedIndex.chunks
            : await indexDocuments(existingDocuments);
        const newChunks = await indexDocuments(newDocuments);
        const index = {
            embeddingModel: OLLAMA_EMBED_MODEL,
            chunks: [...existingChunks, ...newChunks]
        };
        const documents = [...existingDocuments, ...newDocuments];
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
            truncated: truncated
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
    const session = userSessions.get(sessionId);
    if (!session) return res.status(401).end();
    const conversation = loadUser(session.user.lastName)?.conversations?.find(c => c.id === conversationId);
    const selected = conversation?.activePdfNames || conversation?.pdfNames || [];
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest) || !conversation?.pdfMeta?.some(doc => doc.digest === digest && selected.includes(doc.name))) return res.status(404).end();
    res.set('Cache-Control','no-store').type('application/pdf').sendFile(path.join(originalDir(session.user, conversationId), digest));
});

function saveChatMessage(session, conversationId, message, answer, update) {
    if (!conversationId || !session.user) return;
    const user = loadUser(session.user.lastName);
    const conversation = user?.conversations?.find(c => c.id === conversationId);
    if (!conversation) throw new OllamaError('Conversation was deleted.', 409);
    if (update) {
        if (conversation.pdfContent !== update.content || JSON.stringify(conversation.activePdfNames || conversation.pdfNames) !== JSON.stringify(update.names) ||
            conversation.messages?.length !== update.turn) throw new OllamaError('Conversation changed. Please retry.', 409);
        conversation.practice = update.practice;
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

function sendStudyAnswer(res, session, conversationId, message, answer, stream, mode = 'study', update) {
    saveChatMessage(session, conversationId, message, answer, update);
    if (stream === true) {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.write(`${JSON.stringify({ type: 'delta', content: answer })}\n`);
        return res.end(`${JSON.stringify({ type: 'done', answer, mode })}\n`);
    }
    return res.json({ answer, mode });
}

app.post('/api/chat', async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
        const { message, sessionId, conversationId, stream } = req.body;
        if (typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: 'Enter a message.' });
        }
        const session = userSessions.get(sessionId);
        if (!session) return res.status(401).json({ error: 'Session not found' });
        let conversation = null;
        if (conversationId && session.user) {
            const user = loadUser(session.user.lastName);
            conversation = user?.conversations?.find(c => c.id === conversationId);
            if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });
            setSessionConversation(session, conversation, conversationId);
        }
        const pdfContext = {
            user: session.user,
            pdfContent: session.pdfContent,
            pdfMeta: session.pdfMeta,
            pdfNames: [...session.pdfNames],
            activePdfNames: [...(session.activePdfNames || session.pdfNames)],
            pdfIndex: session.pdfIndex
        };
        const hasPDF = pdfContext.pdfNames.length > 0;
        if (!hasPDF) {
            return sendStudyAnswer(res, session, conversationId, message, 'Upload a PDF to ask questions or create study materials.', stream, 'normal');
        }
        const models = await listModels();
        const selectedModel = installedModel(models, req.body.model || OLLAMA_MODEL);
        await requireCapability(selectedModel, 'completion');

        if (hasPDF) {
            const scope = resolveDocumentScope(message, pdfContext.pdfNames, pdfContext.activePdfNames);
            if (scope.error) return sendStudyAnswer(res, session, conversationId, message, scope.error, stream);
            if (!scope.names.length) return sendStudyAnswer(res, session, conversationId, message, 'Select a PDF in Sources before asking a question.', stream);
            const docs = parsePdfContent(pdfContext.pdfContent, pdfContext.pdfNames, pdfContext.pdfMeta).filter(doc => scope.names.includes(doc.name));
            const update = { content: pdfContext.pdfContent, names: pdfContext.activePdfNames, turn: conversation?.messages?.length, scope: scope.names };
            const respond = (answer, extra = {}) => sendStudyAnswer(res, session, conversationId, message, answer, stream, 'study', { ...update, ...extra });
            const call = modelCaller(selectedModel, controller.signal);
            const settings = studyRequest(scope.query);
            if (conversation?.practice && !settings && conversation.practice.names.every(name => scope.names.includes(name))) {
                const result = await advanceQuiz(call, conversation.practice, scope.query);
                return respond(result.text, { practice: result.state });
            }
            const refusal = docs.some(doc => doc.incomplete)
                ? "I couldn't reliably retrieve the information needed from this PDF. Some pages were unreadable or trimmed. Check the original or upload a clearer copy."
                : 'I cannot answer that question because the requested information is not supported by your currently selected document. Please ask something related to the uploaded material.';
            const embeddingModel = installedModel(models, OLLAMA_EMBED_MODEL);
            await requireCapability(embeddingModel, 'embedding');
            const index = await ensurePdfIndex(pdfContext, conversationId, models);
            const selected = index.chunks.filter(c => scope.names.includes(c.pdfName));
            if (!selected.length) return respond('No readable passages were available. Try a text-based PDF or OCR.');
            const previous = conversation?.messages?.at(-1);
            const followup = /^(?:(?:can|could) you )?(?:(?:explain|simplify|rephrase) (?:that|it)|(?:give me |show me )?an example|what about (?:it|its|the)|(?:make|say) (?:it|that)|tell me more|what is its|what is the difference between them)/i.test(scope.query);
            const sameScope = previous?.topic && JSON.stringify(previous.scope) === JSON.stringify(scope.names);
            if (followup && !sameScope) return respond('Which term or passage would you like me to explain?');
            const history = followup ? { question: previous.topic, answer: previous.content.slice(0, 1500) } : undefined;
            const variants = queryVariants(scope.query, selected);
            const query = [history?.question, scope.query, variants].filter(Boolean).join(' ');
            const [vector] = await embedTexts([query], OLLAMA_EMBED_MODEL);
            const comparison = /\b(compare|contrast|difference|different|similarities|differ|versus|vs)\b/i.test(message);
            const ranked = choosePassages(selected, scope.names, vector, comparison);
            if (settings) {
                if (!Number.isSafeInteger(settings.count) || settings.count < 1 || settings.count > 100)
                    return respond('Choose between 1 and 100 items per study set.');
                if (settings.interactive && !conversation) return respond('Open a saved conversation to start an interactive quiz.');
                const pool = [...ranked, ...selected.filter(c => !ranked.some(r => r.pdfName === c.pdfName && r.text === c.text))];
                const items = await buildStudy(call, settings, pool);
                if (!items.length) return respond('I could not find suitable passages for a reviewed study set with those settings. Try another topic or format.');
                if (!settings.interactive) return respond(studySet(items, settings.count));
                const practice = { items, names: scope.names, index: 0, results: [], retry: false };
                return respond(shortfall(items, settings.count) + questionAt(practice) + '\n\nReply with your answer, “hint”, “skip”, or “end quiz”.', { practice });
            }
            // Preserve the registration form's deterministic table parser.
            const direct = documentAnswer(scope.query, docs);
            const tableAnswer = direct && (/Registration summary|distinct subject codes|subject-code table|Subject codes found/.test(direct));
            if (tableAnswer) {
                // Review derived counts against rows from the same table, and excerpts in document order.
                const relevant = selected.filter(c => c.text.split(/\n|(?<=[.!?])\s+/).some(line => {
                    const prefix = line.trim().slice(0, 36);
                    return prefix.length >= 4 && direct.includes(prefix);
                }));
                const context = (relevant.length ? relevant : ranked).slice(0, 6);
                if ((await review(call, scope.query, direct, passages(context), 'Check each extracted detail and recompute any stated totals.')).approved) {
                    return respond(direct + '\n\nReviewed sources\n' + [...new Set(context.map(c => location({ source: c.pdfName, page: c.page, digest: c.digest })))].join('\n'), { topic: scope.query });
                }
            }
            const overview = isDocumentOverview(scope.query);
            // A global explanation is not a keyword search. Give the model
            // representative pages from every focused PDF, in document order.
            const overviewPages = overview && !comparison
                ? selectedOverviewChunks(selected, scope.names)
                : [];
            const context = overviewPages.length ? overviewPages : ranked;
            const request = scope.query === 'summarize' && !/summari[sz]e/i.test(message) ? 'Summarize ' + message : message;
            const answer = await tutorAnswer(call, request, context, history, comparison ? scope.names : []);
            // A rejected generative summary must not turn a readable PDF into
            // "unsupported". Offer strictly extractive, page-cited passages.
            const fallback = overview && !answer?.text ? sourceOverview(context, scope.names) : null;
            return respond(answer?.text || fallback || refusal, { topic: answer?.topic ? (history?.question || answer.topic) : undefined });
        }

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
