const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../public/js/markdown');

test('escapes untrusted HTML in normal text and code', () => {
    assert.match(render('<img src=x onerror=alert(1)>'), /&lt;img/);
    assert.doesNotMatch(render('<script>alert(1)</script>'), /<script>/);
    assert.match(render('```html\n<img src=x>\n```'), /&lt;img src=x&gt;/);
});

test('renders headings, lists and inline emphasis', () => {
    const html = render('# Title\n\n- first\n- **second**');
    assert.match(html, /<h1>Title<\/h1>/);
    assert.match(html, /<ul><li>first<\/li><li><strong>second<\/strong><\/li><\/ul>/);
});

test('renders fenced code as escaped literal text', () => {
    assert.match(render('```js\nif (a < b) alert(a)\n```'),
        /<pre><code>if \(a &lt; b\) alert\(a\)<\/code><\/pre>/);
});

test('renders simple pipe tables', () => {
    assert.match(render('| Topic | Page |\n| --- | --- |\n| Arrays | 3 |'),
        /<table><thead><tr><th>Topic<\/th><th>Page<\/th><\/tr>/);
});

test('preserves line breaks and inline code', () => {
    assert.match(render('First\nSecond `npm test`'), /First<br>Second <code>npm test<\/code>/);
});