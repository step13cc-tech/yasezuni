import fs from 'node:fs';

const posts = JSON.parse(fs.readFileSync(new URL('../src/_data/posts.json', import.meta.url), 'utf8'));
const counts = new Map();
const missing = posts.filter((post) => !post.image).map((post) => post.title);
for (const post of posts) {
  if (!post.image) continue;
  counts.set(post.image, [...(counts.get(post.image) ?? []), post.title]);
}

const duplicates = [...counts.entries()].filter(([, titles]) => titles.length > 1);
if (missing.length || duplicates.length) {
  for (const title of missing) console.error(`Missing image: ${title}`);
  for (const [image, titles] of duplicates) console.error(`${image}: ${titles.join(' / ')}`);
  process.exitCode = 1;
} else {
  console.log(`OK: ${counts.size} unique images for ${posts.length} articles.`);
}
