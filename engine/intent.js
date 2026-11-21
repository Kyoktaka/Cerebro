const { STOP, META, words } = require('./text');

const has = (pattern, text) => pattern.test(text);

const P = {
    greeting: /^\s*(?:hi+|hello|hey|yo|hiya|good (?:morning|afternoon|evening|day)|thanks?(?: you)?|thank u|ty|ok(?:ay)?|cool|nice|great|got it|alright)\b[\s!.?,]*(?:cerebro)?[\s!.?]*$/i,
    help: /^\s*(?:help|what can you do|who are you|how (?:do|can) i use (?:this|cerebro)|what are you)\s*[?.!]*\s*$/i,
    outline: /\b(?:outline|table of contents|list (?:the |all )?(?:topics|chapters|sections|headings|lessons)|what (?:topics|chapters|sections|lessons) (?:are|does|do|is)|(?:topics|chapters|sections) (?:covered|included|in (?:the|this|my) (?:pdf|document))|what does (?:it|this|the (?:pdf|document|file)) cover)\b/i,
    about: /\bwhat(?:'s| is| are)? (?:this|that|the|these|my) (?:pdf|document|file|reading|material|handout|module)s? about\b|\bwhat(?:'s| is) (?:it|this) about\b/i,
    quiz: /\b(?:quiz(?:zes)?|test me|test my knowledge|practice questions|mcqs?|multiple[ -]choices?|true[ -](?:or|\/|and)[ -]false|identification|fill[ -]in[ -](?:the[ -])?blanks?|enumeration|matching(?: type)?|reviewer|exam questions|mock exam|drill me)\b/i,
    interactive: /\b(?:quiz me|test me|test my knowledge|interactive(?:ly)?|one (?:question )?at a time|let['’]?s review|drill me)\b/i,
    flashcards: /\bflash ?cards?\b|\b(?:make|create|generate|give)\b.*\bcards\b/i,
    studyGuide: /\b(?:study guide|reviewer notes|revision notes|review notes|study notes|study plan|review sheet|cheat ?sheet)\b/i,
    keyTerms: /\b(?:key (?:terms|words|vocabulary)|glossary|vocabulary|important (?:terms|words)|terminolog(?:y|ies)|list (?:of )?(?:the )?(?:terms|definitions))\b/i,
    summary: /\b(?:summar(?:y|ize|ise|ies|ized)|overview|recap|tl;?dr|gist|main (?:ideas|points|concepts|topics)|key (?:ideas|points|takeaways|concepts))\b/i,
    exam: /\b(?:what should i (?:remember|know|focus on|study|review)|exam tips|likely (?:exam )?questions|important questions|for (?:the|my|an?) (?:exam|test|quiz)|before (?:the|my) exam)\b/i,
    remember: /\b(?:mnemonics?|help me (?:remember|memori[sz]e|recall)|how (?:can|do|should) i (?:remember|memori[sz]e)|memory (?:trick|aid|hook)|easy (?:way|trick) to remember)\b/i,
    compare: /\b(?:differen(?:ce|ces|t) (?:between|from)|compare|comparison|contrast|vs\.?|versus|similarit(?:y|ies)|how (?:is|are|does|do) .{2,60} differ|distinguish)\b/i,
    steps: /\b(?:step[- ]by[- ]step|steps (?:of|in|for|to)|procedure|process of|how (?:does|do|did) .{2,60} work|what happens (?:when|if|during)|walk me through|sequence of|how is .{2,60} (?:made|done|performed|formed))\b/i,
    examples: /\b(?:examples?|real[- ]?(?:life|world)|for instance|use[- ]cases?|applications? of|practical (?:use|application)|scenarios?|illustrate|sample)\b/i,
    simplify: /\b(?:simpler|simplify|simple (?:terms|words|language|way)|plain (?:english|language|words)|eli5|explain (?:it )?like i['’]?m|dumb (?:it )?down|easier to understand|make it (?:simple|easy|easier)|layman)\b/i,
    continueOn: /^\s*(?:continue|go on|keep going|more|tell me more|say more|explain (?:it )?(?:further|more)|elaborate(?: more)?|expand(?: on (?:it|that|this))?|go deeper|more details?|and then|what else|anything else|next)\b/i,
    define: /^\s*(?:what(?:['’]s| is| are| was| were)\b|define\b|definition of\b|meaning of\b|what does .{1,60} (?:mean|stand for))/i,
    general: /\b(?:general knowledge|outside (?:the|my|of the) (?:pdf|document|file)s?|not (?:just |only )?(?:from|in) the (?:pdf|document|file)|in general|beyond the (?:pdf|document)|without the (?:pdf|document))\b/i,
    pdfOnly: /\b(?:only (?:from|use|using|based on|according to) (?:the|my|this) (?:pdf|document|file|material)s?|(?:pdf|document)[- ]only|strictly (?:from|based on)|based only on|(?:just|only) (?:the|my) (?:pdf|document)|don['’]?t use (?:outside|general))\b/i,
    anaphora: /\b(?:it|its|they|them|their|theirs|this|that|these|those|the (?:above|previous|last|same|first|second|third) (?:one|ones|example|concept|point|item|answer|topic|part)?)\b/i,
    factual: /^\s*(?:what (?:is|are|does)|why|who|when|where|how (?:does|did|is|are)|explain|define|compare)\b/i,
    create: /\b(?:create|generate|make|build|prepare|give me|write|quiz me|test me|i want|can i have)\b/i
};

const KINDS = [
    ['true-false', /\btrue[ -](?:or|\/|and)[ -]false\b/i],
    ['fill', /\bfill[ -]in[ -](?:the[ -])?blanks?\b/i],
    ['short-answer', /\b(?:identification|short[ -]answer|definition questions|open[ -]ended)\b/i],
    ['enumeration', /\benumeration\b/i],
    ['matching', /\bmatching\b/i],
    ['mixed', /\bmixed\b/i],
    ['multiple-choice', /\b(?:multiple[ -]choices?|mcqs?)\b/i]
];

// Phrases that describe the request. Removed before reading the topic.
const REQUEST_PHRASES = [
    /\b(?:can|could|would|will) you\b/gi, /\bplease\b/gi, /\bi (?:want|need|would like)(?: you)?(?: to)?\b/gi,
    /\b(?:give|show|tell|send) me\b/gi, /\blet['’]?s\b/gi, /\bhelp me\b/gi,
    /\b(?:quiz|test|drill) me\b/gi, /\bone\b.{0,40}?\bat a time\b/gi, /\b(?:with )?(?:four|4|two|2|three|3|five|5) (?:options|choices)\b/gi,
    /\binteractive(?:ly)?\b/gi, /\bwith (?:clear |separate )?(?:front|back)(?: and (?:front|back))? sides?\b/gi,
    /\bstudy (?:guide|notes|plan)\b/gi, /\b(?:reviewer|revision|review) (?:notes|sheet)\b/gi, /\bcheat ?sheet\b/gi,
    /\bkey (?:terms|words|vocabulary)\b/gi, /\bglossary\b/gi, /\bvocabulary\b/gi, /^\s*list\b/gi,
    /\b(?:continue|go on|keep going|tell me more|say more|go deeper|what else|anything else)\b/gi,
    /\b(?:in|using) (?:simple|plain|easy) (?:terms|words|language|english)\b/gi, /\blike i['’]?m (?:five|5|a kid|a beginner)\b/gi,
    /\b(?:the |this |these |my |our |all |focused |selected |uploaded )*(?:pdf|pdfs|document|documents|file|files|material|materials|handout|module|reading)s?\b/gi,
    /\b(?:from|in|on|about|of|for|regarding|covering|based on)\s*$/gi,
    /\b(?:real[- ]?(?:life|world)|step[- ]by[- ]step|true[ -](?:or|\/|and)[ -]false|fill[ -]in[ -](?:the[ -])?blanks?|multiple[ -]choices?|short[ -]answer)\b/gi,
    /\b(?:general knowledge|outside (?:the|my|of the) (?:pdf|document|file)s?|in general)\b/gi,
    /\b(?:what should i (?:remember|know|focus on|study|review)|for (?:the|my|an?) (?:exam|test))\b/gi,
    /\b(?:help me (?:remember|memori[sz]e|recall)|how (?:can|do|should) i (?:remember|memori[sz]e))\b/gi,
    /\b(?:what happens (?:when|if|during)|how (?:does|do|did)|walk me through|differen(?:ce|ces) between|how (?:is|are))\b/gi,
    /\b(?:what(?:['’]s| is| are| was| were)|define|definition of|meaning of|what does|stand for|mean)\b/gi
];

const ANAPHORA_WORDS = new Set(['it', 'its', 'they', 'them', 'their', 'theirs', 'this', 'that', 'these', 'those', 'above', 'previous', 'last', 'same', 'one', 'ones']);
const DOCUMENT_WORDS = new Set(['everything', 'whole', 'entire', 'all', 'overall', 'full', 'complete', 'each', 'every']);
const FILLER = new Set(['easy', 'hard', 'difficult', 'medium', 'moderate', 'short', 'long', 'quick', 'mini', 'few', 'some', 'sure',
    'okay', 'scenario', 'scenarios', 'instance', 'instances', 'illustration', 'clear', 'front', 'back', 'sides', 'options',
    'format', 'style', 'hint', 'hints', 'guide', 'notes', 'sheet', 'set', 'deck', 'list', 'continue', 'now', 'next']);

function topicPhrase(message) {
    const quoted = message.match(/["“]([^"”]{2,90})["”]/);
    if (quoted) return { text: quoted[1].trim(), quoted: true, documentWide: false };
    let text = ' ' + message + ' ';
    for (const pattern of REQUEST_PHRASES) text = text.replace(pattern, ' ');
    // Same tokens as words(), but the student's casing is kept so labels read "RAM", not "ram".
    const tokens = text.normalize('NFKC').match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) || [];
    const lower = tokens.map(word => word.toLowerCase());
    const documentWide = lower.some(word => DOCUMENT_WORDS.has(word));
    const kept = tokens.filter((word, i) => {
        const low = lower[i];
        return !STOP.has(low) && !META.has(low) && !ANAPHORA_WORDS.has(low) && !DOCUMENT_WORDS.has(low) && !/^\d+$/.test(low) && !FILLER.has(low);
    });
    // A capital on the message's first word is just the start of a sentence.
    const first = message.trim().normalize('NFKC').match(/^[\p{L}\p{N}]+/u)?.[0];
    const cased = kept.map(word => word === first && /^\p{Lu}\p{Ll}+$/u.test(word) ? word.toLowerCase() : word);
    return { text: cased.join(' '), quoted: false, documentWide };
}

function countFrom(message, fallback) {
    const match = message.match(/\b(\d{1,3})\s*(?:-?\s*items?\b|(?:[a-z-]+\s+){0,4}(?:questions?|qs|mcqs?|flash ?cards?|cards|terms|items|quiz(?:zes)?)\b)/i) ||
        message.match(/\b(?:quiz|flash ?cards?|questions?)\s+(?:with|of)\s+(\d{1,3})\b/i);
    if (match) return Number(match[1]);
    if (/\b(?:short|quick|mini|small|brief)\b/i.test(message)) return Math.min(5, fallback);
    if (/\b(?:long|big|full|comprehensive)\b/i.test(message)) return Math.max(15, fallback);
    return fallback;
}

function difficultyFrom(message) {
    if (/\b(?:easy|basic|beginner|simple)\b/i.test(message)) return 'easy';
    if (/\b(?:medium|moderate|intermediate|average)\b/i.test(message)) return 'moderate';
    if (/\b(?:hard|difficult|challenging|advanced|tough|tricky)\b/i.test(message)) return 'difficult';
    return 'mixed';
}

/**
 * Reads what the student wants and which topic it concerns. Rules are
 * deliberately transparent; the active topic from earlier turns fills in
 * pronouns and elliptical requests such as "give me examples".
 */
function classify(message, context = {}) {
    const text = String(message || '').trim();
    const topic = topicPhrase(text);
    const sourceMode = has(P.pdfOnly, text) ? 'pdf-only' : has(P.general, text) ? 'general' : null;
    const anaphoric = has(P.anaphora, text) && topic.text.split(' ').filter(Boolean).length <= 1;
    const result = {
        intent: 'explain', topicText: topic.text, quoted: topic.quoted, anaphoric, sourceMode,
        documentWide: topic.documentWide, count: null, difficulty: 'mixed', kind: null, interactive: false
    };

    if (has(P.greeting, text) || has(P.help, text)) return { ...result, intent: 'greeting', topicText: '' };
    if (has(P.outline, text) && !has(P.quiz, text)) return { ...result, intent: 'outline' };

    const asksFactually = has(P.factual, text) && !has(P.create, text);
    if (has(P.flashcards, text) && !asksFactually) {
        return { ...result, intent: 'flashcards', count: Math.min(30, countFrom(text, 10)), difficulty: difficultyFrom(text) };
    }
    if (has(P.quiz, text) && !asksFactually) {
        const kind = KINDS.find(([, pattern]) => pattern.test(text))?.[0] || 'multiple-choice';
        return { ...result, intent: 'quiz', kind, count: Math.min(30, countFrom(text, 10)), difficulty: difficultyFrom(text), interactive: has(P.interactive, text) };
    }
    if (has(P.studyGuide, text)) return { ...result, intent: 'study-guide' };
    if (has(P.keyTerms, text)) return { ...result, intent: 'key-terms', count: countFrom(text, 12) };
    if (has(P.about, text)) return { ...result, intent: 'summary', topicText: '', documentWide: true };
    if (has(P.summary, text) && !has(P.compare, text)) return { ...result, intent: 'summary' };
    if (has(P.exam, text)) return { ...result, intent: 'exam' };
    if (has(P.remember, text)) return { ...result, intent: 'remember' };
    if (has(P.compare, text)) return { ...result, intent: 'compare' };
    if (has(P.steps, text)) return { ...result, intent: 'steps' };
    if (has(P.examples, text)) return { ...result, intent: 'examples' };
    if (has(P.simplify, text)) return { ...result, intent: 'simplify' };
    if (has(P.continueOn, text)) return { ...result, intent: 'continue' };
    if (has(P.define, text) && text.split(/\s+/).length <= 8) return { ...result, intent: 'define' };
    return result;
}

const NEEDS_TOPIC = new Set(['examples', 'steps', 'remember', 'compare', 'simplify', 'continue', 'define', 'explain', 'exam']);
const DOCUMENT_LEVEL = new Set(['summary', 'quiz', 'flashcards', 'study-guide', 'key-terms', 'outline', 'exam']);

/**
 * Decides the topic for this turn. Returns the label used for retrieval and
 * whether this turn starts a new topic or continues the active one.
 */
function resolveTopic(parsed, activeTopic) {
    const own = parsed.topicText;
    const elliptical = !own || parsed.anaphoric;
    if (!elliptical) return { label: own, source: 'message', switched: !activeTopic || activeTopic.label.toLowerCase() !== own.toLowerCase() };
    if (activeTopic?.label && (NEEDS_TOPIC.has(parsed.intent) || (DOCUMENT_LEVEL.has(parsed.intent) && parsed.anaphoric && !parsed.documentWide))) {
        return { label: activeTopic.label, aspect: own, source: 'active', switched: false };
    }
    if (DOCUMENT_LEVEL.has(parsed.intent)) return { label: '', source: 'document', switched: false };
    if (own) return { label: own, source: 'message', switched: true };
    return { label: '', source: 'none', switched: false };
}

module.exports = { classify, resolveTopic, topicPhrase, countFrom, difficultyFrom, NEEDS_TOPIC, DOCUMENT_LEVEL };
