#!/usr/bin/env node
// Upload PR reviews and inbox markdown to Google Drive.
// Creates/updates files in "PR Reviews" folder on JARVIS Shared Drive.
// Each review is stored twice: raw .md file + rendered Google Doc.
// Uses service account auth with domain-wide delegation.

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { google } from 'googleapis';

const SERVICE_DIR = process.env.SERVICE_DIR || '/opt/jarvis-pr-review';
const REVIEWS_DIR = join(SERVICE_DIR, 'reviews');
const REPORTS_DIR = join(SERVICE_DIR, 'reports');
const DATA_DIR = join(SERVICE_DIR, 'data');
const CREDENTIALS_FILE = join(SERVICE_DIR, 'credentials', 'gcp-service-account.json');
const STATE_FILE = join(DATA_DIR, 'upload-state.json');

// JARVIS Shared Drive ID
const SHARED_DRIVE_ID = '0AC4RjZu6DAzcUk9PVA';
const FOLDER_NAME = 'PR Reviews';

// ─── Auth ────────────────────────────────────────────────────────────────────

function getAuth(scopes) {
    const keyContent = readFileSync(CREDENTIALS_FILE, 'utf-8');
    const key = JSON.parse(keyContent);

    return new google.auth.GoogleAuth({
        credentials: key,
        scopes,
        clientOptions: {
            subject: 'pedro@lumesolutions.com',
        },
    });
}

// ─── Markdown → Google Docs converter ────────────────────────────────────────
// Converts markdown to Google Docs API batchUpdate requests.
// Emulates GitHub-flavored markdown rendering: code blocks with background,
// blockquotes with left border, heading separators, styled tables, etc.

// Color palette (GitHub-inspired)
const COLORS = {
    codeBg:      { red: 0.96, green: 0.97, blue: 0.98 },  // #f6f8fa
    codeBorder:  { red: 0.85, green: 0.87, blue: 0.90 },  // #d9dee3
    quoteBorder: { red: 0.82, green: 0.84, blue: 0.86 },  // #d1d6db
    quoteText:   { red: 0.40, green: 0.44, blue: 0.48 },  // #656d76
    hrColor:     { red: 0.85, green: 0.87, blue: 0.90 },  // #d9dee3
    h1Border:    { red: 0.85, green: 0.87, blue: 0.90 },
    h2Border:    { red: 0.90, green: 0.92, blue: 0.94 },
};

const PT = (n) => ({ magnitude: n, unit: 'PT' });

// Base font for all non-code text
const BASE_FONT = 'Arial';
const BASE_SIZE = 11; // pt
const CODE_FONT = 'Roboto Mono';
const CODE_SIZE = 8.5; // pt

class MarkdownToDocsConverter {
    convert(markdown) {
        if (!markdown) return [];

        // Pre-process: split into blocks (code blocks, blockquotes, tables, paragraphs)
        const blocks = this._parseBlocks(markdown);
        const requests = [];
        let index = 1; // Docs content starts at index 1

        for (const block of blocks) {
            const emitted = this._emitBlock(block, index);
            requests.push(...emitted.requests);
            index = emitted.endIndex;
        }

        return requests;
    }

    // Heading font sizes by level
    static HEADING_SIZES = { 1: 20, 2: 16, 3: 13, 4: 11, 5: 10, 6: 10 };

    // Apply base font (Arial) with explicit size to a range.
    // Must be called on every non-code text range to override the document
    // default (Times New Roman) since updateNamedStyle is not available in
    // googleapis v144.
    _setBaseFont(requests, range, fontSize = BASE_SIZE) {
        requests.push({
            updateTextStyle: {
                range,
                textStyle: {
                    weightedFontFamily: { fontFamily: BASE_FONT },
                    fontSize: PT(fontSize),
                },
                fields: 'weightedFontFamily,fontSize',
            },
        });
    }

    // ── Block-level parser (state machine) ───────────────────────────────────

    _parseBlocks(markdown) {
        const lines = markdown.split('\n');
        const blocks = [];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];

            // Fenced code block: ``` or ~~~ (allow up to any leading whitespace)
            const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})(\w*)\s*$/);
            if (fenceMatch) {
                const indent = fenceMatch[1] || '';
                const fenceChar = fenceMatch[2][0]; // ` or ~
                const fenceLen = fenceMatch[2].length;
                const lang = fenceMatch[3] || '';
                const codeLines = [];
                i++;
                while (i < lines.length) {
                    // Closing fence: same char, at least same length, optional indent
                    const closeMatch = lines[i].match(new RegExp(`^\\s*${fenceChar === '`' ? '`' : '~'}{${fenceLen},}\\s*$`));
                    if (closeMatch) {
                        i++;
                        break;
                    }
                    // Strip common indentation from code lines
                    let codeLine = lines[i];
                    if (indent && codeLine.startsWith(indent)) {
                        codeLine = codeLine.slice(indent.length);
                    }
                    codeLines.push(codeLine);
                    i++;
                }
                blocks.push({ type: 'code', lang, text: codeLines.join('\n') });
                continue;
            }

            // Horizontal rule (must be at line start, no leading spaces for list items)
            if (line.match(/^(\*{3,}|-{3,}|_{3,})\s*$/)) {
                blocks.push({ type: 'hr' });
                i++;
                continue;
            }

            // Blockquote (accumulate consecutive > lines, allow indented >)
            if (line.match(/^\s*>\s?/)) {
                const quoteLines = [];
                while (i < lines.length && lines[i].match(/^\s*>\s?/)) {
                    quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
                    i++;
                }
                blocks.push({ type: 'blockquote', text: quoteLines.join('\n') });
                continue;
            }

            // Table (accumulate |...| rows)
            if (line.match(/^\s*\|.*\|\s*$/)) {
                const tableRows = [];
                while (i < lines.length && lines[i].match(/^\s*\|.*\|\s*$/)) {
                    const row = lines[i].trim();
                    // Skip separator rows like |---|---|
                    if (!row.match(/^\|[\s\-:|]+\|$/)) {
                        tableRows.push(
                            row.split('|').filter(c => c.trim() !== '' || false).map(c => c.trim())
                        );
                    }
                    i++;
                }
                if (tableRows.length > 0) {
                    blocks.push({ type: 'table', rows: tableRows });
                }
                continue;
            }

            // Heading
            const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
            if (headingMatch) {
                blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
                i++;
                continue;
            }

            // Checkbox list item
            const checkboxMatch = line.match(/^(\s*)[-*]\s+\[([xX ])\]\s+(.+)/);
            if (checkboxMatch) {
                const checked = checkboxMatch[2].toLowerCase() === 'x';
                blocks.push({ type: 'bullet', text: (checked ? '\u2611 ' : '\u2610 ') + checkboxMatch[3] });
                i++;
                continue;
            }

            // Bullet list item
            const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)/);
            if (bulletMatch) {
                blocks.push({ type: 'bullet', text: bulletMatch[2] });
                i++;
                continue;
            }

            // Numbered list item
            const numberedMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
            if (numberedMatch) {
                blocks.push({ type: 'numbered', text: numberedMatch[2] });
                i++;
                continue;
            }

            // Empty line
            if (line.trim() === '') {
                blocks.push({ type: 'empty' });
                i++;
                continue;
            }

            // Normal paragraph (strip leading whitespace from continuation lines)
            blocks.push({ type: 'paragraph', text: line.trim() });
            i++;
        }

        return blocks;
    }

    // ── Block emitters ───────────────────────────────────────────────────────

    _emitBlock(block, index) {
        switch (block.type) {
            case 'heading':    return this._emitHeading(block, index);
            case 'code':       return this._emitCodeBlock(block, index);
            case 'blockquote': return this._emitBlockquote(block, index);
            case 'hr':         return this._emitHorizontalRule(index);
            case 'table':      return this._emitTable(block, index);
            case 'bullet':     return this._emitListItem(block, index, 'bullet');
            case 'numbered':   return this._emitListItem(block, index, 'numbered');
            case 'paragraph':  return this._emitParagraph(block, index);
            case 'empty':      return this._emitEmpty(index);
            default:           return { requests: [], endIndex: index };
        }
    }

    _emitHeading(block, index) {
        const requests = [];
        const { plainText, runs } = this._parseInline(block.text);
        const insertText = plainText + '\n';
        const range = { startIndex: index, endIndex: index + insertText.length };

        // Insert text
        requests.push({ insertText: { location: { index }, text: insertText } });

        // Named heading style (sets paragraph defaults — must come before text overrides)
        requests.push({
            updateParagraphStyle: {
                range,
                paragraphStyle: {
                    namedStyleType: `HEADING_${block.level}`,
                    alignment: 'START',
                    spaceAbove: PT(block.level <= 2 ? 18 : 14),
                    spaceBelow: PT(block.level <= 2 ? 8 : 6),
                },
                fields: 'namedStyleType,alignment,spaceAbove,spaceBelow',
            },
        });

        // Bottom border for H1 and H2 (GitHub style)
        if (block.level <= 2) {
            const borderColor = block.level === 1 ? COLORS.h1Border : COLORS.h2Border;
            requests.push({
                updateParagraphStyle: {
                    range,
                    paragraphStyle: {
                        borderBottom: {
                            color: { color: { rgbColor: borderColor } },
                            width: PT(1),
                            padding: PT(6),
                            dashStyle: 'SOLID',
                        },
                    },
                    fields: 'borderBottom',
                },
            });
        }

        // Arial font at heading-appropriate size + black color (AFTER namedStyleType to override defaults)
        requests.push({
            updateTextStyle: {
                range,
                textStyle: {
                    weightedFontFamily: { fontFamily: BASE_FONT },
                    fontSize: PT(MarkdownToDocsConverter.HEADING_SIZES[block.level] || BASE_SIZE),
                    foregroundColor: { color: { rgbColor: { red: 0, green: 0, blue: 0 } } },
                },
                fields: 'weightedFontFamily,fontSize,foregroundColor',
            },
        });

        // Inline formatting
        this._applyRuns(requests, runs, index);

        return { requests, endIndex: index + insertText.length };
    }

    _emitCodeBlock(block, index) {
        const requests = [];
        const text = (block.text || ' ') + '\n';

        // Insert text
        requests.push({ insertText: { location: { index }, text } });

        const range = { startIndex: index, endIndex: index + text.length };

        // Paragraph styling first (namedStyleType resets text defaults)
        requests.push({
            updateParagraphStyle: {
                range,
                paragraphStyle: {
                    namedStyleType: 'NORMAL_TEXT',
                    indentStart: PT(18),
                    indentEnd: PT(18),
                    spaceAbove: PT(4),
                    spaceBelow: PT(4),
                    borderLeft: {
                        color: { color: { rgbColor: COLORS.codeBorder } },
                        width: PT(2),
                        padding: PT(8),
                        dashStyle: 'SOLID',
                    },
                    borderTop: {
                        color: { color: { rgbColor: COLORS.codeBorder } },
                        width: PT(0.5),
                        padding: PT(4),
                        dashStyle: 'SOLID',
                    },
                    borderBottom: {
                        color: { color: { rgbColor: COLORS.codeBorder } },
                        width: PT(0.5),
                        padding: PT(4),
                        dashStyle: 'SOLID',
                    },
                    borderRight: {
                        color: { color: { rgbColor: COLORS.codeBorder } },
                        width: PT(0.5),
                        padding: PT(8),
                        dashStyle: 'SOLID',
                    },
                },
                fields: 'namedStyleType,indentStart,indentEnd,spaceAbove,spaceBelow,borderLeft,borderTop,borderBottom,borderRight',
            },
        });

        // Monospace font + smaller size (AFTER paragraph style to override defaults)
        requests.push({
            updateTextStyle: {
                range,
                textStyle: {
                    weightedFontFamily: { fontFamily: CODE_FONT },
                    fontSize: PT(CODE_SIZE),
                    backgroundColor: { color: { rgbColor: COLORS.codeBg } },
                },
                fields: 'weightedFontFamily,fontSize,backgroundColor',
            },
        });

        return { requests, endIndex: index + text.length };
    }

    _emitBlockquote(block, index) {
        const requests = [];
        const { plainText, runs } = this._parseInline(block.text);
        const text = plainText + '\n';

        requests.push({ insertText: { location: { index }, text } });

        const range = { startIndex: index, endIndex: index + text.length };

        // Left border + indentation (namedStyleType first — resets text defaults)
        requests.push({
            updateParagraphStyle: {
                range,
                paragraphStyle: {
                    namedStyleType: 'NORMAL_TEXT',
                    indentStart: PT(18),
                    borderLeft: {
                        color: { color: { rgbColor: COLORS.quoteBorder } },
                        width: PT(3),
                        padding: PT(8),
                        dashStyle: 'SOLID',
                    },
                    spaceAbove: PT(6),
                    spaceBelow: PT(6),
                },
                fields: 'namedStyleType,indentStart,borderLeft,spaceAbove,spaceBelow',
            },
        });

        // Base font (AFTER paragraph style)
        this._setBaseFont(requests, range);

        // Gray text color + italic
        requests.push({
            updateTextStyle: {
                range,
                textStyle: {
                    foregroundColor: { color: { rgbColor: COLORS.quoteText } },
                    italic: true,
                },
                fields: 'foregroundColor,italic',
            },
        });

        this._applyRuns(requests, runs, index);

        return { requests, endIndex: index + text.length };
    }

    _emitHorizontalRule(index) {
        const requests = [];
        const text = ' \n'; // minimal content for the paragraph

        requests.push({ insertText: { location: { index }, text } });

        // Render as a paragraph with only a bottom border
        requests.push({
            updateParagraphStyle: {
                range: { startIndex: index, endIndex: index + text.length },
                paragraphStyle: {
                    namedStyleType: 'NORMAL_TEXT',
                    borderBottom: {
                        color: { color: { rgbColor: COLORS.hrColor } },
                        width: PT(1),
                        padding: PT(8),
                        dashStyle: 'SOLID',
                    },
                    spaceAbove: PT(12),
                    spaceBelow: PT(12),
                },
                fields: 'namedStyleType,borderBottom,spaceAbove,spaceBelow',
            },
        });

        // Make the space character tiny so only the border shows
        requests.push({
            updateTextStyle: {
                range: { startIndex: index, endIndex: index + 1 },
                textStyle: { fontSize: PT(1) },
                fields: 'fontSize',
            },
        });

        return { requests, endIndex: index + text.length };
    }

    _emitTable(block, index) {
        const requests = [];
        const rows = block.rows;
        if (rows.length === 0) return { requests, endIndex: index };

        const numCols = Math.max(...rows.map(r => r.length));

        // Compute column widths based on longest content
        const colWidths = Array(numCols).fill(0);
        for (const row of rows) {
            for (let c = 0; c < numCols; c++) {
                const cell = row[c] || '';
                colWidths[c] = Math.max(colWidths[c], cell.length);
            }
        }

        // Render each row as a monospaced line with padded columns
        for (let r = 0; r < rows.length; r++) {
            const cells = [];
            for (let c = 0; c < numCols; c++) {
                const cell = rows[r][c] || '';
                cells.push(cell.padEnd(colWidths[c]));
            }
            const lineText = '  ' + cells.join('  \u2502  ') + '\n';

            requests.push({ insertText: { location: { index }, text: lineText } });

            const range = { startIndex: index, endIndex: index + lineText.length };

            // Monospace font for alignment
            requests.push({
                updateTextStyle: {
                    range,
                    textStyle: {
                        weightedFontFamily: { fontFamily: 'Roboto Mono' },
                        fontSize: PT(8.5),
                    },
                    fields: 'weightedFontFamily,fontSize',
                },
            });

            // First row = header: bold
            if (r === 0) {
                requests.push({
                    updateTextStyle: {
                        range,
                        textStyle: { bold: true },
                        fields: 'bold',
                    },
                });
            }

            // Paragraph spacing
            requests.push({
                updateParagraphStyle: {
                    range,
                    paragraphStyle: {
                        namedStyleType: 'NORMAL_TEXT',
                        spaceAbove: PT(1),
                        spaceBelow: PT(1),
                        indentStart: PT(9),
                    },
                    fields: 'namedStyleType,spaceAbove,spaceBelow,indentStart',
                },
            });

            // Add bottom border after header row
            if (r === 0) {
                requests.push({
                    updateParagraphStyle: {
                        range,
                        paragraphStyle: {
                            borderBottom: {
                                color: { color: { rgbColor: COLORS.codeBorder } },
                                width: PT(0.5),
                                padding: PT(2),
                                dashStyle: 'SOLID',
                            },
                        },
                        fields: 'borderBottom',
                    },
                });
            }

            index += lineText.length;
        }

        return { requests, endIndex: index };
    }

    _emitListItem(block, index, listType) {
        const requests = [];
        const { plainText, runs } = this._parseInline(block.text);
        const text = plainText + '\n';

        requests.push({ insertText: { location: { index }, text } });

        const range = { startIndex: index, endIndex: index + text.length };

        requests.push({
            createParagraphBullets: {
                range,
                bulletPreset: listType === 'numbered'
                    ? 'NUMBERED_DECIMAL_NESTED'
                    : 'BULLET_DISC_CIRCLE_SQUARE',
            },
        });

        // Tighter spacing for list items
        requests.push({
            updateParagraphStyle: {
                range,
                paragraphStyle: {
                    spaceAbove: PT(2),
                    spaceBelow: PT(2),
                },
                fields: 'spaceAbove,spaceBelow',
            },
        });

        // Base font (AFTER paragraph/bullet setup to override defaults)
        this._setBaseFont(requests, range);

        this._applyRuns(requests, runs, index);

        return { requests, endIndex: index + text.length };
    }

    _emitParagraph(block, index) {
        const requests = [];
        const { plainText, runs } = this._parseInline(block.text);
        const text = plainText + '\n';
        const range = { startIndex: index, endIndex: index + text.length };

        requests.push({ insertText: { location: { index }, text } });

        // Paragraph style first (namedStyleType resets text defaults)
        requests.push({
            updateParagraphStyle: {
                range,
                paragraphStyle: {
                    namedStyleType: 'NORMAL_TEXT',
                    spaceAbove: PT(3),
                    spaceBelow: PT(3),
                    lineSpacing: 115,
                },
                fields: 'namedStyleType,spaceAbove,spaceBelow,lineSpacing',
            },
        });

        // Base font (AFTER paragraph style to override Times New Roman default)
        this._setBaseFont(requests, range);

        this._applyRuns(requests, runs, index);

        return { requests, endIndex: index + text.length };
    }

    _emitEmpty(index) {
        const requests = [];
        const text = '\n';
        requests.push({ insertText: { location: { index }, text } });
        requests.push({
            updateParagraphStyle: {
                range: { startIndex: index, endIndex: index + text.length },
                paragraphStyle: {
                    namedStyleType: 'NORMAL_TEXT',
                    spaceAbove: PT(0),
                    spaceBelow: PT(0),
                },
                fields: 'namedStyleType,spaceAbove,spaceBelow',
            },
        });
        // Reduce empty line height
        requests.push({
            updateTextStyle: {
                range: { startIndex: index, endIndex: index + text.length },
                textStyle: { fontSize: PT(6) },
                fields: 'fontSize',
            },
        });
        return { requests, endIndex: index + text.length };
    }

    // ── Inline formatting ────────────────────────────────────────────────────

    _applyRuns(requests, runs, baseIndex) {
        for (const run of runs) {
            const startIdx = baseIndex + run.start;
            const endIdx = baseIndex + run.end;
            const range = { startIndex: startIdx, endIndex: endIdx };

            if (run.bold) {
                requests.push({ updateTextStyle: { range, textStyle: { bold: true }, fields: 'bold' } });
            }
            if (run.italic) {
                requests.push({ updateTextStyle: { range, textStyle: { italic: true }, fields: 'italic' } });
            }
            if (run.code) {
                requests.push({
                    updateTextStyle: {
                        range,
                        textStyle: {
                            weightedFontFamily: { fontFamily: 'Roboto Mono' },
                            fontSize: PT(8.5),
                            backgroundColor: { color: { rgbColor: COLORS.codeBg } },
                        },
                        fields: 'weightedFontFamily,fontSize,backgroundColor',
                    },
                });
            }
            if (run.link) {
                requests.push({
                    updateTextStyle: { range, textStyle: { link: { url: run.link } }, fields: 'link' },
                });
            }
        }
    }

    _parseInline(text) {
        const runs = [];
        let plainText = '';
        let i = 0;

        while (i < text.length) {
            // Links: [text](url)
            const linkMatch = text.slice(i).match(/^\[([^\]]+)\]\(([^)]+)\)/);
            if (linkMatch) {
                const start = plainText.length;
                plainText += linkMatch[1];
                runs.push({ start, end: plainText.length, link: linkMatch[2] });
                i += linkMatch[0].length;
                continue;
            }

            // Inline code: `text`
            const codeMatch = text.slice(i).match(/^`([^`]+)`/);
            if (codeMatch) {
                const start = plainText.length;
                plainText += codeMatch[1];
                runs.push({ start, end: plainText.length, code: true });
                i += codeMatch[0].length;
                continue;
            }

            // Bold+Italic: ***text***
            const boldItalicMatch = text.slice(i).match(/^(\*{3}|_{3})(.+?)\1/);
            if (boldItalicMatch) {
                const start = plainText.length;
                plainText += boldItalicMatch[2];
                runs.push({ start, end: plainText.length, bold: true, italic: true });
                i += boldItalicMatch[0].length;
                continue;
            }

            // Bold: **text**
            const boldMatch = text.slice(i).match(/^(\*{2}|_{2})(.+?)\1/);
            if (boldMatch) {
                const start = plainText.length;
                plainText += boldMatch[2];
                runs.push({ start, end: plainText.length, bold: true });
                i += boldMatch[0].length;
                continue;
            }

            // Italic: *text*
            const italicMatch = text.slice(i).match(/^(\*|_)(.+?)\1/);
            if (italicMatch) {
                const start = plainText.length;
                plainText += italicMatch[2];
                runs.push({ start, end: plainText.length, italic: true });
                i += italicMatch[0].length;
                continue;
            }

            plainText += text[i];
            i++;
        }

        return { plainText, runs };
    }
}

const mdConverter = new MarkdownToDocsConverter();

// ─── Drive helpers ───────────────────────────────────────────────────────────

async function findOrCreateFolder(drive, parentId, folderName) {
    const res = await drive.files.list({
        q: `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`,
        driveId: SHARED_DRIVE_ID,
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: 'files(id, name)',
    });

    if (res.data.files && res.data.files.length > 0) {
        return res.data.files[0].id;
    }

    const folder = await drive.files.create({
        requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
        },
        supportsAllDrives: true,
        fields: 'id',
    });

    console.log(`  Created folder "${folderName}" → ${folder.data.id}`);
    return folder.data.id;
}

async function upsertFile(drive, folderId, fileName, content, mimeType = 'text/markdown') {
    const res = await drive.files.list({
        q: `name = '${fileName}' and '${folderId}' in parents and trashed = false`,
        driveId: SHARED_DRIVE_ID,
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: 'files(id, name)',
    });

    const media = { mimeType, body: content };

    if (res.data.files && res.data.files.length > 0) {
        const fileId = res.data.files[0].id;
        await drive.files.update({ fileId, media, supportsAllDrives: true });
        return { id: fileId, action: 'updated' };
    } else {
        const file = await drive.files.create({
            requestBody: { name: fileName, parents: [folderId] },
            media,
            supportsAllDrives: true,
            fields: 'id, webViewLink',
        });
        return { id: file.data.id, action: 'created', link: file.data.webViewLink };
    }
}

// ─── Google Docs helpers ─────────────────────────────────────────────────────

async function upsertGoogleDoc(drive, docs, folderId, docName, markdownContent) {
    // Search for existing Google Doc by name in folder
    const res = await drive.files.list({
        q: `name = '${docName}' and mimeType = 'application/vnd.google-apps.document' and '${folderId}' in parents and trashed = false`,
        driveId: SHARED_DRIVE_ID,
        corpora: 'drive',
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: 'files(id, name)',
    });

    let docId;
    let action;

    if (res.data.files && res.data.files.length > 0) {
        docId = res.data.files[0].id;
        action = 'updated';

        // Clear existing content
        const doc = await docs.documents.get({ documentId: docId });
        const endIndex = doc.data.body?.content?.slice(-1)?.[0]?.endIndex || 1;
        if (endIndex > 2) {
            await docs.documents.batchUpdate({
                documentId: docId,
                requestBody: {
                    requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } }],
                },
            });
        }
    } else {
        // Create new Google Doc
        const file = await drive.files.create({
            requestBody: {
                name: docName,
                mimeType: 'application/vnd.google-apps.document',
                parents: [folderId],
            },
            supportsAllDrives: true,
            fields: 'id',
        });
        docId = file.data.id;
        action = 'created';
    }

    // Insert content and apply formatting (font set per-element since
    // updateNamedStyle is not supported in googleapis v144)
    const contentRequests = mdConverter.convert(markdownContent);
    if (contentRequests.length > 0) {
        await docs.documents.batchUpdate({
            documentId: docId,
            requestBody: { requests: contentRequests },
        });
    }

    return { id: docId, action };
}

// ─── State management ────────────────────────────────────────────────────────

function loadState() {
    if (existsSync(STATE_FILE)) {
        return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
    return { last_upload: null, uploaded_files: {}, uploaded_docs: {} };
}

function saveState(state) {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    if (!existsSync(CREDENTIALS_FILE)) {
        console.error(`Credentials not found: ${CREDENTIALS_FILE}`);
        process.exit(1);
    }

    const driveAuth = getAuth(['https://www.googleapis.com/auth/drive']);
    const docsAuth = getAuth([
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/documents',
    ]);

    const drive = google.drive({ version: 'v3', auth: driveAuth });
    const docs = google.docs({ version: 'v1', auth: docsAuth });

    // Create folder structure: PR Reviews / markdown / , PR Reviews / docs /
    const rootFolderId = await findOrCreateFolder(drive, SHARED_DRIVE_ID, FOLDER_NAME);
    const mdFolderId = await findOrCreateFolder(drive, rootFolderId, 'markdown');
    const docsFolderId = await findOrCreateFolder(drive, rootFolderId, 'docs');
    console.log(`Using folders: root=${rootFolderId}, md=${mdFolderId}, docs=${docsFolderId}`);

    const state = loadState();
    if (!state.uploaded_files) state.uploaded_files = {};
    if (!state.uploaded_docs) state.uploaded_docs = {};
    const lastUploadTime = state.last_upload ? new Date(state.last_upload).getTime() : 0;

    // Load PR inbox for metadata (branches, author)
    const INBOX_FILE = join(DATA_DIR, 'pr-inbox.json');
    const prMap = new Map();
    if (existsSync(INBOX_FILE)) {
        const inbox = JSON.parse(readFileSync(INBOX_FILE, 'utf-8'));
        for (const pr of inbox.pull_requests || []) {
            prMap.set(`${pr.repo}-${pr.number}.md`, pr);
        }
    }

    let uploaded = 0;
    let skipped = 0;
    const uploadedReviews = [];

    // Upload review files (only modified since last upload)
    if (existsSync(REVIEWS_DIR)) {
        const files = readdirSync(REVIEWS_DIR).filter(f => f.endsWith('.md'));

        for (const file of files) {
            const filePath = join(REVIEWS_DIR, file);
            const mtime = statSync(filePath).mtimeMs;

            if (mtime <= lastUploadTime) {
                skipped++;
                continue;
            }

            const content = readFileSync(filePath, 'utf-8');
            const docName = file.replace(/\.md$/, '');

            // Upload raw .md to markdown/ subfolder
            const mdResult = await upsertFile(drive, mdFolderId, file, content);
            console.log(`  md ${mdResult.action}: ${file} → ${mdResult.id}`);
            state.uploaded_files[file] = { id: mdResult.id, uploaded_at: new Date().toISOString() };

            // Inject PR metadata after H1 line, before existing fields
            const pr = prMap.get(file);
            let docContent = content;
            if (pr) {
                const lines = content.split('\n');
                const h1Idx = lines.findIndex(l => l.startsWith('# '));
                if (h1Idx !== -1) {
                    const metaLines = [
                        `**Author:** ${pr.author}`,
                        `**Branch:** \`${pr.head}\` → \`${pr.base}\``,
                    ];
                    // Insert after H1, before existing metadata
                    lines.splice(h1Idx + 1, 0, ...metaLines);
                    docContent = lines.join('\n');
                }
            }

            // Upload rendered Google Doc to docs/ subfolder
            try {
                const docResult = await upsertGoogleDoc(drive, docs, docsFolderId, docName, docContent);
                console.log(`  doc ${docResult.action}: ${docName} → ${docResult.id}`);
                state.uploaded_docs[file] = { id: docResult.id, uploaded_at: new Date().toISOString() };
            } catch (err) {
                console.error(`  doc FAILED for ${docName}: ${err.message}`);
                // Non-fatal — raw .md is still uploaded
            }

            uploadedReviews.push(file);
            uploaded++;
        }
    }

    // Upload inbox markdown report (raw only, no Doc conversion)
    const inboxMd = join(REPORTS_DIR, 'pr-inbox.md');
    if (existsSync(inboxMd)) {
        const mtime = statSync(inboxMd).mtimeMs;
        if (mtime > lastUploadTime) {
            const content = readFileSync(inboxMd, 'utf-8');
            const result = await upsertFile(drive, mdFolderId, 'pr-inbox.md', content);
            console.log(`  md ${result.action}: pr-inbox.md → ${result.id}`);
            uploaded++;
        }
    }

    // Save state
    state.last_upload = new Date().toISOString();
    state.folder_id = rootFolderId;
    state.md_folder_id = mdFolderId;
    state.docs_folder_id = docsFolderId;
    saveState(state);

    console.log(`Upload complete: ${uploaded} uploaded, ${skipped} unchanged`);

    // Output uploaded review filenames + IDs for downstream scripts (Chat notification)
    if (uploadedReviews.length > 0) {
        const uploadedListFile = join(DATA_DIR, 'last-uploaded-reviews.json');
        const fileIds = {};
        const docIds = {};
        for (const name of uploadedReviews) {
            const mdEntry = state.uploaded_files[name];
            const docEntry = state.uploaded_docs[name];
            if (mdEntry) fileIds[name] = mdEntry.id;
            if (docEntry) docIds[name] = docEntry.id;
        }
        writeFileSync(uploadedListFile, JSON.stringify({
            reviews: uploadedReviews,
            folder_id: rootFolderId,
            file_ids: fileIds,
            doc_ids: docIds,
        }, null, 2));
    }
}

main().catch(err => {
    console.error('Upload failed:', err.message);
    process.exit(1);
});
