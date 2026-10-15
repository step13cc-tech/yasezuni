import fs from "node:fs";

const dataPath = new URL("../src/_data/posts.json", import.meta.url);
const posts = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const batch = posts.filter((post) => post.published !== true).slice(0, 5);

if (batch.length === 0) {
  console.log("No unpublished articles remain.");
  process.exit(0);
}

for (const post of batch) {
  post.published = true;
}

fs.writeFileSync(dataPath, `${JSON.stringify(posts, null, 2)}\n`);
console.log(`Published ${batch.length} article(s):`);
for (const post of batch) {
  console.log(`- ${post.title}`);
}
