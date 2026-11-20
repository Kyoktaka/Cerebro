const { createHash } = require('node:crypto');
const { plainHeading, looksLikeHeading } = require('./pdf');
const { sentences, stem, words, STOP } = require('./text');

function intEnv(name, fallback) {
    const parsed = Number.parseInt(String(process.env[name] || '').replace(/[^\d]/g, ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
const CHUNK_SIZE = intEnv('CEREBRO_CHUNK_SIZE', 1400);
const CHUNK_OVERLAP = intEnv('CEREBRO_CHUNK_OVERLAP', 180);
const MIN_SECTION = 350;

const normalizeTitle = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function docKey(doc) {
    return (doc.digest || createHash('sha256').update(doc.name).digest('hex')).slice(0, 12);
}

function pagesOf(doc) {
    const ranges = doc.layout?.length ? doc.layout : [{ page: undefined, start: 0, end: doc.text.length }];
    return ranges.map(range => ({ page: range.page, text: doc.text.slice(range.start, range.end) }));
}

function joinLegacyLines(lines) {
    const out = [];
    for (const raw of lines) {
        const line = raw.replace(/\s+/g, ' ').trim();
        if (!line) continue;
        const prev = out.at(-1);
        const listItem = /^(?:[•●▪◦‣∙·*-]|\d{1,2}[.)])\s+/.test(line);
        if (prev && !listItem && !plainHeading(prev) && !/[.!?:;]["”')]?$/.test(prev) &&
            (/^[\p{Ll}(]/u.test(line) || /,$/.test(prev))) {
            out[out.length - 1] = /\p{L}-$/u.test(prev) && /^\p{Ll}/u.test(line) ? prev.slice(0, -1) + line : prev + ' ' + line;
        } else {
            out.push(line);
        }
    }
    return out;
}

function blockKind(lines) {
    if (lines.length && lines.filter(line => line.includes(' | ')).length >= Math.ceil(lines.length * 0.6)) return 'table';
    if (lines.length > 1 && lines.filter(line => /^(?:[•●▪◦‣∙·*-]|\d{1,2}[.)]|[a-z][.)])\s+/i.test(line)).length >= lines.length / 2) return 'list';
    return 'para';
}

function blocksOf(doc) {
    const structured = doc.version >= 2;
    const headingsByPage = new Map();
    for (const heading of doc.outline || []) {
        const list = headingsByPage.get(heading.page) || [];
        list.push(heading);
        headingsByPage.set(heading.page, list);
    }
    const blocks = [];
    for (const { page, text } of pagesOf(doc)) {
        const pageHeadings = headingsByPage.get(page) || [];
        const paragraphs = text.split(/\n{2,}/);
        let first = true;
        const pushLegacy = part => {
            if (plainHeading(part[0])) {
                blocks.push({ page, kind: 'heading', text: part[0], level: /^\d+\.\d+/.test(part[0]) ? 2 : 1 });
                part = part.slice(1);
            }
            if (part.length) blocks.push({ page, kind: blockKind(part), text: part.join('\n') });
            first = false;
        };
        for (const paragraph of paragraphs) {
            let lines = paragraph.split('\n').map(line => line.trim()).filter(Boolean);
            if (!lines.length) continue;
            if (!structured) {
                lines = joinLegacyLines(lines);
                // Old extractions have no blank lines between headings and text.
                while (lines.length > 1) {
                    const at = lines.findIndex((line, i) => i > 0 && plainHeading(line));
                    if (at === -1) break;
                    pushLegacy(lines.slice(0, at));
                    lines = lines.slice(at);
                }
            }
            const heading = lines.length === 1 && (structured
                ? pageHeadings.find(item => normalizeTitle(item.title) === normalizeTitle(lines[0]))
                : (plainHeading(lines[0]) || (first && looksLikeHeading(lines[0]) && lines[0].split(' ').length <= 8 && !/[.!:]$/.test(lines[0])))
                    && { title: lines[0], level: /^\d+\.\d+/.test(lines[0]) ? 2 : 1 });
            if (!structured && !heading && lines.length > 1 && plainHeading(lines[0])) {
                blocks.push({ page, kind: 'heading', text: lines[0], level: 1 });
                lines = lines.slice(1);
            }
            if (heading) blocks.push({ page, kind: 'heading', text: lines[0], level: heading.level || 1 });
            else blocks.push({ page, kind: blockKind(lines), text: lines.join('\n') });
            first = false;
        }
    }
    return blocks;
}

function sectionsOf(doc, blocks) {
    const sections = [];
    const stack = [];
    // Slide decks repeat the same titles on consecutive pages. Re-entering a
    // heading path continues its section instead of creating empty duplicates.
    const byPath = new Map();
    let current = { title: null, level: 0, path: [], blocks: [] };
    sections.push(current);
    for (const block of blocks) {
        if (block.kind !== 'heading') {
            current.blocks.push(block);
            for (const section of byPath.values()) {
                if (current.path.slice(0, section.path.length).join('/') === section.path.join('/')) section.lastPage = block.page;
            }
            current.lastPage = block.page;
            continue;
        }
        while (stack.length && stack.at(-1).level >= block.level) stack.pop();
        if (!stack.length && byPath.size && ![...byPath.keys()].some(key => key.split('/')[0] === normalizeTitle(block.text))) byPath.clear();
        stack.push({ title: block.text, level: block.level });
        const path = stack.map(item => item.title);
        const key = path.map(normalizeTitle).join('/');
        const existing = byPath.get(key);
        if (existing && (existing.lastPage ?? existing.page) >= block.page - 1) {
            current = existing;
            continue;
        }
        current = { title: block.text, level: block.level, path, blocks: [], page: block.page, lastPage: block.page };
        byPath.set(key, current);
        sections.push(current);
    }
    const key = docKey(doc);
    return sections
        .filter(section => section.blocks.length || section.title)
        .map((section, i) => {
            const pages = [section.page, ...section.blocks.map(block => block.page)].filter(Number.isInteger);
            return {
                ...section,
                id: key + ':s' + i,
                pageStart: pages.length ? Math.min(...pages) : undefined,
                pageEnd: pages.length ? Math.max(...pages) : undefined,
                chars: section.blocks.reduce((sum, block) => sum + block.text.length, 0)
            };
        });
}

function splitBlock(block) {
    if (block.text.length <= CHUNK_SIZE) return [block];
    const lines = block.text.split('\n');
    if (block.kind === 'table' || block.kind === 'list') {
        const header = block.kind === 'table' ? lines[0] : '';
        const parts = [];
        let current = block.kind === 'table' ? [header] : [];
        for (const line of block.kind === 'table' ? lines.slice(1) : lines) {
            const size = current.join('\n').length + line.length + 1;
            if (size > CHUNK_SIZE && current.length > (header ? 1 : 0)) {
                parts.push(current.join('\n'));
                current = header ? [header] : [];
            }
            current.push(line);
        }
        if (current.length > (header ? 1 : 0)) parts.push(current.join('\n'));
        return parts.map(text => ({ ...block, text }));
    }
    const parts = [];
    let current = '';
    for (const sentence of sentences(block.text)) {
        if (current && current.length + sentence.length + 1 > CHUNK_SIZE) {
            parts.push(current);
            current = '';
        }
        if (sentence.length > CHUNK_SIZE) {
            for (let i = 0; i < sentence.length; i += CHUNK_SIZE) parts.push(sentence.slice(i, i + CHUNK_SIZE));
            continue;
        }
        current = current ? current + ' ' + sentence : sentence;
    }
    if (current) parts.push(current);
    return parts.map(text => ({ ...block, text }));
}

function overlapTail(text) {
    if (CHUNK_OVERLAP <= 0) return '';
    const tail = [];
    let size = 0;
    for (const sentence of sentences(text).reverse()) {
        if (size + sentence.length > CHUNK_OVERLAP && tail.length) break;
        if (sentence.length > CHUNK_OVERLAP * 1.5) break;
        tail.unshift(sentence);
        size += sentence.length + 1;
    }
    return tail.join(' ');
}

// Pack whole blocks into chunks inside a section. Small neighboring sections
// under the same top-level heading share a chunk, so slide-style documents do not
// produce fragments too short to explain anything.
function chunksOf(doc, sections) {
    const key = docKey(doc);
    const chunks = [];
    let open = null;

    const close = () => {
        if (open && open.parts.length) {
            let text = '';
            const spans = [];
            for (const part of open.parts) {
                if (text) text += '\n\n';
                const start = text.length;
                text += part.text;
                spans.push({ page: part.page, start, end: text.length });
            }
            const pages = [...new Set(spans.map(span => span.page).filter(Number.isInteger))];
            const lead = open.sections[0];
            chunks.push({
                id: key + ':' + chunks.length,
                order: chunks.length,
                pdfName: doc.name,
                digest: doc.digest,
                page: pages[0],
                pages,
                section: lead.title || undefined,
                heading: lead.title || undefined,
                sectionId: lead.id,
                sectionIds: [...new Set(open.sections.map(section => section.id))],
                sectionPath: lead.path,
                text,
                spans
            });
        }
        open = null;
    };

    for (const section of sections) {
        const parts = section.blocks.flatMap(splitBlock);
        if (section.title) parts.unshift({ page: section.page ?? parts[0]?.page, text: section.title, kind: 'heading' });
        const total = parts.reduce((sum, part) => sum + part.text.length, 0);
        const sameFamily = open && (open.sections[0].path[0] || null) === (section.path[0] || null);
        const headingOnly = open && open.parts.every(part => part.kind === 'heading' || part.text.length < 60);
        const fits = open && open.size + total <= CHUNK_SIZE;
        if (!(fits && (headingOnly || (sameFamily && (open.size < MIN_SECTION || total < MIN_SECTION))))) close();
        for (const part of parts) {
            if (open && open.size + part.text.length > CHUNK_SIZE && open.parts.some(item => item.kind !== 'heading')) {
                const tail = overlapTail(open.parts.at(-1).text);
                const carried = open.parts.at(-1);
                close();
                open = { parts: [], sections: [section], size: 0 };
                if (tail && carried.kind !== 'heading') {
                    open.parts.push({ page: carried.page, text: tail, kind: 'overlap' });
                    open.size += tail.length;
                }
            }
            if (!open) open = { parts: [], sections: [section], size: 0 };
            if (!open.sections.includes(section)) open.sections.push(section);
            open.parts.push(part);
            open.size += part.text.length + 2;
        }
    }
    close();
    for (const section of sections) section.chunkIds = chunks.filter(chunk => chunk.sectionIds.includes(section.id)).map(chunk => chunk.id);
    return chunks;
}

const PRONOUN_START = /^(?:it|this|that|these|those|they|there|he|she|we|you|i|which|what|who|here|one|each|some|many|most|all|if|when|while|because|although|as|since|how|why|so|but|and|or|then|thus)\b/i;

function cleanTerm(value) {
    let term = String(value || '').replace(/^(?:the\s+)?(?:term|word|concept|phrase)\s+/i, '');
    if ((term.match(/\(/g) || []).length !== (term.match(/\)/g) || []).length) term = term.replace(/\s*\(.*$/, '');
    return term.replace(/^[\s"“'‘]+|[\s"”'’:]+$/g, '').replace(/\s+/g, ' ').trim();
}

// The shortest trailing run of words whose initials spell the acronym:
// "Memory Random Access Memory (RAM)" gives "Random Access Memory".
function longFormFor(phrase, acronym) {
    const parts = phrase.split(/[ -]/);
    for (let start = parts.length - 1; start >= 0; start--) {
        const initials = parts.slice(start).filter(word => !/^(?:of|and|for|the)$/i.test(word)).map(word => word[0].toUpperCase()).join('');
        if (initials === acronym.toUpperCase()) return parts.slice(start).join(' ');
        if (initials.length > acronym.length) break;
    }
    return null;
}

function termsOf(doc, sections, chunks) {
    const found = new Map();
    const aliases = [];
    const add = (term, data) => {
        term = cleanTerm(term);
        if (term.length < 2 || term.length > 60 || PRONOUN_START.test(term) || !/\p{L}/u.test(term)) return;
        const wordsInTerm = term.split(' ');
        if (wordsInTerm.length > 6 || STOP.has(term.toLowerCase())) return;
        const key = term.toLowerCase();
        const existing = found.get(key);
        if (existing) {
            existing.score += data.score;
            if (!existing.definition && data.definition) Object.assign(existing, { definition: data.definition, page: data.page, chunkId: data.chunkId });
            return;
        }
        found.set(key, { term, score: data.score, definition: data.definition, page: data.page, chunkId: data.chunkId, sectionId: data.sectionId });
    };

    for (const chunk of chunks) {
        const flat = chunk.text.replace(/\s+/g, ' ');
        for (const match of flat.matchAll(/\b(\p{Lu}[\p{Ll}]+(?:[ -](?:of|and|for|the|\p{Lu}?[\p{Ll}]+)){1,5})\s*\(\s*(\p{Lu}[\p{Lu}\d]{1,7}s?)\s*\)/gu)) {
            const acronym = match[2].replace(/s$/, '');
            const phrase = longFormFor(match[1], acronym);
            if (phrase) {
                aliases.push([acronym, phrase]);
                add(acronym, { score: 2, page: chunk.page, chunkId: chunk.id, sectionId: chunk.sectionId });
            }
        }
        for (const match of flat.matchAll(/\b(\p{Lu}[\p{Lu}\d]{1,7})\s*\(\s*(\p{Lu}[\p{Ll}]+(?:[ -]\p{L}+){1,5})\s*\)/gu)) {
            aliases.push([match[1], match[2]]);
            add(match[1], { score: 2, page: chunk.page, chunkId: chunk.id, sectionId: chunk.sectionId });
        }
        for (const block of chunk.text.split(/\n{2,}/)) {
            const first = sentences(block)[0] || '';
            const definition = first.match(/^(?:(?:a|an|the)\s+)?([\p{L}][\p{L}\p{N} '’()-]{1,48}?)\s+(?:is|are|refers to|refer to|means|is defined as|are defined as|is known as|is called|are called|describes)\s+(.{8,})$/iu);
            if (definition) add(definition[1], { score: 3, definition: first, page: chunk.page, chunkId: chunk.id, sectionId: chunk.sectionId });
            const labelled = block.match(/^(\p{Lu}[\p{L}\p{N} '’-]{1,40})\s*[:–—]\s+(.{8,})/u);
            if (labelled && !/\|/.test(labelled[0])) add(labelled[1], { score: 2, definition: labelled[0].split('\n')[0], page: chunk.page, chunkId: chunk.id, sectionId: chunk.sectionId });
            for (const sentence of sentences(block)) {
                const called = sentence.match(/\b(?:called|known as|termed)\s+(?:an?\s+|the\s+)?([\p{L}-]+(?:\s[\p{L}-]+){0,2}?)(?=[,.;:)]|\s+(?:and|or|which|that)\b|$)/iu);
                if (called) add(called[1], { score: 2, definition: sentence, page: chunk.page, chunkId: chunk.id, sectionId: chunk.sectionId });
            }
            const items = block.split('\n').map(line => line.replace(/^(?:[-•*]|\d{1,2}[.)])\s+/, '').trim());
            for (let i = 0; i + 1 < items.length; i++) {
                const label = items[i];
                if (label.split(' ').length <= 4 && /^\p{Lu}/u.test(label) && !/[.!?:;,]$/.test(label) && items[i + 1].length > label.length + 10) {
                    add(label, { score: 1.5, definition: items[i + 1], page: chunk.page, chunkId: chunk.id, sectionId: chunk.sectionId });
                }
            }
        }
    }
    for (const section of sections) {
        if (!section.title || section.title.split(' ').length > 6) continue;
        const firstChunk = chunks.find(chunk => chunk.id === section.chunkIds?.[0]);
        const body = section.blocks[0]?.text || '';
        const definition = body && body.length <= 400 ? sentences(body)[0] : undefined;
        add(section.title, { score: 2, definition, page: section.pageStart, chunkId: firstChunk?.id, sectionId: section.id });
    }

    const counts = new Map();
    for (const word of words(doc.text)) {
        if (STOP.has(word) || word.length < 3) continue;
        const key = stem(word);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const entry of found.values()) {
        const stems = words(entry.term).filter(word => !STOP.has(word)).map(stem);
        const frequency = stems.length ? Math.min(...stems.map(key => counts.get(key) || 0)) : 0;
        entry.score += Math.log2(1 + frequency);
    }
    return {
        terms: [...found.values()].sort((a, b) => b.score - a.score).slice(0, 80),
        aliases: [...new Map(aliases.map(pair => [pair.join('|').toLowerCase(), pair])).values()]
    };
}

function analyzeDocument(doc) {
    const blocks = blocksOf(doc);
    const sections = sectionsOf(doc, blocks);
    const chunks = chunksOf(doc, sections);
    const { terms, aliases } = termsOf(doc, sections, chunks);
    return {
        name: doc.name,
        digest: doc.digest,
        pageCount: doc.pageCount,
        readablePages: doc.readablePages,
        imagePages: doc.imagePages || [],
        incomplete: Boolean(doc.incomplete),
        sections: sections.map(({ blocks: _blocks, page: _page, ...section }) => section),
        terms,
        aliases,
        chunks
    };
}

module.exports = { CHUNK_SIZE, CHUNK_OVERLAP, analyzeDocument, docKey, normalizeTitle };
