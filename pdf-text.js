async function renderPageText(page) {
    const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
    let text = '';
    let previous;
    for (const item of content.items) {
        if (typeof item.str !== 'string' || !item.transform) continue;
        const x = item.transform[4];
        const y = item.transform[5];
        if (previous) {
            if (Math.abs(y - previous.y) > 2 || x < previous.x - 2) text += '\n';
            else if (x - previous.end > 1 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' ';
        }
        text += item.str;
        previous = { x, y, end: x + (item.width || 0) };
    }
    return text;
}

module.exports = { renderPageText };
