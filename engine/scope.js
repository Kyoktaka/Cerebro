// A question may name a PDF ("summarize notes.pdf"). Named files must be both
// uploaded and selected; otherwise the selection decides the scope.
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
    const query = chars.join('').replace(/\s+/g, ' ');
    if (/\.pdf\b/i.test(query)) return { error: 'The requested PDF is not available. Select an uploaded PDF and try again.' };
    const names = [...new Set(matched)];
    if (names.some(name => !activeNames.includes(name))) return { error: 'Select the named PDF in Sources before asking about it.' };
    return { names: names.length ? names : activeNames, named: names, query: query.trim() || 'summarize' };
}

module.exports = { resolveDocumentScope };
