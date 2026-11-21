const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const read = file => fs.readFileSync(path.join(publicDir, file), 'utf8');
const chatHtml = read('chat.html');
const chatJs = read('js/chat.js');
const pages = ['index.html', 'about.html', 'login.html', 'register.html', 'chat.html'];

test('every element the workspace controller looks up exists in the markup', () => {
    const ids = [...chatJs.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
    assert.ok(ids.length > 30);
    for (const id of new Set(ids)) assert.ok(chatHtml.includes(`id="${id}"`), `${id} is used by js/chat.js`);
});

test('scripts load in dependency order', () => {
    const order = ['js/markdown.js', 'js/blocks.js', 'js/chat.js'].map(src => chatHtml.indexOf(`src="${src}"`));
    assert.ok(order.every(index => index > 0) && order[0] < order[1] && order[1] < order[2]);
});

test('pages work offline: no remote assets, fonts are bundled', () => {
    for (const page of pages) {
        const html = read(page);
        assert.doesNotMatch(html, /(?:src|href)="https?:\/\//, `${page} loads a remote asset`);
        assert.match(html, /css\/cerebro\.css/);
        assert.match(html, /js\/theme\.js/);
    }
    const css = read('css/cerebro.css');
    for (const font of css.matchAll(/url\('\.\.\/(fonts\/[^']+)'\)/g)) assert.ok(fs.existsSync(path.join(publicDir, font[1])), font[1]);
    assert.ok(fs.existsSync(path.join(publicDir, 'fonts/OFL.txt')));
});

test('both themes define every color token', () => {
    const css = read('css/cerebro.css');
    const block = selector => css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)));
    const tokens = theme => new Set([...block(theme).matchAll(/--([\w-]+):/g)].map(match => match[1]));
    const dark = tokens('[data-theme="dark"] {');
    const light = tokens('[data-theme="light"] {');
    assert.deepEqual([...dark].sort(), [...light].sort());
    assert.match(block('[data-theme="dark"] {'), /--bg: #000000/);
});

test('cited pages open in the source viewer', () => {
    assert.match(chatHtml, /id="viewer"/);
    assert.match(chatJs, /\/source/);
});
