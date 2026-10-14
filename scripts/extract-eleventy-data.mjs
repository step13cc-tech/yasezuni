import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const sourceDir = path.join(root, "src");
const dataDir = path.join(sourceDir, "_data");

const read = (file) => fs.readFileSync(file, "utf8");
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
};

function decodeHtml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const japaneseTextChars = "ぁ-んァ-ヶ一-龯々ー！？。、，．：；）】〉》」』〕］｝（【〈《「『〔［｛";
const lineWrapSpace = new RegExp(`(?<=[${japaneseTextChars}]) | (?=[${japaneseTextChars}])`, "g");

function normalizeArticleText(value) {
  return value.replaceAll("メルマガ", "サイト").replace(lineWrapSpace, "");
}

function normalizeArticleHtml(value) {
  return value.split(/(<[^>]*>)/g)
    .map((part) => part.startsWith("<") ? part : normalizeArticleText(part))
    .join("");
}

function extractEntry(html, withArticleNav = false) {
  const startTag = "<div class='entry-content'>";
  const start = html.indexOf(startTag);
  if (start < 0) throw new Error("entry-content was not found");
  const endMarker = withArticleNav ? "</div><nav class='article-nav'" : "</div></article>";
  const end = html.lastIndexOf(endMarker);
  if (end < start) throw new Error("entry-content end was not found");
  return html.slice(start + startTag.length, end);
}

function extractTitle(html) {
  const match = html.match(/<h1 class='article-title'>([\s\S]*?)<\/h1>/);
  if (!match) throw new Error("article title was not found");
  return decodeHtml(match[1]);
}

function extractCards(html) {
  const cards = [];
  const cardPattern = /<a class='post-card' href='([^']+)'>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(cardPattern)) {
    const inner = match[2];
    const title = inner.match(/<h2>([\s\S]*?)<\/h2>/);
    const excerpt = inner.match(/<p class='post-excerpt'>([\s\S]*?)<\/p>/);
    const image = inner.match(/<img src='([^']+)'/);
    if (!title || !excerpt) continue;
    const slug = decodeURIComponent(match[1].replace(/^\//, "").replace(/\/$/, ""));
    cards.push({
      slug,
      title: normalizeArticleText(decodeHtml(title[1])),
      excerpt: normalizeArticleText(decodeHtml(excerpt[1])),
      image: image ? `/${image[1].replace(/^\//, "")}` : ""
    });
  }
  return cards;
}

function articlePath(slug) {
  return path.join(root, ...slug.split("/"), "index.html");
}

const listingFiles = [path.join(root, "index.html")];
for (let pageNumber = 2; fs.existsSync(path.join(root, "page", String(pageNumber), "index.html")); pageNumber += 1) {
  listingFiles.push(path.join(root, "page", String(pageNumber), "index.html"));
}

const cards = listingFiles.flatMap((file) => extractCards(read(file)));
const seen = new Set();
const posts = [];
for (const card of cards) {
  if (seen.has(card.slug)) continue;
  seen.add(card.slug);
  const html = read(articlePath(card.slug));
  posts.push({
    slug: card.slug,
    title: normalizeArticleText(extractTitle(html)),
    excerpt: card.excerpt,
    image: card.image,
    content: normalizeArticleHtml(extractEntry(html, true))
  });
}

const fixedPageSlugs = ["about", "privacy-policy", "profile", "sitemap"];
const pages = fixedPageSlugs.filter((slug) => fs.existsSync(articlePath(slug))).map((slug) => {
  const html = read(articlePath(slug));
  return {
    slug,
    title: extractTitle(html),
    content: extractEntry(html)
  };
});

const homePosts = posts.slice(0, 10);
const postPages = [];
for (let index = 10; index < posts.length; index += 10) postPages.push(posts.slice(index, index + 10));

write(path.join(dataDir, "posts.json"), `${JSON.stringify(posts, null, 2)}\n`);
write(path.join(dataDir, "pages.json"), `${JSON.stringify(pages, null, 2)}\n`);
write(path.join(dataDir, "homePosts.json"), `${JSON.stringify(homePosts, null, 2)}\n`);
write(path.join(dataDir, "postPages.json"), `${JSON.stringify(postPages, null, 2)}\n`);

for (const file of ["style.css", "CNAME", "robots.txt"]) {
  fs.copyFileSync(path.join(root, file), path.join(sourceDir, file));
}

console.log(`Eleventy data extracted: ${posts.length} posts, ${pages.length} fixed pages, ${postPages.length + 1} listing pages.`);
