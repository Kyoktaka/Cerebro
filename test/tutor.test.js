const test = require('node:test');
const assert = require('node:assert/strict');
const { tutorAnswer, review } = require('../tutor');
const { validItem, studyRequest } = require('../study');
const { choosePassages, queryVariants } = require('../retrieval');
const { documentChunks, packDocuments } = require('../pdf-source');

const text = 'RAM temporarily stores the information needed by the processor.';
const chunks = [{ pdfName: 'notes.pdf', page: 2, text }];
const evidence = [{ id: 0, quote: text }];
const draft = { support: 'direct', answer: 'RAM holds information temporarily.', evidence };
const scores = { accuracy: 9, relevance: 10, completeness: 9, citations: 10, clarity: 10 };
const approved = { decision: 'approve', scores, feedback: '' };

test('review checks every threshold and the review decision', async () => {
    for (const field of Object.keys(scores)) {
        const result = await review(async () => ({ ...approved, scores: { ...scores, [field]: 8 } }));
        assert.equal(result.approved, false);
    }
    for (const invalid of [null, {}, { ...approved, decision: 'reject' }, { ...approved, scores: [] }]) {
        assert.equal((await review(async () => invalid)).approved, false);
    }
});

test('no answer on missing, fabricated or unrelated evidence, or on failed revision', async () => {
    for (const outputs of [
        [null], [{ ...draft, support: 'unsupported' }],
        [{ ...draft, evidence: [{ id: 3, quote: text }] }],
        [{ ...draft, evidence: [{ id: 0, quote: 'The computer was invented in 1920.' }] }],
        [draft, { ...approved, decision: 'reject' }],
        [draft, { decision: 'revise', feedback: 'Remove unsupported details.' }, draft, { decision: 'reject' }]
    ]) {
        assert.equal(await tutorAnswer(async () => outputs.shift(), 'Who invented RAM?', chunks), null);
    }
});

test('only a revised and approved explanation is shown, with exact passage and page', async () => {
    const outputs = [{ ...draft, answer: 'Invented content' }, { decision: 'revise', feedback: 'Stick to the quote.' }, draft, approved];
    const result = await tutorAnswer(async () => outputs.shift(), 'RAM?', chunks);
    assert.match(result.text, /RAM holds information temporarily/);
    assert.match(result.text, /notes.pdf, p\. 2/);
    assert.ok(result.text.includes(text));
    assert.doesNotMatch(result.text, /Invented content|Stick to/);
    assert.equal(outputs.length, 0);
    const comparison = await tutorAnswer(async () => draft, 'Compare A and B', chunks, '', ['notes.pdf', 'B.pdf']);
    assert.equal(comparison, null);
});

test('validate four options, an exact key, evidence, requested count and format', () => {
    const item = { kind: 'multiple-choice', prompt: 'Which term?', choices: ['RAM', 'CPU', 'disk', 'ROM'],
        answer: 'RAM', topic: 'Memory', hint: 'Review temporary memory.', explanation: text, evidence };
    const settings = studyRequest('Quiz me with 3 hard multiple-choice questions on chapter 2');
    assert.equal(settings.count, 3);
    assert.equal(settings.interactive, true);
    assert.equal(studyRequest('Quiz me on chapter 2').count, 10);
    assert.equal(studyRequest('Test my knowledge').kind, 'multiple-choice');
    assert.equal(studyRequest('Create 8 matching questions').kind, 'matching');
    assert.ok(validItem(item, settings, chunks, new Set()));
    for (const change of [{ answer: 'A' }, { choices: ['RAM','CPU','ROM'] }, { choices: ['RAM','RAM','CPU','disk'] },
        { evidence: [{ id: 0, quote: 'Unsupported claim.' }] }, { kind: 'matching' }]) {
        assert.equal(validItem({ ...item, ...change }, settings, chunks, new Set()), null);
    }
});

test('retrieval improves typos only from selected terms and includes every compared PDF', () => {
    assert.equal(queryVariants('compter', [{ text: 'The computer is here.' }]), 'computer');
    assert.equal(queryVariants('compter', [{ text: 'The computer and the compter.' }]), '');
    const docs = ['a.pdf','b.pdf'].flatMap(pdfName => Array.from({ length: 4 }, () => ({ pdfName, text, embedding: [1,0] })));
    assert.deepEqual(choosePassages(docs, ['a.pdf','b.pdf'], [1,0], true).map(c => c.pdfName), ['a.pdf','b.pdf']);
});

test('page offsets survive a blank page and document-like markers inside extracted text', () => {
    const first = 'First page.\n\n--- B.pdf ---\n\nThis belongs to A.';
    const second = 'A fact on page three.';
    const doc = { name: 'A.pdf', text: first + '\n\n\n\n' + second, layout: [
        { page: 1, start: 0, end: first.length }, { page: 3, start: first.length+4, end: first.length+4+second.length }] };
    const { content, meta } = packDocuments([doc, { name: 'B.pdf', text: 'Separate document.' }]);
    assert.equal(content.slice(meta[1].start, meta[1].end), 'Separate document.');
    assert.deepEqual(documentChunks(doc).map(c => [c.page, c.text]), [[1,first],[3,second]]);
    assert.equal(documentChunks({ name: 'legacy.pdf', text })[0].page, undefined);
});
