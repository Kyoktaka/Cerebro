const API_BASE_URL = 'https://cerebro-6bzw.onrender.com';
const sessionId = localStorage.getItem('cerebro_session');
const userData = JSON.parse(localStorage.getItem('cerebro_user') || '{}');

let currentConversationId = null;
let conversations = [];
let currentMessages = [];
let isPDFMode = false;
let currentPDFName = '';
let currentPDFCount = 0;
let isUploading = false; // Prevent re-render during upload

// DOM Elements
const sidebar = document.getElementById('chatSidebar');
const menuToggle = document.getElementById('menuToggle');
const closeSidebarBtn = document.getElementById('closeSidebarBtn');
const newChatBtn = document.getElementById('newChatBtn');
const uploadBtn = document.getElementById('uploadBtn');
const uploadOptions = document.getElementById('uploadOptions');
const uploadPdfOption = document.getElementById('uploadPdfOption');
const fileInput = document.getElementById('fileInput');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const chatMessages = document.getElementById('chatMessages');
const chatTitle = document.getElementById('chatTitle');
const pdfModeBadge = document.getElementById('pdfModeBadge');
const studyModeBar = document.getElementById('studyModeBar');
const pdfFileNameSpan = document.getElementById('pdfFileName');
const pdfCounter = document.getElementById('pdfCounter');
const exitStudyModeBtn = document.getElementById('exitStudyModeBtn');
const userName = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');
const deleteAccountBtn = document.getElementById('deleteAccountBtn');

// Check login
if (!sessionId) {
    window.location.href = 'login.html';
}

// Set user name
if (userName) userName.textContent = userData.firstName || userData.lastName;

// PDF MODE FUNCTIONS

function enablePDFMode(pdfName, pdfCount = 1) {
    console.log('Enabling PDF Mode');
    isPDFMode = true;
    currentPDFName = pdfName;
    currentPDFCount = pdfCount;

    // Show PDF Mode badge in header
    if (pdfModeBadge) {
        pdfModeBadge.style.display = 'flex';
    }

    // Show study mode bar
    if (studyModeBar) {
        studyModeBar.style.display = 'flex';
    }

    // Update file name display
    if (pdfFileNameSpan) {
        if (pdfCount > 1) {
            pdfFileNameSpan.textContent = `${pdfCount} PDFs`;
        } else {
            pdfFileNameSpan.textContent = pdfName;
        }
    }

    // Update counter
    if (pdfCounter && pdfCount > 1) {
        pdfCounter.textContent = `${pdfCount}/10`;
        pdfCounter.style.display = 'inline-block';
    } else if (pdfCounter) {
        pdfCounter.style.display = 'none';
    }

    console.log(' PDF Mode enabled');
}

function disablePDFMode() {
    console.log('Disabling PDF Mode');
    isPDFMode = false;
    currentPDFName = '';
    currentPDFCount = 0;

    // Hide PDF Mode badge
    if (pdfModeBadge) {
        pdfModeBadge.style.display = 'none';
    }

    // Hide study mode bar
    if (studyModeBar) {
        studyModeBar.style.display = 'none';
    }

    console.log(' PDF Mode disabled');
}

// Exit PDF Mode button
if (exitStudyModeBtn) {
    exitStudyModeBtn.addEventListener('click', async () => {
        console.log('🔘 Exit PDF Mode button clicked');
        try {
            await fetch(`${API_BASE_URL}/conversations/${sessionId}/clear-pdfs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationId: currentConversationId })
            });
            console.log(' PDF context cleared');
        } catch (error) {
            console.error('Error clearing PDF context:', error);
        }
        disablePDFMode();
        addMessageToUI(" **Exited PDF Mode**\n\nI've switched back to normal chat mode. You can upload a new PDF to study, or just chat normally.", 'bot');
        currentMessages.push({ role: 'assistant', content: " **Exited PDF Mode**\n\nI've switched back to normal chat mode. You can upload a new PDF to study, or just chat normally.", timestamp: new Date().toISOString() });
    });
}

// SIDEBAR FUNCTIONS

let isSidebarCollapsed = false;

function loadSidebarState() {
    const savedState = localStorage.getItem('cerebro_sidebar_collapsed');
    if (savedState !== null) {
        isSidebarCollapsed = savedState === 'true';
        if (isSidebarCollapsed) {
            sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
        } else {
            sidebar.classList.remove('collapsed');
            document.body.classList.remove('sidebar-collapsed');
        }
    }
}

function saveSidebarState() {
    localStorage.setItem('cerebro_sidebar_collapsed', isSidebarCollapsed);
}

function toggleSidebar() {
    if (window.innerWidth <= 768) {
        sidebar.classList.toggle('open');
    } else {
        isSidebarCollapsed = !isSidebarCollapsed;
        if (isSidebarCollapsed) {
            sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
        } else {
            sidebar.classList.remove('collapsed');
            document.body.classList.remove('sidebar-collapsed');
        }
        saveSidebarState();
    }
}

function closeSidebar() {
    if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
    } else {
        isSidebarCollapsed = true;
        sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
        saveSidebarState();
    }
}

loadSidebarState();

if (menuToggle) menuToggle.addEventListener('click', toggleSidebar);
if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebar);

document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768) {
        if (!sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
            sidebar.classList.remove('open');
        }
    }
});

window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
        sidebar.classList.remove('open');
        if (isSidebarCollapsed) {
            sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
        } else {
            sidebar.classList.remove('collapsed');
            document.body.classList.remove('sidebar-collapsed');
        }
    } else {
        sidebar.classList.remove('collapsed');
        document.body.classList.remove('sidebar-collapsed');
    }
});

// CONVERSATION MANAGEMENT

function groupConversationsByDate(conversations) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 30);

    const groups = { today: [], yesterday: [], week: [], month: [] };

    conversations.forEach(conv => {
        const convDate = new Date(conv.updatedAt);
        convDate.setHours(0, 0, 0, 0);
        if (convDate.getTime() === today.getTime()) groups.today.push(conv);
        else if (convDate.getTime() === yesterday.getTime()) groups.yesterday.push(conv);
        else if (convDate >= weekAgo) groups.week.push(conv);
        else if (convDate >= monthAgo) groups.month.push(conv);
    });
    return groups;
}

function renderConversationList() {
    const groups = groupConversationsByDate(conversations);
    const todayList = document.getElementById('todayList');
    const yesterdayList = document.getElementById('yesterdayList');
    const weekList = document.getElementById('weekList');
    const monthList = document.getElementById('monthList');

    if (todayList) todayList.innerHTML = groups.today.map(conv => createConversationItem(conv)).join('');
    if (yesterdayList) yesterdayList.innerHTML = groups.yesterday.map(conv => createConversationItem(conv)).join('');
    if (weekList) weekList.innerHTML = groups.week.map(conv => createConversationItem(conv)).join('');
    if (monthList) monthList.innerHTML = groups.month.map(conv => createConversationItem(conv)).join('');
}

function createConversationItem(conv) {
    const isActive = currentConversationId === conv.id;
    const title = conv.title || 'New Conversation';
    const date = new Date(conv.updatedAt).toLocaleDateString();
    return `
        <div class="conversation-item ${isActive ? 'active' : ''}" data-id="${conv.id}">
            <div class="conversation-info" onclick="window.loadConversation('${conv.id}')">
                <div class="conversation-title">${escapeHtml(title)}</div>
                <div class="conversation-date">${date}</div>
            </div>
            <div class="conversation-actions">
                <button class="conv-edit" onclick="window.editConversation('${conv.id}', '${escapeHtml(title)}')">
                    <i class="fas fa-pen"></i>
                </button>
                <button class="conv-delete" onclick="window.deleteConversation('${conv.id}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

async function loadConversations() {
    try {
        const response = await fetch(`${API_BASE_URL}/conversations/${sessionId}`);
        const data = await response.json();
        conversations = data.conversations || [];
        renderConversationList();
        if (conversations.length > 0 && !currentConversationId) {
            loadConversation(conversations[0].id);
        } else if (conversations.length === 0) {
            createNewConversation();
        }
    } catch (error) {
        console.error('Error loading conversations:', error);
        createNewConversation();
    }
}

async function createNewConversation() {
    try {
        const response = await fetch(`${API_BASE_URL}/conversations/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
        });
        const data = await response.json();
        currentConversationId = data.conversationId;
        currentMessages = [];
        await loadConversations();
        renderCurrentConversation();
        if (chatTitle) chatTitle.textContent = 'New Conversation';
        disablePDFMode();
        closeSidebar();
    } catch (error) {
        console.error('Error creating conversation:', error);
        renderCurrentConversation();
    }
}

async function loadConversation(conversationId) {
    currentConversationId = conversationId;
    try {
        const response = await fetch(`${API_BASE_URL}/conversations/${sessionId}/${conversationId}`);
        const data = await response.json();
        currentMessages = data.messages || [];
        renderCurrentConversation();
        const conv = conversations.find(c => c.id === conversationId);
        if (chatTitle) chatTitle.textContent = conv?.title || 'Conversation';

        // Restore PDF mode if this conversation had PDFs
        if (data.pdfNames && data.pdfNames.length > 0) {
            enablePDFMode(data.pdfNames[0], data.pdfCount || data.pdfNames.length);
        } else {
            disablePDFMode();
        }

        renderConversationList();
        closeSidebar();
    } catch (error) {
        console.error('Error loading conversation:', error);
        disablePDFMode();
    }
}

async function editConversation(conversationId, currentTitle) {
    const modal = document.getElementById('editModal');
    const input = document.getElementById('editTitleInput');
    if (!modal || !input) return;
    input.value = currentTitle;
    modal.style.display = 'flex';

    const saveBtn = document.getElementById('saveEditBtn');
    const cancelBtn = document.getElementById('cancelEditBtn');

    const saveHandler = async () => {
        const newTitle = input.value.trim();
        if (newTitle) {
            try {
                await fetch(`${API_BASE_URL}/conversations/${sessionId}/${conversationId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: newTitle })
                });
                await loadConversations();
                if (currentConversationId === conversationId && chatTitle) {
                    chatTitle.textContent = newTitle;
                }
            } catch (error) {
                console.error('Error editing conversation:', error);
            }
        }
        modal.style.display = 'none';
        saveBtn.removeEventListener('click', saveHandler);
        cancelBtn.removeEventListener('click', cancelHandler);
    };

    const cancelHandler = () => {
        modal.style.display = 'none';
        saveBtn.removeEventListener('click', saveHandler);
        cancelBtn.removeEventListener('click', cancelHandler);
    };

    saveBtn.addEventListener('click', saveHandler);
    cancelBtn.addEventListener('click', cancelHandler);
}

async function deleteConversation(conversationId) {
    if (confirm('Delete this conversation? This action cannot be undone.')) {
        try {
            await fetch(`${API_BASE_URL}/conversations/${sessionId}/${conversationId}`, {
                method: 'DELETE'
            });
            if (currentConversationId === conversationId) {
                currentConversationId = null;
                currentMessages = [];
                renderCurrentConversation();
                disablePDFMode();
            }
            await loadConversations();
        } catch (error) {
            console.error('Error deleting conversation:', error);
        }
    }
}

function renderCurrentConversation() {
    if (!chatMessages) return;

    // Don't clear during upload
    if (isUploading) return;

    if (!currentMessages || currentMessages.length === 0) {
        chatMessages.innerHTML = `
            <div class="welcome-message">
                <i class="fas fa-brain"></i>
                <h2>Welcome to Cerebro</h2>
                <p>I'm your AI study assistant. Upload a PDF to get started!</p>
            </div>
        `;
        return;
    }

    // Clear and rebuild all messages
    chatMessages.innerHTML = '';
    for (const msg of currentMessages) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${msg.role === 'user' ? 'user' : 'bot'}`;
        let content = `<div class="message-content">${formatMessage(msg.content)}`;

        if (msg.attachments && msg.attachments.length > 0) {
            for (const file of msg.attachments) {
                content += `<div class="message-attachment"><i class="fas fa-file-pdf"></i> ${escapeHtml(file.name)}</div>`;
            }
        }

        content += `</div>`;
        messageDiv.innerHTML = content;
        chatMessages.appendChild(messageDiv);
    }

    scrollToBottom();
}

function addMessageToUI(text, role, attachments = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role === 'user' ? 'user' : 'bot'}`;
    let content = `<div class="message-content">${formatMessage(text)}`;
    if (attachments && attachments.length > 0) {
        for (const file of attachments) {
            content += `<div class="message-attachment"><i class="fas fa-file-pdf"></i> ${escapeHtml(file.name)}</div>`;
        }
    }
    content += `</div>`;
    messageDiv.innerHTML = content;
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
}

// SEND MESSAGE

async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    addMessageToUI(message, 'user');
    currentMessages.push({ role: 'user', content: message, timestamp: new Date().toISOString() });
    chatInput.value = '';

    showTypingIndicator();

    try {
        const response = await fetch(`${API_BASE_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                sessionId: sessionId,
                conversationId: currentConversationId,
                history: currentMessages.slice(-10)
            })
        });

        const data = await response.json();
        removeTypingIndicator();

        if (data.answer) {
            addMessageToUI(data.answer, 'bot');
            currentMessages.push({ role: 'assistant', content: data.answer, timestamp: new Date().toISOString() });
            await loadConversations();
        } else {
            addMessageToUI(' Sorry, I received an unexpected response. Please try again.', 'bot');
        }
    } catch (error) {
        console.error('Send message error:', error);
        removeTypingIndicator();
        addMessageToUI(' Sorry, I encountered an error. Please make sure the backend is running.', 'bot');
    }
}

// PDF UPLOAD - FIXED VERSION

if (uploadBtn) {
    uploadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        uploadOptions.classList.toggle('show');
    });
}

if (uploadPdfOption) {
    uploadPdfOption.addEventListener('click', () => {
        uploadOptions.classList.remove('show');
        fileInput.click();
    });
}

document.addEventListener('click', (e) => {
    if (!uploadBtn?.contains(e.target) && !uploadOptions?.contains(e.target)) {
        uploadOptions?.classList.remove('show');
    }
});

if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (files.length === 0) return;

        isUploading = true; // Prevent re-renders from wiping chat

        const fileNames = Array.from(files).map(f => f.name);

        // Show uploading message
        addMessageToUI(` **Uploading ${fileNames.length} file(s)...**\n\n${fileNames.map(f => `• ${f}`).join('\n')}`, 'user');

        // Add these messages to currentMessages array
        currentMessages.push({
            role: 'user',
            content: ` **Uploading ${fileNames.length} file(s)...**\n\n${fileNames.map(f => `• ${f}`).join('\n')}`,
            timestamp: new Date().toISOString()
        });

        // Check file sizes
        let sizeError = false;
        for (const file of files) {
            if (file.size > 10 * 1024 * 1024) {
                addMessageToUI(` **${file.name} exceeds 10MB limit**`, 'bot');
                currentMessages.push({
                    role: 'assistant',
                    content: ` **${file.name} exceeds 10MB limit**`,
                    timestamp: new Date().toISOString()
                });
                sizeError = true;
                break;
            }
        }

        if (sizeError) {
            fileInput.value = '';
            isUploading = false;
            return;
        }

        // Show processing indicator
        const processingMsgId = 'processing_' + Date.now();
        const processingDiv = document.createElement('div');
        processingDiv.id = processingMsgId;
        processingDiv.className = 'message bot';
        processingDiv.innerHTML = `<div class="message-content"><i class="fas fa-circle-notch fa-spin"></i> Processing PDF(s)... Extracting text...</div>`;
        chatMessages.appendChild(processingDiv);
        scrollToBottom();

        const formData = new FormData();
        for (let file of files) formData.append('files', file);
        formData.append('sessionId', sessionId);
        formData.append('conversationId', currentConversationId);

        try {
            const response = await fetch(`${API_BASE_URL}/upload`, {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            // Remove processing indicator
            const processingElement = document.getElementById(processingMsgId);
            if (processingElement) processingElement.remove();

            if (result.success) {
                // Build the success message
                let successMessage = `✅ **PDF Upload Complete!**\n\n`;
                successMessage += `**Files uploaded:**\n${fileNames.map(f => `• ${f}`).join('\n')}\n\n`;
                successMessage += `📊 **Stats:** ${result.pdfCount}/${result.maxPDFs} PDFs | ${Math.round(result.charCount / 1000)}K characters\n\n`;
                successMessage += `📚 **I'm now in PDF Mode.** Ask me questions about your documents!`;

                if (result.truncated) {
                    successMessage += `\n\n⚠️ **Note:** Some content was truncated due to length limits.`;
                }

                // Add success message to UI
                addMessageToUI(successMessage, 'bot');

                // Also add to currentMessages array
                currentMessages.push({
                    role: 'assistant',
                    content: successMessage,
                    timestamp: new Date().toISOString()
                });

                // Enable PDF mode
                enablePDFMode(fileNames[0], result.pdfCount || 1);

                // Force a re-render of messages to ensure everything shows
                renderCurrentConversation();

            } else {
                const errorMsg = ` **Upload failed**\n\n${result.error || 'Please try again.'}`;
                addMessageToUI(errorMsg, 'bot');
                currentMessages.push({
                    role: 'assistant',
                    content: errorMsg,
                    timestamp: new Date().toISOString()
                });
                renderCurrentConversation();
            }
        } catch (error) {
            // Remove processing indicator
            const processingElement = document.getElementById(processingMsgId);
            if (processingElement) processingElement.remove();

            const errorMsg = ' **Failed to upload PDFs**\n\nPlease check your connection.';
            addMessageToUI(errorMsg, 'bot');
            currentMessages.push({
                role: 'assistant',
                content: errorMsg,
                timestamp: new Date().toISOString()
            });
            renderCurrentConversation();
            console.error('Upload error:', error);
        }

        isUploading = false;
        fileInput.value = '';

        // Refresh sidebar list
        try {
            const convResponse = await fetch(`${API_BASE_URL}/conversations/${sessionId}`);
            const convData = await convResponse.json();
            conversations = convData.conversations || [];
            renderConversationList();
        } catch (err) {
            console.error('Error refreshing conversations:', err);
        }
    });
}

// UTILITY FUNCTIONS

function formatMessage(text) {
    if (!text) return '';
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}

function showTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message bot typing';
    typingDiv.id = 'typingIndicator';
    typingDiv.innerHTML = '<div class="message-content"><i class="fas fa-circle-notch fa-spin"></i> Thinking...</div>';
    chatMessages.appendChild(typingDiv);
    scrollToBottom();
}

function removeTypingIndicator() {
    const typing = document.getElementById('typingIndicator');
    if (typing) typing.remove();
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// EVENT LISTENERS

if (sendBtn) sendBtn.addEventListener('click', sendMessage);
if (chatInput) chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
if (newChatBtn) newChatBtn.addEventListener('click', createNewConversation);

if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        if (sessionId) {
            try {
                await fetch(`${API_BASE_URL}/auth/logout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId })
                });
            } catch (e) { }
        }
        localStorage.removeItem('cerebro_session');
        localStorage.removeItem('cerebro_user');
        window.location.href = 'index.html';
    });
}

if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', async () => {
        if (confirm('WARNING: This will permanently delete your account and all your data. This action cannot be undone. Are you sure?')) {
            const confirmText = prompt('Type "DELETE" to confirm deletion:');
            if (confirmText === 'DELETE') {
                try {
                    await fetch(`${API_BASE_URL}/auth/delete-account`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sessionId })
                    });
                    localStorage.removeItem('cerebro_session');
                    localStorage.removeItem('cerebro_user');
                    alert('Your account has been deleted.');
                    window.location.href = 'index.html';
                } catch (error) {
                    alert('Error deleting account. Please try again.');
                }
            } else {
                alert('Deletion cancelled.');
            }
        }
    });
}

// INITIALIZE

loadConversations();

window.loadConversation = loadConversation;
window.editConversation = editConversation;
window.deleteConversation = deleteConversation;
