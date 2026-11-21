const { createHash } = require('node:crypto');
const { search, assess, matchTopics, sectionChunks } = require('./retrieve');
const { answerSystem, answerUser, revisionUser, passageBlock, NOTES_SYSTEM, OVERVIEW_SYSTEM } = require('./prompts');
const { verifyAnswer, problemsFor, isOutOfScope, stripForHistory, sourcesBlock } = require('./verify');
const { contentTerms, truncate, words, stem } = require('./text');
const { CONTEXT_CHARS } = require('./llm');

const QA_BUDGET = Math.min(7000, Math.floor(CONTEXT_CHARS * 0.6));
const QA_LIMIT = 6;

function documentsIn(index, names) {
    return (index.documents || []).filter(doc => names.includes(doc.name));
}

// Top-level titles first, taken in turn from each document, so a list of
// "what your PDFs cover" is not just the first document's opening sections.
function subjectsOf(index, names, max = 8) {
    const lists = documentsIn(index, names).map(doc => {
        const titled = doc.sections.filter(section => section.title && section.level <= 2);
        const top = Math.min(...titled.map(section => section.level));
        return [...titled.filter(section => section.level === top), ...titled.filter(section => section.level !== top)].map(section => section.title);
    });
    const titles = [];
    for (let i = 0; titles.length < max && lists.some(list => i < list.length); i++) {
        for (const list of lists) {
            if (i < list.length && !titles.includes(list[i]) && titles.length < max) titles.push(list[i]);
        }
    }
    return titles;
}

function subjectLine(index, names) {
    const topics = subjectsOf(index, names);
    return names.join(', ') + (topics.length ? ' (topics: ' + topics.join('; ') + ')' : '');
}

function historyFor(messages) {
    return messages.slice(-4).map(message => ({ role: message.role, content: truncate(stripForHistory(message.content), 500) }));
}

function extractionNote(index, names) {
    const notes = [];
    for (const doc of documentsIn(index, names)) {
        if (doc.imagePages?.length) {
            const pages = doc.imagePages.length > 6 ? doc.imagePages.slice(0, 6).join(', ') + '…' : doc.imagePages.join(', ');
            notes.push(`${doc.name}: page${doc.imagePages.length > 1 ? 's' : ''} ${pages} ${doc.imagePages.length > 1 ? 'are' : 'is a'} scanned image${doc.imagePages.length > 1 ? 's' : ''} with no text layer, so Cerebro could not read ${doc.imagePages.length > 1 ? 'them' : 'it'}.`);
        }
    }
    return notes.join(' ');
}

function topicState(topic, retrieval) {
    if (!topic?.label) return null;
    const best = retrieval?.topics?.find(item => item.kind === 'section' && item.score >= 0.6 && item.titleCoverage >= 0.66);
    return { label: best ? best.title : topic.label, sectionId: best?.sectionId || null, doc: best?.doc || null };
}

function suggestions(index, names) {
    const topics = subjectsOf(index, names, 4);
    return topics.length ? topics : [];
}

// ------------------------------------------------------------------ greetings

function greeting(index, names, docs) {
    if (!names.length) return 'Hi! Upload a PDF or select one in Sources, and I can explain it, summarize it, or quiz you on it.';
    const topics = suggestions(index, names);
    const list = topics.length ? '\n\nIt covers ' + topics.map(title => `**${title}**`).join(', ') + '.' : '';
    return `Hi! You're studying ${docs.join(', ')}.${list}\n\nAsk me to explain a topic, give examples, summarize a section, or quiz you.`;
}

function outline(index, names) {
    const parts = [];
    for (const doc of documentsIn(index, names)) {
        const lines = doc.sections.filter(section => section.title).map(section =>
            '  '.repeat(Math.max(0, Math.min(section.path.length - 1, 3))) + '- ' + section.title + (section.pageStart ? ` (p. ${section.pageStart}${section.pageEnd > section.pageStart ? '–' + section.pageEnd : ''})` : ''));
        parts.push(`**${doc.name}** · ${doc.pageCount || '?'} pages\n\n` + (lines.length ? lines.join('\n') : 'No headings were found in this PDF. Ask for a summary instead.'));
        const note = extractionNote({ documents: [doc] }, [doc.name]);
        if (note) parts.push('_' + note + '_');
    }
    return parts.join('\n\n');
}

function unrelated(index, names) {
    const topics = subjectsOf(index, names, 6);
    // Unreadable pages may hold the answer, so say so instead of implying the
    // document lacks it.
    const note = extractionNote(index, names);
    return `I couldn't find that in your selected PDF${names.length > 1 ? 's' : ''}.` +
        (topics.length ? ` ${names.length > 1 ? 'They cover' : 'It covers'} ${topics.join(', ')}`.replace(/[^.?!]$/, '$&.') : '') +
        (note ? `\n\n${note} The answer might be on ${/pages/.test(note) ? 'those pages' : 'that page'}.` : '') +
        `\n\nAsk about one of those topics, or add "use general knowledge" to your question if you want a general answer that isn't based on your PDF.`;
}

// ------------------------------------------------------------------ retrieval

async function retrieveFor({ index, names, question, topic, vectorFor, model, onStatus, definitional = false }) {
    const topicText = topic?.label && !question.toLowerCase().includes(topic.label.toLowerCase()) ? topic.label : '';
    const queryText = [topicText, question].filter(Boolean).join(' ');
    onStatus?.({ stage: 'searching', detail: 'Searching ' + names.join(', ') });
    const vector = await vectorFor(queryText);
    let result = search(index, { names, query: question, topicText, vector, limit: QA_LIMIT, budget: QA_BUDGET, definitional });
    let evidence = assess(result.passages, contentTerms(queryText), result.topics);
    let stage = 1;

    if (evidence.strength === 'weak' || evidence.strength === 'none') {
        const boost = matchTopics(index, names, queryText).filter(item => item.score >= 0.3).map(item => item.sectionId);
        const relaxed = search(index, { names, query: question, topicText, vector, limit: QA_LIMIT, budget: QA_BUDGET, relaxed: true, boostSections: boost });
        const relaxedEvidence = assess(relaxed.passages, contentTerms(queryText), relaxed.topics);
        if (relaxedEvidence.coverage > evidence.coverage) {
            result = relaxed;
            evidence = relaxedEvidence;
            stage = 2;
        }
    }
    const specificMissing = evidence.missing.some(term => term.length >= 4);
    if (evidence.strength !== 'strong' && specificMissing && model) {
        onStatus?.({ stage: 'searching', detail: 'Looking for related wording' });
        const expansion = await model.json(
            'List search keywords for finding the answer in a textbook: synonyms, the formal term, and closely related terms. Keywords only.',
            'Question: ' + queryText,
            { type: 'object', properties: { keywords: { type: 'array', items: { type: 'string' }, maxItems: 8 } }, required: ['keywords'] },
            { maxTokens: 120 }
        ).catch(() => null);
        const keywords = (expansion?.keywords || []).filter(word => typeof word === 'string' && word.length < 40).slice(0, 8);
        if (keywords.length) {
            const expanded = [queryText, ...keywords].join(' ');
            const retry = search(index, { names, query: expanded, vector: await vectorFor(expanded), limit: QA_LIMIT, budget: QA_BUDGET, relaxed: true });
            const retryEvidence = assess(retry.passages, contentTerms(expanded), retry.topics);
            const fresh = retry.passages.filter(passage => !result.passages.some(kept => kept.id === passage.id));
            if (retryEvidence.strength !== 'none' && (fresh.length || retryEvidence.coverage >= evidence.coverage)) {
                // Keep what the first search found and add the new passages,
                // so synonyms widen the evidence instead of replacing it.
                const merged = [];
                let size = 0;
                for (const passage of [...result.passages.filter(item => !item.neighbor), ...fresh, ...result.passages.filter(item => item.neighbor)]) {
                    if (merged.length >= QA_LIMIT + 2 || (merged.length && size + passage.text.length > QA_BUDGET)) continue;
                    merged.push(passage);
                    size += passage.text.length;
                }
                result = { ...result, passages: merged, topics: [...result.topics, ...retry.topics] };
                // Synonyms the model supplied count as matches here.
                evidence = assess(merged, contentTerms(expanded), result.topics);
                if (evidence.strength === 'strong') evidence.strength = 'partial';
                stage = 3;
            }
        }
    }
    return { ...result, evidence, stage };
}

// ------------------------------------------------------------------ generation

async function draftAndVerify({ model, system, user, passages, onDraft, onStatus, maxTokens = 900, allowRevision = true }) {
    onStatus?.({ stage: 'writing', detail: 'Writing from ' + passages.length + ' passage' + (passages.length === 1 ? '' : 's') });
    let draft = await model.text(system, user, { onDelta: onDraft, maxTokens });
    if (isOutOfScope(draft)) return { outOfScope: true };
    let check = problemsFor(draft, passages);
    let revised = false;
    if (allowRevision && check.report.unsupported.length + check.report.invalid > 0) {
        onStatus?.({ stage: 'revising', detail: 'Fixing statements your PDF does not support' });
        onDraft?.(null);
        const second = await model.text(system, user + '\n\n' + revisionUser({ draft, problems: check.problems }), { onDelta: onDraft, maxTokens });
        if (!isOutOfScope(second)) {
            const secondCheck = problemsFor(second, passages);
            if (secondCheck.report.unsupported.length + secondCheck.report.invalid <= check.report.unsupported.length + check.report.invalid) {
                draft = second;
                check = secondCheck;
                revised = true;
            }
        }
    }
    onStatus?.({ stage: 'checking', detail: 'Checking citations against your PDF' });
    const verified = await verifyAnswer(draft, passages, { model });
    return { ...verified, revised };
}

function classify(verified, evidence, mode) {
    const docs = new Set(verified.used.map(item => item.passage.pdfName));
    const pages = new Set(verified.used.map(item => item.passage.pdfName + item.page));
    if (!verified.used.length) return verified.beyond ? (evidence.strength === 'none' ? 'supplementary' : 'related-supplementary') : 'unsupported';
    if (docs.size > 1) return 'multi-document';
    if (verified.beyond) return 'partial';
    if (pages.size > 1) return 'multi-passage';
    return mode === 'pdf-only' ? 'pdf-only' : 'direct';
}

function finish(verified, { index, names, evidence }) {
    const notes = [];
    if (verified.report.removed) {
        notes.push(`Removed ${verified.report.removed} statement${verified.report.removed > 1 ? 's' : ''} that your PDF doesn't support.`);
    }
    if (evidence.strength !== 'strong') {
        const note = extractionNote(index, names);
        if (note) notes.push(note);
    }
    let body = verified.markdown.trim();
    if (!body) return null;
    if (notes.length) body += '\n\n' + notes.map(note => '_' + note + '_').join('\n\n');
    return body + verified.sources;
}

async function answerQuestion(ctx) {
    const { index, names, message, parsed, topic, model, history, sourceMode, onStatus, onDraft } = ctx;
    const retrieval = ctx.fixedPassages
        ? { passages: ctx.fixedPassages, evidence: { strength: 'strong', coverage: 1, missing: [] }, topics: [], stage: 0 }
        : await retrieveFor({ index, names, question: message, topic, vectorFor: ctx.vectorFor, model, onStatus, definitional: ['define', 'explain'].includes(parsed.intent) });
    const { evidence, passages } = retrieval;
    if (!passages.length && sourceMode !== 'general') {
        return { text: unrelated(index, names), mode: 'unrelated', topic: null, meta: { answerability: 'retrieval-empty', evidence, stage: retrieval.stage } };
    }
    const mode = sourceMode || (evidence.strength === 'strong' || evidence.strength === 'partial' ? 'covered' : 'uncertain');
    const intent = parsed.intent === 'continue' && !history.length ? 'explain' : parsed.intent;
    const system = answerSystem(intent, mode, subjectsOf(index, names).join(', '));
    const missing = missingWords(message, evidence.missing);
    const user = answerUser({ question: message, passages, history, subjects: subjectLine(index, names), topic: topic?.label, aspect: topic?.aspect, missing });
    const result = await draftAndVerify({ model, system, user, passages, onDraft, onStatus });
    const state = topicState(topic, retrieval);

    if (result.outOfScope) {
        return { text: unrelated(index, names), mode: 'unrelated', topic: state, meta: { answerability: 'unrelated', evidence, stage: retrieval.stage } };
    }
    const text = finish(result, { index, names, evidence });
    if (!text) {
        const note = extractionNote(index, names);
        return {
            text: (note ? note + '\n\n' : '') + "Your PDF doesn't say enough to answer that reliably. Try naming the topic or section you mean.",
            mode: note ? 'extraction-limit' : 'unsupported', topic: state,
            meta: { answerability: note ? 'extraction-failure' : 'unsupported', evidence, stage: retrieval.stage }
        };
    }
    return {
        text, mode: 'answer', topic: state,
        meta: { answerability: classify(result, evidence, mode), evidence, stage: retrieval.stage, report: result.report, revised: result.revised, passages: passages.map(p => p.id) }
    };
}

// Question words whose stems never appear in the passages. Telling a small
// model about them makes it far more likely to admit a gap.
function missingWords(question, stems) {
    if (!stems?.length) return [];
    return [...new Set(words(question).filter(word => stems.includes(stem(word))))];
}

// ------------------------------------------------------------------ summaries

function bestSection(index, names, label) {
    if (!label) return null;
    const match = matchTopics(index, names, label).find(item => item.kind === 'section' && item.score >= 0.5);
    return match || null;
}

async function topicSummary(ctx) {
    const { index, names, topic, model, onStatus, onDraft } = ctx;
    const section = bestSection(index, names, topic.label);
    let passages;
    let retrieval = null;
    if (section) {
        passages = sectionChunks(index, names, [section.sectionId]);
    } else {
        retrieval = await retrieveFor({ index, names, question: topic.label, topic: null, vectorFor: ctx.vectorFor, model, onStatus });
        if (retrieval.evidence.strength === 'none') {
            return { text: unrelated(index, names), mode: 'unrelated', topic: null, meta: { answerability: 'unrelated' } };
        }
        passages = retrieval.passages;
    }
    const budget = Math.floor(CONTEXT_CHARS * 0.75);
    if (passages.reduce((sum, passage) => sum + passage.text.length, 0) > budget) {
        return documentSummary({ ...ctx, chunks: passages, title: section?.title || topic.label });
    }
    const system = answerSystem('summary', ctx.sourceMode === 'pdf-only' ? 'pdf-only' : 'covered', subjectsOf(index, names).join(', '));
    const user = answerUser({ question: 'Summarize ' + (section?.title || topic.label), passages, history: [], subjects: subjectLine(index, names) });
    onStatus?.({ stage: 'summarizing', detail: 'Reading ' + (section ? '“' + section.title + '”' : 'related passages') });
    const result = await draftAndVerify({ model, system, user, passages, onDraft, onStatus, maxTokens: 1000 });
    const evidence = { strength: 'strong' };
    const text = result.outOfScope ? null : finish(result, { index, names, evidence });
    const state = { label: section?.title || topic.label, sectionId: section?.sectionId || null, doc: section?.doc || null };
    return text
        ? { text, mode: 'answer', topic: state, meta: { answerability: 'topic-summary', sections: section ? [section.sectionId] : [], report: result.report } }
        : { text: unrelated(index, names), mode: 'unrelated', topic: null, meta: { answerability: 'unrelated' } };
}

function batchChunks(chunks, budget) {
    const batches = [];
    let current = [];
    let size = 0;
    for (const chunk of chunks) {
        if (current.length && size + chunk.text.length > budget) {
            batches.push(current);
            current = [];
            size = 0;
        }
        current.push(chunk);
        size += chunk.text.length;
    }
    if (current.length) batches.push(current);
    return batches;
}

function cacheKey(chunks, modelName) {
    const doc = chunks[0].digest || chunks[0].pdfName;
    return doc + '|' + createHash('sha256').update(modelName + '|' + chunks.map(chunk => chunk.id + ':' + chunk.text.length).join(',')).digest('hex').slice(0, 16);
}

/**
 * Map-reduce summary: section notes per batch of chunks (verified and cached
 * in the index), then a short overview written from those notes only. Every
 * section is covered, in document order, in proportion to its length.
 */
async function documentSummary(ctx) {
    const { index, names, model, onStatus, onDraft } = ctx;
    const budget = Math.floor(CONTEXT_CHARS * 0.7);
    const docs = ctx.chunks ? [{ name: ctx.title, chunks: ctx.chunks }] :
        documentsIn(index, names).map(doc => ({ name: doc.name, chunks: index.chunks.filter(chunk => chunk.pdfName === doc.name) }));
    const total = docs.reduce((sum, doc) => sum + doc.chunks.reduce((n, chunk) => n + chunk.text.length, 0), 0);

    if (!ctx.chunks && total <= budget) {
        const passages = docs.flatMap(doc => doc.chunks);
        const system = answerSystem('summary', 'covered', subjectsOf(index, names).join(', '));
        const user = answerUser({ question: 'Summarize the whole document' + (names.length > 1 ? 's, one after another' : ''), passages, history: [], subjects: subjectLine(index, names) });
        onStatus?.({ stage: 'summarizing', detail: 'Reading all ' + passages.length + ' passages' });
        const result = await draftAndVerify({ model, system, user, passages, onDraft, onStatus, maxTokens: 1200 });
        const text = result.outOfScope ? null : finish(result, { index, names, evidence: { strength: 'strong' } });
        if (text) return { text, mode: 'answer', topic: null, meta: { answerability: 'document-summary', coverage: coverageOf(index, names, result.used), report: result.report } };
    }

    index.summaries = index.summaries || {};
    const sections = [];
    const used = [];
    let removed = 0;
    let step = 0;
    const batches = docs.map(doc => ({ doc, batches: batchChunks(doc.chunks, budget) }));
    const count = batches.reduce((sum, item) => sum + item.batches.length, 0);
    for (const { doc, batches: list } of batches) {
        const parts = [];
        for (const chunks of list) {
            step++;
            const key = cacheKey(chunks, model.model);
            let notes = index.summaries[key];
            if (!notes) {
                onStatus?.({ stage: 'summarizing', detail: `Taking notes, part ${step} of ${count}` });
                const titles = [...new Set(chunks.map(chunk => chunk.section || doc.name))];
                const raw = await model.text(NOTES_SYSTEM, `Sections to cover, in order:\n${titles.map(title => '- ' + title).join('\n')}\n\nPassages:\n${passageBlock(chunks)}`, { maxTokens: 900, temperature: 0.2 });
                const verified = await verifyAnswer(raw, chunks, { model });
                notes = { markdown: verified.main, used: verified.used.map(item => ({ chunkId: item.passage.id, page: item.page, claim: item.claim })), removed: verified.report.removed };
                index.summaries[key] = notes;
                ctx.onCache?.();
            }
            removed += notes.removed || 0;
            for (const item of notes.used) {
                const passage = index.chunks.find(chunk => chunk.id === item.chunkId);
                if (passage) used.push({ passage, page: item.page, claim: item.claim });
            }
            parts.push(notes.markdown);
        }
        sections.push({ name: doc.name, notes: parts.join('\n\n') });
    }
    onStatus?.({ stage: 'summarizing', detail: 'Writing the overview' });
    onDraft?.(null);
    const overview = await model.text(OVERVIEW_SYSTEM, sections.map(item => `${item.name}\n${stripForHistory(item.notes)}`).join('\n\n'), { onDelta: onDraft, maxTokens: 350, temperature: 0.2 });
    const body = ['## Overview', overview.replace(/\s*\[\d+\]/g, '').trim(), ...sections.flatMap(item => [
        sections.length > 1 || ctx.chunks ? `## ${item.name}` : '## By section', item.notes.replace(/^#{1,3} /gm, '### ')
    ])].join('\n\n');
    const note = removed ? `\n\n_Removed ${removed} statement${removed > 1 ? 's' : ''} that your PDF doesn't support._` : '';
    const extraction = extractionNote(index, names);
    return {
        text: body + note + (extraction ? '\n\n_' + extraction + '_' : '') + sourcesBlock(dedupeUsed(used)),
        mode: 'answer',
        topic: ctx.chunks ? { label: ctx.title } : null,
        meta: { answerability: ctx.chunks ? 'topic-summary' : 'document-summary', coverage: coverageOf(index, names, used), batches: count }
    };
}

function dedupeUsed(used) {
    const seen = new Map();
    for (const item of used) {
        const key = item.passage.pdfName + '#' + item.page;
        if (!seen.has(key)) seen.set(key, item);
    }
    return [...seen.values()];
}

function coverageOf(index, names, used) {
    const titled = documentsIn(index, names).flatMap(doc => doc.sections.filter(section => section.chars > 80));
    if (!titled.length) return null;
    const cited = new Set(used.flatMap(item => item.passage.sectionIds || [item.passage.sectionId]));
    return { sections: titled.length, cited: titled.filter(section => cited.has(section.id)).length };
}

// ------------------------------------------------------------------ key terms and study guide

async function keyTerms(ctx) {
    const { index, names, topic, model, onStatus, onDraft } = ctx;
    const section = topic?.label ? bestSection(index, names, topic.label) : null;
    const allowed = section ? new Set(sectionChunks(index, names, [section.sectionId]).map(chunk => chunk.id)) : null;
    const terms = documentsIn(index, names).flatMap(doc => doc.terms.map(term => ({ ...term, doc: doc.name })))
        .filter(term => term.chunkId && (!allowed || allowed.has(term.chunkId)))
        .sort((a, b) => (b.definition ? 1 : 0) - (a.definition ? 1 : 0) || b.score - a.score)
        .slice(0, Math.min(25, ctx.parsed.count || 12));
    const chunkIds = [...new Set(terms.map(term => term.chunkId))];
    let passages = index.chunks.filter(chunk => chunkIds.includes(chunk.id));
    while (passages.reduce((sum, passage) => sum + passage.text.length, 0) > CONTEXT_CHARS * 0.7 && passages.length > 1) passages = passages.slice(0, -1);
    if (!passages.length) return answerQuestion({ ...ctx, parsed: { ...ctx.parsed, intent: 'explain' } });
    const system = answerSystem('key-terms', 'pdf-only', '');
    const user = answerUser({ question: 'List and define these key terms: ' + terms.map(term => term.term).join(', '), passages, history: [], subjects: subjectLine(index, names) });
    onStatus?.({ stage: 'writing', detail: `Defining ${terms.length} terms` });
    const result = await draftAndVerify({ model, system, user, passages, onDraft, onStatus, maxTokens: 1100 });
    const text = result.outOfScope ? null : finish(result, { index, names, evidence: { strength: 'strong' } });
    return { text: text || outline(index, names), mode: 'answer', topic: section ? { label: section.title, sectionId: section.sectionId, doc: section.doc } : null, meta: { answerability: 'key-terms', report: result.report } };
}

async function studyGuide(ctx) {
    const { index, names, topic, model, onStatus, onDraft } = ctx;
    const section = topic?.label ? bestSection(index, names, topic.label) : null;
    let passages;
    if (section) passages = sectionChunks(index, names, [section.sectionId]);
    else if (topic?.label) passages = (await retrieveFor({ index, names, question: topic.label, topic: null, vectorFor: ctx.vectorFor, model, onStatus })).passages;
    else passages = representative(index, names, Math.floor(CONTEXT_CHARS * 0.7));
    passages = trimToBudget(passages, Math.floor(CONTEXT_CHARS * 0.7));
    const system = answerSystem('study-guide', 'covered', subjectsOf(index, names).join(', '));
    const user = answerUser({ question: 'Make a study guide' + (topic?.label ? ' for ' + (section?.title || topic.label) : ' for these documents'), passages, history: [], subjects: subjectLine(index, names) });
    onStatus?.({ stage: 'writing', detail: 'Organizing a study guide' });
    const result = await draftAndVerify({ model, system, user, passages, onDraft, onStatus, maxTokens: 1500 });
    const text = result.outOfScope ? null : finish(result, { index, names, evidence: { strength: 'strong' } });
    const plan = '\n\n## Review plan\n\n- Today: read the key ideas and answer the check-yourself questions without looking.\n- Tomorrow: try the questions again and reread only what you missed.\n- In 3 days and in a week: take a quiz on this topic to test recall.';
    if (!text) return { text: unrelated(index, names), mode: 'unrelated', topic: null, meta: { answerability: 'unrelated' } };
    const [body, sources = ''] = text.split(/(?=\n\n```cerebro-sources)/);
    return { text: body + plan + sources, mode: 'answer', topic: section ? { label: section.title, sectionId: section.sectionId, doc: section.doc } : topic?.label ? { label: topic.label } : null, meta: { answerability: 'study-guide', report: result.report } };
}

// One or two chunks from every section, so document-wide tools do not
// over-sample the first pages.
function representative(index, names, budget) {
    const picks = [];
    for (const doc of documentsIn(index, names)) {
        for (const section of doc.sections) {
            const chunk = index.chunks.find(item => item.id === section.chunkIds?.[0]);
            if (chunk && !picks.includes(chunk)) picks.push(chunk);
        }
    }
    const all = picks.length ? picks : index.chunks.filter(chunk => names.includes(chunk.pdfName));
    if (all.reduce((sum, chunk) => sum + chunk.text.length, 0) <= budget) return all;
    const step = all.reduce((sum, chunk) => sum + chunk.text.length, 0) / budget;
    return all.filter((_, i) => Math.floor(i % Math.ceil(step)) === 0);
}

function trimToBudget(passages, budget) {
    const out = [];
    let size = 0;
    for (const passage of passages) {
        if (out.length && size + passage.text.length > budget) break;
        out.push(passage);
        size += passage.text.length;
    }
    return out;
}

module.exports = {
    QA_BUDGET, greeting, outline, unrelated, retrieveFor, answerQuestion, topicSummary, documentSummary, keyTerms, studyGuide,
    historyFor, subjectsOf, subjectLine, extractionNote, representative, trimToBudget, documentsIn, bestSection, draftAndVerify
};
