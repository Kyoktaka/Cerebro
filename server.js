require('dotenv').config();

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
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
    embedTexts,
    openChat
} = require('./local-ai');
const { chunkText, retrieveChunks, questionHasEvidence, resolveDocumentScope, quizRequest, makeSourceQuiz } = require('./rag');
const { EVIDENCE_SCHEMA, REVIEW_SCHEMA, groundingMessages, validateEvidence, reviewMessages, validateReview } = require('./grounding');
const { documentAnswer } = require('./document-answers');
const { renderPageText } = require('./pdf-text');

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

function parsePdfContent(content, names) {
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
    if (session.currentConversationId !== conversationId) {
        setSessionConversation(session, conversation, conversationId);
    }
    return true;
}

async function indexDocuments(documents) {
    const chunks = documents.flatMap(document =>
        chunkText(document.text).map(text => ({ pdfName: document.name, text }))
    );
    const vectors = await embedTexts(chunks.map(chunk => chunk.text));
    return chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i] }));
}

function indexCoversDocuments(index, names) {
    return index?.embeddingModel === OLLAMA_EMBED_MODEL && Array.isArray(index.chunks) &&
        names.every(name => index.chunks.some(chunk => chunk.pdfName === name));
}

async function ensurePdfIndex(session, conversationId, models) {
    const storedIndex = session.pdfIndex || loadIndex(session.user, conversationId);
    if (indexCoversDocuments(storedIndex, session.pdfNames)) {
        session.pdfIndex = storedIndex;
        return storedIndex;
    }
    installedModel(models, OLLAMA_EMBED_MODEL);
    const documents = parsePdfContent(session.pdfContent, session.pdfNames);
    const index = { embeddingModel: OLLAMA_EMBED_MODEL, chunks: await indexDocuments(documents) };
    saveIndex(session.user, conversationId, index);
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
        for (const conversation of user?.conversations || []) deleteIndex(session.user, conversation.id);
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

    res.json({ conversations: conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)) });
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
    session.pdfContent = '';
    session.pdfNames = [];
    session.activePdfNames = [];
    session.uploadedPDFs = [];
    session.pdfIndex = null;

    deleteIndex(session.user, convId);
    if (convId && session.user) {
        const user = loadUser(session.user.lastName);
        const conversation = user.conversations?.find(c => c.id === convId);
        if (conversation) {
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
    const remainingDocuments = parsePdfContent(session.pdfContent, session.pdfNames)
        .filter(document => document.name !== pdfName);
    const allContent = remainingDocuments.map(document => `\n\n--- ${document.name} ---\n\n${document.text}`).join('');
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
    if (session.currentConversationId === req.params.conversationId) {
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
            if (session.currentConversationId !== conversationId) {
                setSessionConversation(session, conversation, conversationId);
            }
        }
        const state = {
            pdfContent: session.pdfContent,
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

        const existingDocuments = parsePdfContent(state.pdfContent || '', state.pdfNames);
        let totalChars = existingDocuments.reduce((sum, document) => sum + document.text.length, 0);
        const newDocuments = [];
        let truncated = false;

        for (const file of req.files) {
            const dataBuffer = await fs.promises.readFile(file.path);
            if (dataBuffer.subarray(0, 5).toString() !== '%PDF-') {
                return res.status(400).json({ error: `File ${file.originalname} is not a PDF.` });
            }
            // Copy pooled Buffer bytes so PDF.js reads only this file.
            const pdfData = await pdfParse(new Uint8Array(dataBuffer), { pagerender: renderPageText });
            let extractedText = pdfData.text?.trim() || '';

            if (!extractedText) {
                return res.status(400).json({ error: `File ${file.originalname} contains no readable text.` });
            }

            if (totalChars + extractedText.length > MAX_TOTAL_CHARS) {
                const remaining = MAX_TOTAL_CHARS - totalChars;
                if (remaining <= 0) {
                    return res.status(400).json({ error: `Total content limit reached (${MAX_TOTAL_CHARS} chars).` });
                }
                extractedText = extractedText.substring(0, remaining);
                truncated = true;
            }

            newDocuments.push({ name: file.originalname, text: extractedText });
            totalChars += extractedText.length;
        }

        const models = await listModels();
        const embeddingModel = installedModel(models, OLLAMA_EMBED_MODEL);
        await requireCapability(embeddingModel, 'embedding');
        const storedIndex = state.pdfIndex || loadIndex(session.user, conversationId);
        const existingChunks = indexCoversDocuments(storedIndex, state.pdfNames)
            ? storedIndex.chunks
            : await indexDocuments(existingDocuments);
        const newChunks = await indexDocuments(newDocuments);
        const index = {
            embeddingModel: OLLAMA_EMBED_MODEL,
            chunks: [...existingChunks, ...newChunks]
        };
        const documents = [...existingDocuments, ...newDocuments];
        const allText = documents.map(document => `\n\n--- ${document.name} ---\n\n${document.text}`).join('');
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

function saveChatMessage(session, conversationId, message, answer) {
    if (!conversationId || !session.user) return;
    const user = loadUser(session.user.lastName);
    const conversation = user?.conversations?.find(c => c.id === conversationId);
    if (!conversation) return;
    conversation.messages = conversation.messages || [];
    conversation.messages.push({ role: 'user', content: message, timestamp: new Date().toISOString() });
    conversation.messages.push({ role: 'assistant', content: answer, timestamp: new Date().toISOString() });
    conversation.updatedAt = new Date().toISOString();
    if (conversation.messages.length === 2 && conversation.title === 'New Conversation') {
        conversation.title = message.substring(0, 40) + (message.length > 40 ? '...' : '');
    }
    saveUser(user);
}

function sendStudyAnswer(res, session, conversationId, message, answer, stream, mode = 'study') {
    saveChatMessage(session, conversationId, message, answer);
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
            if (session.currentConversationId !== conversationId) {
                setSessionConversation(session, conversation, conversationId);
            }
        }
        const pdfContext = {
            user: session.user,
            pdfContent: session.pdfContent,
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
            const documents = parsePdfContent(pdfContext.pdfContent, pdfContext.pdfNames).filter(document => scope.names.includes(document.name));
            const directAnswer = documents.length ? documentAnswer(scope.query, documents) : null;
            if (directAnswer) return sendStudyAnswer(res, session, conversationId, message, directAnswer, stream);
            const embeddingModel = installedModel(models, OLLAMA_EMBED_MODEL);
            await requireCapability(embeddingModel, 'embedding');
            const index = await ensurePdfIndex(pdfContext, conversationId, models);
            const selectedChunks = index.chunks.filter(chunk => scope.names.includes(chunk.pdfName));
            if (!selectedChunks.length) {
                throw new OllamaError('No readable text found in the focused PDFs.', 422);
            }
            const refusal = 'I cannot answer this question because the information is not present in your uploaded PDF document(s).';
            const quiz = quizRequest(scope.query);
            if (quiz) {
                const studyChunks = quiz.topic ? selectedChunks.filter(chunk => questionHasEvidence(quiz.topic, [chunk])) : selectedChunks;
                if (!studyChunks.length) return sendStudyAnswer(res, session, conversationId, message, refusal, stream);
                const questions = makeSourceQuiz(studyChunks, quiz.count, quiz.kind, quiz.topic);
                const label = quiz.kind === 'flashcards' ? 'Flashcards: recall each answer' : quiz.kind === 'multiple-choice' ? 'Multiple choice: choose the word missing from the exact passage' : quiz.kind === 'definition' ? 'Complete the definitions from your PDFs' : quiz.kind === 'short-answer' ? 'Short answer: recall or complete each passage' : 'Fill in the blanks using your PDFs';
                const answer = questions.length
                    ? `${label}:${questions.length < quiz.count ? ` (${questions.length} of ${quiz.count} requested; not enough suitable passages found.)` : ''}\n\n${questions.map((item, i) => `${i + 1}. ${item.prompt} [${item.source}]${item.choices ? `\n${item.choices.map((choice, j) => `${String.fromCharCode(65 + j)}. ${choice}`).join('\n')}` : ''}`).join('\n\n')}\n\nAnswer key:\n${questions.map((item, i) => `${i + 1}. ${item.answer} [${item.source}]\nEvidence: ${item.evidence}`).join('\n\n')}`
                    : 'I could not find suitable passages for that study format in the requested PDFs. Try another format or a text-based PDF.';
                return sendStudyAnswer(res, session, conversationId, message, answer, stream);
            }
            const [questionVector] = await embedTexts([scope.query], OLLAMA_EMBED_MODEL);
            const chunks = retrieveChunks({ chunks: selectedChunks }, scope.names, questionVector);
            const response = await openChat(selectedModel, groundingMessages(scope.query, chunks), false, controller.signal, EVIDENCE_SCHEMA);
            const result = await response.json();
            if (result.error) throw new OllamaError(`Ollama request failed: ${result.error}`, 502);
            const evidenceQuotes = validateEvidence(result.message?.content, chunks, scope.query);
            if (!evidenceQuotes.length) return sendStudyAnswer(res, session, conversationId, message, refusal, stream);
            const reviewResponse = await openChat(selectedModel, reviewMessages(scope.query, evidenceQuotes), false, controller.signal, REVIEW_SCHEMA);
            const reviewResult = await reviewResponse.json();
            if (!validateReview(reviewResult.message?.content)) return sendStudyAnswer(res, session, conversationId, message, refusal, stream);
            const answer = `Passages from your PDFs (check whether they answer your question):\n\n${evidenceQuotes.map(item => `Source: ${item.source}\n${item.quote}`).join('\n\n')}`;
            return sendStudyAnswer(res, session, conversationId, message, answer, stream);
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
