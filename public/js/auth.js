console.log(' auth.js loaded');

const API_BASE_URL = window.location.origin + '/api';

// Toggle password visibility
document.querySelectorAll('.toggle-password').forEach(icon => {
    icon.addEventListener('click', function () {
        const targetId = this.getAttribute('data-target');
        const input = targetId ? document.getElementById(targetId) : this.previousElementSibling;
        if (input && input.type === 'password') {
            input.type = 'text';
            this.classList.remove('fa-eye-slash');
            this.classList.add('fa-eye');
        } else if (input) {
            input.type = 'password';
            this.classList.remove('fa-eye');
            this.classList.add('fa-eye-slash');
        }
    });
});

// Login Form
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    console.log(' Login form found');
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        console.log('Attempting login:', username);

        try {
            const response = await fetch(`${API_BASE_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const result = await response.json();
            console.log('Login response:', result);

            if (response.ok) {
                localStorage.setItem('cerebro_session', result.sessionId);
                localStorage.setItem('cerebro_user', JSON.stringify(result.user));
                window.location.href = 'chat.html';
            } else {
                showError(result.error || 'Invalid credentials');
            }
        } catch (error) {
            console.error('Login error:', error);
            showError('Cannot connect to server. Make sure backend is running.');
        }
    });
} else {
    console.log(' Login form NOT found');
}

// Register Form
const registerForm = document.getElementById('registerForm');
if (registerForm) {
    console.log(' Register form found');

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        console.log('Register form submitted');

        const firstName = document.getElementById('firstName').value;
        const lastName = document.getElementById('lastName').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const confirm = document.getElementById('confirmPassword').value;

        console.log('Form data:', { firstName, lastName, email });

        if (password !== confirm) {
            showError('Passwords do not match');
            return;
        }

        if (password.length < 6) {
            showError('Password must be at least 6 characters');
            return;
        }

        const data = {
            firstName: firstName,
            lastName: lastName,
            email: email,
            password: password
        };

        try {
            console.log('Sending registration request to:', `${API_BASE_URL}/auth/register`);

            const response = await fetch(`${API_BASE_URL}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await response.json();
            console.log('Registration response:', result);

            if (response.ok) {
                alert('Registration successful! Please login.');
                console.log('Redirecting to login.html');
                window.location.href = 'login.html';
            } else {
                showError(result.error || 'Registration failed');
            }
        } catch (error) {
            console.error('Register error:', error);
            showError('Cannot connect to server. Make sure backend is running.');
        }
    });
} else {
    console.log(' Register form NOT found');
}

// Forgot Password
const forgotLink = document.getElementById('forgotPassword');
if (forgotLink) {
    forgotLink.addEventListener('click', async (e) => {
        e.preventDefault();
        const username = prompt('Enter your last name:');
        if (!username) return;

        try {
            const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lastName: username })
            });

            const result = await response.json();
            if (response.ok) {
                alert(`Your password is: ${result.password}`);
            } else {
                alert(result.error || 'User not found');
            }
        } catch (error) {
            alert('Cannot connect to server');
        }
    });
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        setTimeout(() => errorDiv.style.display = 'none', 3000);
    } else {
        alert(message);
    }
}
