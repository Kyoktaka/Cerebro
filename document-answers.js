function documentAnswer(question, documents) {
    const summary = /^(?:(?:please|can you|could you)\s+)?(?:summari[sz]e(?:\s+(?:it|this|that|the document|the pdf))?|(?:give me\s+)?(?:a\s+)?summary)[.!?]*$/i.test(question.trim());
    const codes = /^(?:(?:please|can you|could you)\s+)?(?:(?:tell|give|show)\s+me\s+|list\s+)?(?:the\s+)?(?:subject|course)\s+codes[.!?]*$/i.test(question.trim());
    const count = /^how many (?:subjects|courses)(?: are (?:in )?(?:there|here|it|this|the document|the pdf))?[.!?]*$/i.test(question.trim());
    if (!summary && !codes && !count) return null;
    if (summary) {
        return 'Document highlights (quoted from each selected PDF):\n\n' + documents.map(document => {
            const lines = [...new Set(document.text.split(/\n+|(?<=[.!?])\s+/).map(line => line.trim()).filter(line => line.length >= 20))];
            const selected = lines.length <= 8 ? lines : Array.from({ length: 8 }, (_, i) => lines[Math.floor(i * (lines.length - 1) / 7)]);
            const excerpts = selected.length ? selected.map(line => line.slice(0, 500)) : [document.text.slice(0, 500)];
            return `Source: ${document.name}\n${excerpts.map(line => `• ${line}`).join('\n')}`;
        }).join('\n\n');
    }
    return documents.map(document => {
        const lines = document.text.split(/\r?\n/);
        const found = new Map();
        let inTable = false;
        for (const line of lines) {
            if (/\b(?:subject|course)\s*codes?\b/i.test(line)) inTable = true;
            if (/^\s*(?:total|assessment|fees|payment|remarks|approved|certified)\b/i.test(line)) inTable = false;
            if (!inTable) continue;
            const match = line.match(/^\s*([A-Z]{2,10}[ -]?\d{1,4}[A-Z]?)\b/);
            if (match) found.set(match[1].replace(/[ -]/g, ''), { code: match[1], line: line.trim() });
        }
        if (!found.size) return `Source: ${document.name}\nI could not reliably read the subject-code table. This does not mean the PDF has no subjects. Try a text-based export with separate table rows.`;
        return `Source: ${document.name}\n${count ? `Found ${found.size} distinct subject codes in the extracted table.` : 'Subject codes found in the extracted table:'}\n${[...found.values()].map(item => `• ${item.code}\n  Evidence: ${item.line}`).join('\n')}\nCheck these rows against the PDF; merged or unreadable rows may be missing.`;
    }).join('\n\n');
}

module.exports = { documentAnswer };
