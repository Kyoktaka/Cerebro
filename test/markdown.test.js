const test = require('node:test');
const assert = require('node:assert/strict');
const { render, plain } = require('../public/js/markdown');

const digest = 'a'.repeat(64);

test('escapes untrusted HTML in text, code and study blocks', () => {
    assert.match(render('<img src=x onerror=alert(1)>'), /&lt;img/);
    assert.doesNotMatch(render('<script>alert(1)</script>'), /<script>/);
    assert.match(render('```html\n<img src=x>\n```'), /&lt;img src=x&gt;/);
    assert.doesNotMatch(render('```cerebro-quiz\n{"title":"<b>x</b>"}\n```'), /<b>x/);
});

test('renders headings one level below the page title, lists and emphasis', () => {
    const html = render('# Title\n\n- first\n- **second**');
    assert.match(html, /<h2>Title<\/h2>/);
    assert.match(html, /<ul><li>first<\/li><li><strong>second<\/strong><\/li><\/ul>/);
});

test('renders tables and line breaks', () => {
    assert.match(render('| Topic | Page |\n| --- | --- |\n| Arrays | 3 |'), /<table><thead><tr><th>Topic<\/th><th>Page<\/th><\/tr>/);
    assert.match(render('First\nSecond `npm test`'), /First<br>Second <code>npm test<\/code>/);
});

test('citations become page tabs; supplementary text is set apart', () => {
    const html = render(`RAM is working memory [notes.pdf, p. 2](cerebro:${digest}:2).\n\n**Remember:** RAM is temporary.\n\n**Beyond your PDF**\n\nThink of a desk.\n\n_Removed 1 statement._`);
    assert.match(html, new RegExp(`<button type="button" class="page-tab" data-digest="${digest}" data-page="2" data-doc="notes.pdf"`));
    assert.match(html, /<p class="takeaway"><span class="takeaway-label">Remember<\/span> RAM is temporary\.<\/p>/);
    assert.match(html, /<section class="beyond" aria-label="Beyond your PDF"><p class="beyond-label">Beyond your PDF<\/p><p>Think of a desk\.<\/p><\/section><p class="note">/);
});

test('study blocks are passed to the block renderer, and copy text drops them', () => {
    const text = 'Quiz\n\n```cerebro-quiz\n{"items":[]}\n```';
    assert.match(render(text), /<div class="study-block" data-block="quiz" data-json="\{&quot;items&quot;:\[\]\}"><\/div>/);
    assert.equal(plain(`A [n.pdf, p. 3](cerebro:${digest}:3).\n\n${text}`), 'A (n.pdf p. 3).\n\nQuiz');
});
