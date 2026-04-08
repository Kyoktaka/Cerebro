const API_BASE_URL = window.location.origin + '/api';
const sessionId = localStorage.getItem('cerebro_session');
const userData = JSON.parse(localStorage.getItem('cerebro_user') || '{}');

let currentConversationId = null;
let conversations = [];
let currentMessages = [];
let isPDFMode = false;
let currentPDFName = '';
let currentPDFCount = 0;
let currentPDFNames = [];
let isUploading = false;

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

// SIDEBAR-ONLY REFRESH (never reloads conversation)
async function refreshSidebarOnly() {
    try {
        const response = await fetch(`${API_BASE_URL}/conversations/${sessionId}`);
        const data = await response.json();
        conversations = data.conversations || [];
        renderConversationList();
    } catch (err) {
        console.error('Error refreshing sidebar:', err);
    }
}

// PDF MODE FUNCTIONS
function enablePDFMode(pdfName, pdfCount = 1, pdfNames = []) {
    console.log('Enabling PDF Mode');
    isPDFMode = true;
    currentPDFName = pdfName;
    currentPDFCount = pdfCount;
    currentPDFNames = pdfNames.length > 0 ? pdfNames : (pdfName ? [pdfName] : []);

    if (pdfModeBadge) pdfModeBadge.style.display = 'flex';
    if (studyModeBar) studyModeBar.style.display = 'flex';

    renderPDFChips();

    if (pdfCounter) {
        if (pdfCount > 1) {
            pdfCounter.textContent = `${pdfCount}/10`;
            pdfCounter.style.display = 'inline-block';
        } else {
            pdfCounter.style.display = 'none';
        }
    }
    console.log('PDF Mode enabled');
}

function disablePDFMode() {
    console.log('Disabling PDF Mode');
    isPDFMode = false;
    currentPDFName = '';
    currentPDFCount = 0;
    currentPDFNames = [];

    if (pdfModeBadge) pdfModeBadge.style.display = 'none';
    if (studyModeBar) studyModeBar.style.display = 'none';

    closePDFManager();
    console.log('PDF Mode disabled');
}


// PDF Manage
function renderPDFChips() {
    if (!pdfFileNameSpan) return;
    pdfFileNameSpan.innerHTML = '';

    if (currentPDFNames.length === 0) {
        pdfFileNameSpan.textContent = currentPDFName || '';
        return;
    }

    currentPDFNames.forEach((name) => {
        const chip = document.createElement('span');
        chip.className = 'pdf-chip';
        chip.title = name;
        chip.dataset.name = name;
        chip.innerHTML = `<i class="fas fa-file-pdf"></i> ${truncateName(name, 20)}`;
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            openPDFManager();
        });
        pdfFileNameSpan.appendChild(chip);
    });

    // Add a "Manage" button after the chips if more than 1
    if (currentPDFNames.length > 1) {
        const manageBtn = document.createElement('span');
        manageBtn.className = 'pdf-manage-btn';
        manageBtn.innerHTML = `<i class="fas fa-sliders-h"></i> Manage`;
        manageBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPDFManager();
        });
        pdfFileNameSpan.appendChild(manageBtn);
    }
}

function truncateName(name, max) {
    if (name.length <= max) return name;
    const ext = name.lastIndexOf('.');
    if (ext !== -1) {
        const keep = max - 3 - (name.length - ext);
        return keep > 0 ? name.substring(0, keep) + '...' + name.substring(ext) : '...' + name.substring(ext);
    }
    return name.substring(0, max) + '...';
}

// PDF MANAGER PANEL (multi-select)
let activePDFManagerPanel = null;

function openPDFManager() {
    // Toggle: if panel is already open, close it
    if (activePDFManagerPanel) {
        closePDFManager();
        return;
    }

    const panel = document.createElement('div');
    panel.id = 'pdfManagerPanel';
    panel.className = 'pdf-manager-panel';

    const listItems = currentPDFNames.map((name) => `
        <label class="pdf-manager-item" title="${escapeHtml(name)}">
            <input type="checkbox" class="pdf-focus-check" data-name="${escapeHtml(name)}" checked>
            <i class="fas fa-file-pdf"></i>
            <span class="pdf-item-name">${escapeHtml(truncateName(name, 30))}</span>
        </label>
    `).join('');

    panel.innerHTML = `
        <div class="pdf-manager-header">
            <i class="fas fa-layer-group"></i>
            <span class="pdf-manager-title">Manage PDFs (${currentPDFNames.length}/10)</span>
            <button class="pdf-manager-close" id="pdfManagerClose"><i class="fas fa-times"></i></button>
        </div>
        <p class="pdf-manager-hint">Checked = AI will focus on it | Unchecked = excluded</p>
        <div class="pdf-manager-list">
            ${listItems}
        </div>
        <div class="pdf-manager-footer">
            <button class="pdf-manager-action-btn pdf-select-all-btn" id="pdfSelectAll">
                <i class="fas fa-check-double"></i> Select All
            </button>
            <button class="pdf-manager-action-btn pdf-apply-btn" id="pdfApplyFocus">
                <i class="fas fa-crosshairs"></i> Apply Focus
            </button>
            <button class="pdf-manager-action-btn pdf-delete-btn" id="pdfDeleteSelected">
                <i class="fas fa-trash-alt"></i> Delete Checked
            </button>
        </div>
    `;

    studyModeBar.parentNode.insertBefore(panel, studyModeBar.nextSibling);
    activePDFManagerPanel = panel;
    requestAnimationFrame(() => panel.classList.add('pdf-manager-panel-open'));

    document.getElementById('pdfManagerClose').addEventListener('click', (e) => {
        e.stopPropagation();
        closePDFManager();
    });

    document.getElementById('pdfSelectAll').addEventListener('click', (e) => {
        e.stopPropagation();
        const checks = panel.querySelectorAll('.pdf-focus-check');
        const allChecked = [...checks].every(c => c.checked);
        checks.forEach(c => c.checked = !allChecked);
        e.currentTarget.innerHTML = allChecked
            ? '<i class="fas fa-check-double"></i> Select All'
            : '<i class="fas fa-times"></i> Deselect All';
    });

    document.getElementById('pdfApplyFocus').addEventListener('click', async (e) => {
        e.stopPropagation();
        const selected = getSelectedNames(panel);
        if (selected.length === 0) {
            showPanelError(panel, 'Check at least one PDF to focus on.');
            return;
        }
        if (selected.length === currentPDFNames.length) {
            // All selected = no change, just close
            closePDFManager();
            return;
        }
        await applyFocus(selected);
    });

    document.getElementById('pdfDeleteSelected').addEventListener('click', async (e) => {
        e.stopPropagation();
        const selected = getSelectedNames(panel);
        if (selected.length === 0) {
            showPanelError(panel, 'Check at least one PDF to delete.');
            return;
        }
        await deleteSelectedPDFs(selected);
    });
}

function getSelectedNames(panel) {
    return [...panel.querySelectorAll('.pdf-focus-check:checked')].map(c => c.dataset.name);
}

function showPanelError(panel, msg) {
    let err = panel.querySelector('.pdf-panel-error');
    if (!err) {
        err = document.createElement('p');
        err.className = 'pdf-panel-error';
        panel.querySelector('.pdf-manager-footer').before(err);
    }
    err.textContent = msg;
    setTimeout(() => { if (err.parentNode) err.remove(); }, 2500);
}

function closePDFManager() {
    if (activePDFManagerPanel) {
        activePDFManagerPanel.remove();
        activePDFManagerPanel = null;
    }
}

// Close panel when clicking outside
document.addEventListener('click', (e) => {
    if (activePDFManagerPanel &&
        !activePDFManagerPanel.contains(e.target) &&
        !e.target.closest('.pdf-chip') &&
        !e.target.closest('.pdf-manage-btn')) {
        closePDFManager();
    }
});

async function applyFocus(namesToKeep) {
    closePDFManager();

    try {
        await fetch(`${API_BASE_URL}/conversations/${sessionId}/focus-pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversationId: currentConversationId,
                pdfNames: namesToKeep
            })
        });
    } catch (error) {
        console.error('Focus PDF error:', error);
    }

    currentPDFNames = namesToKeep;
    currentPDFCount = namesToKeep.length;
    currentPDFName = namesToKeep[0];
    enablePDFMode(currentPDFName, currentPDFCount, currentPDFNames);

    const listStr = namesToKeep.map(n => `- ${n}`).join('\n');
    const msg = `Focus applied to ${namesToKeep.length} PDF(s)\n\n${listStr}\n\nAsk me anything about these documents!`;
    addMessageToUI(msg, 'bot');
    currentMessages.push({ role: 'assistant', content: msg, timestamp: new Date().toISOString() });
}

async function deleteSelectedPDFs(namesToDelete) {
    const remaining = currentPDFNames.filter(n => !namesToDelete.includes(n));
    const label = namesToDelete.length === 1 ? `"${namesToDelete[0]}"` : `${namesToDelete.length} PDFs`;
    const confirmMsg = remaining.length === 0
        ? `Delete ${label}? PDF Mode will be disabled.`
        : `Delete ${label}? ${remaining.length} PDF(s) will remain.`;

    if (!confirm(confirmMsg)) return;
    closePDFManager();

    for (const name of namesToDelete) {
        try {
            await fetch(`${API_BASE_URL}/conversations/${sessionId}/delete-pdf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationId: currentConversationId, pdfName: name })
            });
        } catch (e) {
            console.error('Delete PDF error:', e);
        }
    }

    currentPDFNames = remaining;
    currentPDFCount = remaining.length;

    if (remaining.length === 0) {
        disablePDFMode();
        const msg = `Removed ${label}\n\nNo PDFs remaining - switched back to normal chat mode.`;
        addMessageToUI(msg, 'bot');
        currentMessages.push({ role: 'assistant', content: msg, timestamp: new Date().toISOString() });
    } else {
        currentPDFName = remaining[0];
        enablePDFMode(currentPDFName, currentPDFCount, remaining);
        const msg = `Removed ${label}\n\n${remaining.length} PDF(s) still loaded. You can upload up to ${10 - remaining.length} more.`;
        addMessageToUI(msg, 'bot');
        currentMessages.push({ role: 'assistant', content: msg, timestamp: new Date().toISOString() });
    }
}

// Exit PDF Mode button
if (exitStudyModeBtn) {
    exitStudyModeBtn.addEventListener('click', async () => {
        console.log('Exit PDF Mode button clicked');
        try {
            await fetch(`${API_BASE_URL}/conversations/${sessionId}/clear-pdfs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationId: currentConversationId })
            });
            console.log('PDF context cleared');
        } catch (error) {
            console.error('Error clearing PDF context:', error);
        }
        disablePDFMode();
        const msg = "Exited PDF Mode\n\nSwitched back to normal chat mode. Upload a new PDF anytime!";
        addMessageToUI(msg, 'bot');
        currentMessages.push({ role: 'assistant', content: msg, timestamp: new Date().toISOString() });
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

        if (data.pdfNames && data.pdfNames.length > 0) {
            enablePDFMode(data.pdfNames[0], data.pdfCount || data.pdfNames.length, data.pdfNames);
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
                await refreshSidebarOnly();
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

    if (isUploading) return;

    if (currentMessages.length === 0) {
        chatMessages.innerHTML = `
            <div class="welcome-message">
                <i class="fas fa-brain"></i>
                <h2>Welcome to Cerebro</h2>
                <p>I'm your AI study assistant. Upload a PDF to get started!</p>
            </div>
        `;
        return;
    }

    chatMessages.innerHTML = '';
    for (const msg of currentMessages) {
        addMessageToUI(msg.content, msg.role, msg.attachments, msg._isProcessing || false);
    }
    scrollToBottom();
}

function addMessageToUI(text, role, attachments = null, isProcessing = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role === 'user' ? 'user' : 'bot'}`;
    let content;
    if (isProcessing) {
        content = `<div class="message-content status-content"><i class="fas fa-circle-notch fa-spin"></i> ${formatMessage(text)}</div>`;
    } else {
        content = `<div class="message-content">${formatMessage(text)}`;
        if (attachments && attachments.length > 0) {
            for (const file of attachments) {
                content += `<div class="message-attachment"><i class="fas fa-file-pdf"></i> ${escapeHtml(file.name)}</div>`;
            }
        }
        content += `</div>`;
    }
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
                message,
                sessionId,
                conversationId: currentConversationId,
                history: currentMessages.slice(-10)
            })
        });

        const data = await response.json();
        removeTypingIndicator();

        if (data.answer) {
            addMessageToUI(data.answer, 'bot');
            currentMessages.push({ role: 'assistant', content: data.answer, timestamp: new Date().toISOString() });
            // Only refresh sidebar, NEVER reload the conversation from server
            await refreshSidebarOnly();
        } else {
            addMessageToUI('Sorry, I received an unexpected response. Please try again.', 'bot');
        }
    } catch (error) {
        console.error('Send message error:', error);
        removeTypingIndicator();
        addMessageToUI('Sorry, I encountered an error. Please make sure the backend is running.', 'bot');
    }
}


// PDF UPLOAD
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

        isUploading = true;
        const fileNames = Array.from(files).map(f => f.name);

        // Save upload message into currentMessages immediately
        const uploadMsg = `Uploading ${fileNames.length} file(s)...\n\n${fileNames.map(f => `- ${f}`).join('\n')}`;
        addMessageToUI(uploadMsg, 'user');
        currentMessages.push({ role: 'user', content: uploadMsg, timestamp: new Date().toISOString() });

        // Check file sizes
        for (const file of files) {
            if (file.size > 10 * 1024 * 1024) {
                const errMsg = `${file.name} exceeds 10MB limit`;
                addMessageToUI(errMsg, 'bot');
                currentMessages.push({ role: 'assistant', content: errMsg, timestamp: new Date().toISOString() });
                fileInput.value = '';
                isUploading = false;
                return;
            }
        }

        // Add spinner to currentMessages so it survives any re-render
        const processingMsg = { role: 'assistant', content: 'Processing PDF(s)... Extracting text...', _isProcessing: true, timestamp: new Date().toISOString() };
        currentMessages.push(processingMsg);
        const processingIndex = currentMessages.length - 1;
        addMessageToUI(processingMsg.content, 'assistant');

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

            // Remove the processing placeholder from currentMessages
            currentMessages.splice(processingIndex, 1);
            renderCurrentConversation();

            if (result.success) {
                const allPDFNames = result.pdfNames || fileNames;
                let successMessage = `PDF Upload Complete!\n\n`;
                successMessage += `Files uploaded:\n${fileNames.map(f => `- ${f}`).join('\n')}\n\n`;
                successMessage += `Stats: ${result.pdfCount}/${result.maxPDFs} PDFs | ${Math.round(result.charCount / 1000)}K characters\n\n`;
                successMessage += `PDF Mode active. Click the PDF chips above to manage which documents to focus on!`;
                if (result.truncated) successMessage += `\n\nNote: Some content was truncated due to length limits.`;

                // Save success message to currentMessages so it persists
                addMessageToUI(successMessage, 'bot');
                currentMessages.push({ role: 'assistant', content: successMessage, timestamp: new Date().toISOString() });

                enablePDFMode(fileNames[0], result.pdfCount || 1, allPDFNames);
            } else {
                const errMsg = `Upload failed\n\n${result.error || 'Please try again.'}`;
                addMessageToUI(errMsg, 'bot');
                currentMessages.push({ role: 'assistant', content: errMsg, timestamp: new Date().toISOString() });
            }
        } catch (error) {
            // Remove the processing placeholder from currentMessages
            currentMessages.splice(processingIndex, 1);
            renderCurrentConversation();
            const errMsg = 'Failed to upload PDFs\n\nPlease check your connection.';
            addMessageToUI(errMsg, 'bot');
            currentMessages.push({ role: 'assistant', content: errMsg, timestamp: new Date().toISOString() });
        }

        isUploading = false;
        fileInput.value = '';

        // Only refresh sidebar - never reload conversation
        await refreshSidebarOnly();
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
