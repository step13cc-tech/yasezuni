import fs from "node:fs";

const postsPath = new URL("../src/_data/posts.json", import.meta.url);
const posts = JSON.parse(fs.readFileSync(postsPath, "utf8"));
const statusOf = (post) => post.reviewStatus ?? (post.published === true ? "published" : "public-wait");
const requested = process.argv[2] ?? "preview-wait";
const labels = {
  "preview-wait": "プレビュー待ち",
  "public-wait": "公開待ち",
  published: "公開済み"
};
const selected = posts
  .filter((post) => statusOf(post) === requested)
  .sort((a, b) => (a._sortTimestamp ?? Number.MAX_SAFE_INTEGER) - (b._sortTimestamp ?? Number.MAX_SAFE_INTEGER));

if (!labels[requested]) throw new Error(`Unknown workflow status: ${requested}`);
console.log(`${labels[requested]}: ${selected.length}件`);
selected.forEach((post, index) => {
  const date = Number.isFinite(post._sortTimestamp)
    ? new Date(post._sortTimestamp).toISOString().slice(0, 10)
    : "日付なし";
  console.log(`${index + 1}. ${post.title} — ${date}`);
});
