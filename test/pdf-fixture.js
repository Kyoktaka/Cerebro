const fs = require('node:fs');

const escapePdf = text => text.replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '');

function assemble(pageStreams) {
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
    const kids = [];
    for (const { content, image } of pageStreams) {
        const contentId = objects.length + 1;
        objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
        let resources = '/Font << /F1 3 0 R /F2 4 0 R >>';
        if (image) {
            const imageId = objects.length + 1;
            const pixels = '00'.repeat(16 * 16);
            objects.push(`<< /Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${pixels.length + 1} >>\nstream\n${pixels}>\nendstream`);
            resources += ` /XObject << /Im1 ${imageId} 0 R >>`;
        }
        const pageId = objects.length + 1;
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ${resources} >> /Contents ${contentId} 0 R >>`);
        kids.push(pageId);
    }
    objects[1] = `<< /Type /Pages /Kids [${kids.map(id => id + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((object, i) => {
        offsets.push(Buffer.byteLength(pdf));
        pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf);
}

function wrap(text, width) {
    const lines = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
        if (line && (line + ' ' + word).length > width) {
            lines.push(line);
            line = word;
        } else {
            line = line ? line + ' ' + word : word;
        }
    }
    if (line) lines.push(line);
    return lines;
}

// Layout blocks: { h1 }, { h2 }, { p }, { list: [] }, { table: [[...]] }, { image: true }, { rotate: true }.
// Every page gets a small running footer so header/footer removal is exercised.
function makeDocument(pages, { footer = 'Study notes' } = {}) {
    const streams = pages.map((blocks, pageIndex) => {
        let y = 740;
        let content = '';
        // { rotate: true } draws the page's text turned 90 degrees, as in
        // landscape slide decks exported from presentation software.
        const rotated = blocks.some(block => block.rotate);
        const text = (value, size, x = 72, font = 'F1') => {
            const place = rotated ? `0 ${size} -${size} 0 ${800 - y} ${x} Tm` : `${x} ${y} Td`;
            content += `BT\n/${font} ${rotated ? 1 : size} Tf\n${place}\n(${escapePdf(value)}) Tj\nET\n`;
        };
        let image = false;
        for (const block of blocks) {
            if (block.image) {
                content += 'q 400 0 0 500 100 150 cm /Im1 Do Q\n';
                image = true;
            } else if (block.h1) {
                y -= 10; text(block.h1, 20, 72, 'F2'); y -= 30;
            } else if (block.h2) {
                y -= 6; text(block.h2, 15, 72, 'F2'); y -= 22;
            } else if (block.p) {
                for (const line of wrap(block.p, 88)) { text(line, 11); y -= 14; }
                y -= 10;
            } else if (block.list) {
                for (const item of block.list) {
                    wrap(item, 82).forEach((line, i) => { text((i ? '  ' : '- ') + line, 11, i ? 84 : 72); y -= 14; });
                }
                y -= 10;
            } else if (block.table) {
                const width = 460 / block.table[0].length;
                for (const row of block.table) {
                    row.forEach((cell, i) => text(cell, 11, 72 + i * width));
                    y -= 16;
                }
                y -= 10;
            }
        }
        if (footer && !image) {
            y = 40;
            text(`${footer} - page ${pageIndex + 1}`, 9);
        }
        return { content, image };
    });
    return assemble(streams);
}

function makePdf(text) {
    return makeDocument([[{ p: text }]], { footer: '' });
}

if (require.main === module && process.argv[2]) fs.writeFileSync(process.argv[2], makePdf(process.argv.slice(3).join(' ')));

module.exports = { makePdf, makeDocument };
