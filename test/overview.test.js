const test = require('node:test');
const assert = require('node:assert/strict');
const { isDocumentOverview, selectedOverviewChunks, sourceOverview } = require('../overview');

const digest = 'a'.repeat(64);

test('recognizes broad explanations and summary shortcuts', () => {
    assert.equal(isDocumentOverview('Explain the main concepts from the focused documents in simple language.'), true);
    assert.equal(isDocumentOverview('Summarize the focused PDF documents.'), true);
    assert.equal(isDocumentOverview('Give an overview of this document'), true);
    assert.equal(isDocumentOverview('What is science?'), false);
    assert.equal(isDocumentOverview('Summarize how viruses propagate'), false);
    assert.equal(isDocumentOverview('Summarize page 4'), false);
    assert.equal(isDocumentOverview('Summarize CPU architecture'), false);
});

test('short single-page PDFs retain all distinct chunks', () => {
    const chunks = [
        { pdfName: 'resume.pdf', page: 1, text: 'SUMMARY '.repeat(22), digest },
        { pdfName: 'resume.pdf', page: 1, text: 'EDUCATION '.repeat(22), digest },
        { pdfName: 'other.pdf', page: 1, text: 'UNRELATED '.repeat(22), digest }
    ];
    const sample = selectedOverviewChunks(chunks, ['resume.pdf'], 8);
    assert.equal(sample.length, 2);
    assert.ok(sample.every(chunk => chunk.pdfName === 'resume.pdf'));
    assert.ok(sample.some(chunk => chunk.text.includes('EDUCATION')));
});

test('long PDF overviews cover distinct sections within their budget', () => {
    const headings = ['Intro', 'Hardware', 'Hardware', 'Memory', 'Software', 'Network', 'Backup', 'Security'];
    const chunks = headings.map((title, i) => ({ pdfName: 'basics.pdf', page: i + 1,
        text: title + '\n' + ('Detailed source content. '.repeat(10)), digest }));
    const sample = selectedOverviewChunks(chunks, ['basics.pdf'], 5);
    assert.ok(sample.length <= 5);
    assert.ok(sample.length >= 4);
    assert.ok(sample.some(chunk => chunk.text.startsWith('Intro')));
    assert.ok(sample.some(chunk => chunk.text.startsWith('Security')));
});

test('fallback quotes selected PDFs with genuine page citations only', () => {
    const chunks = [
        { pdfName: 'basics.pdf', page: 2, text: 'Hardware consists of physical computer components.', digest },
        { pdfName: 'resume.pdf', page: 1, text: 'Professional summary of development experience.', digest },
        { pdfName: 'secret.pdf', page: 1, text: 'Not a selected document.', digest }
    ];
    const fallback = sourceOverview(chunks.filter(chunk => chunk.pdfName !== 'secret.pdf'), ['basics.pdf', 'resume.pdf']);
    assert.match(fallback, /Hardware consists of physical computer components/);
    assert.match(fallback, /Professional summary of development experience/);
    assert.match(fallback, /basics\.pdf, p\. 2\]\(cerebro:/);
    assert.doesNotMatch(fallback, /secret\.pdf|Not a selected document/);
});