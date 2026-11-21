const API_BASE_URL = window.location.origin + '/api';
const errorBox = document.getElementById('errorMessage');
const successBox = document.getElementById('successMessage');

function showError(message) {
    if (successBox) successBox.hidden = true;
    errorBox.textContent = message;
}

function showSuccess(message) {
    errorBox.textContent = '';
    if (!successBox) return;
    successBox.textContent = message;
    successBox.hidden = false;
}

function missingField(form) {
    const field = [...form.querySelectorAll('input[required]')].find(input => !input.value.trim());
    if (!field) return false;
    showError(`Enter your ${document.querySelector(`label[for="${field.id}"]`).textContent.toLowerCase()}.`);
    field.focus();
    return true;
}

async function send(route, body) {
    let response;
    try {
        response = await fetch(API_BASE_URL + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
        throw new Error('Cerebro is not running. Start it with npm start and try again.');
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Something went wrong. Try again.');
    return result;
}

document.querySelectorAll('.toggle-password').forEach(button => {
    button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.target);
        const visible = input.type === 'password';
        input.type = visible ? 'text' : 'password';
        button.textContent = visible ? 'Hide' : 'Show';
        button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
        button.setAttribute('aria-pressed', String(visible));
    });
});

if (successBox && new URLSearchParams(window.location.search).has('registered')) successBox.hidden = false;
if (errorBox && new URLSearchParams(window.location.search).has('expired')) errorBox.textContent = 'You were signed out. Sign in again to continue.';

const loginForm = document.getElementById('loginForm');
loginForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (missingField(loginForm)) return;
    const submit = loginForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
        const result = await send('/auth/login', {
            username: document.getElementById('username').value.trim(),
            password: document.getElementById('password').value
        });
        localStorage.setItem('cerebro_session', result.sessionId);
        localStorage.setItem('cerebro_user', JSON.stringify(result.user));
        window.location.href = 'chat.html';
    } catch (error) {
        showError(error.message === 'Invalid credentials' ? 'That username and password don\'t match.' : error.message);
        submit.disabled = false;
    }
});

const resetForm = document.getElementById('resetForm');
document.getElementById('forgotPassword')?.addEventListener('click', () => {
    const username = document.getElementById('username');
    if (!username.value.trim()) {
        showError('Enter your username first, then choose "Forgot password?".');
        username.focus();
        return;
    }
    errorBox.textContent = '';
    resetForm.hidden = false;
    document.getElementById('resetEmail').focus();
});

document.getElementById('resetCancel')?.addEventListener('click', () => {
    resetForm.hidden = true;
    document.getElementById('resetMessage').textContent = '';
    document.getElementById('password').focus();
});

const resetMessage = document.getElementById('resetMessage');
resetForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const email = document.getElementById('resetEmail');
    const password = document.getElementById('resetPassword');
    const fail = message => { resetMessage.textContent = message; };
    if (!email.value.trim()) return fail('Enter the email on your account.');
    if (password.value.length < 6) return fail('Use at least 6 characters for your new password.');
    resetMessage.textContent = '';
    const submit = resetForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
        await send('/auth/reset-password', { username: document.getElementById('username').value.trim(), email: email.value.trim(), password: password.value });
        resetForm.hidden = true;
        resetForm.reset();
        document.getElementById('password').value = '';
        showSuccess('Password reset. Sign in with your new password.');
        document.getElementById('password').focus();
    } catch (error) {
        fail(error.message);
    } finally {
        submit.disabled = false;
    }
});

const registerForm = document.getElementById('registerForm');
registerForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (missingField(registerForm)) return;
    const password = document.getElementById('password').value;
    if (password.length < 6) return showError('Use at least 6 characters for your password.');
    if (password !== document.getElementById('confirmPassword').value) return showError('The two passwords don\'t match.');
    const submit = registerForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
        await send('/auth/register', {
            firstName: document.getElementById('firstName').value.trim(),
            lastName: document.getElementById('lastName').value.trim(),
            email: document.getElementById('email').value.trim(),
            password
        });
        window.location.href = 'login.html?registered=1';
    } catch (error) {
        showError(error.message);
        submit.disabled = false;
    }
});
