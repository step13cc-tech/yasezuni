import fs from "node:fs";

const postsPath = new URL("../src/_data/posts.json", import.meta.url);
const posts = JSON.parse(fs.readFileSync(postsPath, "utf8"));
const query = process.argv.slice(2).join(" ").trim();
const statusOf = (post) => post.reviewStatus ?? (post.published === true ? "published" : "public-wait");

if (!query) throw new Error("Usage: node scripts/approve-preview-post.mjs <slug or title>");

const matches = posts.filter((post) =>
  statusOf(post) === "preview-wait" && (post.slug === query || post.title === query)
);
if (matches.length !== 1) {
  throw new Error(matches.length === 0
    ? `Preview article was not found: ${query}`
    : `More than one preview article matched: ${query}`);
}

const post = matches[0];
post.published = false;
post.reviewStatus = "public-wait";
fs.writeFileSync(postsPath, `${JSON.stringify(posts, null, 2)}\n`);
console.log(`Moved to public-wait: ${post.title}`);
