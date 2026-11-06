const test = require('node:test');
const assert = require('node:assert/strict');
const { chunkText, cosineSimilarity, retrieveChunks, questionHasEvidence, resolveDocumentScope, quizRequest, makeSourceQuiz } = require('../rag');
const { documentAnswer } = require('../document-answers');
const { renderPageText } = require('../pdf-text');

test('PDF text keeps table columns separated and rows on separate lines', async () => {
    const item = (str, x, y, width) => ({ str, transform: [1, 0, 0, 1, x, y], width });
    const page = { getTextContent: async () => ({ items: [item('Subject', 0, 100, 40), item('Code', 45, 100, 25), item('CS101', 0, 80, 35), item('Computing', 80, 80, 60)] }) };
    assert.equal(await renderPageText(page), 'Subject Code\nCS101 Computing');
});

test('registration table operations use course rows and ignore repeated permit codes', () => {
    const documents = [{ name: 'registration.pdf', text: 'Registration form for the current semester\nSUBJECT UNIT DESCRIPTION TIME DAY ROOM PROFESSOR\nCS 101 3 Introduction to Computing 08:00AM-09:00AM M Room A\nMATH-102 3 College Mathematics 09:00AM-10:00AM T Room B\nTOTAL: 6\nSUBJECT CODE SIGNATURE\nCS 101\nMATH-102\nREF999 Payment reference' }];
    const count = documentAnswer('how many subjects are in there?', documents);
    assert.match(count, /2 distinct subject codes/);
    assert.doesNotMatch(count, /REF999/);
    assert.match(documentAnswer('tell me the subject codes', documents), /MATH-102/);
    assert.match(documentAnswer('tell me the subject codes', documents), /Evidence: MATH-102 3 College Mathematics/);
    assert.match(documentAnswer('summarize it', documents), /2 distinct subjects, 6 units/);
    assert.equal(documentAnswer('summarize quantum physics', documents), null);
    assert.equal(documentAnswer('how many subjects have failed?', documents), null);
    assert.match(documentAnswer('how many subjects are in there?', [{ name: 'broken.pdf', text: 'unreadable table' }]), /could not reliably read/);
});

test('conversational study requests and resume fields remain source bounded', () => {
    const chunks = [{ pdfName: 'resume.pdf', text: 'Technical skills: React, Node.js, PostgreSQL\nDeploy applications using Vercel, Netlify, and Hostinger.' }];
    assert.equal(questionHasEvidence('whats that all about, give me summary', chunks), true);
    assert.equal(questionHasEvidence("what's his stacks?", chunks), true);
    assert.equal(questionHasEvidence("what's his stacks?", [{ text: 'Plants grow in sunlight.' }]), false);
    assert.equal(questionHasEvidence('give me summary about quantum physics', chunks), false);
    assert.equal(quizRequest('what about identification').kind, 'short-answer');
    assert.equal(quizRequest('what about identification').topic, '');
    assert.equal(quizRequest('generate me a multiple choices').kind, 'multiple-choice');
    assert.equal(quizRequest('generate me a multiple choices').topic, '');
    const cards = makeSourceQuiz(chunks, 10, 'short-answer');
    assert.ok(cards.some(card => card.answer === 'React, Node.js, PostgreSQL'));
    const choices = makeSourceQuiz(chunks, 10, 'multiple-choice');
    assert.equal(choices.length, 1);
    assert.equal(choices[0].choices.length, 3);
    assert.ok(choices[0].choices.every(choice => choices[0].evidence.includes(choice)));
});

test('quiz uses exact source sentences and identifies requested topics', () => {
    const chunks = [{ pdfName: 'resume.pdf', text: 'James is a software developer building websites.\nHe creates database systems for clients.' }];
    assert.equal(quizRequest('create me a quiz').topic, '');
    assert.equal(quizRequest('create me a quiz').count, 10);
    assert.equal(quizRequest('create me a quiz').kind, 'multiple-choice');
    assert.equal(quizRequest('Create me 10 quiz questions.').count, 10);
    assert.equal(quizRequest('Create me 10 quiz questions.').topic, '');
    assert.equal(quizRequest('make a quiz about science').topic, 'science');
    assert.equal(questionHasEvidence('who is the person?', chunks), true);
    const quiz = makeSourceQuiz(chunks, 5, 'fill');
    assert.equal(quiz.length, 2);
    for (const item of quiz) assert.ok(chunks[0].text.includes(item.prompt.replace('_____', item.answer)));
});

test('scope follows explicit uploaded filenames and refuses missing files', () => {
    const uploaded = ['DocA.pdf', 'DocB.pdf', 'My DocA.pdf'];
    assert.deepEqual(resolveDocumentScope('quiz on DocA.pdf', uploaded, uploaded).names, ['DocA.pdf']);
    assert.deepEqual(resolveDocumentScope('quiz on My DocA.pdf', uploaded, uploaded).names, ['My DocA.pdf']);
    assert.deepEqual(resolveDocumentScope('quiz from docb.PDF', uploaded, uploaded).names, ['DocB.pdf']);
    assert.deepEqual(resolveDocumentScope('quiz from DocB.pdf.', uploaded, uploaded).names, ['DocB.pdf']);
    assert.match(resolveDocumentScope('quiz from DocB.pdf.backup', uploaded, uploaded).error, /not available/);
    const both = resolveDocumentScope('quiz from DocA.pdf and DocB.pdf', uploaded, uploaded);
    assert.deepEqual(both.names, ['DocA.pdf', 'DocB.pdf']);
    assert.equal(quizRequest(both.query).topic, '');
    assert.match(resolveDocumentScope('quiz from DocA.pdf', uploaded, ['DocB.pdf']).error, /Select the named PDF/);
    assert.match(resolveDocumentScope('quiz from unknown.pdf', uploaded, uploaded).error, /not available/);
    assert.deepEqual(resolveDocumentScope('quiz me', uploaded, ['DocB.pdf']).names, ['DocB.pdf']);
});

test('quiz formats use document text for questions, choices, and evidence', () => {
    const chunks = [{ pdfName: 'computer.pdf', text: 'A computer is an electronic device that processes data according to instructions.\nThe machine contains a processor, memory, storage, network, and display.' }];
    for (const request of ['10 multiple choice questions', '10 flashcards', '10 short-answer questions', '10 definition questions']) {
        const parsed = quizRequest(request);
        assert.equal(parsed.count, 10);
        assert.equal(parsed.topic, '');
        const items = makeSourceQuiz(chunks, parsed.count, parsed.kind);
        assert.ok(items.length);
        for (const item of items) {
            assert.ok(chunks[0].text.includes(item.evidence));
            assert.ok(item.evidence.includes(item.answer));
            if (item.choices) {
                assert.equal(item.choices.length, 4);
                assert.equal(new Set(item.choices.map(value => value.toLowerCase())).size, 4);
                assert.ok(item.choices.every(choice => item.evidence.includes(choice)));
            }
        }
    }
    const many = [{ pdfName: 'large.pdf', text: Array.from({ length: 12 }, (_, i) => `Example number ${i} explains a different documented concept.`).join('\n') }];
    assert.equal(makeSourceQuiz(many, 10).length, 10);
    const mixed = [{ pdfName: 'biology.pdf', text: 'A plant uses sunlight and water to grow in the garden. A computer processes instructions and stores information.' }];
    const focused = makeSourceQuiz(mixed, 10, 'fill', 'plants');
    assert.equal(focused.length, 1);
    assert.match(focused[0].evidence, /plant/);
    assert.doesNotMatch(focused[0].evidence, /computer/);
    assert.equal(makeSourceQuiz([{ pdfName: 'computer.pdf', text: 'A computer, which is useful, processes data according to instructions.' }], 5, 'multiple-choice').length, 0);
});

test('unrelated question is rejected while document summary and matching question are allowed', () => {
    const chunks = [{ text: 'James is a software developer with experience building websites.' }];
    assert.equal(questionHasEvidence('can you tell me what is science?', chunks), false);
    assert.equal(questionHasEvidence('what is this PDF about?', chunks), true);
    assert.equal(questionHasEvidence('what experience does James have?', chunks), true);
    const computer = [{ text: 'A computer is an electronic device that processes data according to instructions.' }];
    assert.equal(questionHasEvidence('Tell me about computers?', computer), true);
    assert.equal(questionHasEvidence('Who invented the computer?', computer), false);
    assert.equal(questionHasEvidence('Tell me about math.', computer), false);
    assert.equal(questionHasEvidence('What is AI?', [{ text: 'AI is discussed as a tool for automation.' }]), true);
    assert.equal(questionHasEvidence('What is 2 + 2?', [{ text: 'The equation 2+2 = 4 appears here.' }]), true);
    assert.equal(questionHasEvidence('What is 2 + 2?', computer), false);
    assert.equal(questionHasEvidence('What is 2+2 in physics?', [{ text: 'The equation 2+2 = 4 appears here. Physics is a science.' }]), false);
    assert.equal(questionHasEvidence('Who invented the computer?', [{ text: 'The computer processes data.' }, { text: 'A device was invented later.' }]), false);
    assert.equal(questionHasEvidence('Who invented the computer?', [{ text: 'The computer processes data. A device was invented later.' }]), false);
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
