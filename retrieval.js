const { retrieveChunks } = require('./rag');

// Expand only unambiguous one-edit spelling matches from the selected PDF vocabulary.
function oneEdit(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    if (a.length < b.length) return a.slice(i) === b.slice(i+1);
    if (b.length < a.length) return b.slice(i) === a.slice(i+1);
    return a.slice(i+1) === b.slice(i+1) ||
        (a[i] === b[i+1] && a[i+1] === b[i] && a.slice(i+2) === b.slice(i+2));
}

function queryVariants(question, chunks) {
    const terms = new Set();
    for (const chunk of chunks) {
        for (const word of chunk.text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) terms.add(word);
    }
    const expansions = [];
    for (const word of question.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []) {
        if (terms.has(word)) continue;
        const matches = [...terms].filter(term => oneEdit(word, term));
        if (matches.length === 1) expansions.push(matches[0]);
    }
    return [...new Set(expansions)].join(' ');
}

function choosePassages(chunks, names, vector, comparison) {
    if (!comparison || names.length < 2) return retrieveChunks({ chunks }, names, vector);
    // Each compared document gets a passage, even if its nearest match ranks below another PDF's.
    return names.flatMap(name => retrieveChunks({ chunks }, [name], vector).slice(0, 1));
}

module.exports = { queryVariants, choosePassages };
