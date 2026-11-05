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
let activePDFNames = [];
let isUploading = false;
let selectedModel = '';
let embeddingAvailable = false;
let isSending = false;
let isLoadingModels = false;
let conversationRequestVersion = 0;


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
const ollamaModel = document.getElementById('ollamaModel');
const ollamaStatus = document.getElementById('ollamaStatus');
const ollamaStatusText = document.getElementById('ollamaStatusText');
const retryOllamaBtn = document.getElementById('retryOllamaBtn');

if (!sessionId) {
    window.location.href = 'login.html';
}
if (userName) userName.textContent = userData.firstName || userData.lastName;

function setOllamaStatus(message, state) {
    ollamaStatus.dataset.state = state;
    ollamaStatusText.textContent = message;
}

function syncOllamaControls() {
    sendBtn.disabled = !selectedModel || isSending || isUploading;
    uploadBtn.disabled = !embeddingAvailable || isUploading || isSending;
    retryOllamaBtn.disabled = isLoadingModels || isUploading || isSending;
    if (uploadBtn.disabled) uploadOptions.classList.remove('show');
}

function modelIsAvailable(name, models) {
    return models.find(model => model === name || model === `${name}:latest`);
}

async function loadOllamaModels() {
    if (isLoadingModels || isUploading || isSending) return;
    isLoadingModels = true;
    setOllamaStatus('Checking Ollama...', 'loading');
    selectedModel = '';
    embeddingAvailable = false;
    ollamaModel.disabled = true;
    ollamaModel.replaceChildren(new Option('Checking Ollama...', ''));
    syncOllamaControls();

    try {
        const response = await fetch(`${API_BASE_URL}/models`);
        const data = await response.json();
        if (!response.ok || !data.available) {
            throw new Error(data.error || 'Ollama is unavailable. Start it and check OLLAMA_BASE_URL (default http://localhost:11434).');
        }

        const allModels = (data.models || []).map(model => model.name).filter(Boolean);
        const chatModels = allModels.filter(name => !modelIsAvailable(data.embeddingModel, [name]));
        if (chatModels.length === 0) {
            throw new Error('No chat model found. Run ollama pull llama3.2, then refresh models.');
        }

        ollamaModel.replaceChildren(...chatModels.map(name => new Option(name, name)));
        const savedModel = localStorage.getItem('cerebro_ollama_model');
        selectedModel = modelIsAvailable(savedModel, chatModels)
            || modelIsAvailable(data.defaultModel, chatModels)
            || chatModels[0];
        ollamaModel.value = selectedModel;
        ollamaModel.disabled = false;
        embeddingAvailable = data.embeddingAvailable === true;
        syncOllamaControls();

        if (embeddingAvailable) {
            setOllamaStatus('Ollama ready. Chat and PDF study available.', 'ready');
        } else {
            setOllamaStatus(`Chat ready. To upload PDFs, run ollama pull ${data.embeddingModel}, then refresh models.`, 'error');
        }
    } catch (error) {
        ollamaModel.replaceChildren(new Option('No model available', ''));
        setOllamaStatus(error.message || 'Cannot reach Cerebro. Start the server, then refresh models.', 'error');
        syncOllamaControls();
    } finally {
        isLoadingModels = false;
        syncOllamaControls();
    }
}

ollamaModel.addEventListener('change', () => {
    selectedModel = ollamaModel.value;
    localStorage.setItem('cerebro_ollama_model', selectedModel);
    syncOllamaControls();
});
retryOllamaBtn.addEventListener('click', loadOllamaModels);
loadOllamaModels();

async function refreshSidebarOnly() {
    try {
        const response = await fetch(`${API_BASE_URL}/conversations/${sessionId}`);
        const data = await response.json();
        conversations = data.conversations || [];
        renderConversationList();
        const activeConversation = conversations.find(conversation => conversation.id === currentConversationId);
        if (activeConversation && chatTitle) chatTitle.textContent = activeConversation.title;
    } catch (err) {
        console.error('Error refreshing sidebar:', err);
    }
}

// PDF MODE FUNCTIONS
function enablePDFMode(pdfName, pdfCount = 1, pdfNames = [], focusedNames = pdfNames) {
    console.log('Enabling PDF Mode');
    isPDFMode = true;
    currentPDFName = pdfName;
    currentPDFCount = pdfCount;
    currentPDFNames = pdfNames.length > 0 ? pdfNames : (pdfName ? [pdfName] : []);
    activePDFNames = [...focusedNames];

    if (pdfModeBadge) pdfModeBadge.style.display = 'flex';
    if (studyModeBar) studyModeBar.style.display = 'flex';

    renderPDFChips();

    if (pdfCounter) {
        if (currentPDFNames.length > 1) {
            pdfCounter.textContent = `${activePDFNames.length}/${currentPDFNames.length} focused`;
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
    activePDFNames = [];

    if (pdfModeBadge) pdfModeBadge.style.display = 'none';
    if (studyModeBar) studyModeBar.style.display = 'none';

    closePDFManager();
    console.log('PDF Mode disabled');
}


function renderPDFChips() {
    if (!pdfFileNameSpan) return;
    
    pdfFileNameSpan.innerHTML = '';
    
    if (currentPDFNames.length === 0) {
        if (currentPDFName) {
            const chip = document.createElement('button');
            chip.className = 'pdf-chip';
            chip.type = 'button';
            chip.title = currentPDFName;
            chip.innerHTML = `<i class="fas fa-file-pdf"></i> ${escapeHtml(truncateName(currentPDFName, 25))}`;
            chip.addEventListener('click', () => openPDFManager());
            pdfFileNameSpan.appendChild(chip);
        }
    } else {
        const maxVisible = window.innerWidth <= 480 ? 2 : (window.innerWidth <= 768 ? 3 : 5);
        const visiblePDFs = activePDFNames.slice(0, maxVisible);
        const remainingActive = activePDFNames.length - visiblePDFs.length;
        
        visiblePDFs.forEach((name) => {
            const chip = document.createElement('button');
            chip.className = 'pdf-chip';
            chip.type = 'button';
            chip.title = name;
            chip.innerHTML = `<i class="fas fa-file-pdf"></i> ${escapeHtml(truncateName(name, 20))}`;
            chip.addEventListener('click', () => openPDFManager());
            pdfFileNameSpan.appendChild(chip);
        });
        
        if (remainingActive > 0) {
            const moreChip = document.createElement('button');
            moreChip.className = 'pdf-chip';
            moreChip.type = 'button';
            moreChip.innerHTML = `<i class="fas fa-ellipsis-h"></i> +${remainingActive}`;
            moreChip.addEventListener('click', () => openPDFManager());
            pdfFileNameSpan.appendChild(moreChip);
        }
        
        const waitingCount = currentPDFNames.length - activePDFNames.length;
        if (waitingCount > 0) {
            const waitingChip = document.createElement('button');
            waitingChip.className = 'pdf-chip';
            waitingChip.type = 'button';
            waitingChip.classList.add('pdf-chip-waiting');
            waitingChip.title = 'PDFs in waiting list (not focused)';
            waitingChip.innerHTML = `<i class="fas fa-clock"></i> +${waitingCount} waiting`;
            waitingChip.addEventListener('click', () => openPDFManager());
            pdfFileNameSpan.appendChild(waitingChip);
        }
        
        if (currentPDFNames.length > 1) {
            const manageBtn = document.createElement('button');
            manageBtn.className = 'pdf-manage-btn';
            manageBtn.type = 'button';
            manageBtn.innerHTML = `<i class="fas fa-sliders-h"></i> Manage`;
            manageBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openPDFManager();
            });
            pdfFileNameSpan.appendChild(manageBtn);
        }
    }
    
    if (pdfCounter) {
        if (currentPDFNames.length > 1) {
            pdfCounter.textContent = `${activePDFNames.length}/${currentPDFNames.length} focused`;
            pdfCounter.style.display = 'inline-block';
        } else {
            pdfCounter.style.display = 'none';
        }
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

// PDF MANAGER PANEL
let activePDFManagerPanel = null;

function openPDFManager() {
    if (activePDFManagerPanel) {
        closePDFManager();
        return;
    }

    const panel = document.createElement('div');
    panel.id = 'pdfManagerPanel';
    panel.className = 'pdf-manager-panel';

    const listItems = currentPDFNames.map((name) => {
        const isActive = activePDFNames.includes(name);
        return `
            <label class="pdf-manager-item" title="${escapeHtml(name)}">
                <input type="checkbox" class="pdf-focus-check" data-name="${escapeHtml(name)}" ${isActive ? 'checked' : ''}>
                <i class="fas fa-file-pdf"></i>
                <span class="pdf-item-name">${escapeHtml(truncateName(name, 30))}</span>
                ${!isActive ? '<span style="font-size:0.65rem; color:var(--text-muted); margin-left:auto;">(waiting)</span>' : ''}
            </label>
        `;
    }).join('');

    panel.innerHTML = `
        <div class="pdf-manager-header">
            <i class="fas fa-layer-group"></i>
            <span class="pdf-manager-title">Manage PDFs (${activePDFNames.length}/${currentPDFNames.length} focused)</span>
            <button class="pdf-manager-close" id="pdfManagerClose" aria-label="Close PDF manager"><i class="fas fa-times"></i></button>
        </div>
        <p class="pdf-manager-hint">Checked = AI will focus on it | Unchecked = waiting list (kept but not used)</p>
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
    if (allChecked) {
        checks.forEach(c => c.checked = false);
        e.currentTarget.innerHTML = '<i class="fas fa-check-double"></i> Select All';
    } else {
        checks.forEach(c => c.checked = true);
        e.currentTarget.innerHTML = '<i class="fas fa-times"></i> Deselect All';
    }
});

    document.getElementById('pdfApplyFocus').addEventListener('click', async (e) => {
    e.stopPropagation();
    const selected = getSelectedNames(panel);
    if (selected.length === 0) {
        showPanelError(panel, 'Check at least one PDF to focus on.');
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

document.addEventListener('click', (e) => {
    if (activePDFManagerPanel &&
        !activePDFManagerPanel.contains(e.target) &&
        !e.target.closest('.pdf-chip') &&
        !e.target.closest('.pdf-manage-btn')) {
        closePDFManager();
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (activePDFManagerPanel) closePDFManager();
    const editModal = document.getElementById('editModal');
    if (editModal.style.display !== 'none') document.getElementById('cancelEditBtn').click();
});

async function applyFocus(namesToFocus) {
    const targetConversationId = currentConversationId;
    try {
        const response = await fetch(`${API_BASE_URL}/conversations/${sessionId}/focus-pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversationId: targetConversationId,
                pdfNames: namesToFocus
            })
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Could not update PDF focus.');
        if (currentConversationId !== targetConversationId) return;
        activePDFNames = data.activePdfNames;
        currentPDFNames = data.pdfNames;
        currentPDFName = activePDFNames[0] || '';
        currentPDFCount = data.pdfCount;
        closePDFManager();
        renderPDFChips();
    } catch (error) {
        if (currentConversationId !== targetConversationId) return;
        if (activePDFManagerPanel) showPanelError(activePDFManagerPanel, error.message);
        else addMessageToUI(`Could not update PDF focus: ${error.message}`, 'bot');
        return;
    }

    if (pdfCounter && currentPDFNames.length > 1) {
        pdfCounter.textContent = `${activePDFNames.length}/${currentPDFNames.length} focused`;
    }
    const waitingCount = currentPDFNames.length - activePDFNames.length;
    let message = `Focus applied to ${activePDFNames.length} PDF(s)`;
    
    if (waitingCount > 0) {
        const waitingPDFs = currentPDFNames.filter(n => !activePDFNames.includes(n));
        message += `\n\n${waitingCount} PDF(s) in waiting list:\n${waitingPDFs.map(n => `- ${n}`).join('\n')}`;
        message += `\n\nCheck them in the manager to add back to focus.`;
    } else {
        message += `\n\nAll ${currentPDFNames.length} PDF(s) are now in focus.`;
    }
    message += `\n\nAsk me anything about your focused documents!`;

    addMessageToUI(message, 'bot');
    currentMessages.push({ role: 'assistant', content: message, timestamp: new Date().toISOString() });
}


async function deleteSelectedPDFs(namesToDelete) {
    const targetConversationId = currentConversationId;
    const remaining = currentPDFNames.filter(n => !namesToDelete.includes(n));
    const label = namesToDelete.length === 1 ? `"${namesToDelete[0]}"` : `${namesToDelete.length} PDFs`;
    const confirmMsg = remaining.length === 0
        ? `Delete ${label}? PDF Mode will be disabled.`
        : `Delete ${label}? ${remaining.length} PDF(s) will remain.`;

    if (!confirm(confirmMsg)) return;

    let result;
    try {
        for (const name of namesToDelete) {
            const response = await fetch(`${API_BASE_URL}/conversations/${sessionId}/delete-pdf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationId: targetConversationId, pdfName: name })
            });
            result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || `Could not delete ${name}.`);
        }
    } catch (error) {
        if (currentConversationId !== targetConversationId) return;
        await loadConversation(targetConversationId);
        if (currentConversationId !== targetConversationId) return;
        addMessageToUI(`PDF deletion stopped: ${error.message}`, 'bot');
        return;
    }

    if (currentConversationId !== targetConversationId) return;
    closePDFManager();
    currentPDFNames = result.remainingPDFs;
    activePDFNames = result.activePdfNames;
    currentPDFCount = result.pdfCount;

    if (currentPDFCount === 0) {
        disablePDFMode();
        const msg = `Removed ${label}\n\nNo PDFs remaining - switched back to normal chat mode.`;
        addMessageToUI(msg, 'bot');
        currentMessages.push({ role: 'assistant', content: msg, timestamp: new Date().toISOString() });
    } else {
        currentPDFName = activePDFNames[0] || currentPDFNames[0];
        enablePDFMode(currentPDFName, currentPDFCount, currentPDFNames, activePDFNames);
        const msg = `Removed ${label}\n\n${currentPDFCount} PDF(s) still loaded. You can upload up to ${10 - currentPDFCount} more.`;
        addMessageToUI(msg, 'bot');
        currentMessages.push({ role: 'assistant', content: msg, timestamp: new Date().toISOString() });
    }
}

// Exit PDF Mode button
if (exitStudyModeBtn) {
    exitStudyModeBtn.addEventListener('click', async () => {
        const targetConversationId = currentConversationId;
        console.log('Exit PDF Mode button clicked');
        try {
            const response = await fetch(`${API_BASE_URL}/conversations/${sessionId}/clear-pdfs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationId: targetConversationId })
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Could not clear PDFs.');
            console.log('PDF context cleared');
        } catch (error) {
            if (currentConversationId === targetConversationId) addMessageToUI(`Could not exit PDF mode: ${error.message}`, 'bot');
            return;
        }
        if (currentConversationId !== targetConversationId) return;
        disablePDFMode();
        const msg = "Exited PDF Mode\n\nSwitched back to normal chat mode. Upload a new PDF anytime!";
        addMessageToUI(msg, 'bot');
        currentMessages.push({ role: 'assistant', content: msg, timestamp: new Date().toISOString() });
    });
}


let isSidebarCollapsed = false;

function syncSidebarAccessibility() {
    const hidden = window.innerWidth <= 768
        ? !sidebar.classList.contains('open')
        : sidebar.classList.contains('collapsed');
    sidebar.inert = hidden;
    menuToggle.setAttribute('aria-expanded', String(!hidden));
}

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
    syncSidebarAccessibility();
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
    syncSidebarAccessibility();
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
    syncSidebarAccessibility();
}

loadSidebarState();

if (menuToggle) menuToggle.addEventListener('click', toggleSidebar);
if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebar);

document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768) {
        if (!sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
            sidebar.classList.remove('open');
            syncSidebarAccessibility();
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
    syncSidebarAccessibility();
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

    for (const [key, list] of Object.entries({ today: todayList, yesterday: yesterdayList, week: weekList, month: monthList })) {
        if (!list) continue;
        list.innerHTML = groups[key].map(conv => createConversationItem(conv)).join('');
        list.previousElementSibling.hidden = groups[key].length === 0;
    }
}

function createConversationItem(conv) {
    const isActive = currentConversationId === conv.id;
    const title = conv.title || 'New Conversation';
    const date = new Date(conv.updatedAt).toLocaleDateString();
    return `
        <div class="conversation-item ${isActive ? 'active' : ''}" data-id="${escapeHtml(conv.id)}">
            <button type="button" class="conversation-info" data-action="load" data-id="${escapeHtml(conv.id)}">
                <span class="conversation-title">${escapeHtml(title)}</span>
                <span class="conversation-date">${date}</span>
            </button>
            <div class="conversation-actions">
                <button type="button" class="conv-edit" data-action="edit" data-id="${escapeHtml(conv.id)}" aria-label="Edit ${escapeHtml(title)}">
                    <i class="fas fa-pen"></i>
                </button>
                <button type="button" class="conv-delete" data-action="delete" data-id="${escapeHtml(conv.id)}" aria-label="Delete ${escapeHtml(title)}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

document.querySelector('.conversations-section').addEventListener('click', (event) => {
    const control = event.target.closest('button[data-action]');
    if (!control) return;
    const conversation = conversations.find(item => item.id === control.dataset.id);
    if (!conversation) return;
    if (control.dataset.action === 'load') loadConversation(conversation.id);
    if (control.dataset.action === 'edit') editConversation(conversation.id, conversation.title || 'New Conversation');
    if (control.dataset.action === 'delete') deleteConversation(conversation.id);
});

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
    const requestVersion = ++conversationRequestVersion;
    try {
        const response = await fetch(`${API_BASE_URL}/conversations/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
        });
        const data = await response.json();
        if (requestVersion !== conversationRequestVersion) return;
        currentConversationId = data.conversationId;
        currentMessages = [];
        await loadConversations();
        if (requestVersion !== conversationRequestVersion || currentConversationId !== data.conversationId) return;
        renderCurrentConversation();
        if (chatTitle) chatTitle.textContent = 'New Conversation';
        disablePDFMode();
        if (window.innerWidth <= 768) closeSidebar();
    } catch (error) {
        if (requestVersion !== conversationRequestVersion) return;
        console.error('Error creating conversation:', error);
        renderCurrentConversation();
    }
}

async function loadConversation(conversationId) {
    const requestVersion = ++conversationRequestVersion;
    currentConversationId = conversationId;
    closePDFManager();
    try {
        const response = await fetch(`${API_BASE_URL}/conversations/${sessionId}/${conversationId}`);
        const data = await response.json();
        if (requestVersion !== conversationRequestVersion || currentConversationId !== conversationId) return;
        currentMessages = data.messages || [];
        renderCurrentConversation();
        const conv = conversations.find(c => c.id === conversationId);
        if (chatTitle) chatTitle.textContent = conv?.title || 'Conversation';

        if (data.pdfNames && data.pdfNames.length > 0) {
            enablePDFMode(data.activePdfNames?.[0] || data.pdfNames[0], data.pdfCount || data.pdfNames.length, data.pdfNames, data.activePdfNames || data.pdfNames);
        } else {
            disablePDFMode();
        }

        renderConversationList();
        if (window.innerWidth <= 768) closeSidebar();
    } catch (error) {
        if (requestVersion !== conversationRequestVersion || currentConversationId !== conversationId) return;
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
    input.focus();

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

    if (currentMessages.length === 0) {
        chatMessages.innerHTML = `
            <div class="welcome-message">
                <i class="fas fa-brain"></i>
                <h2>Welcome to Cerebro</h2>
                <p>Choose a local model, then ask a question or upload a PDF.</p>
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
        content = `<div class="message-content status-content">${formatMessage(text)}</div>`;
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
    return messageDiv;
}


// SEND MESSAGE
async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message || !selectedModel || isSending || isUploading) return;

    isSending = true;
    syncOllamaControls();
    const targetConversationId = currentConversationId;

    if (currentMessages.length === 0) chatMessages.replaceChildren();
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
                conversationId: targetConversationId,
                model: selectedModel,
                stream: true
            })
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || `Chat request failed (${response.status}).`);
        }

        if (!response.body) throw new Error('This browser cannot receive streamed responses.');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        let answer = '';
        let finished = false;
        let answerElement = null;

        function updateAnswer() {
            if (currentConversationId !== targetConversationId) return;
            removeTypingIndicator();
            if (!answerElement) answerElement = addMessageToUI('', 'bot').querySelector('.message-content');
            answerElement.innerHTML = formatMessage(answer);
            scrollToBottom();
        }

        function handleEvent(line) {
            if (!line.trim()) return;
            const event = JSON.parse(line);
            if (event.type === 'delta') {
                answer += event.content || '';
                updateAnswer();
            } else if (event.type === 'done') {
                answer = event.answer || answer;
                finished = true;
                updateAnswer();
            } else if (event.type === 'error') {
                throw new Error(event.error || 'Ollama stopped generating.');
            }
        }

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
            const lines = pending.split('\n');
            pending = lines.pop();
            for (const line of lines) handleEvent(line);
        }
        pending += decoder.decode();
        if (pending.trim()) handleEvent(pending);
        if (!finished) throw new Error('Ollama closed the response before finishing.');

        removeTypingIndicator();
        if (currentConversationId === targetConversationId) {
            currentMessages.push({ role: 'assistant', content: answer, timestamp: new Date().toISOString() });
        }
        await refreshSidebarOnly();
    } catch (error) {
        console.error('Send message error:', error);
        removeTypingIndicator();
        if (currentConversationId === targetConversationId) {
            addMessageToUI(`Response stopped: ${error.message}`, 'bot');
        }
        if (/ollama|model|connect|fetch/i.test(error.message)) {
            setOllamaStatus(`${error.message} Check Ollama, then refresh models.`, 'error');
            selectedModel = '';
            embeddingAvailable = false;
            ollamaModel.disabled = true;
        }
    } finally {
        isSending = false;
        syncOllamaControls();
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
        const targetConversationId = currentConversationId;

        isUploading = true;
        syncOllamaControls();
        const fileNames = Array.from(files).map(f => f.name);

        const uploadMsg = `Uploading ${fileNames.length} file(s)...\n\n${fileNames.map(f => `- ${f}`).join('\n')}`;
        if (currentMessages.length === 0) chatMessages.replaceChildren();
        addMessageToUI(uploadMsg, 'user');
        currentMessages.push({ role: 'user', content: uploadMsg, timestamp: new Date().toISOString() });
        for (const file of files) {
            if (file.size > 10 * 1024 * 1024) {
                const errMsg = `${file.name} exceeds 10MB limit`;
                addMessageToUI(errMsg, 'bot');
                currentMessages.push({ role: 'assistant', content: errMsg, timestamp: new Date().toISOString() });
                fileInput.value = '';
                isUploading = false;
                syncOllamaControls();
                return;
            }
        }

        const processingMsg = { role: 'assistant', content: 'Processing PDF(s)... Extracting text...', _isProcessing: true, timestamp: new Date().toISOString() };
        addMessageToUI(processingMsg.content, 'assistant', null, true);
        const spinnerEl = chatMessages.lastElementChild;

        const formData = new FormData();
        for (let file of files) formData.append('files', file);
        formData.append('sessionId', sessionId);
        formData.append('conversationId', targetConversationId);

        try {
            const response = await fetch(`${API_BASE_URL}/upload`, {
                method: 'POST',
                body: formData
            });
            const result = await response.json();

            if (spinnerEl && spinnerEl.parentNode) spinnerEl.remove();

            if (currentConversationId === targetConversationId && result.success) {
                const allPDFNames = result.pdfNames || fileNames;
                let successMessage = `PDF Upload Complete!\n\n`;
                successMessage += `Files uploaded:\n${fileNames.map(f => `- ${f}`).join('\n')}\n\n`;
                successMessage += `Stats: ${result.pdfCount}/${result.maxPDFs} PDFs | ${result.charCount.toLocaleString()} characters\n\n`;
                successMessage += `PDF Mode active. Click the PDF chips above to manage which documents to focus on!`;
                if (result.truncated) successMessage += `\n\nNote: Some content was truncated due to length limits.`;

                addMessageToUI(successMessage, 'bot');
                currentMessages.push({ role: 'assistant', content: successMessage, timestamp: new Date().toISOString() });
                enablePDFMode(result.activePdfNames?.[0] || fileNames[0], result.pdfCount || 1, allPDFNames, result.activePdfNames || allPDFNames);
            } else if (currentConversationId === targetConversationId) {
                const errMsg = `Upload failed\n\n${result.error || 'Please try again.'}`;
                addMessageToUI(errMsg, 'bot');
                currentMessages.push({ role: 'assistant', content: errMsg, timestamp: new Date().toISOString() });
            }
        } catch (error) {
            if (spinnerEl && spinnerEl.parentNode) spinnerEl.remove();
            if (currentConversationId === targetConversationId) {
                const errMsg = 'Failed to upload PDFs\n\nPlease check your connection and make sure the server is running.';
                addMessageToUI(errMsg, 'bot');
                currentMessages.push({ role: 'assistant', content: errMsg, timestamp: new Date().toISOString() });
            }
        }

        isUploading = false;
        syncOllamaControls();
        fileInput.value = '';

        await refreshSidebarOnly();
    });
}


// UTILITY FUNCTIONS

function formatMessage(text) {
    if (!text) return '';
    return escapeHtml(text).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}

function showTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message bot typing';
    typingDiv.id = 'typingIndicator';
    typingDiv.innerHTML = '<div class="message-content">Thinking...</div>';
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

let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (isPDFMode && currentPDFNames.length > 0) {
            renderPDFChips();
        }
    }, 250);
});

loadConversations();

window.loadConversation = loadConversation;
window.editConversation = editConversation;
window.deleteConversation = deleteConversation;
