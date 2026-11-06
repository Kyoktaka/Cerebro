/* Progressive UI enhancements. This file leaves Cerebro's existing API calls in chat.js intact. */
(() => {
    const historySearch = document.getElementById('conversationSearch');
    const conversationSection = document.querySelector('.conversations-section');
    const historyEmpty = document.getElementById('historyEmpty');
    const messages = document.getElementById('chatMessages');
    const input = document.getElementById('chatInput');
    const upload = document.getElementById('uploadBtn');
    const viewer = document.getElementById('pdfViewer');
    const viewerFrame = document.getElementById('pdfViewerFrame');
    const viewerTitle = document.getElementById('pdfViewerTitle');
    const viewerPage = document.getElementById('pdfViewerPage');
    const viewerClose = document.getElementById('pdfViewerClose');

    if (!historySearch || !messages || !viewer) return;

    // Filter existing grouped chat history without creating a new search endpoint.
    function filterHistory() {
        const query = historySearch.value.trim().toLocaleLowerCase();
        let total = 0;
        conversationSection.querySelectorAll('.conversation-list').forEach(list => {
            let visible = 0;
            list.querySelectorAll('.conversation-item').forEach(item => {
                const title = item.querySelector('.conversation-title')?.textContent || '';
                const matches = title.toLocaleLowerCase().includes(query);
                item.hidden = !matches;
                if (matches) visible++;
            });
            const heading = list.previousElementSibling;
            if (heading?.tagName === 'H2') heading.hidden = visible === 0;
            total += visible;
        });
        historyEmpty.hidden = total > 0 || !query;
    }
    historySearch.addEventListener('input', filterHistory);
    // Reapply after chat.js renders fresh history, without observing attribute changes.
    new MutationObserver(filterHistory).observe(conversationSection, {childList: true, subtree: true});

    document.getElementById('sidebarChatsBtn')?.addEventListener('click', () => historySearch.focus());
    document.getElementById('sidebarDocumentsBtn')?.addEventListener('click', () => {
        if (window.innerWidth <= 760) closeSidebar();
        if (currentPDFNames.length > 0) {
            openPDFManager();
        } else if (!upload.disabled) {
            upload.click();
        } else {
            input.focus();
            setOllamaStatus('PDF upload requires an available embedding model. Refresh Ollama models.', 'error');
        }
    });
    document.getElementById('sidebarStudyBtn')?.addEventListener('click', () => {
        if (window.innerWidth <= 760) closeSidebar();
        document.getElementById('studyActions')?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
        document.querySelector('#studyActions button')?.focus();
    });

    // Route all study shortcuts through the existing chat request or upload handler.
    document.addEventListener('click', event => {
        const uploadShortcut = event.target.closest('[data-welcome-upload]');
        if (uploadShortcut) {
            if (!upload.disabled) upload.click();
            else setOllamaStatus('Start Ollama and enable the embedding model before uploading PDFs.', 'error');
            return;
        }
        const studyShortcut = event.target.closest('[data-study-prompt]');
        if (!studyShortcut) return;
        const prompt = studyShortcut.dataset.studyPrompt;
        if (!prompt) return;
        input.value = prompt;
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.focus();
        if (!selectedModel || isSending || isUploading) return;
        if (currentPDFNames.length === 0) {
            if (!upload.disabled) upload.click();
            else setOllamaStatus('Add a PDF before starting a study session.', 'error');
            return;
        }
        sendMessage();
    });

    // Lightweight, usable actions on assistant responses, including streamed replies.
    function addResponseActions() {
        messages.querySelectorAll('.message.bot:not(.typing)').forEach(message => {
            if (message.querySelector('.response-actions')) return;
            const actions = document.createElement('div');
            actions.className = 'response-actions';
            actions.innerHTML = '<button type="button" data-response-copy title="Copy response"><i class="far fa-copy" aria-hidden="true"></i> Copy</button><button type="button" data-response-retry title="Ask again"><i class="fas fa-rotate-right" aria-hidden="true"></i> Ask again</button>';
            message.append(actions);
        });
    }
    new MutationObserver(addResponseActions).observe(messages, {childList: true, subtree: true});
    addResponseActions();

    messages.addEventListener('click', async event => {
        const copy = event.target.closest('[data-response-copy]');
        const retry = event.target.closest('[data-response-retry]');
        if (copy) {
            const message = copy.closest('.message');
            const text = message?.querySelector('.message-content')?.innerText || '';
            if (!text) return;
            try {
                await navigator.clipboard.writeText(text);
                copy.textContent = 'Copied';
                copy.setAttribute('aria-label', 'Response copied');
            } catch {
                copy.textContent = 'Copy failed';
            }
        } else if (retry) {
            const previousUser = [...currentMessages].reverse().find(item => item.role === 'user');
            if (!previousUser || isSending || isUploading) return;
            input.value = previousUser.content;
            input.dispatchEvent(new Event('input', {bubbles: true}));
            if (selectedModel) sendMessage();
            else input.focus();
        }
    });

    // Render cited PDFs next to the conversation on desktop, or full-screen on mobile.
    let objectUrl = '';
    let currentPage = 1;
    let viewerConversationId = null;
    let lastTrigger = null;
    let requestNumber = 0;

    function setPage(page) {
        if (!objectUrl) return;
        currentPage = Math.max(1, page);
        viewerPage.textContent = String(currentPage);
        viewerFrame.src = objectUrl + '#page=' + currentPage;
    }
    function closeViewer() {
        requestNumber++;
        document.body.classList.remove('pdf-viewer-open');
        viewer.setAttribute('aria-hidden', 'true');
        viewerFrame.removeAttribute('src');
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = '';
        viewerConversationId = null;
        if (lastTrigger?.isConnected) lastTrigger.focus();
        lastTrigger = null;
    }
    async function openCitation(citation) {
        const digest = citation.dataset.digest;
        const page = Math.max(1, Number(citation.dataset.page) || 1);
        if (!digest || !currentConversationId) return;
        const openedFor = currentConversationId;
        const requestId = ++requestNumber;
        try {
            const response = await fetch(API_BASE_URL + '/source', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({sessionId, conversationId: openedFor, digest})
            });
            if (!response.ok) throw new Error('The PDF source is unavailable.');
            const nextUrl = URL.createObjectURL(await response.blob());
            if (requestId !== requestNumber || currentConversationId !== openedFor) {
                URL.revokeObjectURL(nextUrl);
                return;
            }
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            objectUrl = nextUrl;
            viewerConversationId = openedFor;
            lastTrigger = citation;
            viewerTitle.textContent = citation.textContent.trim() || 'PDF source';
            document.body.classList.add('pdf-viewer-open');
            viewer.setAttribute('aria-hidden', 'false');
            setPage(page);
            viewerClose.focus();
        } catch (error) {
            addMessageToUI(error.message + ' Upload the source again if it was removed.', 'error');
        }
    }

    // Capture before the old new-tab citation handler. The backend source request is unchanged.
    messages.addEventListener('click', event => {
        const citation = event.target.closest('.source-citation');
        if (!citation) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        openCitation(citation);
    }, true);

    document.getElementById('pdfPrevPage')?.addEventListener('click', () => setPage(currentPage - 1));
    document.getElementById('pdfNextPage')?.addEventListener('click', () => setPage(currentPage + 1));
    viewerClose?.addEventListener('click', closeViewer);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.body.classList.contains('pdf-viewer-open')) closeViewer();
    });
    new MutationObserver(() => {
        if (viewerConversationId && viewerConversationId !== currentConversationId) closeViewer();
    }).observe(messages, {childList:true});

    // A prompt entered on the starting page survives the sign-in redirect.
    try {
        const pending = sessionStorage.getItem('cerebro_pending_prompt');
        const attachHint = sessionStorage.getItem('cerebro_attach_hint');
        sessionStorage.removeItem('cerebro_pending_prompt');
        sessionStorage.removeItem('cerebro_attach_hint');
        if (pending) {
            input.value = pending;
            input.dispatchEvent(new Event('input', {bubbles:true}));
            input.focus();
        }
        if (attachHint) {
            input.placeholder = 'Choose + to attach your PDF, then ask a question...';
            upload.focus();
        }
    } catch {}
})();