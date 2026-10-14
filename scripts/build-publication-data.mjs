import fs from "node:fs";

const dataDir = new URL("../src/_data/", import.meta.url);
const posts = JSON.parse(fs.readFileSync(new URL("posts.json", dataDir), "utf8"));
const now = Date.now();

const publishedPosts = posts.filter((post) => {
  if (!post.publishAt) return true;
  const publishTime = Date.parse(post.publishAt);
  return Number.isNaN(publishTime) || publishTime <= now;
});

const publishedHomePosts = publishedPosts.slice(0, 10);
const publishedPostPages = [];
for (let index = 10; index < publishedPosts.length; index += 10) {
  publishedPostPages.push(publishedPosts.slice(index, index + 10));
}

const write = (name, value) => {
  fs.writeFileSync(new URL(name, dataDir), `${JSON.stringify(value, null, 2)}\n`);
};

write("publishedPosts.json", publishedPosts);
write("publishedHomePosts.json", publishedHomePosts);
write("publishedPostPages.json", publishedPostPages);

console.log(`Publication data: ${publishedPosts.length}/${posts.length} articles are published.`);
