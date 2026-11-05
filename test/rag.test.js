const test = require('node:test');
const assert = require('node:assert/strict');
const { chunkText, cosineSimilarity, retrieveChunks, questionHasEvidence, quizRequest, makeSourceQuiz } = require('../rag');

test('quiz uses exact source sentences and identifies requested topics', () => {
    const chunks = [{ pdfName: 'resume.pdf', text: 'James is a software developer building websites.\nHe creates database systems for clients.' }];
    assert.equal(quizRequest('create me a quiz').topic, '');
    assert.equal(quizRequest('make a quiz about science').topic, 'science');
    assert.equal(questionHasEvidence('who is the person?', chunks), true);
    const quiz = makeSourceQuiz(chunks);
    assert.equal(quiz.length, 2);
    for (const item of quiz) assert.ok(chunks[0].text.includes(item.prompt.replace('_____', item.answer)));
});

test('unrelated question is rejected while document summary and matching question are allowed', () => {
    const chunks = [{ text: 'James is a software developer with experience building websites.' }];
    assert.equal(questionHasEvidence('can you tell me what is science?', chunks), false);
    assert.equal(questionHasEvidence('what is this PDF about?', chunks), true);
    assert.equal(questionHasEvidence('what experience does James have?', chunks), true);
});

test('long documents are chunked without losing their ends', () => {
    const content = `${'A '.repeat(1000)}final sentence`;
    const chunks = chunkText(content);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.at(-1).endsWith('final sentence'));
    assert.ok(chunks.every(chunk => chunk.length <= 1400));
});

test('retrieval ranks local vectors and respects focused PDF names', () => {
    const index = {
        chunks: [
            { pdfName: 'a.pdf', text: 'alpha', embedding: [1, 0] },
            { pdfName: 'b.pdf', text: 'beta', embedding: [0, 1] }
        ]
    };
    assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
    assert.deepEqual(retrieveChunks(index, ['b.pdf'], [1, 0]).map(chunk => chunk.text), ['beta']);
    assert.deepEqual(retrieveChunks(index, ['a.pdf', 'b.pdf'], [1, 0]).map(chunk => chunk.text), ['alpha', 'beta']);
});
