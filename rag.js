const CHUNK_SIZE = 1400;
const CHUNK_OVERLAP = 180;
const MAX_CONTEXT_CHARS = 6000;
const { isDocumentOverview } = require('./overview');

function chunkText(text) {
    const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
    const chunks = [];
    let start = 0;

    while (start < normalized.length) {
        let end = Math.min(start + CHUNK_SIZE, normalized.length);
        if (end < normalized.length) {
            const paragraph = normalized.lastIndexOf('\n', end);
            const word = normalized.lastIndexOf(' ', end);
            const boundary = paragraph > start + CHUNK_SIZE * 0.6 ? paragraph : word;
            if (boundary > start + CHUNK_SIZE * 0.6) end = boundary;
        }
        const chunk = normalized.slice(start, end).trim();
        if (chunk) chunks.push(chunk);
        if (end === normalized.length) break;
        start = Math.max(start + 1, end - CHUNK_OVERLAP);
    }
    return chunks;
}

function cosineSimilarity(a, b) {
    if (a.length !== b.length) return -1;
    let dot = 0;
    let aSize = 0;
    let bSize = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        aSize += a[i] * a[i];
        bSize += b[i] * b[i];
    }
    return aSize && bSize ? dot / Math.sqrt(aSize * bSize) : -1;
}

function retrieveChunks(index, activeNames, queryVector) {
    const active = new Set(activeNames);
    const ranked = index.chunks
        .filter(chunk => active.has(chunk.pdfName))
        .map(chunk => ({ ...chunk, score: cosineSimilarity(chunk.embedding, queryVector) }))
        .sort((a, b) => b.score - a.score);
    const selected = [];
    let used = 0;
    for (const chunk of ranked) {
        if (selected.length === 4 || used + chunk.text.length > MAX_CONTEXT_CHARS) break;
        selected.push(chunk);
        used += chunk.text.length;
    }
    return selected;
}

function normalizeTerm(word) {
    if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
    if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
}

function questionHasEvidence(question, chunks) {
    if (isDocumentOverview(question)) return chunks.some(chunk => typeof chunk.text === 'string' && chunk.text.trim().length > 0);
    question = question.replace(/\b(?:give|provide|write)\s+(?:me\s+)?(?:a\s+)?/gi, '').replace(/\b(?:his|her|their)\b/gi, '');
    if (/\bstacks?\b/i.test(question)) {
        question = question.replace(/\b(?:tech(?:nology)?\s+)?stacks?\b/gi, '');
        chunks = chunks.filter(chunk => /\b(?:technologies|technical skills|frameworks|programming|stack|backend|frontend)\b/i.test(chunk.text));
        if (!chunks.length) return false;
        if (!question.replace(/\b(?:what|whats|s|is|are)\b|[^\w]/gi, '').trim()) return true;
    }
    if (/^\s*who\s+is\s+(?:he|she|the person)\s*[?.!]*\s*$/i.test(question)) return true;
    const equation = question.match(/\b\d+(?:\.\d+)?\s*[+\-*/^=−]\s*\d+(?:\.\d+)?\b/u);
    const compact = value => value.replace(/\s+/g, '').replace(/−/g, '-');
    if (equation && !chunks.some(chunk => compact(chunk.text).includes(compact(equation[0])))) return false;
    const words = (equation ? question.replace(equation[0], ' ') : question).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const stop = new Set(['what', 'whats', 'that', 'this', 'about', 'tell', 'please', 'could', 'would', 'should', 'does', 'have', 'from', 'with', 'your', 'their', 'which', 'where', 'when', 'into', 'explain', 'describe', 'summarize', 'summary', 'document', 'documents', 'pdf', 'file', 'files', 'content', 'uploaded', 'question', 'based', 'according', 'can', 'you', 'the', 'and', 'for', 'are', 'all', 'how', 'who', 'why', 'was', 'again', 'is', 'to', 'me', 'of', 'as', 'it', 'in', 'on', 'do', 'at', 'by', 'or', 'be', 'he', 'we', 'if', 'am', 'an']);
    const terms = words.filter(word => word.length > 1 && !stop.has(word)).map(normalizeTerm);
    if (!terms.length) return Boolean(equation) || /\b(summar(?:y|ize|ise)|about|overview)\b/i.test(question);
    return chunks.some(chunk => chunk.text.split(/(?<=[.!?])\s+/u).some(sentence => {
        const tokens = new Set((sentence.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).map(normalizeTerm));
        return (!equation || compact(sentence).includes(compact(equation[0]))) && terms.every(term => tokens.has(term));
    }));
}

function resolveDocumentScope(question, uploadedNames, activeNames) {
    const lower = question.toLowerCase();
    const chars = question.split('');
    const matched = [];
    for (const name of [...uploadedNames].sort((a, b) => b.length - a.length)) {
        const needle = name.toLowerCase();
        let pos = lower.indexOf(needle);
        while (pos !== -1) {
            const before = lower[pos - 1] || '';
            const after = lower[pos + needle.length] || '';
            const suffix = /[\p{L}\p{N}_-]/u.test(after) || (after === '.' && /[\p{L}\p{N}_]/u.test(lower[pos + needle.length + 1] || ''));
            if (!/[\p{L}\p{N}_.-]/u.test(before) && !suffix && chars.slice(pos, pos + name.length).some(char => char !== ' ')) {
                matched.push(name);
                for (let i = pos; i < pos + name.length; i++) chars[i] = ' ';
            }
            pos = lower.indexOf(needle, pos + needle.length);
        }
    }
    const query = chars.join('');
    if (/\.pdf\b/i.test(query)) return { error: 'The requested PDF is not available. Select an uploaded PDF and try again.' };
    const names = [...new Set(matched)];
    if (names.some(name => !activeNames.includes(name))) return { error: 'Select the named PDF in Sources before asking about it.' };
    return { names: names.length ? names : activeNames, query: query.trim() || 'summarize' };
}

function quizRequest(question) {
    question = question.replace(/\bmultiple[ -]choices\b/gi, 'multiple choice').replace(/\bidentification\b/gi, 'short-answer questions').replace(/^\s*what about\s+/i, '');
    if (!/\b(?:quiz|quizzes|reviewer|flashcards?|multiple[ -]choice|mcqs?|practice questions|short[ -]answer questions|definition questions|fill[ -]in[ -]the[ -]blank)\b/i.test(question)) return null;
    const kind = /\b(?:fill[ -]in[ -]the[ -]blank)\b/i.test(question) ? 'fill' : /\bflashcards?\b/i.test(question) ? 'flashcards' : /\b(?:term[ -]definition|definitions?)\b/i.test(question) ? 'definition' : /\bshort[ -]answer\b/i.test(question) ? 'short-answer' : 'multiple-choice';
    const countMatch = question.match(/\b(\d{1,2})\s+(?:(?:multiple[ -]choice|short[ -]answer|practice|definition)\s+)?(?:quiz(?:zes)?|questions?|flashcards?|mcqs?)\b/i);
    const count = countMatch ? Math.max(1, Math.min(20, Number(countMatch[1]))) : 10;
    const topic = question.toLowerCase().replace(/\b\d{1,2}\s+(?=(?:(?:multiple[ -]choice|short[ -]answer|practice|definition)\s+)?(?:quiz(?:zes)?|questions?|flashcards?|mcqs?)\b)/g, '').replace(/\b(?:create|make|generate|give|build|prepare|write|please|could|would|can|you|me|a|an|the|some|and|both|quiz|quizzes|reviewer|flashcards|flashcard|questions|question|about|on|from|using|based|of|for|this|these|my|pdf|pdfs|document|documents|file|files|uploaded|multiple|choice|mcq|mcqs|short|answer|fill|in|blank|practice|term|definition|definitions)\b/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return { topic, count, kind };
}

function makeSourceQuiz(chunks, limit = 5, kind = 'fill', topic = '') {
    const seen = new Set();
    const questions = [];
    for (const chunk of chunks) {
        const sentences = chunk.text.split(/\n+|(?<=[.!?])\s+/u);
        for (const raw of sentences) {
            const sentence = raw.replace(/^\s*[•\-*]\s*/, '').trim();
            if (sentence.length < 25 || sentence.length > 240 || (!/[.!?]$/.test(sentence) && !sentence.includes(':'))) continue;
            if (topic && !questionHasEvidence(topic, [{ text: sentence }])) continue;
            const words = [...sentence.matchAll(/\b[A-Za-z]{5,}\b/g)];
            if (words.length < 2 || seen.has(sentence.toLowerCase())) continue;
            let word = words.at(-1);
            let answer = word[0];
            let prompt = sentence.slice(0, word.index) + '_____' + sentence.slice(word.index + word[0].length);
            let choices;
            const definition = sentence.match(/^(.{2,80}?)\s+(is defined as|refers to|is|are|means)\s+(.{5,150})[.!?]$/i);
            const field = sentence.match(/^([^:]{2,60}):\s*(.{2,170})$/);
            if (field && kind !== 'multiple-choice') {
                prompt = `What is listed under ${field[1]}?`;
                answer = field[2];
            }
            if (kind === 'definition') {
                if (!definition) continue;
                prompt = `${definition[1]} ${definition[2]} _____`;
                answer = definition[3];
            } else if ((kind === 'flashcards' || kind === 'short-answer') && definition) {
                prompt = `What does the document state about ${definition[1]}?`;
                answer = sentence;
            }
            if (kind === 'multiple-choice') {
                const list = sentence.match(/\b[A-Za-z]{3,}(?:,\s*[A-Za-z]{3,}){1,},?\s+(?:and|or)\s+[A-Za-z]{3,}\b/i);
                if (!list) continue;
                const listWords = (list[0].match(/[A-Za-z]{3,}/g) || []).filter(item => !/^(?:and|or)$/i.test(item));
                const alternatives = [...new Map(listWords.map(item => [item.toLowerCase(), item])).values()];
                if (alternatives.length < 3 || alternatives.length !== listWords.length) continue;
                answer = alternatives.at(-1);
                const answerIndex = list.index + list[0].lastIndexOf(answer);
                prompt = sentence.slice(0, answerIndex) + '_____' + sentence.slice(answerIndex + answer.length);
                choices = [...alternatives.slice(0, -1).slice(0, 3), answer];
                const shift = questions.length % choices.length;
                choices = [...choices.slice(shift), ...choices.slice(0, shift)];
            }
            seen.add(sentence.toLowerCase());
            questions.push({ prompt, answer, source: chunk.pdfName, evidence: sentence, choices });
            if (questions.length === limit) return questions;
        }
    }
    return questions;
}

module.exports = { chunkText, cosineSimilarity, retrieveChunks, questionHasEvidence, resolveDocumentScope, quizRequest, makeSourceQuiz };
