const API_BASE_URL = window.location.origin + '/api';

document.querySelectorAll('.toggle-password').forEach(button => {
    button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.target);
        if (!input) return;
        const visible = input.type === 'password';
        input.type = visible ? 'text' : 'password';
        button.textContent = visible ? 'Hide' : 'Show';
        button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
        button.setAttribute('aria-pressed', String(visible));
    });
});

if (new URLSearchParams(window.location.search).has('registered')) {
    const success = document.getElementById('successMessage');
    if (success) success.hidden = false;
}

const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async event => {
        event.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const submit = loginForm.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
            const response = await fetch(API_BASE_URL + '/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not sign in.');
            localStorage.setItem('cerebro_session', result.sessionId);
            localStorage.setItem('cerebro_user', JSON.stringify(result.user));
            window.location.href = 'chat.html';
        } catch (error) {
            showError(error.message || 'Cannot connect to Cerebro. Start the local server.');
        } finally {
            submit.disabled = false;
        }
    });
}

const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async event => {
        event.preventDefault();
        const firstName = document.getElementById('firstName').value.trim();
        const lastName = document.getElementById('lastName').value.trim();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const confirm = document.getElementById('confirmPassword').value;
        if (password !== confirm) return showError('Passwords do not match.');
        if (password.length < 6) return showError('Password must be at least 6 characters.');

        const submit = registerForm.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
            const response = await fetch(API_BASE_URL + '/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ firstName, lastName, email, password })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not create the account.');
            window.location.href = 'login.html?registered=1';
        } catch (error) {
            showError(error.message || 'Cannot connect to Cerebro. Start the local server.');
        } finally {
            submit.disabled = false;
        }
    });
}

const forgotLink = document.getElementById('forgotPassword');
if (forgotLink) {
    forgotLink.addEventListener('click', async () => {
        const username = prompt('Enter your last name (username):');
        if (!username) return;
        try {
            const response = await fetch(API_BASE_URL + '/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lastName: username.trim() })
            });
            const result = await response.json();
            if (response.ok) alert('Your password is: ' + result.password);
            else showError(result.error || 'Account not found.');
        } catch {
            showError('Cannot connect to Cerebro. Start the local server.');
        }
    });
}

let errorTimer;
function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    if (!errorDiv) return;
    clearTimeout(errorTimer);
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    errorTimer = setTimeout(() => { errorDiv.style.display = 'none'; }, 6000);
}
