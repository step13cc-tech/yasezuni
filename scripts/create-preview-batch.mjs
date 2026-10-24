import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.resolve(repoRoot, "..", "mail-magazine-source", "extracted");
const dataPath = path.join(repoRoot, "src", "_data", "posts.json");
const manifestPath = path.join(repoRoot, "scripts", "preview-batch-images.json");
const count = Number(process.argv.find((arg) => arg.startsWith("--count="))?.split("=")[1] || 30);
const dryRun = process.argv.includes("--dry-run");
const refresh = process.argv.includes("--refresh-existing");

function findMbox(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = findMbox(file);
      if (found) return found;
    } else if (entry.name.toLowerCase().endsWith(".mbox")) return file;
  }
  return null;
}

const mboxPath = findMbox(sourceDir);
if (!mboxPath) throw new Error(`MBOX file was not found under ${sourceDir}`);

const decoders = new Map();
function decoderFor(charset) {
  const key = (charset || "utf-8").toLowerCase().replace(/["']/g, "").trim();
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
  const unfolded = text.replace(/\r?\n[ \t]+/g, " ");
  const headers = new Map();
  for (const line of unfolded.split(/\r?\n/)) {
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
      bytes.push(parseInt(text.slice(index + 1, index + 3), 16)); index += 2;
    } else bytes.push(...Buffer.from(text[index], "latin1"));
  }
  return Buffer.from(bytes);
}

function decodeBody(headers, text) {
  const transfer = (headers.get("content-transfer-encoding") || "7bit").toLowerCase();
  const bytes = transfer.includes("base64")
    ? Buffer.from(text.replace(/\s/g, ""), "base64")
    : transfer.includes("quoted-printable") ? decodeQuotedPrintable(text) : Buffer.from(text, "latin1");
  const type = headers.get("content-type") || "";
  const charset = type.match(/charset\s*=\s*\"?([^\";\s]+)\"?/i)?.[1] || "iso-2022-jp";
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
    dateMs
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

function sanitizeTitle(title) {
  return /^ＨＮ.*「幸せ」$/.test(title) ? "「幸せ」" : title;
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
    const lines = block.lines.map((line) => normalizeText(line)).filter(Boolean);
    const isQuote = lines.some((line) => /^>/.test(line));
    const normalized = isQuote ? lines.join("<br>") : normalizeText(lines.join(" "));
    if (normalized) {
      const escaped = escapeHtml(normalized).replaceAll("&lt;br&gt;", "<br>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="noreferrer noopener" target="_blank">$1</a>');
      html.push(`<p>　${escaped}</p>`);
    }
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

function extractArticleBody(body, title) {
  const lines = body.replace(/\r/g, "").split("\n");
  const headingIndex = lines.findIndex((line) => /^\s*■.*■\s*$/.test(line));
  if (headingIndex < 0) throw new Error("記事見出しが見つかりません。");
  let start = headingIndex + 1;
  while (start < lines.length && (/^\s*$/.test(lines[start]) || /^[━=\-]{5,}\s*$/.test(lines[start]))) start += 1;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    if (/^\s*(?:⇒|★☆|━━━━━━━━|================|＜やせずに幸せモテ女＞|<やせずに幸せモテ女>)/.test(lines[index])) { end = index; break; }
  }
  let content = lines.slice(start, end)
    .filter((line) => !/^\s*(?:配信停止|購読解除|登録解除|配信先変更)\b/.test(line))
    .join("\n")
    .trim();
  const titleText = normalizeText(title);
  const blocks = splitTextBlocks(content);
  const kept = [];
  let separatorBlankLines = 1;
  for (const block of blocks) {
    const normalized = normalizeText(block.lines.join(" "));
    if (!normalized) continue;
    if (normalized === titleText || /^ＨＮ.*「幸せ」$/.test(normalized)) continue;
    if (/@/.test(normalized)) continue;
    if (/^秋さん、(?:メールありがとうございました|末永くお幸せに)/.test(normalized)) continue;
    if (/(?:さん|氏).*(?:歳|才).*(?:リクエスト|ありがとうございました)/.test(normalized)) continue;
    if (kept.length) kept[kept.length - 1].blankLines = separatorBlankLines;
    kept.push({ lines: block.lines, blankLines: 0 });
    separatorBlankLines = block.blankLines;
  }
  content = kept.map((block) => `${block.lines.join("\n")}${"\n".repeat(block.blankLines + 1)}`).join("").trim();
  content = content.replaceAll("秋さん", "相談者さん");
  content = content.replace(/・ＨＮ\s*・年齢\s*・リクエストテーマ/g, "・リクエストテーマ");
  return textToHtml(content);
}

function makeExcerpt(content) {
  const text = content.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

let posts = JSON.parse(fs.readFileSync(dataPath, "utf8"));
if (refresh) posts = posts.filter((post) => !post.image?.startsWith("/assets/uploads/2011/02/mag-next-"));
const existingTitles = new Set(posts.map((post) => compact(post.title)));
const latestTimestamp = Math.max(...posts.map((post) => post._sortTimestamp ?? 0));
const raw = fs.readFileSync(mboxPath).toString("latin1");
const messages = raw.split(/\n(?=From )/)
  .filter((chunk) => chunk.startsWith("From "))
  .map(parseMessage)
  .filter((message) => message && Number.isFinite(message.dateMs));

const candidates = new Map();
for (const message of messages) {
  const subjectTitle = titleFromSubject(message.subject);
  if (!subjectTitle || message.dateMs <= latestTimestamp || /公開相談/.test(compact(message.subject))) continue;
  const title = sanitizeTitle(extractHeading(message.body) || subjectTitle);
  if (existingTitles.has(compact(title))) continue;
  const key = `${compact(title)}\u0000${message.dateMs}`;
  if (!candidates.has(key)) candidates.set(key, { ...message, title });
}

const unique = new Map();
for (const candidate of candidates.values()) {
  const key = compact(candidate.title);
  if (!unique.has(key) || candidate.dateMs < unique.get(key).dateMs) unique.set(key, candidate);
}
const selected = [...unique.values()].sort((a, b) => a.dateMs - b.dateMs).slice(0, count);
if (selected.length !== count) throw new Error(`作成できる候補が${selected.length}件しかありません。`);

console.log(`候補: ${selected.length}件（${new Date(selected[0].dateMs).toISOString().slice(0, 10)} 以降）`);
selected.forEach((candidate, index) => console.log(`${index + 1}. ${candidate.title} — ${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short" }).format(new Date(candidate.dateMs))}`));
if (dryRun) process.exit(0);

const imageManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (imageManifest.length < selected.length) throw new Error("画像マニフェストの枚数が不足しています。");
const imageDir = path.join(repoRoot, "assets", "uploads", "2011", "02");
for (const [index, candidate] of selected.entries()) {
  const image = imageManifest[index];
  const imagePath = path.join(imageDir, image.file);
  if (!fs.existsSync(imagePath)) throw new Error(`画像がありません: ${imagePath}`);
  const content = extractArticleBody(candidate.body, candidate.title);
  posts.push({
    slug: candidate.title,
    title: candidate.title,
    excerpt: makeExcerpt(content),
    image: `/assets/uploads/2011/02/${image.file}`,
    content,
    _sortTimestamp: candidate.dateMs,
    published: false,
    reviewStatus: "preview-wait"
  });
}

posts.sort((a, b) => (b._sortTimestamp ?? -Infinity) - (a._sortTimestamp ?? -Infinity));
fs.writeFileSync(dataPath, `${JSON.stringify(posts, null, 2)}\n`);
console.log(`プレビュー待ちに追加: ${selected.length}件`);
