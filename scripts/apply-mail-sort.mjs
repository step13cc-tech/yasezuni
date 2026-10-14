import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(repoRoot, "src", "_data");
const externalSourceDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(repoRoot, "..", "mail-magazine-source", "extracted");

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

const mboxPath = findMbox(externalSourceDir);
if (!mboxPath) throw new Error(`MBOX file was not found under ${externalSourceDir}`);

const decoderCache = new Map();
function decoderFor(charset) {
  const key = (charset || "utf-8").toLowerCase().replace(/[\"']/g, "").trim();
  if (!decoderCache.has(key)) {
    try { decoderCache.set(key, new TextDecoder(key)); }
    catch { decoderCache.set(key, new TextDecoder("utf-8")); }
  }
  return decoderCache.get(key);
}

function decodeMimeWords(value) {
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]+)\?=/g, (_, charset, kind, data) => {
    let bytes;
    if (kind.toUpperCase() === "B") bytes = Buffer.from(data, "base64");
    else {
      const q = data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      bytes = Buffer.from(q, "latin1");
    }
    return decoderFor(charset).decode(bytes);
  });
}

function parseHeaders(text) {
  const unfolded = text.replace(/\r?\n[ \t]+/g, " ");
  const headers = new Map();
  for (const line of unfolded.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).toLowerCase();
    if (!headers.has(key)) headers.set(key, line.slice(index + 1).trim());
  }
  return headers;
}

function decodeQuotedPrintable(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "=" && text[i + 1] === "\r" && text[i + 2] === "\n") { i += 2; continue; }
    if (text[i] === "=" && text[i + 1] === "\n") { i += 1; continue; }
    if (text[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const characterBytes = Buffer.from(text[i], "latin1");
      for (const byte of characterBytes) bytes.push(byte);
    }
  }
  return Buffer.from(bytes);
}

function decodeBody(headers, bodyText) {
  const transfer = (headers.get("content-transfer-encoding") || "7bit").toLowerCase();
  let bytes;
  if (transfer.includes("base64")) bytes = Buffer.from(bodyText.replace(/\s/g, ""), "base64");
  else if (transfer.includes("quoted-printable")) bytes = decodeQuotedPrintable(bodyText);
  else bytes = Buffer.from(bodyText, "latin1");
  const contentType = headers.get("content-type") || "";
  const charsetMatch = contentType.match(/charset\s*=\s*\"?([^\";\s]+)\"?/i);
  return decoderFor(charsetMatch ? charsetMatch[1] : "iso-2022-jp").decode(bytes);
}

function parseMessage(chunk) {
  const separator = chunk.match(/\r?\n\r?\n/);
  if (!separator) return null;
  const headers = parseHeaders(chunk.slice(0, separator.index));
  const body = decodeBody(headers, chunk.slice(separator.index + separator[0].length));
  const dateText = headers.get("date") || "";
  const dateMs = Date.parse(dateText);
  return {
    subject: decodeMimeWords(headers.get("subject") || ""),
    body,
    dateText,
    dateMs: Number.isFinite(dateMs) ? dateMs : null
  };
}

function compact(value) {
  return value.normalize("NFKC").replace(/\s+/g, "").replaceAll("メルマガ", "サイト");
}

function htmlToText(value) {
  return value.replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'").replace(/&quot;/gi, '"');
}

function subjectTitle(subject) {
  const normalized = compact(subject);
  const prefix = normalized.indexOf("-----");
  const suffix = normalized.lastIndexOf("<やせずに幸せモテ女>");
  if (prefix < 0 || suffix < prefix + 5) return "";
  return normalized.slice(prefix + 5, suffix);
}

function isExcluded(subject) {
  return /(?:メール|メルマガ)公開相談/.test(compact(subject));
}

function bodySnippets(post) {
  const normalized = compact(htmlToText(post.content || ""));
  return [0, 5, 15, 30, 50, 80]
    .map((start) => normalized.slice(start, start + 55))
    .filter((snippet) => snippet.length >= 25);
}

const posts = JSON.parse(fs.readFileSync(path.join(dataDir, "posts.json"), "utf8"));
const raw = fs.readFileSync(mboxPath).toString("latin1");
const messages = raw.split(/\n(?=From )/)
  .filter((chunk) => chunk.startsWith("From "))
  .map(parseMessage)
  .filter((message) => message && message.dateMs !== null)
  .map((message) => ({
    ...message,
    titleKey: subjectTitle(message.subject),
    normalizedBody: compact(message.body)
  }))
  .filter((message) => !isExcluded(message.subject));

function findMailForPost(post) {
  const titleKey = compact(post.title);
  const snippets = bodySnippets(post);
  const titleMatches = messages.filter((message) => message.titleKey === titleKey);
  const titleAndBodyMatches = titleMatches.filter((message) => snippets.some((snippet) => message.normalizedBody.includes(snippet)));
  const candidates = titleAndBodyMatches.length ? titleAndBodyMatches : titleMatches;
  if (candidates.length) return [...candidates].sort((a, b) => a.dateMs - b.dateMs)[0];

  const bodyMatches = messages.filter((message) => snippets.some((snippet) => message.normalizedBody.includes(snippet)));
  if (bodyMatches.length) return [...bodyMatches].sort((a, b) => a.dateMs - b.dateMs)[0];
  return null;
}

const enriched = posts.map((post, originalIndex) => {
  const mail = findMailForPost(post);
  return {
    ...post,
    _sortTimestamp: mail?.dateMs ?? null,
    _originalIndex: originalIndex
  };
});

enriched.sort((a, b) => {
  if (a._sortTimestamp === null && b._sortTimestamp === null) return a._originalIndex - b._originalIndex;
  if (a._sortTimestamp === null) return 1;
  if (b._sortTimestamp === null) return -1;
  return b._sortTimestamp - a._sortTimestamp || a._originalIndex - b._originalIndex;
});

const clean = (post) => {
  const { _originalIndex, ...value } = post;
  return value;
};
const sortedPosts = enriched.map(clean);
const homePosts = sortedPosts.slice(0, 10);
const postPages = [];
for (let index = 10; index < sortedPosts.length; index += 10) postPages.push(sortedPosts.slice(index, index + 10));

const writeJson = (name, value) => fs.writeFileSync(path.join(dataDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
writeJson("posts.json", sortedPosts);
writeJson("homePosts.json", homePosts);
writeJson("postPages.json", postPages);

const unresolved = sortedPosts.filter((post) => post._sortTimestamp === null).map((post) => post.title);
console.log(`Mail dates applied: ${sortedPosts.length} posts, ${sortedPosts.length - unresolved.length} matched, ${unresolved.length} unresolved.`);
if (unresolved.length) console.log(`Unresolved titles: ${unresolved.join(" / ")}`);
console.log(`MBOX messages considered: ${messages.length}; excluded consultation messages are not used.`);
