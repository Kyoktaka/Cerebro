const API_BASE_URL = window.location.origin + '/api';
const hamburger = document.getElementById('hamburger');
const navMenu = document.getElementById('navMenu');
const authButtons = document.getElementById('authButtons');
const heroButtons = document.getElementById('heroButtons');
const sessionId = localStorage.getItem('cerebro_session');
const userData = localStorage.getItem('cerebro_user');

function link(href, label, className) {
    const element = document.createElement('a');
    element.href = href;
    element.textContent = label;
    element.className = className;
    return element;
}

function logoutButton(className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = 'Sign out';
    button.addEventListener('click', logout);
    return button;
}

function syncMenu() {
    if (!navMenu || !hamburger) return;
    const open = navMenu.classList.contains('active');
    navMenu.inert = window.innerWidth <= 760 && !open;
    hamburger.setAttribute('aria-expanded', String(open));
    hamburger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.classList.toggle('menu-open', open);
}

function closeMenu() {
    if (!navMenu) return;
    navMenu.classList.remove('active');
    syncMenu();
}

if (hamburger && navMenu) {
    hamburger.addEventListener('click', event => {
        event.stopPropagation();
        navMenu.classList.toggle('active');
        syncMenu();
    });
    document.addEventListener('click', event => {
        if (navMenu.classList.contains('active') && !navMenu.contains(event.target) && !hamburger.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && navMenu.classList.contains('active')) {
            closeMenu();
            hamburger.focus();
        }
    });
    navMenu.querySelectorAll('a').forEach(item => item.addEventListener('click', closeMenu));
    window.addEventListener('resize', () => {
        if (window.innerWidth > 760) closeMenu();
        syncMenu();
    });
    syncMenu();
}

function renderAuth() {
    let user;
    if (sessionId && userData) {
        try {
            user = JSON.parse(userData);
        } catch {
            user = null;
        }
    }

    if (authButtons) {
        authButtons.replaceChildren();
        if (user) {
            const greeting = document.createElement('span');
            greeting.className = 'auth-user';
            greeting.textContent = user.firstName || user.lastName || 'Account';
            authButtons.append(greeting, logoutButton('auth-logout'));
        } else {
            authButtons.append(link('login.html', 'Sign in', 'btn-login'), link('register.html', 'Create account', 'btn-register'));
        }
    }

    if (heroButtons && user) {
        heroButtons.replaceChildren(link('chat.html', 'Open workspace', 'btn btn-primary'), link('about.html', 'How it works', 'btn btn-secondary'));
    }

    if (navMenu) {
        const mobileAuth = document.createElement('li');
        mobileAuth.className = 'mobile-auth';
        if (user) {
            const greeting = document.createElement('span');
            greeting.className = 'auth-user';
            greeting.textContent = user.firstName || user.lastName || 'Account';
            mobileAuth.append(greeting, logoutButton('auth-logout'));
        } else {
            mobileAuth.append(link('login.html', 'Sign in', 'btn-login'), link('register.html', 'Create account', 'btn-register'));
        }
        navMenu.append(mobileAuth);
    }
}

async function logout() {
    if (sessionId) {
        try {
            await fetch(API_BASE_URL + '/auth/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId })
            });
        } catch (error) {
            console.error('Logout error:', error);
        }
    }
    localStorage.removeItem('cerebro_session');
    localStorage.removeItem('cerebro_user');
    window.location.href = 'index.html';
}

renderAuth();


// Carry study prompts across sign-in without changing authentication APIs.
function openStudyWorkspace(promptText = '', attach = false) {
    try {
        if (promptText.trim()) sessionStorage.setItem('cerebro_pending_prompt', promptText.trim());
        if (attach) sessionStorage.setItem('cerebro_attach_hint', '1');
    } catch {}
    window.location.href = sessionId && userData ? 'chat.html' : 'login.html';
}

const homePromptForm = document.getElementById('homePromptForm');
if (homePromptForm) {
    homePromptForm.addEventListener('submit', event => {
        event.preventDefault();
        const prompt = document.getElementById('homePrompt')?.value || '';
        if (prompt.trim()) openStudyWorkspace(prompt);
    });
    document.querySelectorAll('[data-home-action]').forEach(button => {
        button.addEventListener('click', () => {
            const action = button.dataset.homeAction;
            openStudyWorkspace(action === 'upload' ? '' : action, action === 'upload');
        });
    });
}
