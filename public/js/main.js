const API_BASE_URL = window.location.origin + '/api';
const sessionId = localStorage.getItem('cerebro_session');

function currentUser() {
    try {
        return sessionId ? JSON.parse(localStorage.getItem('cerebro_user') || 'null') : null;
    } catch {
        return null;
    }
}

async function logout() {
    try {
        await fetch(API_BASE_URL + '/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
    } catch {}
    localStorage.removeItem('cerebro_session');
    localStorage.removeItem('cerebro_user');
    window.location.href = 'index.html';
}

const authButtons = document.getElementById('authButtons');
const user = currentUser();
if (authButtons && user) {
    const name = document.createElement('span');
    name.className = 'auth-user hide-small';
    name.textContent = user.firstName || user.lastName;
    const open = document.createElement('a');
    open.href = 'chat.html';
    open.className = 'solid-button';
    open.textContent = 'Open workspace';
    const out = document.createElement('a');
    out.href = '#';
    out.textContent = 'Sign out';
    out.addEventListener('click', event => {
        event.preventDefault();
        logout();
    });
    authButtons.replaceChildren(name, out, open);
}

// A question typed on the home page survives the sign-in redirect.
document.getElementById('homePromptForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const prompt = document.getElementById('homePrompt').value.trim();
    if (!prompt) return;
    try { sessionStorage.setItem('cerebro_pending_prompt', prompt); } catch {}
    window.location.href = user ? 'chat.html' : 'login.html';
});
