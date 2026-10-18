import fs from "node:fs";

const dataDir = new URL("../src/_data/", import.meta.url);
const posts = JSON.parse(fs.readFileSync(new URL("posts.json", dataDir), "utf8"));
const publishedPosts = posts.filter((post) => post.published === true);
const statusOf = (post) => post.reviewStatus ?? (post.published === true ? "published" : "public-wait");
const publicWaitPosts = posts.filter((post) => statusOf(post) === "public-wait");
const previewPosts = posts.filter((post) => statusOf(post) === "preview-wait");
const previewMode = process.env.PREVIEW_MODE === "1";
const visiblePosts = previewMode
  ? posts.filter((post) => post.published === true || statusOf(post) === "preview-wait")
  : publishedPosts;

const publishedHomePosts = visiblePosts.slice(0, 10);
const publishedPostPages = [];
for (let index = 10; index < visiblePosts.length; index += 10) {
  publishedPostPages.push(visiblePosts.slice(index, index + 10));
}

const write = (name, value) => {
  fs.writeFileSync(new URL(name, dataDir), `${JSON.stringify(value, null, 2)}\n`);
};

write("publishedPosts.json", visiblePosts);
write("publishedHomePosts.json", publishedHomePosts);
write("publishedPostPages.json", publishedPostPages);
write("publicWaitPosts.json", publicWaitPosts);
write("previewPosts.json", previewPosts);

console.log(`Publication data: ${publishedPosts.length}/${posts.length} articles are published.`);
console.log(`Workflow lists: ${publicWaitPosts.length} public-wait, ${previewPosts.length} preview-wait.`);
if (previewMode) console.log(`Local preview mode: ${visiblePosts.length} articles are included in the preview.`);
