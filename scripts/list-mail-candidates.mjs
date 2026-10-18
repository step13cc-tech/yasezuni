import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.resolve(repoRoot, "..", "mail-magazine-source", "extracted");
const dataPath = path.join(repoRoot, "src", "_data", "posts.json");

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
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "=" && text[i + 1] === "\r" && text[i + 2] === "\n") { i += 2; continue; }
    if (text[i] === "=" && text[i + 1] === "\n") { i += 1; continue; }
    if (text[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16)); i += 2;
    } else bytes.push(...Buffer.from(text[i], "latin1"));
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
  const body = decodeBody(headers, chunk.slice(separator.index + separator[0].length));
  const dateMs = Date.parse(headers.get("date") || "");
  return { subject: decodeMimeWords(headers.get("subject") || ""), body, dateMs };
}

function compact(value) {
  return value.normalize("NFKC").replace(/\s+/g, "").replaceAll("メルマガ", "サイト");
}

function titleFromSubject(subject) {
  const normalized = compact(subject);
  const prefix = normalized.indexOf("-----");
  const suffix = normalized.lastIndexOf("<やせずに幸せモテ女>");
  if (prefix < 0 || suffix < prefix + 5) return "";
  return normalized.slice(prefix + 5, suffix);
}

function excluded(subject) {
  return /公開相談/.test(compact(subject));
}

const existing = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const existingTitles = new Set(existing.map((post) => compact(post.title)));
const raw = fs.readFileSync(mboxPath).toString("latin1");
const messages = raw.split(/\n(?=From )/)
  .filter((chunk) => chunk.startsWith("From "))
  .map(parseMessage)
  .filter((message) => message && Number.isFinite(message.dateMs));

const candidates = new Map();
for (const message of messages) {
  const title = titleFromSubject(message.subject);
  if (!title || excluded(message.subject) || existingTitles.has(compact(title))) continue;
  const key = `${title}\u0000${message.dateMs}`;
  if (!candidates.has(key)) candidates.set(key, { title, dateMs: message.dateMs, subject: message.subject });
}

const uniqueByTitle = new Map();
for (const candidate of candidates.values()) {
  const previous = uniqueByTitle.get(compact(candidate.title));
  if (!previous || candidate.dateMs < previous.dateMs) uniqueByTitle.set(compact(candidate.title), candidate);
}

const result = [...uniqueByTitle.values()].sort((a, b) => a.dateMs - b.dateMs);
console.log(`候補: ${result.length}件（既存記事と公開相談シリーズを除外）`);
result.forEach((candidate, index) => {
  const date = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short" }).format(new Date(candidate.dateMs));
  console.log(`${index + 1}. ${candidate.title} — ${date}`);
});
