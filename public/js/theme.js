(() => {
    const key = 'cerebro_theme';

    function savedTheme() {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        document.querySelectorAll('[data-theme-toggle]').forEach(button => {
            const next = theme === 'dark' ? 'light' : 'dark';
            button.setAttribute('aria-label', `Switch to ${next} mode`);
            button.setAttribute('title', `Switch to ${next} mode`);
            const label = button.querySelector('[data-theme-label]');
            if (label) label.textContent = next === 'dark' ? 'Dark mode' : 'Light mode';
            const icon = button.querySelector('i');
            if (icon) icon.className = `fas fa-${next === 'dark' ? 'moon' : 'sun'}`;
        });
    }

    applyTheme(savedTheme() || 'dark');

    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(document.documentElement.dataset.theme);
        document.querySelectorAll('[data-theme-toggle]').forEach(button => {
            button.addEventListener('click', () => {
                const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
                try {
                    localStorage.setItem(key, next);
                } catch {}
                applyTheme(next);
            });
        });
    });

})();
