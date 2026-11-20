const API_BASE_URL = window.location.origin + '/api';
const sessionId = localStorage.getItem('cerebro_session');
if (!sessionId) window.location.href = 'login.html';
const user = (() => { try { return JSON.parse(localStorage.getItem('cerebro_user') || '{}'); } catch { return {}; } })();
const $ = id => document.getElementById(id);
const { render: renderMarkdown, plain: plainText, escapeHtml } = window.CerebroMarkdown;

const ui = {
    workspace: $('workspace'), rail: $('rail'), sources: $('sources'), scrim: $('scrim'),
    history: $('chatHistory'), historyEmpty: $('historyEmpty'), search: $('chatSearch'),
    title: $('chatTitle'), pill: $('modelPill'), pillText: $('modelPillText'), sourcesCount: $('sourcesCount'),
    banner: $('statusBanner'), bannerText: $('statusText'), conversation: $('conversation'),
    contextLine: $('contextLine'), contextDocs: $('contextDocs'), topicChip: $('topicChip'), topicLabel: $('topicLabel'),
    composer: $('composer'), input: $('composerInput'), send: $('sendBtn'), attach: $('attachBtn'), fileInput: $('fileInput'),
    tools: $('toolRow'), library: $('library'), clearPdfs: $('clearPdfsBtn'),
    viewer: $('viewer'), viewerFrame: $('viewerFrame'), viewerTitle: $('viewerTitle'), viewerPage: $('viewerPage'),
    settings: $('settingsDialog'), modelSelect: $('modelSelect'), modelNote: $('modelNote'),
    rename: $('renameDialog'), renameInput: $('renameInput'), confirm: $('confirmDialog'), toast: $('toast')
};

const state = {
    conversations: [],
    conversationId: null,
    messages: [],
    pdfNames: [],
    activeNames: [],
    outline: [],
    activeTopic: null,
    pinnedTopic: null,
    topicReset: false,
    model: '',
    embedding: false,
    sending: false,
    uploading: false,
    loadingModels: false,
    controller: null,
    version: 0
};

const MAX_PDFS = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const overlayWidth = () => window.innerWidth <= 1180;
const narrow = () => window.innerWidth <= 860;
const sourceMode = () => localStorage.getItem('cerebro_source_mode') === 'pdf-only' ? 'pdf-only' : 'pdf-first';

async function api(path, options = {}) {
    const response = await fetch(API_BASE_URL + path, {
        ...options,
        headers: options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
        body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status}).`), { status: response.status });
    return data;
}

let toastTimer;
function toast(message) {
    ui.toast.textContent = message;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 4200);
}

function confirmAction(title, text, action) {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmAction').textContent = action;
    ui.confirm.returnValue = '';
    ui.confirm.showModal();
    return new Promise(resolve => ui.confirm.addEventListener('close', () => resolve(ui.confirm.returnValue === 'confirm'), { once: true }));
}

// ------------------------------------------------------------------ layout

function syncScrim() {
    const railOpen = narrow() && !ui.workspace.classList.contains('rail-hidden');
    const sourcesOpen = overlayWidth() && !ui.workspace.classList.contains('sources-hidden');
    ui.scrim.hidden = !(railOpen || sourcesOpen);
    $('railToggle').setAttribute('aria-expanded', String(!ui.workspace.classList.contains('rail-hidden')));
    $('sourcesToggle').setAttribute('aria-expanded', String(!ui.workspace.classList.contains('sources-hidden')));
    ui.rail.inert = ui.workspace.classList.contains('rail-hidden');
    ui.sources.inert = ui.workspace.classList.contains('sources-hidden') && !ui.workspace.classList.contains('viewing');
}

function setRail(open) {
    ui.workspace.classList.toggle('rail-hidden', !open);
    if (!narrow()) localStorage.setItem('cerebro_rail', open ? 'open' : 'hidden');
    syncScrim();
}

function setSources(open) {
    ui.workspace.classList.toggle('sources-hidden', !open);
    if (open && ui.workspace.classList.contains('viewing')) closeViewer();
    if (!overlayWidth()) localStorage.setItem('cerebro_sources', open ? 'open' : 'hidden');
    syncScrim();
}

function initialLayout() {
    ui.workspace.classList.toggle('rail-hidden', narrow() || localStorage.getItem('cerebro_rail') === 'hidden');
    ui.workspace.classList.toggle('sources-hidden', overlayWidth() || localStorage.getItem('cerebro_sources') === 'hidden');
    syncScrim();
}

$('railToggle').addEventListener('click', () => setRail(ui.workspace.classList.contains('rail-hidden')));
$('railClose').addEventListener('click', () => setRail(false));
$('sourcesToggle').addEventListener('click', () => setSources(ui.workspace.classList.contains('sources-hidden')));
$('sourcesClose').addEventListener('click', () => setSources(false));
ui.scrim.addEventListener('click', () => {
    if (narrow()) setRail(false);
    if (overlayWidth()) setSources(false);
});
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncScrim, 120);
});

// ------------------------------------------------------------------ models

function setPill(stateName, text) {
    ui.pill.dataset.state = stateName;
    ui.pillText.textContent = text;
    ui.pill.title = text;
}

function showBanner(message) {
    ui.bannerText.textContent = message;
    ui.banner.hidden = !message;
}

async function loadModels() {
    if (state.loadingModels) return;
    state.loadingModels = true;
    setPill('loading', 'Checking Ollama');
    showBanner('');
    try {
        const data = await api('/models');
        const names = (data.models || []).map(model => model.name).filter(Boolean);
        if (!data.available || !names.length) throw new Error(data.error || 'No chat model is installed in Ollama.');
        const saved = localStorage.getItem('cerebro_ollama_model');
        const match = name => names.find(item => item === name || item === `${name}:latest`);
        state.model = match(saved) || match(data.defaultModel) || names[0];
        state.embedding = data.embeddingAvailable === true;
        ui.modelSelect.replaceChildren(...names.map(name => new Option(name, name)));
        ui.modelSelect.value = state.model;
        ui.modelSelect.disabled = false;
        if (state.embedding) {
            setPill('ready', state.model);
            ui.modelNote.textContent = `Ollama is running. PDFs are indexed with ${data.embeddingModel}.`;
        } else {
            setPill('limited', state.model);
            ui.modelNote.textContent = `To read PDFs, run: ollama pull ${data.embeddingModel}`;
            showBanner(`PDF reading needs the embedding model. Run "ollama pull ${data.embeddingModel}", then check again.`);
        }
    } catch (error) {
        state.model = '';
        state.embedding = false;
        ui.modelSelect.replaceChildren(new Option('No model available', ''));
        ui.modelSelect.disabled = true;
        setPill('error', 'Ollama offline');
        ui.modelNote.textContent = error.message;
        showBanner(error.status ? error.message : `${error.message} Start Ollama, then check again.`.replace('Failed to fetch.', 'Cerebro\'s server is not reachable.'));
    } finally {
        state.loadingModels = false;
        syncControls();
    }
}

ui.modelSelect.addEventListener('change', () => {
    state.model = ui.modelSelect.value;
    localStorage.setItem('cerebro_ollama_model', state.model);
    setPill(state.embedding ? 'ready' : 'limited', state.model);
});
$('retryModelsBtn').addEventListener('click', loadModels);
ui.pill.addEventListener('click', () => openSettings());

function syncControls() {
    const busy = state.sending || state.uploading;
    ui.send.disabled = state.sending ? false : (!state.model || !ui.input.value.trim() || busy);
    ui.send.classList.toggle('is-stop', state.sending);
    ui.send.setAttribute('aria-label', state.sending ? 'Stop' : 'Send');
    ui.send.innerHTML = state.sending ? '<i class="fas fa-stop" aria-hidden="true"></i>' : '<i class="fas fa-arrow-up" aria-hidden="true"></i>';
    ui.attach.disabled = !state.embedding || busy || !state.conversationId;
    $('addPdfBtn').disabled = ui.attach.disabled;
    ui.attach.title = state.embedding ? 'Add PDF' : 'PDF reading needs the Ollama embedding model';
    ui.tools.querySelectorAll('button').forEach(button => { button.disabled = busy || !state.model || !state.pdfNames.length; });
}

// ------------------------------------------------------------------ chats

const chatName = title => !title || title === 'New Conversation' ? 'New chat' : title;

function groupByDate(list) {
    const day = 86400000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const groups = [['Today', []], ['Yesterday', []], ['Previous 7 days', []], ['Previous 30 days', []], ['Older', []]];
    for (const item of list) {
        const age = today - new Date(item.updatedAt).setHours(0, 0, 0, 0);
        const index = age <= 0 ? 0 : age <= day ? 1 : age <= 7 * day ? 2 : age <= 30 * day ? 3 : 4;
        groups[index][1].push(item);
    }
    return groups.filter(([, items]) => items.length);
}

function renderHistory() {
    const query = ui.search.value.trim().toLowerCase();
    const list = state.conversations.filter(item => !query || (item.title || '').toLowerCase().includes(query));
    ui.history.innerHTML = groupByDate(list).map(([label, items]) => `
        <div class="history-group"><p class="history-label">${label}</p>${items.map(item => `
            <div class="history-item${item.id === state.conversationId ? ' is-active' : ''}">
                <button type="button" class="history-open" data-open="${escapeHtml(item.id)}"${item.id === state.conversationId ? ' aria-current="true"' : ''}>${escapeHtml(chatName(item.title))}</button>
                <span class="history-tools">
                    <button type="button" data-rename="${escapeHtml(item.id)}" aria-label="Rename ${escapeHtml(item.title || 'chat')}" title="Rename"><i class="fas fa-pen" aria-hidden="true"></i></button>
                    <button type="button" data-delete="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.title || 'chat')}" title="Delete"><i class="fas fa-trash" aria-hidden="true"></i></button>
                </span>
            </div>`).join('')}</div>`).join('');
    ui.historyEmpty.hidden = !query || list.length > 0;
}

ui.search.addEventListener('input', renderHistory);
ui.history.addEventListener('click', event => {
    const open = event.target.closest('[data-open]');
    const rename = event.target.closest('[data-rename]');
    const remove = event.target.closest('[data-delete]');
    if (open) openConversation(open.dataset.open);
    if (rename) renameConversation(rename.dataset.rename);
    if (remove) deleteConversation(remove.dataset.delete);
});

async function refreshHistory() {
    try {
        state.conversations = (await api(`/conversations/${sessionId}`)).conversations || [];
    } catch {
        state.conversations = [];
    }
    renderHistory();
    const current = state.conversations.find(item => item.id === state.conversationId);
    if (current) ui.title.textContent = chatName(current.title);
}

async function createConversation() {
    if (state.sending || state.uploading) return;
    const version = ++state.version;
    try {
        const data = await api('/conversations/create', { method: 'POST', body: { sessionId } });
        if (version !== state.version) return;
        await refreshHistory();
        await openConversation(data.conversationId);
        ui.input.focus();
    } catch (error) {
        if (error.status === 401) return signOutLocally();
        toast(error.message);
    }
}

async function openConversation(id) {
    if (state.sending) return;
    const version = ++state.version;
    state.conversationId = id;
    closeViewer();
    try {
        const data = await api(`/conversations/${sessionId}/${id}`);
        if (version !== state.version) return;
        state.messages = data.messages || [];
        state.pdfNames = data.pdfNames || [];
        state.activeNames = data.activePdfNames || state.pdfNames;
        state.activeTopic = data.context?.activeTopic || null;
        state.pinnedTopic = null;
        state.topicReset = false;
        state.outline = [];
        ui.title.textContent = chatName(state.conversations.find(item => item.id === id)?.title);
        renderHistory();
        renderLibrary();
        renderThread();
        renderContext();
        syncControls();
        if (narrow()) setRail(false);
        if (state.pdfNames.length) loadOutline(version);
    } catch (error) {
        if (error.status === 401) return signOutLocally();
        toast('That chat could not be opened.');
    }
}

function renameConversation(id) {
    const current = state.conversations.find(item => item.id === id);
    ui.renameInput.value = current?.title || '';
    ui.rename.returnValue = '';
    ui.rename.showModal();
    ui.renameInput.select();
    ui.rename.addEventListener('close', async () => {
        const title = ui.renameInput.value.trim();
        if (ui.rename.returnValue !== 'save' || !title) return;
        try {
            await api(`/conversations/${sessionId}/${id}`, { method: 'PUT', body: { title } });
            await refreshHistory();
        } catch (error) {
            toast(error.message);
        }
    }, { once: true });
}

async function deleteConversation(id) {
    const current = state.conversations.find(item => item.id === id);
    if (!await confirmAction('Delete this chat?', `"${current?.title || 'New chat'}" and its PDFs will be removed from this computer.`, 'Delete chat')) return;
    try {
        await api(`/conversations/${sessionId}/${id}`, { method: 'DELETE' });
        await refreshHistory();
        if (id === state.conversationId) {
            if (state.conversations.length) await openConversation(state.conversations[0].id);
            else await createConversation();
        }
        toast('Chat deleted.');
    } catch (error) {
        toast(error.message);
    }
}

$('newChatBtn').addEventListener('click', createConversation);

// ------------------------------------------------------------------ sources

async function loadOutline(version = state.version) {
    try {
        const data = await api(`/conversations/${sessionId}/${state.conversationId}/outline`);
        if (version !== state.version) return;
        state.outline = data.documents || [];
        renderLibrary();
        if (!state.messages.length) renderThread();
    } catch {
        state.outline = [];
    }
}

function docInfo(name) {
    return state.outline.find(doc => doc.name === name);
}

function renderLibrary() {
    ui.sourcesCount.textContent = state.pdfNames.length ? `${state.activeNames.length} of ${state.pdfNames.length} PDFs` : 'Sources';
    ui.clearPdfs.hidden = !state.pdfNames.length;
    if (!state.pdfNames.length) {
        ui.library.innerHTML = '<li class="library-empty">No PDFs in this chat yet.</li>';
        return;
    }
    ui.library.innerHTML = state.pdfNames.map((name, i) => {
        const info = docInfo(name);
        const on = state.activeNames.includes(name);
        const meta = info ? [
            info.pageCount ? `${info.pageCount} page${info.pageCount === 1 ? '' : 's'}` : '',
            info.imagePages?.length ? `<span class="warn">${info.imagePages.length} scanned, not readable</span>` : '',
            info.truncated ? '<span class="warn">trimmed to fit</span>' : ''
        ].filter(Boolean).join(' · ') : 'Reading…';
        const sections = info?.sections || [];
        const pinned = state.pinnedTopic;
        const toc = info ? (sections.length ? `<details class="toc"${on && i === 0 ? ' open' : ''}><summary>Contents</summary><ol>${sections.map(section => `
            <li data-level="${section.level}">
                <button type="button" class="toc-topic" data-topic="${escapeHtml(section.title)}" data-doc="${escapeHtml(name)}" aria-pressed="${pinned?.label === section.title && pinned?.doc === name}"${on ? '' : ' disabled'}>
                    <span class="toc-title">${escapeHtml(section.title)}</span><span class="toc-leader" aria-hidden="true"></span>
                </button>
                ${section.page ? `<button type="button" class="toc-page" data-view-doc="${escapeHtml(name)}" data-view-page="${section.page}" aria-label="Open ${escapeHtml(name)} at page ${section.page}">${section.page}</button>` : ''}
            </li>`).join('')}</ol></details>` : '<p class="toc-empty">No headings found. Ask for a summary to see what it covers.</p>') : '';
        return `<li class="doc${on ? '' : ' is-off'}">
            <div class="doc-row">
                <input type="checkbox" id="doc-${i}" data-focus="${escapeHtml(name)}"${on ? ' checked' : ''}>
                <label for="doc-${i}"><span class="doc-name">${escapeHtml(name)}</span><span class="doc-meta">${meta}</span></label>
                <button type="button" class="icon-button" data-remove="${escapeHtml(name)}" aria-label="Remove ${escapeHtml(name)}" title="Remove"><i class="fas fa-trash" aria-hidden="true"></i></button>
            </div>${toc}</li>`;
    }).join('');
}

ui.library.addEventListener('change', async event => {
    const box = event.target.closest('[data-focus]');
    if (!box) return;
    const next = box.checked ? [...new Set([...state.activeNames, box.dataset.focus])] : state.activeNames.filter(name => name !== box.dataset.focus);
    if (!next.length) {
        box.checked = true;
        return toast('Keep at least one PDF ticked.');
    }
    try {
        const data = await api(`/conversations/${sessionId}/focus-pdf`, { method: 'POST', body: { conversationId: state.conversationId, pdfNames: state.pdfNames.filter(name => next.includes(name)) } });
        state.activeNames = data.activePdfNames;
        if (state.pinnedTopic && !state.activeNames.includes(state.pinnedTopic.doc)) state.pinnedTopic = null;
        state.activeTopic = null;
        renderLibrary();
        renderContext();
    } catch (error) {
        box.checked = !box.checked;
        toast(error.message);
    }
});

ui.library.addEventListener('click', async event => {
    const topic = event.target.closest('[data-topic]');
    const view = event.target.closest('[data-view-doc]');
    const remove = event.target.closest('[data-remove]');
    if (topic) {
        const same = state.pinnedTopic?.label === topic.dataset.topic && state.pinnedTopic?.doc === topic.dataset.doc;
        state.pinnedTopic = same ? null : { label: topic.dataset.topic, doc: topic.dataset.doc };
        renderLibrary();
        renderContext();
        if (!same) {
            if (overlayWidth()) setSources(false);
            ui.input.focus();
        }
    }
    if (view) openViewer({ doc: view.dataset.viewDoc, page: Number(view.dataset.viewPage) });
    if (remove) removePdf(remove.dataset.remove);
});

async function removePdf(name) {
    if (!await confirmAction(`Remove ${name}?`, 'Answers in this chat will no longer use it. Earlier answers stay in the chat.', 'Remove PDF')) return;
    try {
        const data = await api(`/conversations/${sessionId}/delete-pdf`, { method: 'POST', body: { conversationId: state.conversationId, pdfName: name } });
        state.pdfNames = data.remainingPDFs;
        state.activeNames = data.activePdfNames;
        state.outline = state.outline.filter(doc => doc.name !== name);
        if (state.pinnedTopic?.doc === name) state.pinnedTopic = null;
        state.activeTopic = null;
        renderLibrary();
        renderContext();
        if (!state.messages.length) renderThread();
        syncControls();
    } catch (error) {
        toast(error.message);
    }
}

ui.clearPdfs.addEventListener('click', async () => {
    if (!await confirmAction('Remove all PDFs from this chat?', 'The conversation stays. You can add PDFs again any time.', 'Remove all')) return;
    try {
        await api(`/conversations/${sessionId}/clear-pdfs`, { method: 'POST', body: { conversationId: state.conversationId } });
        Object.assign(state, { pdfNames: [], activeNames: [], outline: [], pinnedTopic: null, activeTopic: null });
        renderLibrary();
        renderContext();
        renderThread();
        syncControls();
    } catch (error) {
        toast(error.message);
    }
});

function pickFiles() {
    if (!ui.attach.disabled) ui.fileInput.click();
    else if (!state.embedding) toast('PDF reading needs the Ollama embedding model. Open Settings for details.');
}
ui.attach.addEventListener('click', pickFiles);
$('addPdfBtn').addEventListener('click', pickFiles);
ui.fileInput.addEventListener('change', () => {
    uploadFiles([...ui.fileInput.files]);
    ui.fileInput.value = '';
});

async function uploadFiles(files) {
    if (!files.length || state.uploading || state.sending) return;
    const pdfs = files.filter(file => /\.pdf$/i.test(file.name));
    if (pdfs.length !== files.length) return toast('Only PDF files can be added.');
    const large = pdfs.find(file => file.size > MAX_BYTES);
    if (large) return toast(`${large.name} is larger than 10 MB.`);
    if (state.pdfNames.length + pdfs.length > MAX_PDFS) return toast(`A chat can hold ${MAX_PDFS} PDFs. Remove one first.`);
    const target = state.conversationId;
    state.uploading = true;
    syncControls();
    const notice = appendMessage({ role: 'notice', content: `Reading ${pdfs.length === 1 ? pdfs[0].name : pdfs.length + ' PDFs'}: extracting pages, finding sections, and indexing for search…` });
    const form = new FormData();
    pdfs.forEach(file => form.append('files', file));
    form.append('sessionId', sessionId);
    form.append('conversationId', target);
    try {
        const result = await api('/upload', { method: 'POST', body: form });
        if (state.conversationId !== target) return;
        state.pdfNames = result.pdfNames;
        state.activeNames = result.activePdfNames;
        const details = (result.extractedPages || []).map(file => {
            const scanned = file.imagePages?.length ? ` ${file.imagePages.length} page${file.imagePages.length > 1 ? 's are' : ' is a'} scanned image${file.imagePages.length > 1 ? 's' : ''} without text and can't be read.` : '';
            return `**${file.name}**: ${file.readablePages} of ${file.pages} pages have text.${scanned}`;
        }).join('\n');
        notice.querySelector('.message-body').innerHTML = renderMarkdown(`Added ${pdfs.length === 1 ? 'your PDF' : pdfs.length + ' PDFs'}.\n${details}${result.truncated ? '\nSome text was trimmed to stay under the size limit.' : ''}`);
        renderLibrary();
        renderContext();
        await loadOutline();
        if (!state.messages.length) renderThread();
        if (!overlayWidth()) setSources(true);
    } catch (error) {
        notice.classList.replace('notice', 'error');
        notice.querySelector('.message-body').textContent = `Couldn't add the PDF. ${error.message}`;
    } finally {
        state.uploading = false;
        syncControls();
        refreshHistory();
    }
}

['dragenter', 'dragover'].forEach(type => ui.workspace.addEventListener(type, event => {
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
    event.preventDefault();
    ui.workspace.classList.add('dragging');
}));
['dragleave', 'drop'].forEach(type => ui.workspace.addEventListener(type, event => {
    if (type === 'dragleave' && event.relatedTarget && ui.workspace.contains(event.relatedTarget)) return;
    ui.workspace.classList.remove('dragging');
}));
ui.workspace.addEventListener('drop', event => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    uploadFiles([...event.dataTransfer.files]);
});

// ------------------------------------------------------------------ context line

function currentTopic() {
    return state.pinnedTopic || (state.topicReset ? null : state.activeTopic);
}

function renderContext() {
    const show = state.pdfNames.length > 0;
    ui.contextLine.hidden = !show;
    if (!show) return;
    const names = state.activeNames;
    ui.contextDocs.innerHTML = names.length <= 2
        ? names.map(name => `<strong>${escapeHtml(name)}</strong>`).join(' and ')
        : `<strong>${names.length} PDFs</strong>`;
    const topic = currentTopic();
    ui.topicChip.hidden = !topic;
    ui.topicLabel.textContent = topic?.label || '';
    ui.input.placeholder = topic ? `Ask about ${topic.label}` : 'Ask about your PDF';
}

$('topicClear').addEventListener('click', () => {
    if (state.pinnedTopic) state.pinnedTopic = null;
    else state.topicReset = true;
    renderLibrary();
    renderContext();
    ui.input.focus();
});

// ------------------------------------------------------------------ thread

function suggestionsFor() {
    const sections = state.outline.filter(doc => state.activeNames.includes(doc.name)).flatMap(doc => doc.sections.filter(section => section.level <= 2));
    const picks = [];
    if (sections[0]) picks.push(['Explain', `Explain "${sections[0].title}"`]);
    if (sections[1]) picks.push(['Quiz', `Make a 5 question quiz on "${sections[1].title}"`]);
    if (sections[2]) picks.push(['Flashcards', `Make flashcards on "${sections[2].title}"`]);
    picks.push(['Summarize', state.activeNames.length > 1 ? 'Summarize the selected PDFs' : `Summarize ${state.activeNames[0]}`]);
    picks.push(['Outline', 'List the topics covered']);
    return picks;
}

function renderThread() {
    ui.conversation.replaceChildren();
    if (!state.messages.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        if (!state.pdfNames.length) {
            empty.innerHTML = `<h2>Add the PDF you're studying</h2>
                <p>Lecture notes, handouts, slides exported as PDF. Cerebro reads the text, finds the sections, and answers from it with page references.</p>
                <div class="dropzone"><button type="button" class="solid-button" data-empty-upload><i class="fas fa-paperclip" aria-hidden="true"></i> Choose PDF</button>
                <p>Or drop files here. Up to 10 PDFs, 10 MB each. Scanned pages need OCR first.</p></div>`;
        } else {
            empty.innerHTML = `<h2>What do you want to understand?</h2>
                <p>Ask in your own words. Follow-ups like "give me an example" or "make it simpler" stay on the same topic.</p>
                <div class="suggestions">${suggestionsFor().map(([tool, prompt]) =>
                    `<button type="button" class="suggestion" data-prompt="${escapeHtml(prompt)}"><span class="suggestion-tool">${tool}</span><span>${escapeHtml(prompt.replace(/^(?:Explain|Make a 5 question quiz on|Make flashcards on|Summarize) /, '').replace(/"/g, ''))}</span></button>`).join('')}</div>`;
        }
        ui.conversation.append(empty);
        return;
    }
    const thread = document.createElement('div');
    thread.className = 'thread';
    ui.conversation.append(thread);
    for (const message of state.messages) appendMessage(message, false);
    markStalePractice();
    scrollToEnd();
}

function threadNode() {
    let thread = ui.conversation.querySelector('.thread');
    if (!thread) {
        ui.conversation.replaceChildren();
        thread = document.createElement('div');
        thread.className = 'thread';
        ui.conversation.append(thread);
    }
    return thread;
}

function fillAnswer(body, text) {
    body.innerHTML = renderMarkdown(text);
    window.CerebroBlocks.hydrate(body);
    const docs = new Set([...body.querySelectorAll('.page-tab[data-doc]')].map(tab => tab.dataset.doc));
    body.closest('.message')?.classList.toggle('multi-doc', docs.size > 1);
}

function appendMessage(message, scroll = true) {
    const node = document.createElement('article');
    const role = message.role === 'assistant' ? 'assistant' : message.role;
    node.className = 'message ' + role;
    const body = document.createElement('div');
    body.className = 'message-body' + (role === 'assistant' ? ' answer' : '');
    node.append(body);
    if (role === 'assistant') {
        fillAnswer(body, message.content);
        node.insertAdjacentHTML('beforeend', '<div class="message-actions"><button type="button" class="text-button" data-copy>Copy</button><button type="button" class="text-button" data-retry>Ask again</button></div>');
    } else {
        body.textContent = message.content;
    }
    threadNode().append(node);
    if (scroll) scrollToEnd();
    return node;
}

function markStalePractice() {
    const blocks = [...ui.conversation.querySelectorAll('.practice')];
    blocks.forEach((block, i) => block.classList.toggle('is-stale', i !== blocks.length - 1 || block.closest('.message') !== ui.conversation.querySelector('.message.assistant:last-of-type')));
}

function scrollToEnd() {
    ui.conversation.scrollTop = ui.conversation.scrollHeight;
}

ui.conversation.addEventListener('click', async event => {
    const upload = event.target.closest('[data-empty-upload]');
    const prompt = event.target.closest('[data-prompt]');
    const sendButton = event.target.closest('[data-send]');
    const tab = event.target.closest('.page-tab[data-digest]');
    const copy = event.target.closest('[data-copy]');
    const retry = event.target.closest('[data-retry]');
    if (upload) pickFiles();
    if (prompt) send(prompt.dataset.prompt);
    if (sendButton && !sendButton.closest('.is-stale')) send(sendButton.dataset.send);
    if (tab) openViewer({ digest: tab.dataset.digest, page: Number(tab.dataset.page), doc: tab.dataset.doc, trigger: tab });
    if (copy) {
        const index = [...ui.conversation.querySelectorAll('.message')].indexOf(copy.closest('.message'));
        const message = state.messages[index];
        try {
            await navigator.clipboard.writeText(plainText(message?.content || copy.closest('.message').innerText));
            copy.textContent = 'Copied';
            setTimeout(() => { copy.textContent = 'Copy'; }, 1600);
        } catch {
            toast('Copy is blocked in this browser.');
        }
    }
    if (retry) {
        const messages = [...ui.conversation.querySelectorAll('.message')];
        const index = messages.indexOf(retry.closest('.message'));
        const question = state.messages.slice(0, index).reverse().find(item => item.role === 'user');
        if (question) send(question.content);
    }
});

// ------------------------------------------------------------------ sending

const STAGES = { indexing: 'Preparing your PDFs', searching: 'Searching', writing: 'Writing', revising: 'Fixing unsupported statements', checking: 'Checking citations against your PDF', summarizing: 'Reading' };

function pendingNode() {
    const node = document.createElement('article');
    node.className = 'message assistant pending';
    node.setAttribute('aria-busy', 'true');
    node.innerHTML = '<div class="message-body"><p class="working" role="status"><span class="working-mark" aria-hidden="true"></span><span class="working-text">Thinking</span></p><div class="draft answer"></div></div>';
    threadNode().append(node);
    scrollToEnd();
    return node;
}

function toolPrompt(tool) {
    const topic = currentTopic()?.label;
    const quoted = topic ? `"${topic}"` : null;
    const scope = state.activeNames.length > 1 ? 'the selected PDFs' : state.activeNames[0];
    return {
        explain: quoted ? `Explain ${quoted}` : `Explain the main ideas of ${scope} in simple language`,
        summary: quoted ? `Summarize ${quoted}` : `Summarize ${scope}`,
        quiz: quoted ? `Make a 5 question quiz on ${quoted}` : `Make a 10 question quiz on ${scope}`,
        flashcards: quoted ? `Make flashcards on ${quoted}` : `Make flashcards from ${scope}`,
        practice: quoted ? `Quiz me on ${quoted}, one question at a time` : `Quiz me on ${scope}, one question at a time`,
        guide: quoted ? `Make a study guide for ${quoted}` : `Make a study guide for ${scope}`,
        terms: quoted ? `List the key terms in ${quoted}` : `List the key terms in ${scope}`
    }[tool];
}

ui.tools.addEventListener('click', event => {
    const button = event.target.closest('[data-tool]');
    if (button) send(toolPrompt(button.dataset.tool));
});

async function send(text) {
    const message = String(text || '').trim();
    if (!message || state.sending || state.uploading) return;
    if (!state.model) return toast('No local model is available. Start Ollama, then check again.');
    const target = state.conversationId;
    state.sending = true;
    state.controller = new AbortController();
    syncControls();
    ui.input.value = '';
    autosize();
    appendMessage({ role: 'user', content: message });
    state.messages.push({ role: 'user', content: message });
    markStalePractice();
    const pending = pendingNode();
    const working = pending.querySelector('.working-text');
    const draft = pending.querySelector('.draft');
    let draftText = '';
    let finished = null;

    try {
        const response = await fetch(`${API_BASE_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: state.controller.signal,
            body: JSON.stringify({ message, sessionId, conversationId: target, model: state.model, stream: true, sourceMode: sourceMode(), topicReset: state.topicReset || undefined })
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw Object.assign(new Error(data.error || `Request failed (${response.status}).`), { status: response.status });
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const handle = line => {
            if (!line.trim()) return;
            const event = JSON.parse(line);
            if (event.type === 'status') {
                const stage = STAGES[event.stage] || 'Working';
                working.textContent = event.detail || stage;
            } else if (event.type === 'draft') {
                if (event.reset) draftText = '';
                else draftText += event.content || '';
                draft.innerHTML = draftText ? '<span class="draft-label">Draft, not yet checked against your PDF</span>' + renderMarkdown(draftText.replace(/\[(\d+)\]/g, '')) : '';
                if (ui.conversation.scrollHeight - ui.conversation.scrollTop - ui.conversation.clientHeight < 160) scrollToEnd();
            } else if (event.type === 'done') {
                finished = event;
            } else if (event.type === 'error') {
                throw new Error(event.error || 'The local model stopped.');
            }
        };
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            lines.forEach(handle);
        }
        handle(buffer + decoder.decode());
        if (!finished) throw new Error('The response ended early. Try again.');
        if (state.conversationId !== target) return;
        pending.remove();
        state.messages.push({ role: 'assistant', content: finished.answer });
        appendMessage({ role: 'assistant', content: finished.answer });
        state.topicReset = false;
        if ('topic' in finished) state.activeTopic = finished.topic;
        markStalePractice();
        renderContext();
    } catch (error) {
        pending.remove();
        if (state.conversationId !== target) return;
        if (error.name === 'AbortError') {
            appendMessage({ role: 'notice', content: 'Stopped. Nothing was saved for that question.' });
        } else {
            appendMessage({ role: 'error', content: error.message });
            if (error.status === 401) return signOutLocally();
            if (/ollama|model|reach/i.test(error.message)) loadModels();
        }
        state.messages.pop();
    } finally {
        state.sending = false;
        state.controller = null;
        syncControls();
        refreshHistory();
    }
}

ui.composer.addEventListener('submit', event => {
    event.preventDefault();
    if (state.sending) return state.controller?.abort();
    send(ui.input.value);
});

function autosize() {
    ui.input.style.height = 'auto';
    ui.input.style.height = Math.min(ui.input.scrollHeight, 220) + 'px';
    syncControls();
}
ui.input.addEventListener('input', autosize);
ui.input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!state.sending) send(ui.input.value);
    }
});

// ------------------------------------------------------------------ viewer

const viewer = { url: '', page: 1, trigger: null, request: 0 };

function setViewerPage(page) {
    viewer.page = Math.max(1, page);
    ui.viewerPage.textContent = 'p. ' + viewer.page;
    ui.viewerFrame.src = viewer.url + '#page=' + viewer.page;
}

async function openViewer({ digest, page = 1, doc, trigger }) {
    const conversationId = state.conversationId;
    const id = ++viewer.request;
    const hash = digest || docInfo(doc)?.digest;
    if (!hash) return toast('This PDF has no stored original to show. Upload it again to view its pages.');
    try {
        const response = await fetch(API_BASE_URL + '/source', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, conversationId, digest: hash })
        });
        if (!response.ok) throw new Error();
        const url = URL.createObjectURL(await response.blob());
        if (id !== viewer.request || conversationId !== state.conversationId) return URL.revokeObjectURL(url);
        if (viewer.url) URL.revokeObjectURL(viewer.url);
        viewer.url = url;
        viewer.trigger = trigger || document.activeElement;
        ui.viewerTitle.textContent = doc || 'PDF';
        ui.workspace.classList.add('viewing');
        ui.viewer.setAttribute('aria-hidden', 'false');
        setViewerPage(page);
        $('viewerClose').focus();
    } catch {
        toast('That PDF is not available. It may have been removed or unticked in Sources.');
    }
}

function closeViewer() {
    viewer.request++;
    if (!ui.workspace.classList.contains('viewing')) return;
    ui.workspace.classList.remove('viewing');
    ui.viewer.setAttribute('aria-hidden', 'true');
    ui.viewerFrame.removeAttribute('src');
    if (viewer.url) URL.revokeObjectURL(viewer.url);
    viewer.url = '';
    if (viewer.trigger?.isConnected) viewer.trigger.focus();
    syncScrim();
}

$('viewerPrev').addEventListener('click', () => setViewerPage(viewer.page - 1));
$('viewerNext').addEventListener('click', () => setViewerPage(viewer.page + 1));
$('viewerClose').addEventListener('click', closeViewer);
document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (ui.workspace.classList.contains('viewing')) closeViewer();
    else if (overlayWidth() && !ui.workspace.classList.contains('sources-hidden')) setSources(false);
    else if (narrow() && !ui.workspace.classList.contains('rail-hidden')) setRail(false);
});

// ------------------------------------------------------------------ settings and account

function signOutLocally() {
    localStorage.removeItem('cerebro_session');
    localStorage.removeItem('cerebro_user');
    window.location.href = 'login.html';
}

function openSettings() {
    document.querySelectorAll('[data-theme-choice]').forEach(input => { input.checked = input.value === document.documentElement.dataset.theme; });
    ui.settings.showModal();
}
$('settingsBtn').addEventListener('click', openSettings);
document.querySelectorAll('input[name="sourceMode"]').forEach(input => {
    input.checked = input.value === sourceMode();
    input.addEventListener('change', () => {
        if (input.checked) localStorage.setItem('cerebro_source_mode', input.value);
    });
});
$('accountName').textContent = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Signed in';
$('accountEmail').textContent = user.email || '';
$('userName').textContent = user.firstName || user.lastName || 'Account';
$('userInitial').textContent = (user.firstName || user.lastName || '?').slice(0, 1).toUpperCase();

$('logoutBtn').addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST', body: { sessionId } }); } catch {}
    signOutLocally();
});
$('deleteAccountBtn').addEventListener('click', async () => {
    ui.settings.close();
    if (!await confirmAction('Delete your account?', 'All chats, uploaded PDFs and indexes for this account are removed from this computer. This cannot be undone.', 'Delete account')) return;
    try { await api('/auth/delete-account', { method: 'POST', body: { sessionId } }); } catch {}
    signOutLocally();
});

// ------------------------------------------------------------------ start

async function start() {
    initialLayout();
    renderLibrary();
    loadModels();
    await refreshHistory();
    if (state.conversations.length) await openConversation(state.conversations[0].id);
    else await createConversation();
    try {
        const pending = sessionStorage.getItem('cerebro_pending_prompt');
        sessionStorage.removeItem('cerebro_pending_prompt');
        if (pending) {
            ui.input.value = pending;
            autosize();
            ui.input.focus();
        }
    } catch {}
}

start();
