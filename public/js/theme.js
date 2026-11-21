(() => {
    const key = 'cerebro_theme';
    const stored = () => {
        try { return localStorage.getItem(key); } catch { return null; }
    };

    function apply(theme) {
        document.documentElement.dataset.theme = theme;
        document.querySelectorAll('[data-theme-toggle]').forEach(button => {
            const next = theme === 'dark' ? 'light' : 'dark';
            button.setAttribute('aria-label', `Switch to ${next} theme`);
            button.title = `Switch to ${next} theme`;
            const icon = button.querySelector('i');
            if (icon) icon.className = `fas fa-${theme === 'dark' ? 'sun' : 'moon'}`;
        });
        document.querySelectorAll('[data-theme-choice]').forEach(input => { input.checked = input.value === theme; });
    }

    function set(theme) {
        try { localStorage.setItem(key, theme); } catch {}
        apply(theme);
    }

    apply(stored() || 'dark');
    window.CerebroTheme = { set, current: () => document.documentElement.dataset.theme };

    document.addEventListener('DOMContentLoaded', () => {
        apply(document.documentElement.dataset.theme);
        document.querySelectorAll('[data-theme-toggle]').forEach(button => {
            button.addEventListener('click', () => set(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
        });
        document.querySelectorAll('[data-theme-choice]').forEach(input => {
            input.addEventListener('change', () => input.checked && set(input.value));
        });
    });
})();
