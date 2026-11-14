const test = require('node:test');
const assert = require('node:assert/strict');
const { rankPassages, rankByKeywords, keywordScore, phraseBonus, semanticScore } = require('../hybrid');
const { choosePassages } = require('../retrieval');

test('keyword scoring rewards term overlap and exact phrases, and penalizes unrelated text', () => {
    const text = 'Photosynthesis converts light energy into chemical energy.';
    assert.equal(keywordScore('what is photosynthesis', text) > 0.5, true);
    assert.equal(keywordScore('light energy', text) > 0.5, true);
    assert.equal(keywordScore('quantum entanglement', text), 0);
    assert.equal(phraseBonus('light energy', text), 1);
    assert.equal(phraseBonus('chemical energy', text), 1);
    assert.equal(phraseBonus('what is', text), 0);
});

test('hybrid ranking recovers a keyword passage that semantic similarity alone would miss', () => {
    const chunks = [
        { pdfName: 'bio.pdf', text: 'Photosynthesis is the process plants use.', embedding: [0, 1] },
        { pdfName: 'bio.pdf', text: 'The chapter is long and detailed.', embedding: [1, 0] }
    ];
    // Query vector points at the distract paragraph; keyword weight rescues the answer.
    const ranked = rankPassages(chunks, ['bio.pdf'], [1, 0], 'photosynthesis', {
        weights: { semantic: 0.4, keyword: 0.6 }
    });
    assert.equal(ranked[0].text, 'Photosynthesis is the process plants use.');
});

test('semantic-only ranking preserves vector order when no query is provided', () => {
    const chunks = [
        { pdfName: 'a.pdf', text: 'alpha', embedding: [1, 0] },
        { pdfName: 'b.pdf', text: 'beta', embedding: [0, 1] }
    ];
    assert.deepEqual(rankPassages(chunks, ['b.pdf'], [1, 0]).map(c => c.text), ['beta']);
    assert.deepEqual(rankPassages(chunks, ['a.pdf', 'b.pdf'], [1, 0]).map(c => c.text), ['alpha', 'beta']);
});

test('coverage selection suppresses near-duplicate chunks and caps the context budget', () => {
    const repeated = Array.from({ length: 6 }, () => ({
        pdfName: 'p.pdf', text: 'Identical overlapping sentence about the same topic.', embedding: [1, 0]
    }));
    const distinct = { pdfName: 'p.pdf', text: 'A genuinely different section about networking.', embedding: [0, 1] };
    const ranked = rankPassages([...repeated, distinct], ['p.pdf'], [1, 0], 'networking', { top: 8, maxChars: 10000 });
    assert.ok(ranked.length <= 2, 'near-duplicate chunks are collapsed');
    assert.ok(ranked.some(c => c.text.includes('networking')));
    assert.ok(ranked.some(c => c.text.includes('Identical')));
});

test('keyword-only ranking returns only passages that share terms with the query', () => {
    const chunks = [
        { pdfName: 'n.pdf', text: 'TCP is a connection-oriented transport protocol.' },
        { pdfName: 'n.pdf', text: 'A haiku is a short Japanese poem.' },
        { pdfName: 'n.pdf', text: 'Photosynthesis occurs in plant cells.' }
    ];
    const ranked = rankByKeywords(chunks, ['n.pdf'], 'What does TCP provide?');
    assert.ok(ranked.length >= 1);
    assert.ok(ranked.every(c => c.text.includes('TCP')));
    assert.ok(!ranked.some(c => c.text.includes('haiku')));
});

test('choosePassages keeps per-document comparison behavior and honors scope', () => {
    const text = 'RAM temporarily stores the information needed by the processor.';
    const docs = ['a.pdf', 'b.pdf'].flatMap(pdfName =>
        Array.from({ length: 4 }, () => ({ pdfName, text, embedding: [1, 0] })));
    assert.deepEqual(choosePassages(docs, ['a.pdf', 'b.pdf'], [1, 0], true).map(c => c.pdfName), ['a.pdf', 'b.pdf']);
    assert.deepEqual(choosePassages(docs, ['b.pdf'], [1, 0], false).map(c => c.pdfName), ['b.pdf']);
});

test('semantic score normalizes cosine similarity and tolerates missing embeddings', () => {
    assert.equal(semanticScore([1, 0], [1, 0]), 1);
    assert.equal(semanticScore([1, 0], [0, 1]), 0.5);
    assert.equal(semanticScore(null, [1, 0]), 0);
    assert.equal(semanticScore([1, 0], undefined), 0);
});
