// ---------------------------------------------------------------------------
// Markdown <-> Google Docs conversion utilities
// ---------------------------------------------------------------------------

export class MarkdownToDocsConverter {
  convert(markdown) {
    if (!markdown) return [];
    const lines = markdown.split("\n");
    const requests = [];
    let index = 1; // Docs content starts at index 1

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const { text, style, isBullet, isNumbered, runs } = this.parseLine(line);

      if (text === null) continue;

      const insertText = text + "\n";
      requests.push({
        insertText: {
          location: { index },
          text: insertText,
        },
      });

      // Apply paragraph style
      if (style) {
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: index, endIndex: index + insertText.length },
            paragraphStyle: { namedStyleType: style },
            fields: "namedStyleType",
          },
        });
      }

      // Apply bullet/numbered list
      if (isBullet || isNumbered) {
        requests.push({
          createParagraphBullets: {
            range: { startIndex: index, endIndex: index + insertText.length },
            bulletPreset: isNumbered
              ? "NUMBERED_DECIMAL_NESTED"
              : "BULLET_DISC_CIRCLE_SQUARE",
          },
        });
      }

      // Apply text formatting runs (bold, italic, links)
      if (runs && runs.length > 0) {
        for (const run of runs) {
          const startIdx = index + run.start;
          const endIdx = index + run.end;
          if (run.bold) {
            requests.push({
              updateTextStyle: {
                range: { startIndex: startIdx, endIndex: endIdx },
                textStyle: { bold: true },
                fields: "bold",
              },
            });
          }
          if (run.italic) {
            requests.push({
              updateTextStyle: {
                range: { startIndex: startIdx, endIndex: endIdx },
                textStyle: { italic: true },
                fields: "italic",
              },
            });
          }
          if (run.link) {
            requests.push({
              updateTextStyle: {
                range: { startIndex: startIdx, endIndex: endIdx },
                textStyle: { link: { url: run.link } },
                fields: "link",
              },
            });
          }
        }
      }

      index += insertText.length;
    }

    return requests;
  }

  parseLine(line) {
    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const rawText = headingMatch[2];
      const { plainText, runs } = this.parseInlineFormatting(rawText);
      return {
        text: plainText,
        style: `HEADING_${level}`,
        isBullet: false,
        isNumbered: false,
        runs,
      };
    }

    // Bullet lists
    const bulletMatch = line.match(/^[\-\*]\s+(.+)/);
    if (bulletMatch) {
      const { plainText, runs } = this.parseInlineFormatting(bulletMatch[1]);
      return {
        text: plainText,
        style: null,
        isBullet: true,
        isNumbered: false,
        runs,
      };
    }

    // Numbered lists
    const numberedMatch = line.match(/^\d+\.\s+(.+)/);
    if (numberedMatch) {
      const { plainText, runs } = this.parseInlineFormatting(numberedMatch[1]);
      return {
        text: plainText,
        style: null,
        isBullet: false,
        isNumbered: true,
        runs,
      };
    }

    // Empty lines
    if (line.trim() === "") {
      return { text: "", style: "NORMAL_TEXT", isBullet: false, isNumbered: false, runs: null };
    }

    // Normal paragraph
    const { plainText, runs } = this.parseInlineFormatting(line);
    return {
      text: plainText,
      style: "NORMAL_TEXT",
      isBullet: false,
      isNumbered: false,
      runs,
    };
  }

  parseInlineFormatting(text) {
    const runs = [];
    let plainText = "";
    let i = 0;
    const src = text;

    while (i < src.length) {
      // Links: [text](url)
      const linkMatch = src.slice(i).match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        const start = plainText.length;
        plainText += linkMatch[1];
        runs.push({ start, end: plainText.length, link: linkMatch[2] });
        i += linkMatch[0].length;
        continue;
      }

      // Bold+Italic: ***text*** or ___text___
      const boldItalicMatch = src.slice(i).match(/^(\*{3}|_{3})(.+?)\1/);
      if (boldItalicMatch) {
        const start = plainText.length;
        plainText += boldItalicMatch[2];
        runs.push({ start, end: plainText.length, bold: true, italic: true });
        i += boldItalicMatch[0].length;
        continue;
      }

      // Bold: **text** or __text__
      const boldMatch = src.slice(i).match(/^(\*{2}|_{2})(.+?)\1/);
      if (boldMatch) {
        const start = plainText.length;
        plainText += boldMatch[2];
        runs.push({ start, end: plainText.length, bold: true });
        i += boldMatch[0].length;
        continue;
      }

      // Italic: *text* or _text_
      const italicMatch = src.slice(i).match(/^(\*|_)(.+?)\1/);
      if (italicMatch) {
        const start = plainText.length;
        plainText += italicMatch[2];
        runs.push({ start, end: plainText.length, italic: true });
        i += italicMatch[0].length;
        continue;
      }

      plainText += src[i];
      i++;
    }

    return { plainText, runs };
  }
}

export class DocsToMarkdownConverter {
  convert(document) {
    if (!document || !document.body || !document.body.content) return "";
    const elements = document.body.content;
    const lines = [];
    const listInfo = document.lists || {};

    for (const element of elements) {
      if (!element.paragraph) continue;

      const para = element.paragraph;
      const style = para.paragraphStyle?.namedStyleType || "NORMAL_TEXT";
      const bullet = para.bullet;

      let lineText = this.extractParagraphText(para);

      // Apply heading prefix
      const headingMatch = style.match(/^HEADING_(\d)$/);
      if (headingMatch) {
        const level = parseInt(headingMatch[1]);
        lineText = "#".repeat(level) + " " + lineText;
      } else if (bullet) {
        const listId = bullet.listId;
        const nestingLevel = bullet.nestingLevel || 0;
        const indent = "  ".repeat(nestingLevel);
        const listProps = listInfo[listId];
        const glyphType =
          listProps?.listProperties?.nestingLevels?.[nestingLevel]?.glyphType;
        if (
          glyphType &&
          (glyphType.includes("DECIMAL") || glyphType.includes("ALPHA"))
        ) {
          lineText = indent + "1. " + lineText;
        } else {
          lineText = indent + "- " + lineText;
        }
      }

      lines.push(lineText);
    }

    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  extractParagraphText(para) {
    if (!para.elements) return "";
    let text = "";

    for (const elem of para.elements) {
      if (!elem.textRun) continue;
      let content = elem.textRun.content || "";
      // Remove trailing newline that Docs API adds per paragraph
      content = content.replace(/\n$/, "");

      const ts = elem.textRun.textStyle || {};
      const isBold = ts.bold === true;
      const isItalic = ts.italic === true;
      const link = ts.link?.url;

      if (link) {
        content = `[${content}](${link})`;
      } else if (isBold && isItalic) {
        content = `***${content}***`;
      } else if (isBold) {
        content = `**${content}**`;
      } else if (isItalic) {
        content = `*${content}*`;
      }

      text += content;
    }

    return text;
  }
}
