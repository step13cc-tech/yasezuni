import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.resolve(repoRoot, "..", "mail-magazine-source", "extracted");
const dataPath = path.join(repoRoot, "src", "_data", "posts.json");
const count = Number(process.argv[2] || 10);

function findMbox(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { const found = findMbox(file); if (found) return found; }
    else if (entry.name.toLowerCase().endsWith(".mbox")) return file;
  }
  return null;
}

const mboxPath = findMbox(sourceDir);
if (!mboxPath) throw new Error(`MBOX file was not found under ${sourceDir}`);

const decoders = new Map();
function decoderFor(charset) {
  const key = (charset || "utf-8").toLowerCase().replace(/[\"']/g, "").trim();
  if (!decoders.has(key)) {
    try { decoders.set(key, new TextDecoder(key)); } catch { decoders.set(key, new TextDecoder("utf-8")); }
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
    if (index > 0 && !headers.has(line.slice(0, index).toLowerCase())) headers.set(line.slice(0, index).toLowerCase(), line.slice(index + 1).trim());
  }
  return headers;
}
function decodeQuotedPrintable(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "=" && text[i + 1] === "\r" && text[i + 2] === "\n") { i += 2; continue; }
    if (text[i] === "=" && text[i + 1] === "\n") { i += 1; continue; }
    if (text[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) { bytes.push(parseInt(text.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...Buffer.from(text[i], "latin1"));
  }
  return Buffer.from(bytes);
}
function decodeBody(headers, text) {
  const transfer = (headers.get("content-transfer-encoding") || "7bit").toLowerCase();
  const bytes = transfer.includes("base64") ? Buffer.from(text.replace(/\s/g, ""), "base64") : transfer.includes("quoted-printable") ? decodeQuotedPrintable(text) : Buffer.from(text, "latin1");
  const charset = (headers.get("content-type") || "").match(/charset\s*=\s*\"?([^\";\s]+)\"?/i)?.[1] || "iso-2022-jp";
  return decoderFor(charset).decode(bytes);
}
function parseMessage(chunk) {
  const separator = chunk.match(/\r?\n\r?\n/);
  if (!separator) return null;
  const headers = parseHeaders(chunk.slice(0, separator.index));
  const dateMs = Date.parse(headers.get("date") || "");
  return { subject: decodeMimeWords(headers.get("subject") || ""), body: decodeBody(headers, chunk.slice(separator.index + separator[0].length)), dateMs };
}
function compact(value) { return value.normalize("NFKC").replace(/\s+/g, "").replaceAll("メルマガ", "サイト"); }
function titleFromSubject(subject) {
  const normalized = compact(subject);
  const prefix = normalized.indexOf("-----");
  const suffix = normalized.lastIndexOf("<やせずに幸せモテ女>");
  return prefix >= 0 && suffix >= prefix + 5 ? normalized.slice(prefix + 5, suffix) : "";
}
function normalizeText(value) {
  const japaneseTextChars = "ぁ-んァ-ヶ一-龯々ー！？。、，．：；）】〉》」』〕］｝（【〈《「『〔［｛";
  const lineWrapSpace = new RegExp(`(?<=[${japaneseTextChars}]) | (?=[${japaneseTextChars}])`, "g");
  return value.replaceAll("メルマガ", "サイト").replaceAll("　", "").replace(lineWrapSpace, "").replace(/[ \t]+/g, " ").trim();
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
    const normalized = normalizeText(block.lines.join(" "));
    if (!normalized) continue;
    const escaped = escapeHtml(normalized).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="noreferrer noopener" target="_blank">$1</a>');
    html.push(`<p>　${escaped}</p>`);
    const spacerCount = Math.max(0, Math.ceil((block.blankLines + 1) / 2) - 1);
    for (let spacer = 0; spacer < spacerCount; spacer += 1) {
      html.push('<p class="article-spacer" aria-hidden="true">&nbsp;</p>');
    }
  }
  return html.join("\n\n");
}
function extractHeading(body) {
  const line = body.replace(/\r/g, "").split("\n").find((value) => /^\s*■.*■\s*$/.test(value));
  return line ? normalizeText(line.replace(/^\s*■\s*/, "").replace(/\s*■\s*$/, "")) : "";
}
function extractArticleBody(body) {
  const lines = body.replace(/\r/g, "").split("\n");
  const headingIndex = lines.findIndex((line) => /^\s*■.*■\s*$/.test(line));
  if (headingIndex < 0) throw new Error("記事見出しが見つかりません。");
  let start = headingIndex + 1;
  while (start < lines.length && (/^\s*$/.test(lines[start]) || /^[━=\-]{5,}\s*$/.test(lines[start]))) start += 1;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    if (/^\s*(?:⇒|★☆|━━━━━━━━|================|＜やせずに幸せモテ女＞|<やせずに幸せモテ女>)/.test(lines[index])) { end = index; break; }
  }
  const content = lines.slice(start, end).join("\n").trim();
  return textToHtml(content);
}
function makeExcerpt(content) {
  const text = content.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

const imageByTitle = new Map([
  ["直接向き合う", "mag-direct-conversation.jpg"],
  ["嘘", "mag-honesty.jpg"],
  ["あたりまえって難しい", "mag-everyday-life.jpg"],
  ["なんとなぁーくが最高です。", "mag-relaxed-smile.jpg"],
  ["「なんで??」", "mag-thinking-question.jpg"],
  ["「なんで？？」", "mag-thinking-question.jpg"],
  ["恋愛は相手があることなので", "mag-couple-connection.jpg"],
  ["「待ってて」や「待っているよ」", "mag-waiting.jpg"],
  ["「彼氏ができない100の理由」", "mag-choice-notebook.jpg"],
  ["「彼氏ができない100の理由", "mag-choice-notebook.jpg"],
  ["男らしいと勘違いさせる男", "mag-confident-man.jpg"],
  ["いろんな場合においていい男の条件", "mag-supportive-friends.jpg"]
]);

const posts = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const existingTitles = new Set(posts.map((post) => compact(post.title)));
const latestTimestamp = Math.max(...posts.map((post) => post._sortTimestamp ?? 0));
const raw = fs.readFileSync(mboxPath).toString("latin1");
const messages = raw.split(/\n(?=From )/).filter((chunk) => chunk.startsWith("From ")).map(parseMessage).filter((message) => message && Number.isFinite(message.dateMs));
const candidates = new Map();
for (const message of messages) {
  const subjectTitle = titleFromSubject(message.subject);
  if (!subjectTitle || message.dateMs <= latestTimestamp || /公開相談/.test(compact(message.subject)) || existingTitles.has(compact(subjectTitle))) continue;
  const title = extractHeading(message.body) || subjectTitle;
  if (!imageByTitle.has(title)) continue;
  const key = `${compact(title)}\u0000${message.dateMs}`;
  if (!candidates.has(key)) candidates.set(key, { ...message, title });
}
const unique = new Map();
for (const candidate of candidates.values()) {
  const key = compact(candidate.title);
  if (!unique.has(key) || candidate.dateMs < unique.get(key).dateMs) unique.set(key, candidate);
}
const selected = [...unique.values()].sort((a, b) => a.dateMs - b.dateMs).slice(0, count);
if (selected.length !== count) {
  console.log([...unique.values()].sort((a, b) => a.dateMs - b.dateMs).slice(0, 20).map((item) => item.title).join(" / "));
  throw new Error(`作成できる候補が${selected.length}件しかありません。`);
}

for (const candidate of selected) {
  const imageName = imageByTitle.get(candidate.title);
  const imagePath = path.join(repoRoot, "assets", "uploads", "2011", "01", imageName);
  if (!fs.existsSync(imagePath)) throw new Error(`画像がありません: ${imagePath}`);
  const content = extractArticleBody(candidate.body);
  posts.push({
    slug: candidate.title,
    title: candidate.title,
    excerpt: makeExcerpt(content),
    image: `/assets/uploads/2011/01/${imageName}`,
    content,
    _sortTimestamp: candidate.dateMs,
    published: false,
    reviewStatus: "preview-wait"
  });
}

posts.sort((a, b) => (b._sortTimestamp ?? -Infinity) - (a._sortTimestamp ?? -Infinity));
fs.writeFileSync(dataPath, `${JSON.stringify(posts, null, 2)}\n`);
console.log(`プレビュー待ちに追加: ${selected.length}件`);
for (const post of selected) console.log(`- ${post.title}`);
