/* Safe, dependency-free Markdown for Cerebro's local chat. */
(function (global) {
    function escapeHtml(input) {
        return String(input).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function inline(input) {
        return String(input).split(/(`[^`\n]+`)/g).map(part => {
            if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
                return '<code>' + escapeHtml(part.slice(1, -1)) + '</code>';
            }
            return escapeHtml(part)
                .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
                .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1<em>$2</em>');
        }).join('');
    }

    function render(input) {
        const lines = String(input || '').replace(/\r\n?/g, '\n').split('\n');
        const parts = [];
        let paragraph = [];
        let listType = '';

        function flushParagraph() {
            if (!paragraph.length) return;
            parts.push('<p>' + paragraph.map(inline).join('<br>') + '</p>');
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
            const fence = /^ {0,3}```[a-zA-Z0-9_-]*\s*$/.test(line);
            if (fence) {
                flushParagraph();
                closeList();
                const code = [];
                while (i + 1 < lines.length && !/^ {0,3}```\s*$/.test(lines[i + 1])) {
                    code.push(lines[++i]);
                }
                if (i + 1 < lines.length) i++;
                parts.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
                continue;
            }
            if (!line.trim()) {
                flushParagraph();
                closeList();
                continue;
            }
            const heading = line.match(/^ {0,3}(#{1,3})\s+(.+)$/);
            if (heading) {
                flushParagraph();
                closeList();
                const level = heading[1].length;
                parts.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
                continue;
            }
            if (i + 1 < lines.length && line.includes('|') && isTableRule(lines[i + 1])) {
                flushParagraph();
                closeList();
                const headers = splitCells(line);
                i++;
                const rows = [];
                while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim()) {
                    rows.push(splitCells(lines[++i]));
                }
                let table = '<table><thead><tr>' + headers.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
                for (const cells of rows) {
                    table += '<tr>' + headers.map((_, k) => '<td>' + inline(cells[k] || '') + '</td>').join('') + '</tr>';
                }
                parts.push(table + '</tbody></table>');
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
        return parts.join('');
    }

    global.CerebroMarkdown = {render};
    if (typeof module !== 'undefined' && module.exports) module.exports = {render, escapeHtml};
})(typeof window !== 'undefined' ? window : {});