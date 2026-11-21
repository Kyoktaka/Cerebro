const test = require('node:test');
const assert = require('node:assert/strict');
const { extractDocument, renderPageText } = require('../engine/pdf');
const { analyzeDocument } = require('../engine/structure');
const { buildIndex, indexCovers, embeddingPrefixes, INDEX_VERSION } = require('../engine/indexer');
const { search, assess, sectionChunks, expandQuery, matchTopics } = require('../engine/retrieve');
const { classify, resolveTopic } = require('../engine/intent');
const { verifyAnswer, normalizeCitations, splitAnswer } = require('../engine/verify');
const { normalizeItem, locate, difficultyMix } = require('../engine/study');
const { resolveDocumentScope } = require('../engine/scope');
const { documentAnswer } = require('../document-answers');
const { makeDocument } = require('./pdf-fixture');
const corpus = require('./fixtures/corpus');
const { corpusIndex } = require('./harness');
const { hashEmbed } = require('./oracle');

const extract = (name, pages = corpus[name]) => extractDocument(makeDocument(pages), name + '.pdf');

test('extraction keeps headings, paragraphs, tables and page numbers', async () => {
    const doc = await extract('networking');
    assert.equal(doc.pageCount, 5);
    assert.deepEqual(doc.outline.filter(item => item.level === 1).map(item => item.title),
        ['Introduction to Computer Networks', 'Types of Networks', 'Network Topologies', 'Network Devices']);
    assert.ok(doc.outline.some(item => item.title === 'Star Topology' && item.level === 2 && item.page === 3));
    assert.match(doc.text, /When two computers communicate, the sending computer breaks the message into small units called packets\. Each packet/,
        'wrapped lines are joined back into one paragraph');
    assert.doesNotMatch(doc.text, /Study notes - page/, 'running footers are removed');
    assert.match(doc.text, /Topology \| Main advantage \| Main disadvantage\nBus \| Low cost \| Backbone is a single point of failure/);
    assert.equal(doc.text.slice(doc.layout[2].start, doc.layout[2].end).split('\n')[0], 'Network Topologies');
});

test('image-only pages are reported instead of silently skipped', async () => {
    const doc = await extract('scanned');
    assert.deepEqual(doc.imagePages, [2, 3]);
    assert.equal(doc.readablePages, 1);
    assert.equal(doc.incomplete, true);
});

test('rotated slide pages read line by line', async () => {
    const doc = await extract('rotated', [[{ rotate: true }, { h1: 'Rotated Slide Title' },
        { p: 'This sentence is long enough to wrap across more than one line on the rotated page so the reader must join the lines again.' }]]);
    assert.match(doc.text, /^Rotated Slide Title\n\nThis sentence is long enough to wrap across more than one line on the rotated page so the reader must join the lines again\./);
    assert.equal(doc.outline[0].title, 'Rotated Slide Title');
});

test('page text keeps table columns separated and rows on separate lines', async () => {
    const page = { getTextContent: async () => ({ items: [
        { str: 'Subject', transform: [1, 0, 0, 1, 0, 100], width: 40 },
        { str: 'Code', transform: [1, 0, 0, 1, 45, 100], width: 25 },
        { str: 'CS101', transform: [1, 0, 0, 1, 0, 80], width: 35 },
        { str: 'Computing', transform: [1, 0, 0, 1, 80, 80], width: 60 }
    ] }) };
    assert.equal(await renderPageText(page), 'Subject Code\nCS101 Computing');
});

test('registration table answers still work with column separators', () => {
    const text = 'SUBJECT | UNIT | DESCRIPTION | TIME | DAY | ROOM | PROFESSOR\nCS 101 | 3 | Introduction to Computing | 08:00AM-09:00AM | M | Room A | Cruz\nMATH 102 | 3 | College Algebra | 10:00AM-11:00AM | T | Room B | Reyes\nTOTAL: | 6';
    const answer = documentAnswer('How many subjects are there?', [{ name: 'reg.pdf', text }]);
    assert.match(answer, /2/);
});

test('structure: sections, page spans, terms and acronyms', async () => {
    const analysis = analyzeDocument(await extract('computer'));
    const ram = analysis.sections.find(section => section.title === 'Random Access Memory');
    assert.deepEqual(ram.path, ['Memory', 'Random Access Memory']);
    assert.equal(ram.pageStart, 2);
    const chunk = analysis.chunks.find(item => item.sectionIds.includes(ram.id));
    assert.ok(chunk.spans.every(span => Number.isInteger(span.page)));
    assert.ok(chunk.text.includes('volatile'));
    assert.ok(analysis.aliases.some(([short, long]) => short === 'RAM' && long === 'Random Access Memory'));
    assert.ok(analysis.terms.some(term => term.term === 'RAM'));
    assert.ok(analysis.chunks.every(item => item.text.length <= 1600));
});

test('legacy text without page structure still gets sections', () => {
    const text = 'CHAPTER 1 BASICS\nA computer is an electronic device that\naccepts data and processes it.\nCHAPTER 2 MEMORY\nRAM is temporary\nworking memory.';
    const analysis = analyzeDocument({ name: 'old.pdf', text, layout: [{ page: 1, start: 0, end: text.length }] });
    assert.deepEqual(analysis.sections.filter(section => section.title).map(section => section.title), ['CHAPTER 1 BASICS', 'CHAPTER 2 MEMORY']);
    assert.ok(analysis.chunks.some(chunk => chunk.text.includes('A computer is an electronic device that accepts data')));
});

test('index reuse embeds only new documents and versions invalidate old indexes', async () => {
    const computer = await extract('computer');
    const networking = await extract('networking');
    let embedded = 0;
    const embed = async texts => { embedded += texts.length; return texts.map(text => hashEmbed(text)); };
    const first = await buildIndex([computer], { embed, model: 'nomic-embed-text' });
    const firstCount = embedded;
    const second = await buildIndex([computer, networking], { embed, model: 'nomic-embed-text', previous: first });
    assert.equal(embedded - firstCount, second.chunks.filter(chunk => chunk.pdfName === 'networking.pdf').length);
    assert.equal(second.version, INDEX_VERSION);
    const meta = [computer, networking].map(({ name, digest, version }) => ({ name, digest, version }));
    assert.equal(indexCovers(second, ['computer.pdf', 'networking.pdf'], meta, 'nomic-embed-text'), true);
    assert.equal(indexCovers({ ...second, version: 2 }, ['computer.pdf', 'networking.pdf'], meta, 'nomic-embed-text'), false);
    assert.equal(indexCovers(second, ['computer.pdf', 'networking.pdf'], meta, 'mxbai-embed-large'), false);
    assert.deepEqual(embeddingPrefixes('nomic-embed-text:latest'), { document: 'search_document: ', query: 'search_query: ' });
    assert.ok(first.chunks[0].embedding.length);
});

test('retrieval respects the selected documents and expands acronyms', async () => {
    const { index } = await corpusIndex(['computer', 'networking', 'operatingSystems']);
    const vector = hashEmbed('What is RAM?');
    const isolated = search(index, { names: ['networking.pdf'], query: 'What is RAM?', vector });
    assert.ok(isolated.passages.every(passage => passage.pdfName === 'networking.pdf'));
    assert.equal(assess(isolated.passages, isolated.base, isolated.topics).strength, 'none');

    const both = search(index, { names: ['computer.pdf', 'operatingSystems.pdf'], query: 'What happens when RAM is full?', vector: hashEmbed('What happens when RAM is full?') });
    assert.deepEqual([...new Set(both.passages.slice(0, 3).map(passage => passage.pdfName))].sort(), ['computer.pdf', 'operatingSystems.pdf']);

    assert.ok(expandQuery(index, 'random access memory').terms.includes('ram'));
    assert.ok(expandQuery(index, 'netwrok topology').terms.includes('network'), 'one-letter typos are fixed from the document vocabulary');

    const topic = matchTopics(index, ['networking.pdf'], 'network topologies')[0];
    assert.equal(topic.title, 'Network Topologies');
    const chunks = sectionChunks(index, ['networking.pdf'], [topic.sectionId]);
    assert.ok(chunks.some(chunk => chunk.text.includes('Mesh Topology')), 'a topic includes its subsections across pages');
    assert.ok(chunks.every(chunk => !chunk.text.includes('modem')));
});

test('intent: requests, topics and counts', () => {
    const cases = [
<<<<<<< HEAD
        ['Give me a real-life example of a LAN.', 'examples', 'LAN'],
=======
        ['Give me a real-life example of a LAN.', 'examples', 'lan'],
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d
        ['What happens when two computers communicate?', 'steps', 'two computers communicate'],
        ['Summarize the topic about network topologies.', 'summary', 'network topologies'],
        ['What is the difference between star and bus topology?', 'compare', 'star bus topology'],
        ['Create flashcards about network devices.', 'flashcards', 'network devices'],
        ['Summarize the focused PDF documents.', 'summary', ''],
        ['what is this pdf about?', 'summary', ''],
        ['hi', 'greeting', ''],
        ['Make a study guide', 'study-guide', ''],
        ['Explain normalization in simple terms', 'simplify', 'normalization']
    ];
    for (const [message, intent, topic] of cases) {
        const parsed = classify(message);
        assert.equal(parsed.intent, intent, message);
        assert.equal(parsed.topicText, topic, message);
    }
    const quiz = classify('Make 3 easy true or false questions about RAM');
<<<<<<< HEAD
    assert.deepEqual([quiz.intent, quiz.count, quiz.kind, quiz.difficulty, quiz.topicText], ['quiz', 3, 'true-false', 'easy', 'RAM']);
=======
    assert.deepEqual([quiz.intent, quiz.count, quiz.kind, quiz.difficulty, quiz.topicText], ['quiz', 3, 'true-false', 'easy', 'ram']);
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d
    assert.equal(classify('Quiz me on keys, one question at a time').interactive, true);
    assert.equal(classify('Answer only from the PDF: what is RAM?').sourceMode, 'pdf-only');
});

test('follow-ups keep the active topic; a new subject switches it', () => {
    const active = { label: 'Network Topologies' };
    assert.equal(resolveTopic(classify('Give me examples'), active).label, 'Network Topologies');
    const advantages = resolveTopic(classify('What are their advantages?'), active);
    assert.deepEqual([advantages.label, advantages.aspect], ['Network Topologies', 'advantages']);
    assert.equal(resolveTopic(classify('Make a short quiz about this topic'), active).label, 'Network Topologies');
    const switched = resolveTopic(classify('What is a primary key?'), active);
    assert.deepEqual([switched.label, switched.switched], ['primary key', true]);
    assert.equal(resolveTopic(classify('Summarize the whole document'), active).label, '');
});

const passages = [
    { id: 'a:0', pdfName: 'computer.pdf', digest: 'a'.repeat(64), page: 2, section: 'Random Access Memory', text: 'Random Access Memory (RAM) is the main working memory of a computer. RAM is volatile, which means its contents are lost when the power is turned off.' },
    { id: 'a:1', pdfName: 'computer.pdf', digest: 'a'.repeat(64), page: 3, section: 'Storage Devices', text: 'Storage devices keep data and programs for long-term use. Unlike RAM, storage is non-volatile.' }
];

test('verification removes fabricated citations and unsupported specifics', async () => {
    const draft = 'RAM is the main working memory [1]. It was invented in 1968 by Robert Dennard [1]. Plants are green [7]. Storage keeps data for long-term use [1].';
    const unchecked = await verifyAnswer(draft, passages);
    assert.match(unchecked.markdown, /Storage keeps data for long-term use\.$/, 'without a judge a mis-cited claim loses its citation');
    const judge = { json: async () => ({ verdicts: [{ n: 1, supported: true }] }) };
    const result = await verifyAnswer(draft, passages, { model: judge });
    assert.match(result.markdown, /main working memory \[computer\.pdf, p\. 2\]\(cerebro:a{64}:2\)\./);
    assert.doesNotMatch(result.markdown, /1968|Dennard|Plants/);
    assert.match(result.markdown, /long-term use \[computer\.pdf, p\. 3\]/, 'a wrong passage number is re-pointed to the passage that states it');
    assert.equal(result.report.removed, 2);
    assert.match(result.sources, /cerebro-sources/);
});

test('verification: contrast sentences need the judge; supplementary text is never cited', async () => {
    const judge = { json: async (system, user) => ({ verdicts: [{ n: 1, supported: !/non-volatile/.test(user.split('Source:')[0]) }] }) };
    const result = await verifyAnswer('RAM is non-volatile [2].\n\n**Beyond your PDF**\n\nThink of RAM as a desk [1].', passages, { model: judge });
    assert.doesNotMatch(result.markdown, /RAM is non-volatile/);
    assert.match(result.markdown, /\*\*Beyond your PDF\*\*\n\nThink of RAM as a desk\.$/);
    assert.equal(normalizeCitations('A [Passage 1, 2]. B [3-4].'), 'A [1][2]. B [3][4].');
    assert.deepEqual(splitAnswer('x\n\n### Beyond the PDF\ny'), { main: 'x', beyond: 'y' });
});

test('quiz validation rejects ambiguous or unsupported items', () => {
    const base = { question: 'Which statement describes RAM?', explanation: 'The passage says so.', concept: 'RAM', difficulty: 'easy', quote: 'RAM is volatile, which means its contents are lost', passage: 1 };
    const good = normalizeItem({ ...base, choices: ['Volatile working memory', 'Permanent startup storage', 'A spinning platter', 'A printer port'], correct: 0 }, 'multiple-choice', passages);
    assert.ok(good.item, good.error);
    assert.equal(good.item.source.page, 2);
    assert.match(normalizeItem({ ...base, choices: ['A', 'B', 'All of the above', 'D'], correct: 0 }, 'multiple-choice', passages).error, /vague/);
    assert.match(normalizeItem({ ...base, choices: ['Volatile', 'Volatile', 'C', 'D'], correct: 0 }, 'multiple-choice', passages).error, /duplicate/);
    assert.match(normalizeItem({ ...base, quote: 'RAM was invented in 1968', choices: ['Volatile working memory', 'B', 'C', 'D'], correct: 0 }, 'multiple-choice', passages).error, /quote/);
    assert.match(normalizeItem({ ...base, choices: ['Volatile working memory', 'B', 'C', 'D'], correct: 5 }, 'multiple-choice', passages).error, /answer key/);
    assert.ok(locate('RAM  is vola tile, which means', passages), 'quotes match across broken words and spacing');
    assert.deepEqual(difficultyMix(5, 'mixed'), ['easy', 'easy', 'moderate', 'moderate', 'difficult']);
});

test('named PDFs must be uploaded and selected', () => {
    assert.deepEqual(resolveDocumentScope('summarize alpha.pdf', ['alpha.pdf', 'beta.pdf'], ['alpha.pdf', 'beta.pdf']).names, ['alpha.pdf']);
    assert.match(resolveDocumentScope('quiz from alpha.pdf', ['alpha.pdf', 'beta.pdf'], ['beta.pdf']).error, /Select the named PDF/);
    assert.match(resolveDocumentScope('quiz from missing.pdf', ['alpha.pdf'], ['alpha.pdf']).error, /not available/);
    assert.deepEqual(resolveDocumentScope('What is RAM?', ['alpha.pdf', 'beta.pdf'], ['beta.pdf']).names, ['beta.pdf']);
});
<<<<<<< HEAD

test('sessions persist across restarts and expire when idle', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { createSessionStore, IDLE_LIMIT_MS } = require('../sessions');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cerebro-sessions-'));
    const users = { Cruz: { lastName: 'Cruz' }, Reyes: { lastName: 'Reyes' } };
    const load = name => users[name] || null;
    const first = createSessionStore(dir, load);
    const id = first.create(users.Cruz);
    const other = first.create(users.Reyes);
    const reopened = createSessionStore(dir, load);
    assert.equal(reopened.get(id).user.lastName, 'Cruz', 'a new process still knows the session');
    assert.equal(reopened.get('missing'), null);
    reopened.removeUser('Cruz');
    assert.equal(createSessionStore(dir, load).get(id), null);
    const file = path.join(dir, 'sessions.json');
    const records = JSON.parse(fs.readFileSync(file, 'utf8'));
    records[other].lastSeen -= IDLE_LIMIT_MS + 1000;
    fs.writeFileSync(file, JSON.stringify(records));
    assert.equal(createSessionStore(dir, load).get(other), null, 'idle sessions expire');
    fs.rmSync(dir, { recursive: true, force: true });
});
=======
>>>>>>> 904ba39d7f3dbe823e744c8ab0f1ff7d4598e29d
