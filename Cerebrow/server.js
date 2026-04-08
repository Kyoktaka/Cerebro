require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Create directories
const usersDir = path.join(__dirname, 'users');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(usersDir)) fs.mkdirSync(usersDir);
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Gemini Setup
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error('GEMINI_API_KEY not found in .env');
    process.exit(1);
}

console.log('Gemini API Key loaded');
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// Test API
async function testAPI() {
    try {
        const result = await model.generateContent('Say "Hello! Cerebro is ready!"');
        console.log('Gemini API works:', result.response.text());
    } catch (error) {
        console.error('Gemini API failed:', error.message);
    }
}
testAPI();

// User sessions
const userSessions = new Map();

// User functions
function getUserFilePath(lastName) {
    return path.join(usersDir, `${lastName.replace(/[^a-zA-Z0-9]/g, '')}.json`);
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

// AUTH ENDPOINTS

app.post('/api/auth/register', (req, res) => {
    const { firstName, lastName, email, password } = req.body;

    if (loadUser(lastName)) {
        return res.status(400).json({ error: 'Username already exists' });
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

    saveUser(user);
    res.json({ success: true });
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
        uploadedPDFs: []
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

    // Reset PDF context for new conversation
    session.pdfContent = '';
    session.pdfNames = [];
    session.uploadedPDFs = [];

    res.json({ success: true, conversationId: newConversation.id });
});

app.post('/api/conversations/:sessionId/clear-pdfs', (req, res) => {
    const session = userSessions.get(req.params.sessionId);
    if (session) {
        session.pdfContent = '';
        session.pdfNames = [];
        session.uploadedPDFs = [];

        // Also clear from disk so it doesn't restore on next load
        const convId = req.body.conversationId;
        if (convId && session.user) {
            const user = loadUser(session.user.lastName);
            const conversation = user.conversations?.find(c => c.id === convId);
            if (conversation) {
                delete conversation.pdfContent;
                delete conversation.pdfNames;
                saveUser(user);
            }
        }
    }
    res.json({ success: true });
});

// Save one or more system messages to a conversation (used for upload/exit events)
app.post('/api/conversations/:sessionId/:conversationId/save-messages', (req, res) => {
    const session = userSessions.get(req.params.sessionId);
    if (!session || !session.user) return res.status(401).json({ error: 'Unauthorized' });

    const { messages } = req.body; // array of { role, content, timestamp }
    if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'messages array required' });

    try {
        const user = loadUser(session.user.lastName);
        const conversation = user.conversations?.find(c => c.id === req.params.conversationId);
        if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

        conversation.messages = conversation.messages || [];
        for (const msg of messages) {
            conversation.messages.push({
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp || new Date().toISOString()
            });
        }
        conversation.updatedAt = new Date().toISOString();
        saveUser(user);
        res.json({ success: true });
    } catch (e) {
        console.error('save-messages error:', e);
        res.status(500).json({ error: 'Failed to save messages' });
    }
});

// Focus on selected PDFs — strips all others from the session context
// Accepts pdfNames: string[] (array of names to keep)
app.post('/api/conversations/:sessionId/focus-pdf', (req, res) => {
    const session = userSessions.get(req.params.sessionId);
    if (!session) return res.status(401).json({ error: 'Session not found' });

    const { conversationId, pdfNames: namesToKeep } = req.body;
    if (!namesToKeep || namesToKeep.length === 0) return res.status(400).json({ error: 'pdfNames required' });

    const allContent = session.pdfContent || '';

    // Extract and concatenate content sections for each kept PDF
    let focusedContent = '';
    for (const pdfName of namesToKeep) {
        const marker = `--- ${pdfName} ---`;
        const markerIndex = allContent.indexOf(marker);
        if (markerIndex !== -1) {
            const nextMarkerIndex = allContent.indexOf('\n\n--- ', markerIndex + marker.length);
            const section = nextMarkerIndex !== -1
                ? allContent.substring(markerIndex, nextMarkerIndex)
                : allContent.substring(markerIndex);
            focusedContent += (focusedContent ? '\n\n' : '') + section;
        }
    }

    session.pdfContent = focusedContent;
    session.pdfNames = namesToKeep;
    session.uploadedPDFs = namesToKeep;

    // Persist to disk
    if (conversationId && session.user) {
        try {
            const user = loadUser(session.user.lastName);
            const conversation = user.conversations?.find(c => c.id === conversationId);
            if (conversation) {
                conversation.pdfNames = namesToKeep;
                conversation.pdfContent = focusedContent;
                saveUser(user);
            }
        } catch (e) { console.error('Focus PDF disk save error:', e); }
    }

    res.json({ success: true, pdfNames: namesToKeep, pdfCount: namesToKeep.length });
});

// Delete a single PDF from the session context
app.post('/api/conversations/:sessionId/delete-pdf', (req, res) => {
    const session = userSessions.get(req.params.sessionId);
    if (!session) return res.status(401).json({ error: 'Session not found' });

    const { conversationId, pdfName } = req.body;
    if (!pdfName) return res.status(400).json({ error: 'pdfName required' });

    // Remove this PDF's section from pdfContent
    const marker = `\n\n--- ${pdfName} ---\n\n`;
    let allContent = session.pdfContent || '';
    const markerIndex = allContent.indexOf(marker);

    if (markerIndex !== -1) {
        const contentStart = markerIndex + marker.length;
        const nextMarkerIndex = allContent.indexOf('\n\n--- ', contentStart);
        if (nextMarkerIndex !== -1) {
            allContent = allContent.substring(0, markerIndex) + '\n\n' + allContent.substring(nextMarkerIndex);
        } else {
            allContent = allContent.substring(0, markerIndex);
        }
    }

    const updatedNames = (session.pdfNames || []).filter(n => n !== pdfName);
    session.pdfContent = allContent;
    session.pdfNames = updatedNames;
    session.uploadedPDFs = updatedNames;

    // Persist to disk
    if (conversationId && session.user) {
        try {
            const user = loadUser(session.user.lastName);
            const conversation = user.conversations?.find(c => c.id === conversationId);
            if (conversation) {
                if (updatedNames.length === 0) {
                    delete conversation.pdfContent;
                    delete conversation.pdfNames;
                } else {
                    conversation.pdfNames = updatedNames;
                    conversation.pdfContent = allContent;
                }
                saveUser(user);
            }
        } catch (e) { console.error('Delete PDF disk save error:', e); }
    }

    res.json({ success: true, pdfName, remainingPDFs: updatedNames, pdfCount: updatedNames.length });
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

    // Restore PDF context into session if this conversation had PDFs
    if (conversation.pdfContent) {
        session.pdfContent = conversation.pdfContent;
        session.pdfNames = conversation.pdfNames || [];
        session.uploadedPDFs = conversation.pdfNames || [];
    } else {
        // Clear PDF context when switching to a non-PDF conversation
        session.pdfContent = '';
        session.pdfNames = [];
        session.uploadedPDFs = [];
    }

    res.json({
        messages: conversation.messages || [],
        pdfNames: conversation.pdfNames || [],
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

    res.json({ success: true });
});

// PDF UPLOAD

const upload = multer({ dest: uploadsDir });
const MAX_PDFS_PER_CONVERSATION = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_CHARS = 1000000;

app.post('/api/upload', upload.array('files'), async (req, res) => {
    try {
        const session = userSessions.get(req.body.sessionId);
        if (!session) return res.status(401).json({ error: 'Session not found' });

        for (const file of req.files) {
            if (file.size > MAX_FILE_SIZE) {
                fs.unlinkSync(file.path);
                return res.status(400).json({ error: `File ${file.originalname} exceeds 10MB limit.` });
            }
        }

        if (!session.uploadedPDFs) {
            session.uploadedPDFs = [];
        }

        const currentCount = session.uploadedPDFs.length;
        const newCount = currentCount + req.files.length;

        if (newCount > MAX_PDFS_PER_CONVERSATION) {
            for (const file of req.files) fs.unlinkSync(file.path);
            return res.status(400).json({ error: `You can only upload ${MAX_PDFS_PER_CONVERSATION} PDFs per conversation.` });
        }

        let allText = session.pdfContent || '';
        let fileNames = [...(session.pdfNames || [])];
        let totalChars = allText.length;
        let truncated = false;

        for (const file of req.files) {
            const dataBuffer = fs.readFileSync(file.path);
            const pdfData = await pdfParse(dataBuffer);
            let extractedText = pdfData.text;

            if (!extractedText || extractedText.trim().length === 0) {
                fs.unlinkSync(file.path);
                return res.status(400).json({ error: `File ${file.originalname} contains no readable text.` });
            }

            if (totalChars + extractedText.length > MAX_TOTAL_CHARS) {
                const remaining = MAX_TOTAL_CHARS - totalChars;
                if (remaining <= 0) {
                    fs.unlinkSync(file.path);
                    return res.status(400).json({ error: `Total content limit reached (${MAX_TOTAL_CHARS} chars).` });
                }
                extractedText = extractedText.substring(0, remaining);
                truncated = true;
            }

            allText += `\n\n--- ${file.originalname} ---\n\n${extractedText}`;
            fileNames.push(file.originalname);
            totalChars += extractedText.length;
            fs.unlinkSync(file.path);
        }

        session.pdfContent = allText;
        session.pdfNames = fileNames;
        session.uploadedPDFs = fileNames;

        // Persist PDF metadata + content to the conversation on disk
        const convId = req.body.conversationId;
        if (convId && session.user) {
            const user = loadUser(session.user.lastName);
            const conversation = user.conversations?.find(c => c.id === convId);
            if (conversation) {
                conversation.pdfNames = fileNames;
                conversation.pdfContent = allText;
                saveUser(user);
            }
        }

        res.json({
            success: true,
            pdfNames: fileNames,
            charCount: totalChars,
            pdfCount: fileNames.length,
            maxPDFs: MAX_PDFS_PER_CONVERSATION,
            truncated: truncated
        });

    } catch (error) {
        console.error('Upload error:', error);
        if (req.files) {
            for (const file of req.files) {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            }
        }
        res.status(500).json({ error: 'Failed to process PDF.' });
    }
});

// CHAT ENDPOINT

app.post('/api/chat', async (req, res) => {
    try {
        const { message, sessionId, conversationId } = req.body;
        const session = userSessions.get(sessionId);

        if (!session) {
            return res.status(401).json({ error: 'Session not found' });
        }

        // Restore PDF context from disk if session is fresh  after re-login
        if ((!session.pdfContent || session.pdfContent.length === 0) && conversationId && session.user) {
            try {
                const user = loadUser(session.user.lastName);
                const conversation = user?.conversations?.find(c => c.id === conversationId);
                if (conversation?.pdfContent) {
                    session.pdfContent = conversation.pdfContent;
                    session.pdfNames = conversation.pdfNames || [];
                    session.uploadedPDFs = conversation.pdfNames || [];
                }
            } catch (e) { console.error('PDF context restore error:', e); }
        }

        const hasPDF = session.pdfContent && session.pdfContent.length > 0;
        const MAX_CONTEXT_LENGTH = 80000;

        let answer = '';

        if (hasPDF) {
            // Study Mode - Only answer from PDF
            let context = session.pdfContent;
            if (context.length > MAX_CONTEXT_LENGTH) {
                context = context.substring(0, MAX_CONTEXT_LENGTH);
            }

            // Simple, clean prompt - let Gemini handle language automatically
            const prompt = `You are Cerebro, a strict study assistant. RULES:
1. ONLY answer using the PDF content below.
2. If the question cannot be answered from the PDF, say: "This question is beyond the scope of your uploaded PDF/s. Please ask about the content of your PDF/s."
3. DO NOT use your own knowledge.
4. Answer in the SAME LANGUAGE as the user's question.
5. If the user asks for a summary, summarize the document.

PDF CONTENT:
${context}

USER QUESTION: ${message}

YOUR ANSWER (ONLY from PDF, in user's language):`;

            const result = await model.generateContent(prompt);
            answer = result.response.text();

            // Fallback if answer is empty
            if (!answer || answer.trim().length === 0) {
                answer = "I cannot answer that based on your uploaded document. Please ask a question about the content of your PDF.";
            }
        } else {
            // Normal Mode - Free chat
            const prompt = `You are Cerebro, a friendly AI assistant. Answer concisely and helpfully. Respond in the SAME LANGUAGE as the user's question.\n\nUser: ${message}\n\nAssistant:`;
            const result = await model.generateContent(prompt);
            answer = result.response.text();
        }

        // Save to conversation
        if (conversationId && session.user) {
            const user = loadUser(session.user.lastName);
            const conversation = user.conversations?.find(c => c.id === conversationId);

            if (conversation) {
                conversation.messages = conversation.messages || [];
                conversation.messages.push({
                    role: 'user',
                    content: message,
                    timestamp: new Date().toISOString()
                });
                conversation.messages.push({
                    role: 'assistant',
                    content: answer,
                    timestamp: new Date().toISOString()
                });
                conversation.updatedAt = new Date().toISOString();

                if (conversation.messages.length === 2 && conversation.title === 'New Conversation' && message) {
                    conversation.title = message.substring(0, 40) + (message.length > 40 ? '...' : '');
                }

                saveUser(user);
            }
        }

        res.json({
            answer: answer,
            mode: hasPDF ? 'study' : 'normal'
        });

    } catch (error) {
        console.error('Chat error:', error);
        res.json({
            answer: 'Sorry, I encountered an error. Please try again.',
            mode: 'error'
        });
    }
});

// HEALTH CHECK

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Cerebro backend is running' });
});

// START SERVER

app.listen(PORT, () => {
    console.log(`  CEREBRO BACKEND RUNNING`);
    console.log(`  Port: ${PORT}`);
    console.log(`  API: http://localhost:${PORT}/api`);
    console.log(`  Gemini AI: Ready`);
});


//1st API key AIzaSyAt3w2-sL7g4PF6rYsdk3paKue1tr09X1w
//2nd API key AIzaSyBdr9Kpq01iWRHzaupIQvvmhOGHd-zc8dE
//3rd API key AIzaSyDapj8TcbFeDpCwBx5nJZ-6PxaEKW6sPX8
