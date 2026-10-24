import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.resolve(repoRoot, "..", "mail-magazine-source", "extracted");
const dataPath = path.join(repoRoot, "src", "_data", "posts.json");

function findMbox(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = findMbox(fullPath);
      if (found) return found;
    } else if (entry.name.toLowerCase().endsWith(".mbox")) {
      return fullPath;
    }
  }
  return null;
}

const mboxPath = findMbox(sourceDir);
if (!mboxPath) throw new Error(`MBOX file was not found under ${sourceDir}`);
const matchedHomepageLinkLabels = [];
const homepageLinkTitleKeys = new Set(["些細なことで人生が変わる"]);
const articleEndOverrides = new Map([
  ["日本中に悩める女性がいるけど", /ワクワクドキドキの幸せは、あなたにも必ずつかめますからね！！/]
]);

const decoders = new Map();
function decoderFor(charset) {
  const key = (charset || "utf-8").toLowerCase().replace(/[\"']/g, "").trim();
  if (!decoders.has(key)) {
    try { decoders.set(key, new TextDecoder(key)); }
    catch { decoders.set(key, new TextDecoder("utf-8")); }
  }
  return decoders.get(key);
}

function decodeMimeWords(value) {
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]+)\?=/g, (_, charset, kind, data) => {
    if (kind.toUpperCase() === "B") return decoderFor(charset).decode(Buffer.from(data, "base64"));
    const bytes = data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    return decoderFor(charset).decode(Buffer.from(bytes, "latin1"));
  });
}

function parseHeaders(text) {
  const headers = new Map();
  for (const line of text.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index > 0 && !headers.has(line.slice(0, index).toLowerCase())) {
      headers.set(line.slice(0, index).toLowerCase(), line.slice(index + 1).trim());
    }
  }
  return headers;
}

function decodeQuotedPrintable(text) {
  const bytes = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "=" && text[index + 1] === "\r" && text[index + 2] === "\n") { index += 2; continue; }
    if (text[index] === "=" && text[index + 1] === "\n") { index += 1; continue; }
    if (text[index] === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(index + 1, index + 3))) {
      bytes.push(parseInt(text.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(...Buffer.from(text[index], "latin1"));
    }
  }
  return Buffer.from(bytes);
}

function decodeBody(headers, text) {
  const transfer = (headers.get("content-transfer-encoding") || "7bit").toLowerCase();
  const bytes = transfer.includes("base64")
    ? Buffer.from(text.replace(/\s/g, ""), "base64")
    : transfer.includes("quoted-printable")
      ? decodeQuotedPrintable(text)
      : Buffer.from(text, "latin1");
  const charset = (headers.get("content-type") || "").match(/charset\s*=\s*\"?([^\";\s]+)\"?/i)?.[1] || "iso-2022-jp";
  return decoderFor(charset).decode(bytes);
}

function parseMessage(chunk) {
  const separator = chunk.match(/\r?\n\r?\n/);
  if (!separator) return null;
  const headers = parseHeaders(chunk.slice(0, separator.index));
  const dateMs = Date.parse(headers.get("date") || "");
  return {
    subject: decodeMimeWords(headers.get("subject") || ""),
    body: decodeBody(headers, chunk.slice(separator.index + separator[0].length)),
    dateMs: Number.isFinite(dateMs) ? dateMs : null
  };
}

function compact(value) {
  return value.normalize("NFKC").replace(/\s+/g, "").replaceAll("メルマガ", "サイト");
}

function titleFromSubject(subject) {
  const normalized = compact(subject);
  const prefix = normalized.indexOf("-----");
  const suffix = normalized.lastIndexOf("<やせずに幸せモテ女>");
  return prefix >= 0 && suffix >= prefix + 5 ? normalized.slice(prefix + 5, suffix) : "";
}

const japaneseTextChars = "ぁ-んァ-ヶ一-龯々ー！？。、，．：；）】〉》」』〕］｝（【〈《「『〔［｛";
const lineWrapSpace = new RegExp(`(?<=[${japaneseTextChars}]) | (?=[${japaneseTextChars}])`, "g");

function normalizeText(value) {
  return value
    .replaceAll("メルマガ", "サイト")
    .replaceAll("　", "")
    .replace(lineWrapSpace, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function splitTextBlocks(text) {
  const blocks = [];
  let lines = [];
  let blankLines = 0;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (/^\s*$/.test(line)) { blankLines += 1; continue; }
    if (lines.length && blankLines > 0) { blocks.push({ lines, blankLines }); lines = []; }
    lines.push(line);
    blankLines = 0;
  }
  if (lines.length) blocks.push({ lines, blankLines: 0 });
  return blocks;
}

function textToHtml(text) {
  const html = [];
  for (const block of splitTextBlocks(text)) {
    const hasQuoteMarkers = block.lines.some((line) => /^\s*>/.test(line));
    const normalizedLines = block.lines
      .map((line) => hasQuoteMarkers ? line.replace(/^\s*(?:>\s?)+/, "") : line)
      .map((line) => normalizeText(line));
    if (!hasQuoteMarkers) normalizedLines.splice(0, normalizedLines.length, ...normalizedLines.filter(Boolean));
    const normalized = normalizedLines.join(hasQuoteMarkers ? "<br>" : " ");
    if (!normalized) continue;
    const escaped = escapeHtml(normalized).replaceAll("&lt;br&gt;", "<br>");
    html.push(`<p>　${escaped}</p>`);
    const spacerCount = Math.max(0, Math.ceil((block.blankLines + 1) / 2) - 1);
    for (let index = 0; index < spacerCount; index += 1) {
      html.push('<p class="article-spacer" aria-hidden="true">&nbsp;</p>');
    }
  }
  return html.join("\n\n");
}

function findArticleEnd(lines, start) {
  let footerIndex = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    if (/^\s*(?:⇒|★☆|━━━━━━━━|================|＜やせずに幸せモテ女＞\s*$|<やせずに幸せモテ女>\s*$)/.test(lines[index])) {
      footerIndex = index;
      break;
    }
  }
  if (footerIndex === lines.length) return { end: footerIndex, label: null };

  let labelIndex = footerIndex - 1;
  while (labelIndex >= start && /^\s*$/.test(lines[labelIndex])) labelIndex -= 1;
  return { end: footerIndex, label: labelIndex >= start ? labelIndex : null };
}

function extractArticleBody(body, currentContent, currentTitle) {
  const lines = body.replace(/\r/g, "").split("\n");
  const headingIndex = lines.findIndex((line) => /^\s*■.*■\s*$/.test(line));
  if (headingIndex < 0) return null;
  let start = headingIndex + 1;
  while (start < lines.length && (/^\s*$/.test(lines[start]) || /^[━=\-]{5,}\s*$/.test(lines[start]))) start += 1;

  const overrideEnd = articleEndOverrides.get(currentTitle);
  if (overrideEnd) {
    const bodyEnd = lines.findIndex((line, index) => index >= start && overrideEnd.test(line));
    if (bodyEnd >= 0) return textToHtml(lines.slice(start, bodyEnd + 1).join("\n").trim());
  }

  const endInfo = findArticleEnd(lines, start);
  const defaultHtml = textToHtml(lines.slice(start, endInfo.end).join("\n").trim());
  if (endInfo.label === null) return defaultHtml;

  const labelKey = compact(lines[endInfo.label]);
  const candidateHtml = textToHtml(lines.slice(start, endInfo.label).join("\n").trim());
  const isPlausibleHomepageLinkTitle = !/[：:＠@]/.test(labelKey) && !/^https?:/i.test(labelKey);
  if (isPlausibleHomepageLinkTitle && homepageLinkTitleKeys.has(labelKey)) {
    matchedHomepageLinkLabels.push({ title: currentTitle || "", label: normalizeText(lines[endInfo.label]), reason: "known-homepage-link-title" });
    return candidateHtml;
  }
  if (isPlausibleHomepageLinkTitle && currentContent) {
    const currentKeys = contentKeys(parseParagraphs(currentContent));
    const candidateKeys = contentKeys(parseParagraphs(candidateHtml));
    if (JSON.stringify(currentKeys) === JSON.stringify(candidateKeys)) {
      matchedHomepageLinkLabels.push({ title: currentTitle || "", label: normalizeText(lines[endInfo.label]), reason: "matched-current-article" });
      return candidateHtml;
    }
  }
  return defaultHtml;
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function parseParagraphs(content) {
  const paragraphs = [];
  for (const match of content.matchAll(/<p([^>]*)>([\s\S]*?)<\/p>/g)) {
    const attributes = match[1];
    const inner = decodeHtml(match[2].replace(/<br\s*\/?>(\s*)/gi, " ").replace(/<[^>]+>/g, ""));
    paragraphs.push({
      spacer: /article-spacer/.test(attributes),
      raw: match[0],
      text: inner
    });
  }
  return paragraphs;
}

function flattenedParagraphText(paragraphs) {
  return compact(paragraphs.filter((paragraph) => !paragraph.spacer).map((paragraph) => paragraph.text).join(""));
}

function structuralSignature(paragraphs) {
  return paragraphs.map((paragraph) => paragraph.spacer ? "S" : "P").join("");
}

function normalizeExistingQuoteMarkers(content) {
  return content.replace(/<p([^>]*)>([\s\S]*?)<\/p>/g, (raw, attributes, inner) => {
    if (!/(?:^|<br\s*\/?>)\s*(?:&gt;|>)/i.test(inner)) return raw;
    const parts = inner.split(/<br\s*\/?>/i);
    let changed = false;
    const normalized = parts.map((part) => {
      if (/^<br/i.test(part)) return part;
      const next = part.replace(/^\s*(?:(?:&gt;|>)\s?)+/, "");
      if (next !== part) changed = true;
      return next;
    }).join("<br>");
    return changed ? `<p${attributes}>${normalized}</p>` : raw;
  });
}

function contentKeys(paragraphs) {
  return paragraphs.filter((paragraph) => !paragraph.spacer).map((paragraph) => compact(paragraph.text));
}

function trimKnownHomepageLinkLabel(content, expectedParagraphs, linkTitleKeys) {
  const currentParagraphs = parseParagraphs(content);
  const currentKeys = contentKeys(currentParagraphs);
  const expectedKeys = contentKeys(expectedParagraphs);
  if (currentKeys.length !== expectedKeys.length + 1) return { content, changed: false };
  if (currentKeys[currentKeys.length - 1] === "" || !linkTitleKeys.has(currentKeys[currentKeys.length - 1])) {
    return { content, changed: false };
  }
  if (expectedKeys.some((key, index) => key !== currentKeys[index])) return { content, changed: false };
  const lastContentIndex = currentParagraphs.map((paragraph, index) => ({ paragraph, index }))
    .filter(({ paragraph }) => !paragraph.spacer).at(-1)?.index;
  if (lastContentIndex === undefined) return { content, changed: false };
  return {
    content: currentParagraphs.slice(0, lastContentIndex).map((paragraph) => paragraph.raw).join("\n\n"),
    changed: true
  };
}

function safeSpacerInsertions(currentParagraphs, expectedParagraphs) {
  const currentContent = currentParagraphs
    .map((paragraph, index) => ({ paragraph, index }))
    .filter(({ paragraph }) => !paragraph.spacer);
  const expectedContent = expectedParagraphs
    .map((paragraph, index) => ({ paragraph, index }))
    .filter(({ paragraph }) => !paragraph.spacer);
  const currentKeys = currentContent.map(({ paragraph }) => compact(paragraph.text));
  const expectedKeys = expectedContent.map(({ paragraph }) => compact(paragraph.text));
  const expectedToCurrent = new Map();
  let currentSearchStart = 0;
  for (let expectedIndex = 0; expectedIndex < expectedKeys.length; expectedIndex += 1) {
    const currentIndex = currentKeys.indexOf(expectedKeys[expectedIndex], currentSearchStart);
    if (currentIndex < 0) continue;
    expectedToCurrent.set(expectedIndex, currentIndex);
    currentSearchStart = currentIndex + 1;
  }
  const insertAfter = new Set();
  for (let index = 0; index < expectedParagraphs.length; index += 1) {
    if (!expectedParagraphs[index].spacer) continue;
    let previous = index - 1;
    while (previous >= 0 && expectedParagraphs[previous].spacer) previous -= 1;
    let next = index + 1;
    while (next < expectedParagraphs.length && expectedParagraphs[next].spacer) next += 1;
    if (previous < 0 || next >= expectedParagraphs.length) continue;
    const previousContentIndex = expectedContent.findIndex(({ index: contentIndex }) => contentIndex === previous);
    const nextContentIndex = expectedContent.findIndex(({ index: contentIndex }) => contentIndex === next);
    const previousCurrentIndex = expectedToCurrent.get(previousContentIndex);
    const nextCurrentIndex = expectedToCurrent.get(nextContentIndex);
    if (previousCurrentIndex === undefined || nextCurrentIndex === undefined) continue;
    if (nextCurrentIndex === previousCurrentIndex + 1) {
      const previousFullIndex = currentContent[previousCurrentIndex].index;
      const nextFullIndex = currentContent[nextCurrentIndex].index;
      const alreadyPresent = currentParagraphs.slice(previousFullIndex + 1, nextFullIndex).some((paragraph) => paragraph.spacer);
      if (!alreadyPresent) insertAfter.add(previousCurrentIndex);
    }
  }
  return { insertAfter, matchedParagraphs: expectedToCurrent.size };
}

const posts = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const shouldFix = process.argv.includes("--fix");
const raw = fs.readFileSync(mboxPath).toString("latin1");
const messages = raw.split(/\n(?=From )/)
  .filter((chunk) => chunk.startsWith("From "))
  .map(parseMessage)
  .filter((message) => message?.dateMs !== null)
  .filter((message) => !/公開相談/.test(compact(message.subject)));
const ruleChanges = [];

function findMessage(post) {
  const titleKey = compact(post.title);
  const dated = messages.filter((message) => message.dateMs === post._sortTimestamp);
  const titleMatches = messages.filter((message) => titleFromSubject(message.subject) === titleKey);
  const pool = dated.length ? dated : titleMatches;
  if (!pool.length) return null;
  const matchingTitle = pool.find((message) => titleFromSubject(message.subject) === titleKey);
  return matchingTitle || pool[0];
}

const published = posts.filter((post) => post.reviewStatus === "published" || post.published === true);
const rows = [];
for (const post of published) {
  const message = findMessage(post);
  if (!message) {
    rows.push({ title: post.title, issue: "unmatched" });
    continue;
  }
  const quoteNormalizedContent = normalizeExistingQuoteMarkers(post.content || "");
  const expected = extractArticleBody(message.body, quoteNormalizedContent, post.title);
  if (!expected) {
    rows.push({ title: post.title, issue: "source-body-unparsed" });
    continue;
  }
  const expectedParagraphs = parseParagraphs(expected);
  const trimmed = trimKnownHomepageLinkLabel(quoteNormalizedContent, expectedParagraphs, homepageLinkTitleKeys);
  const currentContent = trimmed.content;
  if (quoteNormalizedContent !== (post.content || "") || trimmed.changed) {
    ruleChanges.push({ title: post.title, quoteMarkersRemoved: quoteNormalizedContent !== (post.content || ""), homepageLinkLabelRemoved: trimmed.changed });
    if (shouldFix) post.content = currentContent;
  }
  const currentParagraphs = parseParagraphs(currentContent);
  const textSame = flattenedParagraphText(currentParagraphs) === flattenedParagraphText(expectedParagraphs);
  const signatureSame = structuralSignature(currentParagraphs) === structuralSignature(expectedParagraphs);
  const spacerPlan = safeSpacerInsertions(currentParagraphs, expectedParagraphs);
  if (!textSame) {
    const row = {
      title: post.title,
      issue: "text-different",
      current: currentParagraphs.length,
      expected: expectedParagraphs.length,
      matchedParagraphs: spacerPlan.matchedParagraphs,
      safeSpacers: spacerPlan.insertAfter.size
    };
    if (shouldFix && spacerPlan.insertAfter.size > 0 && !currentParagraphs.some((paragraph) => paragraph.spacer)) {
      let contentIndex = 0;
      const repaired = [];
      for (const paragraph of currentParagraphs) {
        repaired.push(paragraph.raw);
        if (!paragraph.spacer && spacerPlan.insertAfter.has(contentIndex)) {
          repaired.push('<p class="article-spacer" aria-hidden="true">&nbsp;</p>');
        }
        if (!paragraph.spacer) contentIndex += 1;
      }
      post.content = repaired.join("\n\n");
      row.fixed = true;
    }
    if (process.env.AUDIT_TITLE === post.title) {
      row.currentParagraphs = currentParagraphs;
      row.expectedParagraphs = expectedParagraphs;
    }
    rows.push(row);
  }
  else if (!signatureSame) {
    const currentTextParagraphs = currentParagraphs.filter((paragraph) => !paragraph.spacer).map((paragraph) => compact(paragraph.text));
    const expectedTextParagraphs = expectedParagraphs.filter((paragraph) => !paragraph.spacer).map((paragraph) => compact(paragraph.text));
    const row = {
      title: post.title,
      issue: "structure-different",
      current: structuralSignature(currentParagraphs),
      expected: structuralSignature(expectedParagraphs),
      currentP: currentTextParagraphs.length,
      expectedP: expectedTextParagraphs.length,
      sameParagraphs: JSON.stringify(currentTextParagraphs) === JSON.stringify(expectedTextParagraphs)
    };
    if (shouldFix && row.sameParagraphs) {
      const currentContentParagraphs = currentParagraphs.filter((paragraph) => !paragraph.spacer);
      let currentIndex = 0;
      const repaired = expectedParagraphs.map((paragraph) => {
        if (paragraph.spacer) return '<p class="article-spacer" aria-hidden="true">&nbsp;</p>';
        return currentContentParagraphs[currentIndex++].raw;
      });
      post.content = repaired.join("\n\n");
      row.fixed = true;
    }
    if (process.env.AUDIT_TITLE === post.title) {
      row.currentParagraphs = currentParagraphs;
      row.expectedParagraphs = expectedParagraphs;
    }
    rows.push(row);
  }
}

if (shouldFix) {
  const boundaryTitles = new Set(["希望と絶望", "いつもダメな男と付き合っちゃう", "本物の愛は？", "約束破りの対処法"]);
  for (const post of published) {
    if (!boundaryTitles.has(post.title)) continue;
    const message = findMessage(post);
    const expected = message ? extractArticleBody(message.body, post.content || "", post.title) : null;
    if (expected) {
      post.content = expected;
      const row = rows.find((item) => item.title === post.title && item.issue === "structure-different");
      if (row) row.fixed = true;
    }
  }
  fs.writeFileSync(dataPath, `${JSON.stringify(posts, null, 2)}\n`, "utf8");
}

const counts = rows.reduce((result, row) => { result[row.issue] = (result[row.issue] || 0) + 1; return result; }, {});
console.log(JSON.stringify({ published: published.length, messages: messages.length, issues: rows.length, fixed: rows.filter((row) => row.fixed).length, ruleChanges: ruleChanges.length, ruleChangesDetail: ruleChanges, homepageLinkLabelsRemovedFromSource: matchedHomepageLinkLabels.length, homepageLinkLabelsDetail: matchedHomepageLinkLabels, counts, rows }, null, 2));
