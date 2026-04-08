const API_BASE_URL = 'http://localhost:8080/api';

// Hamburger Menu
const hamburger = document.querySelector('.hamburger');
const navMenu = document.querySelector('.nav-menu');

if (hamburger) {
    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
    });
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    if (navMenu && navMenu.classList.contains('active')) {
        if (!navMenu.contains(e.target) && !hamburger.contains(e.target)) {
            navMenu.classList.remove('active');
            hamburger.classList.remove('active');
        }
    }
});

// Check login status
const sessionId = localStorage.getItem('cerebro_session');
const userData = localStorage.getItem('cerebro_user');
const authButtons = document.getElementById('authButtons');
const heroButtons = document.getElementById('heroButtons');

// Function to add mobile auth buttons
function addMobileAuthButtons() {
    // Remove existing mobile auth if any
    const existingMobileAuth = document.querySelector('.mobile-auth');
    if (existingMobileAuth) existingMobileAuth.remove();

    if (sessionId && userData) {
        try {
            const user = JSON.parse(userData);
            const mobileAuthDiv = document.createElement('div');
            mobileAuthDiv.className = 'mobile-auth';
            mobileAuthDiv.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0; color: var(--secondary-color);">
                    <i class="fas fa-user-circle"></i> Welcome, ${user.firstName || user.lastName}
                </div>
                <button onclick="logout()" style="background: none; border: 1px solid var(--secondary-color); color: var(--secondary-color); padding: 0.5rem; border-radius: 20px; cursor: pointer; width: 100%;">Logout</button>
            `;
            navMenu.appendChild(mobileAuthDiv);
        } catch (e) {
            console.error('Error parsing user data');
        }
    } else {
        const mobileAuthDiv = document.createElement('div');
        mobileAuthDiv.className = 'mobile-auth';
        mobileAuthDiv.innerHTML = `
            <a href="login.html" class="btn-login" style="display: block; text-align: center; width: 100%;">Login</a>
            <a href="register.html" class="btn-register" style="display: block; text-align: center; width: 100%;">Register</a>
        `;
        navMenu.appendChild(mobileAuthDiv);
    }
}

function updateAuthUI() {
    if (sessionId && userData) {
        try {
            const user = JSON.parse(userData);
            if (authButtons) {
                authButtons.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <span style="font-size: 0.9rem;">Welcome, ${user.firstName || user.lastName}</span>
                        <button onclick="logout()" style="background: none; border: 1px solid var(--secondary-color); color: var(--secondary-color); padding: 0.3rem 0.8rem; border-radius: 20px; cursor: pointer;">Logout</button>
                    </div>
                `;
            }
            if (heroButtons) {
                heroButtons.innerHTML = `
                    <a href="chat.html" class="btn btn-primary">
                        <i class="fas fa-comment"></i> Start Chatting
                    </a>
                    <a href="about.html" class="btn btn-secondary">
                        <i class="fas fa-info-circle"></i> Learn More
                    </a>
                `;
            }
        } catch (e) {
            console.error('Error parsing user data');
        }
    } else {
        if (authButtons) {
            authButtons.innerHTML = `
                <a href="login.html" class="btn-login">Login</a>
                <a href="register.html" class="btn-register">Register</a>
            `;
        }
    }
    addMobileAuthButtons();
}

async function logout() {
    if (sessionId) {
        try {
            await fetch(`${API_BASE_URL}/auth/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId })
            });
        } catch (e) {
            console.error('Logout error:', e);
        }
    }
    localStorage.removeItem('cerebro_session');
    localStorage.removeItem('cerebro_user');
    window.location.href = 'index.html';
}

window.logout = logout;
window.API_BASE_URL = API_BASE_URL;

// Initialize
updateAuthUI();