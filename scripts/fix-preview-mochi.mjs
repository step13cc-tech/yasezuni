import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = path.join(repoRoot, "src", "_data", "posts.json");
const posts = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const target = /気持(?!ち)/g;
let changedPosts = 0;
let changedOccurrences = 0;

function replace(value) {
  const text = String(value ?? "");
  const matches = text.match(target);
  if (!matches) return text;
  changedOccurrences += matches.length;
  return text.replace(target, "気持ち");
}

for (const post of posts) {
  if (post.reviewStatus !== "preview-wait") continue;
  const before = `${post.title}\u0000${post.content}\u0000${post.excerpt}`;
  post.title = replace(post.title);
  post.content = replace(post.content);
  post.excerpt = replace(post.excerpt);
  const after = `${post.title}\u0000${post.content}\u0000${post.excerpt}`;
  if (before !== after) changedPosts += 1;
}

fs.writeFileSync(dataPath, `${JSON.stringify(posts, null, 2)}\n`, "utf8");
console.log(`修正記事: ${changedPosts}件`);
console.log(`修正箇所: ${changedOccurrences}か所`);
