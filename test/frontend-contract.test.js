const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const chatHtml = fs.readFileSync(path.join(publicDir, 'chat.html'), 'utf8');
const chatJs = fs.readFileSync(path.join(publicDir, 'js/chat.js'), 'utf8');

test('chat markup retains controller-owned element IDs', () => {
    const dynamic = new Set(['pdfManagerClose', 'pdfSelectAll', 'pdfApplyFocus', 'pdfDeleteSelected', 'typingIndicator']);
    const ids = [...chatJs.matchAll(/getElementById\('([^']+)'\)/g)].map(match => match[1]);
    for (const id of ids) {
        if (dynamic.has(id)) continue;
        assert.ok(chatHtml.includes('id="' + id + '"'), id + ' is required by the conversation controller');
    }
});

test('chat loads Markdown before the controller and enhanced controls after', () => {
    const sources = ['js/markdown.js', 'js/chat.js', 'js/ultracave-chat.js'];
    const indexes = sources.map(src => chatHtml.indexOf('src="' + src + '"'));
    assert.ok(indexes.every(index => index >= 0));
    assert.ok(indexes[0] < indexes[1] && indexes[1] < indexes[2]);
});

test('PDF citations retain a working source viewer', () => {
    assert.match(chatHtml, /id="pdfViewer"/);
    assert.match(chatJs, /\/source/);
});