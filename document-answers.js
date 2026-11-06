function documentAnswer(question, documents) {
    const summary = /^(?:(?:please|can you|could you)\s+)?(?:summari[sz]e(?:\s+(?:it|this|that|the document|the pdf))?|(?:give me\s+)?(?:a\s+)?summary)[.!?]*$/i.test(question.trim());
    const codes = /^(?:(?:please|can you|could you)\s+)?(?:(?:tell|give|show)\s+me\s+|list\s+)?(?:the\s+)?(?:subject|course)\s+codes[.!?]*$/i.test(question.trim());
    const count = /^how many (?:subjects|courses)(?: are (?:in )?(?:there|here|it|this|the document|the pdf))?[.!?]*$/i.test(question.trim());
    if (!summary && !codes && !count) return null;
    if (summary) {
        return documents.map(document => {
            const table = subjectTable(document.text);
            if (table.rows.length && table.reportedUnits !== null) {
                const units = table.rows.reduce((total, row) => total + row.units, 0);
                const unitText = units === table.reportedUnits
                    ? `${units} units across those rows.`
                    : `${units} units in parsed rows; the form reports ${table.reportedUnits}. Check the PDF for a discrepancy.`;
                return `Registration summary\nSource: ${document.name}\n${table.rows.length} distinct subjects, ${unitText}\n\n${table.rows.map(row => `• ${row.code}: ${row.description} (${row.units} units)`).join('\n')}`;
            }
            const lines = [...new Set(document.text.split(/\n+|(?<=[.!?])\s+/).map(line => line.trim()).filter(line => line.length >= 20))];
            const selected = lines.length <= 8 ? lines : Array.from({ length: 8 }, (_, i) => lines[Math.floor(i * (lines.length - 1) / 7)]);
            const excerpts = selected.length ? selected.map(line => line.slice(0, 500)) : [document.text.slice(0, 500)];
            return `Source: ${document.name}\n${excerpts.map(line => `• ${line}`).join('\n')}`;
        }).join('\n\n');
    }
    return documents.map(document => {
        const { rows } = subjectTable(document.text);
        if (!rows.length) return `Source: ${document.name}\nI could not reliably read the subject-code table. This does not mean the PDF has no subjects. Try a text-based export with separate table rows.`;
        return `Source: ${document.name}\n${count ? `Found ${rows.length} distinct subject codes in the extracted table.` : 'Subject codes found in the extracted table:'}\n${rows.map(item => `• ${item.code}\n  Evidence: ${item.code} ${item.units} ${item.description}`).join('\n')}\nCheck these rows against the PDF; merged or unreadable rows may be missing.`;
    }).join('\n\n');
}

function subjectTable(text) {
    const lines = text.split(/\r?\n/);
    const rows = new Map();
    let inTable = false;
    let reportedUnits = null;
    for (const line of lines) {
        if (/\bSUBJECT\b.*\bUNIT\b.*\bDESCRIPTION\b/i.test(line) || /\b(?:subject|course)\s+code\b.*\bdescription\b/i.test(line)) inTable = true;
        const total = line.match(/^\s*TOTAL\s*:?[ \t]*(\d+)\b/i);
        if (total && inTable) {
            reportedUnits = Number(total[1]);
            inTable = false;
        }
        if (/^\s*(?:assessment|fees|payment|remarks|approved|certified)\b/i.test(line)) inTable = false;
        if (!inTable) continue;
        const match = line.match(/^\s*([A-Z]{2,10}[ -]?\d{1,4}[A-Z]?)\s+(\d{1,2})\s+(.{4,}?)(?=\s+\d{1,2}:\d{2}|$)/);
        if (!match) continue;
        const key = match[1].replace(/[ -]/g, '');
        if (!rows.has(key)) rows.set(key, { code: match[1], units: Number(match[2]), description: match[3].trim(), line: line.trim() });
    }
    return { rows: [...rows.values()], reportedUnits };
}

module.exports = { documentAnswer, subjectTable };
