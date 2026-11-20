/* Safe, dependency-free Markdown for Cerebro answers. Everything is escaped;
   only the structures below become HTML. */
(function (global) {
    function escapeHtml(input) {
        return String(input).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    const CITATION = /\[([^\]\n]+?), p\. (\d+)\]\(cerebro:([a-f0-9]{64}):(\d+)\)/g;

    function citation(doc, page, digest) {
        return '<button type="button" class="page-tab" data-digest="' + digest + '" data-page="' + page + '" data-doc="' +
            escapeHtml(doc) + '" title="Open ' + escapeHtml(doc) + ' at page ' + page + '"><span class="page-tab-doc">' +
            escapeHtml(doc.replace(/\.pdf$/i, '')) + '</span> p.&nbsp;' + page + '</button>';
    }

    function emphasis(text) {
        return text
            .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
            .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    }

    function inline(input) {
        return String(input).split(/(`[^`\n]+`)/g).map(part => {
            if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
                return '<code>' + escapeHtml(part.slice(1, -1)) + '</code>';
            }
            const pieces = [];
            let last = 0;
            for (const match of part.matchAll(CITATION)) {
                pieces.push(emphasis(escapeHtml(part.slice(last, match.index))));
                pieces.push(citation(match[1], match[2], match[3]));
                last = match.index + match[0].length;
            }
            pieces.push(emphasis(escapeHtml(part.slice(last))));
            return pieces.join('');
        }).join('');
    }

    const BEYOND = /^\s*(?:#{1,4}\s*)?\*\*\s*beyond (?:your|the) pdfs?\s*\*\*\s*:?\s*$/i;
    const TAKEAWAY = /^\s*\*\*remember:?\*\*:?\s*/i;
    const NOTE = /^\s*_([^_][\s\S]*[^_])_\s*$/;

    function render(input) {
        const lines = String(input || '').replace(/\r\n?/g, '\n').split('\n');
        const parts = [];
        let paragraph = [];
        let listType = '';
        let beyondOpen = false;
        let beyondClosed = false;

        function flushParagraph() {
            if (!paragraph.length) return;
            const text = paragraph.join('\n');
            if (TAKEAWAY.test(paragraph[0])) {
                // A takeaway restates the main point, so it is not supplementary.
                if (beyondOpen && !beyondClosed) {
                    parts.push('</section>');
                    beyondClosed = true;
                }
                parts.push('<p class="takeaway"><span class="takeaway-label">Remember</span> ' +
                    [paragraph[0].replace(TAKEAWAY, ''), ...paragraph.slice(1)].map(inline).join('<br>') + '</p>');
            } else if (NOTE.test(text)) {
                parts.push('<p class="note">' + inline(text.match(NOTE)[1]).replace(/\n/g, '<br>') + '</p>');
            } else {
                parts.push('<p>' + paragraph.map(inline).join('<br>') + '</p>');
            }
            paragraph = [];
        }
        function closeList() {
            if (!listType) return;
            parts.push('</' + listType + '>');
            listType = '';
        }
        function splitCells(line) {
            return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
        }
        function isTableRule(line) {
            return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || '');
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const fence = line.match(/^ {0,3}```([a-zA-Z0-9_-]*)\s*$/);
            if (fence) {
                flushParagraph();
                closeList();
                const code = [];
                while (i + 1 < lines.length && !/^ {0,3}```\s*$/.test(lines[i + 1])) code.push(lines[++i]);
                if (i + 1 < lines.length) i++;
                const block = fence[1].match(/^cerebro-(sources|quiz|flashcards|practice)$/);
                if (block) {
                    parts.push('<div class="study-block" data-block="' + block[1] + '" data-json="' + escapeHtml(code.join('\n')) + '"></div>');
                } else {
                    parts.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
                }
                continue;
            }
            if (!line.trim()) {
                flushParagraph();
                closeList();
                continue;
            }
            if (BEYOND.test(line) && !beyondOpen) {
                flushParagraph();
                closeList();
                beyondOpen = true;
                parts.push('<section class="beyond" aria-label="Beyond your PDF"><p class="beyond-label">Beyond your PDF</p>');
                continue;
            }
            const heading = line.match(/^ {0,3}(#{1,4})\s+(.+)$/);
            if (heading) {
                flushParagraph();
                closeList();
                const level = Math.min(heading[1].length + 1, 4);
                parts.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
                continue;
            }
            if (i + 1 < lines.length && line.includes('|') && isTableRule(lines[i + 1])) {
                flushParagraph();
                closeList();
                const headers = splitCells(line);
                i++;
                const rows = [];
                while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim()) rows.push(splitCells(lines[++i]));
                let table = '<div class="table-wrap"><table><thead><tr>' + headers.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
                for (const cells of rows) table += '<tr>' + headers.map((_, k) => '<td>' + inline(cells[k] || '') + '</td>').join('') + '</tr>';
                parts.push(table + '</tbody></table></div>');
                continue;
            }
            const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
            const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
            if (bullet || numbered) {
                flushParagraph();
                const type = bullet ? 'ul' : 'ol';
                if (listType !== type) {
                    closeList();
                    listType = type;
                    parts.push('<' + type + '>');
                }
                parts.push('<li>' + inline((bullet || numbered)[1]) + '</li>');
                continue;
            }
            const quote = line.match(/^>\s?(.+)$/);
            if (quote) {
                flushParagraph();
                closeList();
                parts.push('<blockquote>' + inline(quote[1]) + '</blockquote>');
                continue;
            }
            closeList();
            paragraph.push(line);
        }
        flushParagraph();
        closeList();
        if (beyondOpen && !beyondClosed) {
            // Notes and study blocks after the supplementary part are not part of it.
            const index = parts.findIndex((part, i) => i > 0 && (part.startsWith('<p class="note">') || part.startsWith('<div class="study-block"')) &&
                parts.slice(0, i).some(item => item.startsWith('<section class="beyond"')));
            if (index === -1) parts.push('</section>');
            else parts.splice(index, 0, '</section>');
        }
        return parts.join('');
    }

    // Plain text for copying: citations become "(doc p. N)", blocks are dropped.
    function plain(input) {
        return String(input || '')
            .replace(/```cerebro-[\w-]+\n[\s\S]*?\n```/g, '')
            .replace(CITATION, '($1 p. $2)')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    global.CerebroMarkdown = { render, plain, escapeHtml };
    if (typeof module !== 'undefined' && module.exports) module.exports = { render, plain, escapeHtml };
})(typeof window !== 'undefined' ? window : {});
