// A deterministic stand-in for the local model. It reads Cerebro's prompts the
// way a careful model would (cite the passage that states a fact, say
// OUT_OF_SCOPE for unrelated questions) so pipeline logic can be tested
// without Ollama. It measures the pipeline, not answer quality.
const { contentTerms, terms, textSentences: sentences, stem, words } = require('../engine/text');

const THESAURUS = {
    scratchpad: ['working memory', 'RAM'], brain: ['CPU', 'central processing unit'], scratch: ['working memory'],
    linking: ['foreign key', 'relationships'], duplicate: ['primary key'], layout: ['topology', 'arrangement']
};

function parsePassages(user) {
    const block = user.split(/(?:^|\n)Passages:\n/)[1] || '';
    const body = block.split(/\n\n(?:Student's question:|Write \d|Questions:)/)[0];
    const passages = [];
    for (const part of body.split(/\n\n(?=\[\d+\] )/)) {
        const match = part.match(/^\[(\d+)\] ([^\n]*)\n([\s\S]*)$/);
        if (match) passages.push({ n: Number(match[1]), where: match[2], text: match[3] });
    }
    return passages;
}

function question(user) {
    const q = user.match(/Student's question: ([^\n]*)/)?.[1] || '';
    const about = user.match(/The student is asking about: ([^\n]*)/)?.[1] || '';
    return { q, about };
}

function rank(passages, wanted) {
    const out = [];
    for (const passage of passages) {
        for (const sentence of sentences(passage.text)) {
            if (sentence.split(' ').length < 5) continue;
            const present = new Set(terms(sentence));
            const hits = wanted.filter(term => present.has(term)).length;
            if (hits) out.push({ n: passage.n, sentence, hits: hits / wanted.length });
        }
    }
    return out.sort((a, b) => b.hits - a.hits);
}

function answerText(system, user) {
    const passages = parsePassages(user);
    const { q, about } = question(user);
    const wanted = contentTerms(q + ' ' + about);
    if (/Summarize/.test(q) || /Shape: a short overview/.test(system) || /study guide/i.test(q) || /key terms/.test(q)) {
        const lines = passages.map(passage => '- ' + sentences(passage.text)[0] + ` [${passage.n}]`);
        return 'Here is what the material says.\n\n' + lines.join('\n') + '\n\n**Remember:** these ideas connect.';
    }
    const ranked = rank(passages, wanted);
    if (!ranked.length || ranked[0].hits < (wanted.length > 1 ? 0.6 : 0.34)) {
        if (/OUT_OF_SCOPE/.test(system)) {
            const related = passages.some(passage => wanted.some(term => terms(passage.where).includes(term)));
            if (!related) return 'OUT_OF_SCOPE';
        }
        if (/Use only the passages/.test(system)) return "Your PDF doesn't cover this.";
        return "Your PDF doesn't cover this directly.\n\n**Beyond your PDF**\n\nHere is a general explanation of " + (q || about) + '.';
    }
    const top = ranked.filter((item, i, all) => all.findIndex(other => other.sentence === item.sentence) === i).slice(0, 2);
    let out = top.map(item => `${item.sentence.replace(/[.!?]$/, '')} [${item.n}].`).join(' ');
    if (/Shape: two to four examples/.test(system)) out += '\n\n**Beyond your PDF**\n\n- A school computer lab is a familiar example.';
    return out + '\n\n**Remember:** ' + top[0].sentence;
}

function definitionPairs(passages) {
    const pairs = [];
    for (const passage of passages) {
        for (const sentence of sentences(passage.text)) {
            const match = sentence.match(/^(?:(?:A|An|The)\s+)?([\p{L}][\p{L} ()-]{1,40}?)\s+(is|are|connects|stores|covers|carries|keep|keeps|holds)\s+(.{10,})$/u);
            if (match && !/^(?:it|this|that|they|these|those|there)\b/i.test(match[1])) pairs.push({ term: match[1].replace(/\s*\(.*\)/, ''), verb: match[2], rest: match[3].replace(/[.!?]$/, ''), sentence, n: passage.n });
        }
    }
    return pairs;
}

function quizItems(system, user, schema) {
    const passages = parsePassages(user);
    const wanted = Number(user.match(/Write (\d+)/)?.[1] || 3);
    const covered = (user.match(/Already covered[^:]*: ([^\n]*)/)?.[1] || '').split('; ').map(item => item.toLowerCase());
    const pairs = definitionPairs(passages).map(pair => {
        const detail = /^in /.test(pair.rest) ? ' ' + pair.rest.split(' ').slice(0, 4).join(' ') : '';
        return { ...pair, concept: pair.term + detail };
    }).filter(pair => !covered.includes(pair.concept.toLowerCase()));
    const props = schema.properties.items.items.properties;
    const fillers = ['a printed list of page numbers', 'a type of cooling fan', 'an unrelated spreadsheet formula', 'a method for typing faster'];
    return pairs.slice(0, wanted).map((pair, i) => {
        const base = { explanation: `The passage says: ${pair.sentence}`, concept: pair.concept, difficulty: ['easy', 'moderate', 'difficult'][i % 3], quote: pair.sentence, passage: pair.n };
        if (props.front) return { front: `What is ${pair.concept}?`, back: pair.sentence, type: 'definition', example: '', quote: pair.sentence, passage: pair.n };
        if (props.choices) {
            const others = pairs.filter(other => other.term !== pair.term).map(other => other.rest.slice(0, 60));
            const choices = [pair.rest.slice(0, 70), ...[...others, ...fillers].slice(0, 3)];
            const correct = i % 4;
            [choices[0], choices[correct]] = [choices[correct], choices[0]];
            return { ...base, question: `Which statement best describes ${pair.concept}?`, choices, correct };
        }
        if (props.statement) return { ...base, statement: pair.sentence, answer: true };
        if (/_____/.test(system)) return { ...base, question: pair.sentence.replace(pair.term, '_____'), answer: pair.term };
        return { ...base, question: `What ${pair.verb === 'are' ? 'are' : 'is'} described as: ${pair.rest}?`, answer: pair.term };
    });
}

function solve(user) {
    const passages = parsePassages(user);
    const allTerms = new Set(terms(passages.map(passage => passage.text).join(' ')));
    const qs = user.split('\nQuestions:\n')[1] || '';
    const answers = [];
    for (const block of qs.split(/\n(?=\d+\. )/)) {
        const n = Number(block.match(/^(\d+)\./)?.[1]);
        const choices = [...block.matchAll(/^\s+([A-D])\. (.*)$/gm)].map(match => ({ letter: match[1], text: match[2] }));
        if (!n || !choices.length) continue;
        const scored = choices.map(choice => {
            const t = terms(choice.text);
            return { ...choice, score: t.length ? t.filter(term => allTerms.has(term)).length / t.length : 0 };
        }).sort((a, b) => b.score - a.score);
        answers.push({ n, choice: scored[0].letter, alsoCorrect: [] });
    }
    return { answers };
}

function createOracle(options = {}) {
    const log = [];
    const oracle = {
        model: 'oracle',
        reply: null,
        calls: 0,
        log,
        async text(system, user, { onDelta } = {}) {
            oracle.calls++;
            log.push({ kind: 'text', system, user });
            let out;
            if (typeof oracle.reply === 'function') out = oracle.reply(system, user);
            else if (typeof oracle.reply === 'string') out = oracle.reply;
            if (out == null) {
                if (/study notes/.test(system)) {
                    out = parsePassages(user).map(passage => `### ${passage.where.split(', ').at(-1)}\n- ${sentences(passage.text)[0]} [${passage.n}]`).join('\n\n');
                } else if (/short overview of a document/.test(system)) {
                    out = 'This document explains ' + (user.match(/### ([^\n]+)/)?.[1] || 'its topics') + ' and related ideas.';
                } else if (/These sentences cite a passage/.test(user)) {
                    const draft = user.split('\nDraft:\n')[1] || '';
                    out = draft.replace(/\s*\[\d+\]/g, '');
                } else {
                    out = answerText(system, user);
                }
            }
            if (onDelta) for (const piece of out.match(/.{1,40}/gs) || []) onDelta(piece);
            return out;
        },
        async json(system, user, schema) {
            oracle.calls++;
            log.push({ kind: 'json', system, user });
            if (options.json) {
                const custom = options.json(system, user, schema);
                if (custom !== undefined) return custom;
            }
            if (/^For each claim/.test(system)) {
                const verdicts = [];
                for (const match of user.matchAll(/(\d+)\. Claim: ([^\n]*)\n\s+Source: ([^\n]*)/g)) {
                    const claim = new Set(contentTerms(match[2]));
                    const source = new Set(terms(match[3]));
                    const hits = [...claim].filter(term => source.has(term)).length;
                    verdicts.push({ n: Number(match[1]), supported: claim.size ? hits / claim.size >= 0.6 && !(/non-?volatile/i.test(match[2]) && !/non-?volatile/i.test(match[3].split(/unlike/i)[1] || '')) : true });
                }
                return { verdicts };
            }
            if (/List search keywords/.test(system)) {
                const q = user.replace(/^Question: /, '').toLowerCase();
                return { keywords: Object.entries(THESAURUS).filter(([key]) => words(q).map(stem).includes(stem(key))).flatMap(([, value]) => value) };
            }
            if (/^Answer each question/.test(system)) return solve(user);
            if (/^Grade the student answer/.test(system)) {
                const key = new Set(contentTerms(user.match(/Answer key: ([^\n]*)/)?.[1] || ''));
                const student = contentTerms(user.match(/Student answer: ([^\n]*)/)?.[1] || '');
                return { correct: student.some(term => key.has(term)) };
            }
            if (schema?.properties?.items) return { items: quizItems(system, user, schema) };
            return null;
        }
    };
    return oracle;
}

// Bag-of-stems hashed into a fixed vector: a lexical stand-in for embeddings.
function hashEmbed(text, size = 256) {
    const vector = new Array(size).fill(0);
    for (const term of terms(String(text).replace(/^(?:search_document|search_query): /, ''))) {
        let hash = 2166136261;
        for (const char of term) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
        vector[Math.abs(hash) % size] += 1;
    }
    return vector;
}

module.exports = { createOracle, hashEmbed, parsePassages };
