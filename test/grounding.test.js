const test = require('node:test');
const assert = require('node:assert/strict');
const { groundingMessages, validateEvidence, reviewMessages, validateReview } = require('../grounding');

test('grounded answers accept only exact, relevant quotes from the requested source', () => {
    const chunks = [
        { pdfName: 'computer.pdf', text: 'A computer is an electronic device that processes data according to instructions.' },
        { pdfName: 'other.pdf', text: 'Plants use sunlight and water to grow.' }
    ];
    const quote = chunks[0].text;
    const encode = evidence => JSON.stringify({ evidence });
    assert.deepEqual(validateEvidence(encode([{ source: 'computer.pdf', quote }]), chunks, 'What is a computer?'), [{ source: 'computer.pdf', quote }]);
    assert.deepEqual(validateEvidence(encode([{ source: 'computer.pdf', quote: 'A computer was invented in 1920.' }]), chunks, 'What is a computer?'), []);
    assert.deepEqual(validateEvidence(encode([{ source: 'computer.pdf', quote: chunks[1].text }]), chunks, 'What is a computer?'), []);
    assert.deepEqual(validateEvidence(encode([{ source: 'other.pdf', quote: chunks[1].text }]), [chunks[0]], 'What is a computer?'), []);
    assert.deepEqual(validateEvidence(encode([{ source: 'computer.pdf', quote }]), chunks, 'Who invented the computer?'), [{ source: 'computer.pdf', quote }]);
    assert.deepEqual(validateEvidence('{"evidence":[],"answer":"invented"}', chunks, 'What is a computer?'), []);
    assert.deepEqual(validateEvidence('not JSON', chunks, 'What is a computer?'), []);
    const messages = groundingMessages('What is a computer?', chunks);
    assert.match(messages[0].content, /untrusted data/);
    assert.match(messages[1].content, /=== START RETRIEVED PDF CONTEXT ===/);
    assert.match(messages[1].content, /=== END RETRIEVED PDF CONTEXT ===/);
    assert.equal(validateReview('{"supported":true}'), true);
    assert.equal(validateReview('{"supported":true,"inventor":"unknown"}'), false);
    assert.equal(validateReview('{"supported":false}'), false);
    assert.match(reviewMessages('Who invented the computer?', [{ source: 'computer.pdf', quote }])[0].content, /Topic overlap alone is insufficient/);
});
