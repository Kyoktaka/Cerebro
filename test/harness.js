// Builds real indexes from the fixture corpus for engine-level tests.
const { extractDocument } = require('../engine/pdf');
const { buildIndex } = require('../engine/indexer');
const { respond } = require('../engine');
const { makeDocument } = require('./pdf-fixture');
const corpus = require('./fixtures/corpus');
const { createOracle, hashEmbed } = require('./oracle');

async function corpusIndex(names) {
    const documents = [];
    for (const name of names) documents.push(await extractDocument(makeDocument(corpus[name]), name + '.pdf'));
    const index = await buildIndex(documents, { embed: async texts => texts.map(text => hashEmbed(text)), model: 'hash-embed' });
    return { index, documents };
}

function session(index, selected, oracle = createOracle()) {
    const messages = [];
    let context = {};
    return {
        oracle,
        messages,
        get context() { return context; },
        async ask(query, extra = {}) {
            const statuses = [];
            const result = await respond({
                index, names: selected, query, context, model: oracle,
                vectorFor: async text => hashEmbed(text),
                history: messages.slice(-4), onStatus: status => statuses.push(status), onDraft: () => {}, ...extra
            });
            messages.push({ role: 'user', content: query }, { role: 'assistant', content: result.text });
            context = { ...context, activeTopic: result.topic || null };
            return { ...result, statuses };
        }
    };
}

module.exports = { corpusIndex, session };
