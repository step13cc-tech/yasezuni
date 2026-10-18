import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mboxPath = path.join(repoRoot, "..", "mail-magazine-source", "extracted", "Takeout", "メール", "まぐまぐ羽林由鶴.mbox");
const posts = JSON.parse(fs.readFileSync(path.join(repoRoot, "src", "_data", "posts.json"), "utf8"));

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

const existingTitles = new Set(posts.map((post) => compact(post.title)));
const latestTimestamp = Math.max(...posts.map((post) => post._sortTimestamp ?? 0));
const messages = fs.readFileSync(mboxPath).toString("latin1").split(/\n(?=From )/)
  .filter((chunk) => chunk.startsWith("From ")).map(parseMessage).filter((message) => message && Number.isFinite(message.dateMs));
const candidates = new Map();
for (const message of messages) {
  const title = titleFromSubject(message.subject);
  if (!title || message.dateMs <= latestTimestamp || /公開相談/.test(compact(message.subject)) || existingTitles.has(compact(title))) continue;
  const key = `${compact(title)}\u0000${message.dateMs}`;
  if (!candidates.has(key)) candidates.set(key, { title, ...message });
}
const unique = new Map();
for (const candidate of candidates.values()) {
  const key = compact(candidate.title);
  if (!unique.has(key) || candidate.dateMs < unique.get(key).dateMs) unique.set(key, candidate);
}
const selected = [...unique.values()].sort((a, b) => a.dateMs - b.dateMs).slice(0, 10);
for (const [index, message] of selected.entries()) {
  console.log(`\n===== ${index + 1}. ${message.title} / ${new Date(message.dateMs).toISOString()} =====\n`);
  console.log(message.body.slice(0, 5000));
}
