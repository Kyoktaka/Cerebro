// Repeatable evaluation of Cerebro's study pipeline on the fixture corpus.
//
//   npm run eval        offline: deterministic stand-in model and lexical
//                       embeddings. Measures retrieval, scope, follow-ups,
//                       citation checks, and study-set validation logic.
//   npm run eval:live   your local Ollama models from .env. Also measures
//                       answer behavior and latency of the real model.
//
// Scores are computed from each run; nothing here is hard-coded.
require('dotenv').config();
const { extractDocument } = require('../engine/pdf');
const { buildIndex, embeddingPrefixes } = require('../engine/indexer');
const { respond } = require('../engine');
const { createModel } = require('../engine/llm');
const { historyFor } = require('../engine/answer');
const { makeDocument } = require('./pdf-fixture');
const corpus = require('./fixtures/corpus');
const { createOracle, hashEmbed } = require('./oracle');

const live = process.argv.includes('--live');
const verbose = process.argv.includes('--verbose');

const CASES = [
    { id: 'A', name: 'Direct PDF question', docs: ['computer'], turns: [
        { q: 'What is RAM?', retrieve: ['Random Access Memory'], pages: [['computer.pdf', 2]], include: /working memory|temporar/i }] },
    { id: 'B', name: 'Related concept question', docs: ['computer'], turns: [
        { q: 'Why is RAM important?', retrieve: ['Random Access Memory'], pages: [['computer.pdf', 2]] }] },
    { id: 'C', name: 'Practical example follow-up', docs: ['databases'], turns: [
        { q: 'Explain primary keys', retrieve: ['Primary Key'], pages: [['databases.pdf', 2]] },
        { q: 'Give me a real-life example.', topic: /primary key/i, retrieve: ['Primary Key'], pages: [['databases.pdf', 2]] }] },
    { id: 'D', name: 'Topic-specific summary', docs: ['databases'], turns: [
        { q: 'Summarize normalization', pages: [['databases.pdf', 3]], exclude: /SQL|SELECT|relational database stores/ }] },
    { id: 'E', name: 'Follow-up context', docs: ['networking'], turns: [
        { q: 'Explain network topologies.', retrieve: ['Network Topologies'] },
        { q: 'Give me examples.', topic: /network topolog/i, notMode: 'clarify', retrieve: ['Network Topologies', 'Bus Topology', 'Star Topology', 'Ring Topology', 'Mesh Topology'] }] },
    { id: 'F', name: 'Multi-document retrieval', docs: ['computer', 'operatingSystems'], turns: [
        { q: 'What happens when RAM is full?', citeDocs: ['computer.pdf', 'operatingSystems.pdf'], retrieve: ['Memory Management'] }] },
    { id: 'G', name: 'Unselected document isolation', docs: ['networking', 'computer'], select: ['networking'], turns: [
        { q: 'What is RAM?', forbidDocs: ['computer.pdf'], exclude: /main working memory/ }] },
    { id: 'H', name: 'Missing information', docs: ['computer'], turns: [
        { q: 'Who invented the computer?', exclude: /invented[^.]*\[computer\.pdf/i, include: /doesn't cover|does not cover|not (?:in|covered)/i }] },
    { id: 'I', name: 'Quiz validation', docs: ['networking'], turns: [
        { q: 'Make a 4 question quiz about network topologies', quiz: { min: 2, docs: ['networking.pdf'], pages: [3, 4] } }] },
    { id: 'J', name: 'Flashcard quality', docs: ['databases'], turns: [
        { q: 'Create flashcards about tables and keys', cards: { min: 2, docs: ['databases.pdf'], pages: [2] } }] },
    { id: 'K', name: 'Retrieval failure recovery', docs: ['computer'], turns: [
        { q: 'What does the processor use as its scratchpad?', retrieve: ['Random Access Memory', 'Memory'], minStage: 2 }] },
    { id: 'L', name: 'Extraction failure', docs: ['scanned'], turns: [
        { q: 'What does the chapter say about chlorophyll?', include: /scanned image|could not read/i }] },
    { id: 'M', name: 'Long document summary coverage', docs: ['networking'], turns: [
        { q: 'Summarize the whole document', coverage: 0.75 }] },
    { id: 'N', name: 'Topic switching', docs: ['networking', 'databases'], turns: [
        { q: 'Explain star topology', retrieve: ['Star Topology'] },
        { q: 'What is a primary key?', topic: /primary key/i, retrieve: ['Primary Key'] },
        { q: 'Give me examples', topic: /primary key/i, forbidDocs: ['networking.pdf'] }] }
];

async function setup(names) {
    const documents = [];
    for (const name of names) documents.push(await extractDocument(makeDocument(corpus[name]), name + '.pdf'));
    let embed;
    let vectorFor;
    if (live) {
        const { embedTexts, OLLAMA_EMBED_MODEL } = require('../local-ai');
        const prefix = embeddingPrefixes(OLLAMA_EMBED_MODEL).query;
        embed = texts => embedTexts(texts, OLLAMA_EMBED_MODEL);
        vectorFor = async text => (await embedTexts([prefix + text], OLLAMA_EMBED_MODEL))[0];
        return { index: await buildIndex(documents, { embed, model: OLLAMA_EMBED_MODEL }), vectorFor };
    }
    embed = async texts => texts.map(text => hashEmbed(text));
    vectorFor = async text => hashEmbed(text);
    return { index: await buildIndex(documents, { embed, model: 'hash-embed' }), vectorFor };
}

function citations(text) {
    return [...text.matchAll(/\[([^\]\n]+?), p\. (\d+)\]\(cerebro:[a-f0-9]{64}:\d+\)/g)].map(match => [match[1], Number(match[2])]);
}

function block(text, type) {
    const match = text.match(new RegExp('```cerebro-' + type + '\\n([\\s\\S]*?)\\n```'));
    return match ? JSON.parse(match[1]) : null;
}

function check(turn, result, index) {
    const failures = [];
    const metrics = {};
    const text = result.text;
    const cites = citations(text);
    if (turn.retrieve) {
        const ids = result.meta?.passages || [];
        const sections = new Set(index.chunks.filter(chunk => ids.includes(chunk.id)).flatMap(chunk => {
            const doc = index.documents.find(item => item.name === chunk.pdfName);
            return chunk.sectionIds.map(id => doc.sections.find(section => section.id === id)?.title);
        }));
        metrics.retrievalHit = turn.retrieve.some(title => sections.has(title)) ? 1 : 0;
        if (!metrics.retrievalHit) failures.push(`expected a passage from ${turn.retrieve.join(' / ')}; got ${[...sections].join(', ') || 'none'}`);
    }
    if (turn.pages && cites.length) {
        const allowed = turn.pages.map(([doc, page]) => doc + '#' + page);
        const good = cites.filter(([doc, page]) => allowed.includes(doc + '#' + page)).length;
        metrics.citationAccuracy = good / cites.length;
        if (good < cites.length) failures.push(`citations outside expected pages: ${cites.map(c => c.join(' p.')).join(', ')}`);
    }
    if (turn.pages && !cites.length && !live) failures.push('no citations');
    if (turn.citeDocs) {
        const docs = new Set(cites.map(([doc]) => doc));
        metrics.multiDocument = turn.citeDocs.every(doc => docs.has(doc)) ? 1 : 0;
        if (!metrics.multiDocument) failures.push(`expected citations from ${turn.citeDocs.join(' and ')}`);
    }
    if (turn.forbidDocs) {
        const leaked = cites.filter(([doc]) => turn.forbidDocs.includes(doc));
        metrics.isolation = leaked.length ? 0 : 1;
        if (leaked.length) failures.push('cited an unselected document');
    }
    if (turn.include && !turn.include.test(text)) failures.push(`missing ${turn.include}`);
    if (turn.exclude && turn.exclude.test(text)) failures.push(`contains ${turn.exclude}`);
    if (turn.topic) {
        metrics.followUp = turn.topic.test(result.topic?.label || '') ? 1 : 0;
        if (!metrics.followUp) failures.push(`active topic was "${result.topic?.label}"`);
    }
    if (turn.notMode && result.mode === turn.notMode) failures.push(`mode was ${result.mode}`);
    if (turn.minStage && !(result.meta?.stage >= turn.minStage)) failures.push(`retrieval stage ${result.meta?.stage}, expected recovery`);
    if (turn.coverage) {
        const coverage = result.meta?.coverage;
        metrics.summaryCoverage = coverage ? coverage.cited / coverage.sections : 0;
        if (metrics.summaryCoverage < turn.coverage) failures.push(`summary covered ${coverage?.cited}/${coverage?.sections} sections`);
    }
    for (const [key, type] of [['quiz', 'quiz'], ['cards', 'flashcards']]) {
        if (!turn[key]) continue;
        const set = block(text, type);
        const items = set?.items || [];
        const spec = turn[key];
        const valid = items.filter(item => spec.docs.includes(item.source.doc) && spec.pages.includes(item.source.page) &&
            (type === 'flashcards' || item.type !== 'mcq' || item.choices[item.correct] === item.answer));
        metrics[key === 'quiz' ? 'quizValidity' : 'cardValidity'] = items.length ? valid.length / items.length : 0;
        if (items.length < spec.min) failures.push(`only ${items.length} ${type} items`);
        if (valid.length < items.length) failures.push(`${items.length - valid.length} items outside the topic or with a bad key`);
    }
    if (result.meta?.checks || result.meta?.report) {
        const report = result.meta.report || result.meta.checks;
        if (report.cited) metrics.removedRate = (report.removed || 0) / report.cited;
    }
    return { failures, metrics };
}

async function run() {
    const started = Date.now();
    const rows = [];
    const totals = {};
    let model;
    if (live) {
        const { OLLAMA_MODEL } = require('../local-ai');
        model = createModel(OLLAMA_MODEL);
        console.log(`Live evaluation with ${OLLAMA_MODEL}\n`);
    }
    for (const testCase of CASES) {
        const { index, vectorFor } = await setup(testCase.docs);
        const names = (testCase.select || testCase.docs).map(name => name + '.pdf');
        const messages = [];
        let context = {};
        const failures = [];
        const caseStart = Date.now();
        for (const turn of testCase.turns) {
            const result = await respond({
                index, names, query: turn.q, context, model: model || createOracle(), vectorFor,
                history: historyFor(messages), onStatus: () => {}, onDraft: () => {}
            });
            messages.push({ role: 'user', content: turn.q }, { role: 'assistant', content: result.text });
            context = { activeTopic: result.topic || null };
            const outcome = check(turn, result, index);
            failures.push(...outcome.failures.map(failure => `"${turn.q}": ${failure}`));
            for (const [key, value] of Object.entries(outcome.metrics)) (totals[key] ||= []).push(value);
            if (verbose) console.log(`\n--- ${testCase.id} ${turn.q}\n${result.text.replace(/\(cerebro:[a-f0-9]{64}:/g, '(').slice(0, 900)}\n`);
        }
        const seconds = (Date.now() - caseStart) / 1000;
        (totals.latency ||= []).push(seconds / testCase.turns.length);
        rows.push({ id: testCase.id, name: testCase.name, pass: !failures.length, failures, seconds });
    }
    for (const row of rows) {
        console.log(`${row.pass ? 'PASS' : 'FAIL'}  ${row.id}  ${row.name}${live ? `  (${row.seconds.toFixed(1)} s)` : ''}`);
        for (const failure of row.failures) console.log('        ' + failure);
    }
    const mean = list => list.reduce((a, b) => a + b, 0) / list.length;
    const labels = {
        retrievalHit: 'Retrieval hit rate', citationAccuracy: 'Citation accuracy', multiDocument: 'Multi-document coverage',
        isolation: 'Selected-document isolation', followUp: 'Follow-up topic resolution', summaryCoverage: 'Summary section coverage',
        quizValidity: 'Quiz item validity', cardValidity: 'Flashcard validity', removedRate: 'Draft claims removed by verifier', latency: 'Seconds per turn'
    };
    console.log(`\n${rows.filter(row => row.pass).length}/${rows.length} scenarios passed (${live ? 'live model' : 'offline stand-in model'})`);
    for (const [key, label] of Object.entries(labels)) {
        if (!totals[key]) continue;
        const value = mean(totals[key]);
        console.log(`  ${label.padEnd(34)} ${key === 'latency' ? value.toFixed(2) : (value * 100).toFixed(0) + '%'}  (n=${totals[key].length})`);
    }
    if (!live) console.log('\nOffline scores test the pipeline, not answer quality. Run `npm run eval:live` with Ollama for model behavior.');
    console.log(`Finished in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    process.exitCode = rows.every(row => row.pass) ? 0 : 1;
}

run().catch(error => {
    console.error(error.status ? `Cannot run the evaluation: ${error.message}` : error);
    process.exit(1);
});
