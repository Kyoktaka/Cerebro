const { createHash } = require('node:crypto');
const pdfParse = require('pdf-parse');
const { OPS } = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');

const EXTRACTION_VERSION = 2;
const IMAGE_OPS = new Set([OPS.paintImageXObject, OPS.paintJpegXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]);

// Text items carry a transform matrix. Projecting positions onto the baseline
// direction keeps rotated and landscape pages readable line by line.
function geometry(item) {
    const [a, b, c, d, e, f] = item.transform;
    const size = Math.sqrt(Math.abs(a * d - b * c)) || Math.hypot(c, d) || 1;
    const length = Math.hypot(a, b) || 1;
    const ux = a / length;
    const uy = b / length;
    return { size, along: e * ux + f * uy, across: f * ux - e * uy };
}

function pageLines(items) {
    const lines = [];
    let line = null;
    let previous = null;
    for (const item of items) {
        if (typeof item.str !== 'string' || !item.transform || !item.str.length) continue;
        const g = geometry(item);
        const tolerance = Math.max(2, 0.45 * Math.min(g.size, previous?.size || g.size));
        const wrapped = previous && g.along < previous.end - Math.max(2, 0.5 * g.size);
        if (!line || Math.abs(g.across - previous.across) > tolerance || wrapped) {
            line = { cells: [{ text: item.str, along: g.along }], size: g.size, across: g.across, chars: 0 };
            lines.push(line);
        } else {
            const gap = g.along - previous.end;
            const cell = line.cells.at(-1);
            if (gap > Math.max(4, 1.1 * g.size)) line.cells.push({ text: item.str, along: g.along });
            else cell.text += gap > Math.max(1, 0.12 * g.size) && !/\s$/.test(cell.text) && !/^\s/.test(item.str) ? ' ' + item.str : item.str;
            line.size = Math.max(line.size, g.size);
        }
        line.chars += item.str.trim().length;
        previous = { across: g.across, size: g.size, end: g.along + (item.width || 0) };
    }
    for (const entry of lines) {
        entry.cells = entry.cells.map(cell => ({ ...cell, text: cell.text.replace(/\s+/g, ' ').trim() })).filter(cell => cell.text);
        // Symbol fonts map bullets into the private use area.
        if (entry.cells.length) {
            entry.cells[0].text = entry.cells[0].text.replace(/^[\uE000-\uF8FF]\s*/, '- ');
            entry.cells = entry.cells.map(cell => ({ ...cell, text: cell.text.replace(/[\uE000-\uF8FF]/g, '').trim() })).filter(cell => cell.text);
        }
    }
    return lines.filter(entry => entry.cells.length);
}

// A row belongs to a table when at least two of its column starts line up with
// a neighboring multi-column row. Justified prose has gaps, but not aligned ones.
function markTables(lines) {
    const aligned = (a, b) => {
        if (!a || !b || a.cells.length < 2 || b.cells.length < 2) return false;
        const tolerance = 0.8 * Math.max(a.size, b.size);
        let matches = 0;
        for (const cell of a.cells.slice(1)) {
            if (b.cells.slice(1).some(other => Math.abs(other.along - cell.along) <= tolerance)) matches++;
        }
        return matches >= Math.min(2, a.cells.length - 1, b.cells.length - 1);
    };
    lines.forEach((line, i) => {
        line.table = aligned(line, lines[i - 1]) || aligned(line, lines[i + 1]);
    });
}

function lineText(line) {
    return line.table ? line.cells.map(cell => cell.text).join(' | ') : line.cells.map(cell => cell.text).join(' ');
}

async function countImages(page) {
    try {
        const operators = await page.getOperatorList();
        return operators.fnArray.filter(fn => IMAGE_OPS.has(fn)).length;
    } catch {
        return 0;
    }
}

function bodySize(pages) {
    const weights = new Map();
    for (const page of pages) {
        for (const line of page.lines) {
            const key = Math.round(line.size * 2) / 2;
            weights.set(key, (weights.get(key) || 0) + line.chars);
        }
    }
    let best = 0;
    let size = 0;
    for (const [key, weight] of weights) if (weight > best) { best = weight; size = key; }
    return size || 10;
}

const PAGE_NUMBER = /^(?:page\s*)?[-–]?\s*\d{1,4}\s*[-–]?(?:\s*(?:of|\/)\s*\d{1,4})?$/i;

function runningLines(pages, body) {
    if (pages.length < 3) return new Set();
    const counts = new Map();
    for (const page of pages) {
        const edges = [...page.lines.slice(0, 2), ...page.lines.slice(-2)];
        const seen = new Set();
        for (const line of edges) {
            const key = lineText(line).toLowerCase().replace(/\d+/g, '#').trim();
            if (!key || seen.has(key) || line.size > body * 1.05) continue;
            seen.add(key);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }
    const minimum = Math.max(3, Math.ceil(pages.length * 0.5));
    return new Set([...counts].filter(([, count]) => count >= minimum).map(([key]) => key));
}

function looksLikeHeading(text) {
    const value = text.trim();
    if (value.length < 2 || value.length > 120 || !/\p{L}/u.test(value)) return false;
    if (/[,;]$/.test(value) || /\.$/.test(value) && !/^\d+(?:\.\d+)*\.?\s/.test(value)) return false;
    if (!/^[\p{Lu}\p{N}"“'‘(]/u.test(value)) return false;
    return value.split(/\s+/).length <= 14;
}

const NUMBERED = /^(?:(?:chapter|section|part|unit|lesson|module|topic|appendix)\s+[\dIVXLC]+\b|\d+(?:\.\d+)*[.)]?\s+\p{Lu})/iu;

function plainHeading(text) {
    const value = text.trim();
    if (!looksLikeHeading(value) || value.length > 80 || /[.!:]$/.test(value)) return false;
    if (NUMBERED.test(value)) return true;
    const letters = value.replace(/[^\p{L}]/gu, '');
    return letters.length >= 3 && letters === letters.toUpperCase();
}

function startsList(text) {
    return /^(?:[•●▪◦‣∙·*-]|\d{1,2}[.)]|[a-z][.)]|\(?[ivx]{1,4}\))\s+/i.test(text.trim());
}

function joinable(previous, next) {
    if (!previous || previous.heading || next.heading || previous.table || next.table) return false;
    if (startsList(next.text)) return false;
    const prev = previous.text.trim();
    if (/-$/.test(prev) && /^\p{Ll}/u.test(next.text)) return true;
    if (/[.!?:;]["”')\]]?$/.test(prev)) return false;
    return /^[\p{Ll}(]/u.test(next.text.trim()) || /,$/.test(prev);
}

// A full-width line ending in a sentence was wrapped at the margin, so the
// next sentence still belongs to the same paragraph.
function wrappedSentence(previous, next, measure) {
    if (!measure || previous.heading || next.heading || previous.table || next.table || startsList(next.text)) return false;
    return previous.text.length >= measure * 0.8 && /[.!?]["”')]?$/.test(previous.text) && /^[\p{Lu}"“]/u.test(next.text);
}

function buildPage(page, body, running, headingSizes) {
    const lines = page.lines.map((line, i) => {
        const text = lineText(line);
        const edge = i < 2 || i >= page.lines.length - 2;
        const key = text.toLowerCase().replace(/\d+/g, '#').trim();
        if (edge && (PAGE_NUMBER.test(text.trim()) || running.has(key))) return null;
        return { text, size: line.size, across: line.across, table: line.table };
    }).filter(Boolean);

    const headings = [];
    lines.forEach((line, i) => {
        const next = lines[i + 1];
        const continues = next && !next.heading && Math.abs(next.size - line.size) < 0.5 && /^\p{Ll}/u.test(next.text.trim());
        const sized = headingSizes.length && line.size >= body * 1.15 && looksLikeHeading(line.text) && !continues;
        const capitals = line.text.replace(/[^\p{L}]/gu, '').length >= 6 && line.text.split(/\s+/).length <= 5;
        const plain = plainHeading(line.text) && next && !continues && (!headingSizes.length || capitals);
        if (!line.table && (sized || plain)) {
            line.heading = true;
            const rank = headingSizes.findIndex(size => line.size >= size - 0.25);
            const level = sized ? (rank === -1 ? headingSizes.length + 1 : rank + 1)
                : headingSizes.length ? headingSizes.length + 1 : (NUMBERED.test(line.text) ? 2 : 1);
            headings.push({ title: line.text.replace(/\s+/g, ' ').trim(), level, size: line.size });
        }
    });
    const prose = lines.filter(line => !line.heading && !line.table && !startsList(line.text)).map(line => line.text.length);
    const measure = prose.length ? Math.max(...prose) : 0;

    const paragraphs = [];
    let current = null;
    let previous = null;
    for (const line of lines) {
        const gap = previous ? Math.abs(line.across - previous.across) : 0;
        const breakBefore = !current || line.heading || previous.heading || gap > 1.75 * Math.max(line.size, previous.size) ||
            Math.abs(line.size - previous.size) > 1.5;
        if (breakBefore) {
            current = { lines: [line.text], last: line };
            paragraphs.push(current);
        } else if (joinable(current.last, line) || wrappedSentence(current.last, line, measure)) {
            const last = current.lines.length - 1;
            current.lines[last] = /\p{L}-$/u.test(current.lines[last]) && /^\p{Ll}/u.test(line.text)
                ? current.lines[last].slice(0, -1) + line.text
                : current.lines[last] + ' ' + line.text;
            current.last = line;
        } else {
            current.lines.push(line.text);
            current.last = line;
        }
        previous = line;
    }
    return {
        text: paragraphs.map(paragraph => paragraph.lines.join('\n')).join('\n\n').trim(),
        headings
    };
}

function headingScale(pages, body) {
    const sizes = new Map();
    for (const page of pages) {
        for (const line of page.lines) {
            if (line.size >= body * 1.15 && looksLikeHeading(lineText(line))) {
                const key = Math.round(line.size * 2) / 2;
                sizes.set(key, (sizes.get(key) || 0) + 1);
            }
        }
    }
    return [...sizes.keys()].sort((a, b) => b - a).slice(0, 4);
}

async function extractDocument(buffer, name, remaining = Infinity) {
    const raw = [];
    // Copy: pdf.js reads the whole underlying ArrayBuffer, and small Node
    // Buffers share a pooled one with other data.
    const pdf = await pdfParse(new Uint8Array(buffer), {
        pagerender: async page => {
            const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
            const lines = pageLines(content.items);
            markTables(lines);
            const chars = lines.reduce((sum, line) => sum + line.chars, 0);
            raw[page.pageNumber - 1] = { lines, images: chars < 20 ? await countImages(page) : 0 };
            return '';
        }
    });
    const pages = Array.from({ length: pdf.numpages }, (_, i) => raw[i] || { lines: [], images: 0 });
    const body = bodySize(pages);
    const running = runningLines(pages, body);
    const scale = headingScale(pages, body);
    const built = pages.map(page => buildPage(page, body, running, scale));

    const parts = built.map(page => page.text);
    const full = parts.join('\n\n');
    const text = full.slice(0, remaining);
    let offset = 0;
    const layout = parts.map((part, i) => {
        const start = offset;
        offset += part.length + 2;
        return { page: i + 1, start, end: Math.min(start + part.length, text.length) };
    }).filter(page => page.end > page.start);
    const included = new Set(layout.map(page => page.page));

    const outline = [];
    built.forEach((page, i) => {
        if (!included.has(i + 1)) return;
        for (const heading of page.headings) outline.push({ ...heading, page: i + 1 });
    });
    const imagePages = [];
    const blankPages = [];
    pages.forEach((page, i) => {
        if (parts[i].trim().length >= 20) return;
        (page.images ? imagePages : blankPages).push(i + 1);
    });
    const truncated = full.length > text.length;

    return {
        name, text, layout, truncated, outline, imagePages, blankPages,
        version: EXTRACTION_VERSION,
        pageCount: pdf.numpages,
        readablePages: parts.filter(part => part.trim()).length,
        incomplete: truncated || imagePages.length > 0,
        digest: createHash('sha256').update(buffer).digest('hex')
    };
}

async function renderPageText(page) {
    const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
    const lines = pageLines(content.items);
    markTables(lines);
    return lines.map(lineText).join('\n');
}

module.exports = { EXTRACTION_VERSION, extractDocument, renderPageText, pageLines, plainHeading, looksLikeHeading };
