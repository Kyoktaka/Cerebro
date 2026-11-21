const { terms, compact, sentences, textSentences, truncate, STOP } = require('./text');

const BEYOND_LINE = /^\s*(?:#{1,4}\s*)?(?:\*\*|__)?\s*beyond (?:your|the) (?:pdfs?|documents?|files?)\s*:?\s*(?:\*\*|__)?\s*:?\s*$/im;
const GENERIC = new Set(['example', 'exampl', 'mean', 'help', 'make', 'thing', 'way', 'part', 'also', 'like', 'simpl', 'basic', 'import', 'important', 'remember', 'key', 'idea', 'term', 'call', 'use', 'kind', 'type', 'one', 'two', 'way']);
const NEGATION = /\b(?:not|no|never|cannot|can't|isn't|aren't|doesn't|don't|won't|non)\b|\bnon-/i;
const CONTRAST = /\b(?:unlike|whereas|however|instead|rather than|in contrast|except|although|but)\b/i;

function normalizeCitations(text) {
    return String(text || '')
        .replace(/\[(?:passage|source|ref|reference|doc)s?\s*#?\s*(\d+(?:\s*(?:,|and|&)\s*\d+)*)\]/gi, '[$1]')
        .replace(/[【〔]\s*(\d+)\s*[】〕]/g, '[$1]')
        .replace(/\[(\d+(?:\s*(?:,|and|&)\s*\d+)+)\]/g, (_, list) => list.split(/\s*(?:,|and|&)\s*/).map(n => `[${n}]`).join(''))
        .replace(/\[(\d+)\s*[-–]\s*(\d+)\]/g, (_, a, b) => {
            const start = Number(a);
            const end = Number(b);
            return end > start && end - start < 6 ? Array.from({ length: end - start + 1 }, (_, i) => `[${start + i}]`).join('') : `[${a}][${b}]`;
        });
}

function splitAnswer(text) {
    const match = BEYOND_LINE.exec(text);
    if (!match) return { main: text.trim(), beyond: '' };
    return { main: text.slice(0, match.index).trim(), beyond: text.slice(match.index + match[0].length).trim() };
}

function claimTerms(text) {
    return [...new Set(terms(text.replace(/\[\d+\]/g, ' ').replace(/[*_`#>|]/g, ' ')))].filter(term => !GENERIC.has(term));
}

function specifics(text) {
    const clean = text.replace(/\[\d+\]/g, ' ').replace(/[*_`#>|]/g, ' ');
    const numbers = clean.match(/\b\d[\d,.:/%-]*\d\b|\b\d+%?/g) || [];
    const names = [];
    for (const sentence of sentences(clean)) {
        const tokens = sentence.match(/[\p{L}][\p{L}'’.-]*/gu) || [];
        tokens.slice(1).forEach(token => {
            if (/^\p{Lu}[\p{Ll}]/u.test(token) && !STOP.has(token.toLowerCase()) && token.length > 2) names.push(token);
        });
    }
    return { numbers: [...new Set(numbers)], names: [...new Set(names)] };
}

function bestSentence(claim, passageText) {
    const wanted = new Set(claimTerms(claim));
    let best = { text: '', overlap: 0 };
    for (const sentence of textSentences(passageText)) {
        const present = terms(sentence);
        const hits = present.filter(term => wanted.has(term)).length;
        const overlap = wanted.size ? hits / wanted.size : 0;
        if (overlap > best.overlap) best = { text: sentence, overlap };
    }
    return best;
}

/**
 * Lexical support of one claim by one passage, in [0, 1]. Numbers and proper
 * names must appear in the passage; a negation the passage lacks halves the
 * score. This is a filter for unsupported citations, not proof of truth.
 */
function support(claim, passage) {
    const wanted = claimTerms(claim);
    if (!wanted.length) return { score: 1, specificOk: true };
    const present = new Set(terms(passage.text + ' ' + (passage.sectionPath || []).join(' ')));
    let score = wanted.filter(term => present.has(term)).length / wanted.length;
    const haystack = compact(passage.text);
    const { numbers, names } = specifics(claim);
    const specificOk = numbers.every(number => haystack.includes(compact(number))) &&
        names.every(name => haystack.includes(compact(name)) || present.has(terms(name)[0]));
    const sentence = bestSentence(claim, passage.text);
    if (NEGATION.test(claim.replace(/\[\d+\]/g, '')) !== NEGATION.test(sentence.text)) score *= 0.5;
    return { score, specificOk, sentence: sentence.text };
}

function pageFor(claim, passage) {
    if (!passage.spans?.length) return passage.page;
    const wanted = new Set(claimTerms(claim));
    let best = { page: passage.page, hits: -1 };
    for (const span of passage.spans) {
        const text = passage.text.slice(span.start, span.end);
        const hits = terms(text).filter(term => wanted.has(term)).length;
        if (hits > best.hits) best = { page: span.page, hits };
    }
    return best.page ?? passage.page;
}

// Units are list items, table rows, and sentences: the smallest pieces a
// citation can attach to.
function units(markdown) {
    const out = [];
    const lines = markdown.split('\n');
    lines.forEach((line, lineIndex) => {
        if (!line.trim() || /^\s*\|?\s*:?-{3,}/.test(line) || /^\s*#{1,6}\s/.test(line)) {
            out.push({ line: lineIndex, text: line, structural: true });
            return;
        }
        if (/^\s*\|/.test(line) || /^\s*(?:[-*+]|\d+[.)])\s/.test(line)) {
            out.push({ line: lineIndex, text: line });
            return;
        }
        const parts = line.split(/(?<=[.!?](?:\s*\[\d+\])*)\s+(?=[\p{Lu}*"“(\d])/u);
        parts.forEach(part => out.push({ line: lineIndex, text: part, inline: parts.length > 1 }));
    });
    return out;
}

function citationsIn(text) {
    return [...text.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]));
}

function analyze(markdown, passages) {
    const report = { cited: 0, supported: 0, repointed: 0, invalid: 0, unsupported: [], borderline: [] };
    const items = units(markdown).map(unit => {
        if (unit.structural) return unit;
        const ids = citationsIn(unit.text);
        if (!ids.length) return { ...unit, ids: [] };
        report.cited++;
        const valid = [...new Set(ids)].filter(id => id >= 1 && id <= passages.length);
        report.invalid += ids.length - ids.filter(id => id >= 1 && id <= passages.length).length;
        const scored = valid.map(id => ({ id, ...support(unit.text, passages[id - 1]) }));
        const good = scored.filter(item => item.specificOk && item.score >= 0.5).sort((a, b) => b.score - a.score);
        // Contrast sentences ("Unlike RAM, storage is non-volatile") share words
        // with the opposite claim, so lexical overlap alone cannot clear them.
        if (good.length && !CONTRAST.test(good[0].sentence || '')) {
            report.supported++;
            return { ...unit, ids: good.map(item => item.id), status: 'supported' };
        }
        const alternatives = good.length ? [] : passages.map((passage, i) => ({ id: i + 1, ...support(unit.text, passage) }))
            .filter(item => item.specificOk && item.score >= 0.6)
            .sort((a, b) => b.score - a.score);
        const candidate = good[0] || alternatives[0];
        if (candidate) {
            if (!good.length) report.repointed++;
            const entry = { ...unit, ids: [candidate.id], status: 'borderline', evidence: candidate.sentence || passages[candidate.id - 1].text.slice(0, 400) };
            report.borderline.push(entry);
            return entry;
        }
        const top = scored.sort((a, b) => b.score - a.score)[0];
        if (top && top.specificOk && top.score >= 0.34) {
            const entry = { ...unit, ids: [top.id], status: 'borderline', evidence: top.sentence || passages[top.id - 1].text.slice(0, 400) };
            report.borderline.push(entry);
            return entry;
        }
        const entry = { ...unit, ids: [], status: 'unsupported', specific: !top?.specificOk };
        report.unsupported.push(entry);
        return entry;
    });
    return { items, report };
}

const JUDGE_SCHEMA = {
    type: 'object',
    properties: { verdicts: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, supported: { type: 'boolean' } }, required: ['n', 'supported'] } } },
    required: ['verdicts']
};

// Asks the model one narrow yes/no question per uncertain claim.
async function judge(model, borderline) {
    if (!model || !borderline.length) return new Map();
    const list = borderline.slice(0, 6);
    const prompt = list.map((item, i) => `${i + 1}. Claim: ${item.text.replace(/\[\d+\]/g, '').trim()}\n   Source: ${truncate(item.evidence, 500)}`).join('\n');
    const result = await model.json(
        'For each claim, decide whether the source sentence states it. Say supported=true only when the source says the same thing. Different meaning, added details, or a missing fact means false.',
        prompt, JUDGE_SCHEMA, { maxTokens: 300 }
    ).catch(() => null);
    const verdicts = new Map();
    for (const verdict of result?.verdicts || []) {
        if (Number.isInteger(verdict.n) && list[verdict.n - 1]) verdicts.set(list[verdict.n - 1], verdict.supported === true);
    }
    return verdicts;
}

function anchor(passage, page) {
    const label = passage.pdfName + (page ? ', p. ' + page : '');
    return passage.digest && page ? `[${label}](cerebro:${passage.digest}:${page})` : `(${label})`;
}

/**
 * Turns a checked draft into the final markdown: valid citations become page
 * links, citations that the passages do not support are removed, and claims
 * with unsupported specific facts (numbers, names) are dropped.
 */
function render(items, passages) {
    const used = new Map();
    let removed = 0;
    const lines = new Map();
    for (const item of items) {
        let text = item.text;
        if (!item.structural) {
            const clean = text.replace(/\s*\[\d+\]/g, '');
            if ((item.status === 'unsupported' && item.specific) || item.status === 'rejected') {
                removed++;
                text = '';
            } else if (item.status === 'supported' || item.status === 'borderline-kept') {
                const links = [];
                for (const id of item.ids) {
                    const passage = passages[id - 1];
                    const page = pageFor(clean, passage);
                    const key = passage.pdfName + '#' + page;
                    if (!used.has(key)) used.set(key, { passage, page, claim: clean });
                    const link = anchor(passage, page);
                    if (!links.includes(link)) links.push(link);
                }
                text = links.length ? appendLinks(clean, links) : clean;
            } else {
                text = clean;
            }
        }
        const list = lines.get(item.line) || [];
        list.push(text);
        lines.set(item.line, list);
    }
    const out = [...lines.keys()].sort((a, b) => a - b).map(key => lines.get(key).filter((part, i, all) => part || all.length === 1).join(' '));
    return { markdown: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), used: [...used.values()], removed };
}

function appendLinks(text, links) {
    const trailing = text.match(/([.!?:;]["”')]?)(\s*)$/);
    if (trailing && !/^\s*\|/.test(text)) return text.slice(0, trailing.index) + ' ' + links.join(' ') + trailing[1];
    if (/\|\s*$/.test(text)) return text.replace(/\s*\|\s*$/, ' ' + links.join(' ') + ' |');
    return text + ' ' + links.join(' ');
}

function sourcesBlock(used) {
    if (!used.length) return '';
    const sources = used.map(({ passage, page, claim }) => ({
        doc: passage.pdfName,
        page: page || null,
        section: passage.section || null,
        digest: passage.digest || null,
        excerpt: truncate(bestSentence(claim, passage.text).text || passage.text, 220)
    }));
    return '\n\n```cerebro-sources\n' + JSON.stringify(sources) + '\n```';
}

/**
 * Full check of a model answer. Returns the final markdown and a report of
 * what verification changed, so callers can decide on a revision pass.
 */
async function verifyAnswer(raw, passages, { model } = {}) {
    const text = normalizeCitations(raw).trim();
    const { main, beyond } = splitAnswer(text);
    const { items, report } = analyze(main, passages);
    if (report.borderline.length) {
        const verdicts = await judge(model, report.borderline);
        for (const item of items) {
            if (item.status !== 'borderline') continue;
            if (verdicts.get(item) === true) {
                item.status = 'borderline-kept';
                report.supported++;
            } else {
                item.status = verdicts.has(item) ? 'rejected' : 'unsupported';
                report.unsupported.push(item);
            }
        }
    }
    const rendered = render(items, passages);
    const extra = beyond.replace(/\s*\[\d+\]/g, '').trim();
    const markdown = rendered.markdown + (extra ? '\n\n**Beyond your PDF**\n\n' + extra : '');
    return {
        markdown,
        main: rendered.markdown,
        beyond: extra,
        used: rendered.used,
        sources: sourcesBlock(rendered.used),
        report: { ...report, removed: rendered.removed, unsupportedCount: report.unsupported.length }
    };
}

function problemsFor(raw, passages) {
    const { main } = splitAnswer(normalizeCitations(raw));
    const { report } = analyze(main, passages);
    return {
        report,
        problems: [...report.unsupported, ...report.borderline].map(item => item.text.trim()).slice(0, 6),
        uncited: report.cited === 0
    };
}

function isOutOfScope(text) {
    return /^\W*OUT_OF_SCOPE\b/.test(String(text || '').trim());
}

function stripForHistory(text) {
    return String(text || '')
        .replace(/```cerebro-[\w-]+\n[\s\S]*?```/g, '')
        .replace(/\[([^\]\n]+?, p\. \d+)\]\(cerebro:[a-f0-9]{64}:\d+\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

module.exports = {
    BEYOND_LINE, normalizeCitations, splitAnswer, support, specifics, units, analyze, judge, render,
    verifyAnswer, problemsFor, sourcesBlock, isOutOfScope, stripForHistory, anchor, pageFor, bestSentence, claimTerms
};
