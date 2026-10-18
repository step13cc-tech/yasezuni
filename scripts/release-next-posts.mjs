import fs from "node:fs";

const dataPath = new URL("../src/_data/posts.json", import.meta.url);
const posts = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const statusOf = (post) => post.reviewStatus ?? (post.published === true ? "published" : "public-wait");
const unpublished = posts.filter((post) => post.published !== true && statusOf(post) === "public-wait");
const batch = [...unpublished]
  .sort((a, b) => {
    const aTime = Number.isFinite(a._sortTimestamp) ? a._sortTimestamp : Number.MAX_SAFE_INTEGER;
    const bTime = Number.isFinite(b._sortTimestamp) ? b._sortTimestamp : Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  })
  .slice(0, 5);

if (batch.length === 0) {
  console.log("No unpublished articles remain.");
  process.exit(0);
}

for (const post of batch) {
  post.published = true;
  post.reviewStatus = "published";
}

fs.writeFileSync(dataPath, `${JSON.stringify(posts, null, 2)}\n`);
console.log(`Published ${batch.length} article(s):`);
for (const post of batch) {
  console.log(`- ${post.title}`);
}
