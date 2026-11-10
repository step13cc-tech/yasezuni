import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = path.join(repoRoot, "src", "_data", "posts.json");
const targetTitle = "好きにならないのか、嫌いなのか";
const target = /気持(?!ち)/g;
const posts = JSON.parse(fs.readFileSync(dataPath, "utf8"));
let changed = 0;

for (const post of posts) {
  if (post.title !== targetTitle) continue;
  for (const field of ["title", "content", "excerpt"]) {
    const before = String(post[field] ?? "");
    const matches = before.match(target);
    if (!matches) continue;
    post[field] = before.replace(target, "気持ち");
    changed += matches.length;
  }
}

fs.writeFileSync(dataPath, `${JSON.stringify(posts, null, 2)}\n`, "utf8");
console.log(`「${targetTitle}」を${changed}か所修正しました。`);
