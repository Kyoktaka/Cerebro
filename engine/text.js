const STOP = new Set(`a about above after again against all also am an and any are as at be because been before being
below between both but by can could did do does doing down during each either else ever every few for from further
had has have having he her here hers herself him himself his how however i if in into is it its itself just let lets
me might more most much must my myself no nor not now of off often on once only or other our ours ourselves out over
own per perhaps please rather same shall she should since so some such than that thats the their theirs them
themselves then there therefore these they this those though through thus to too under until up upon us very via was
we were what whats when where whereas whether which while who whom whose why will with within without would yet you
your yours yourself yourselves s t d ll re ve m o y`.split(/\s+/));

// Words that describe the request rather than its subject.
const META = new Set(`explain explanation describe description define definition definitions meaning mean means
summarize summarise summary summaries overview outline give show tell provide write make create generate
prepare help understand understanding know learn study review revise remember memorize example examples sample
quiz quizzes question questions flashcard flashcards card cards practice exercise exercises answer answers
pdf pdfs document documents doc docs file files uploaded selected focused material materials content contents
chapter section topic topics simple simply simpler simplest easy easier detail details detailed
brief briefly more further again please thanks thank okay ok real life world everyday practical
difference differences different compare comparison contrast versus vs similar similarity similarities between
important importance main major basic basics concept concepts idea ideas point points thing things stuff
step steps way ways kind kinds use used using mcq mcqs multiple choice choices identification enumeration
matching mixed fill blank blanks medium moderate hard difficult difficulty interactive words term terms
lesson lessons can could would should will may might need want like according based`.split(/\s+/));

function stem(word) {
    let w = String(word || '').toLowerCase();
    if (w.length <= 3 || /\d/.test(w)) return w;
    if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
    else if (w.endsWith('sses')) w = w.slice(0, -2);
    else if (/(?:x|ch|sh|z)es$/.test(w)) w = w.slice(0, -2);
    else if (w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);
    if (w.endsWith('ied') && w.length > 5) w = w.slice(0, -3) + 'y';
    else if (w.endsWith('ing') && w.length >= 7) w = w.slice(0, -3);
    else if (w.endsWith('ed') && w.length >= 6) w = w.slice(0, -2);
    if (w.endsWith('er') && w.length >= 7) w = w.slice(0, -2);
    if (w.endsWith('ly') && w.length >= 6) w = w.slice(0, -2);
    if (w.endsWith('e') && w.length >= 5) w = w.slice(0, -1);
    return w;
}

function words(text) {
    return String(text || '').toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) || [];
}

function terms(text) {
    return words(text).filter(w => !STOP.has(w) && w.length > 1).map(stem);
}

function contentTerms(text) {
    return [...new Set(words(text)
        .filter(w => !STOP.has(w) && !META.has(w) && (w.length > 1 || /\d/.test(w)))
        .map(stem))];
}

function compact(text) {
    return String(text || '').toLowerCase().normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

function sentences(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"“(])/u)
        .map(s => s.trim())
        .filter(Boolean);
}

// Line breaks inside extracted text separate headings, list items and table
// rows, so they are sentence boundaries too.
function textSentences(text) {
    return String(text || '').split(/\n+/).flatMap(sentences);
}

function jaccard(a, b) {
    const left = a instanceof Set ? a : new Set(a);
    const right = b instanceof Set ? b : new Set(b);
    if (!left.size && !right.size) return 1;
    let shared = 0;
    for (const item of left) if (right.has(item)) shared++;
    return shared / (left.size + right.size - shared);
}

function truncate(text, max) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (value.length <= max) return value;
    return value.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

module.exports = { STOP, META, stem, words, terms, contentTerms, compact, sentences, textSentences, jaccard, truncate };
