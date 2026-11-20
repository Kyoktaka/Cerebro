const { classify, resolveTopic } = require('./intent');
const answer = require('./answer');
const study = require('./study');
const { CONTEXT_CHARS } = require('./llm');

const NEEDS_TOPIC = new Set(['examples', 'steps', 'remember', 'compare', 'simplify', 'continue', 'explain', 'define']);

const CLARIFY = {
    examples: 'Examples of what?',
    steps: 'Which process should I walk through?',
    remember: 'What would you like help remembering?',
    compare: 'Which two things should I compare?',
    simplify: 'What should I explain more simply?',
    continue: 'What should I continue with?',
    explain: 'What would you like me to explain?',
    define: 'Which term should I define?'
};

function clarify(intent, index, names) {
    const topics = answer.subjectsOf(index, names, 4);
    return (CLARIFY[intent] || CLARIFY.explain) + (topics.length ? ' Your PDF covers ' + topics.map(title => `**${title}**`).join(', ') + '.' : '');
}

/**
 * Routes one student message. `context.activeTopic` carries the topic of
 * earlier turns so follow-ups ("give me examples", "what are their
 * advantages?") stay on subject until the student changes it.
 */
async function respond(ctx) {
    const { index, names, query, context = {} } = ctx;
    const parsed = classify(query, context);
    const sourceMode = parsed.sourceMode || (ctx.sourceMode === 'pdf-only' ? 'pdf-only' : null);
    let topic = resolveTopic(parsed, context.activeTopic);
    const shared = { ...ctx, parsed, sourceMode, topic, message: query };
    const keep = context.activeTopic || null;

    if (parsed.intent === 'greeting') {
        return { text: answer.greeting(index, names, names), mode: 'normal', topic: keep, meta: { intent: 'greeting' } };
    }
    if (parsed.intent === 'outline') {
        return { text: answer.outline(index, names), mode: 'answer', topic: keep, meta: { intent: 'outline', answerability: 'outline' } };
    }
    if (parsed.intent === 'quiz' || parsed.intent === 'flashcards') {
        const result = parsed.intent === 'quiz' && parsed.interactive
            ? await study.startPractice(shared, parsed)
            : await study.studySet(shared, parsed);
        return { ...result, topic: result.topic || keep, meta: { intent: parsed.intent, ...result.meta } };
    }
    if (topic.source === 'none' && NEEDS_TOPIC.has(parsed.intent)) {
        if ((parsed.intent === 'simplify' || parsed.intent === 'continue') && ctx.history.length) {
            topic = { label: '', source: 'history' };
        } else {
            return { text: clarify(parsed.intent, index, names), mode: 'clarify', topic: keep, meta: { intent: parsed.intent, answerability: 'ambiguous' } };
        }
    }
    let result;
    if (parsed.intent === 'summary') {
        result = topic.label ? await answer.topicSummary({ ...shared, topic }) : await answer.documentSummary(shared);
    } else if (parsed.intent === 'key-terms') {
        result = await answer.keyTerms({ ...shared, topic });
    } else if (parsed.intent === 'study-guide') {
        result = await answer.studyGuide({ ...shared, topic });
    } else if (parsed.intent === 'exam' && !topic.label) {
        const fixedPassages = answer.representative(index, names, Math.floor(CONTEXT_CHARS * 0.6));
        result = await answer.answerQuestion({ ...shared, topic, fixedPassages });
    } else {
        result = await answer.answerQuestion({ ...shared, topic });
    }
    // A question the PDF doesn't cover does not replace the topic being studied.
    const nextTopic = result.mode === 'unrelated' ? keep
        : result.topic || (topic.source === 'active' || topic.source === 'history' || topic.source === 'document' ? keep : null);
    return { ...result, topic: nextTopic, meta: { intent: parsed.intent, topicSource: topic.source, ...result.meta } };
}

module.exports = { respond, classify, resolveTopic };
