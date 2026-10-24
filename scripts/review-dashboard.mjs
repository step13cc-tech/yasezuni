import fs from "node:fs";
import { execFileSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = path.join(repoRoot, "src", "_data", "posts.json");
const dashboardRoot = path.join(repoRoot, "review-dashboard");
const port = Number(process.env.REVIEW_PORT || 3001);

const statusOf = (post) => post.reviewStatus ?? (post.published === true ? "published" : "public-wait");

function readPosts() {
  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

function writePosts(posts) {
  fs.writeFileSync(dataPath, `${JSON.stringify(posts, null, 2)}\n`, "utf8");
}

function readRemotePosts() {
  try {
    const source = execFileSync("git", ["show", "origin/main:src/_data/posts.json"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function fetchRemoteMain() {
  execFileSync("git", ["fetch", "origin", "main"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function gitRevision(ref) {
  try {
    return execFileSync("git", ["rev-parse", ref], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function revisionDistance() {
  try {
    const output = execFileSync("git", ["rev-list", "--left-right", "--count", "HEAD...origin/main"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim().split(/\s+/).map(Number);
    return { localAheadBy: output[0] || 0, remoteAheadBy: output[1] || 0 };
  } catch {
    return { localAheadBy: null, remoteAheadBy: null };
  }
}

function publicationCounts(posts) {
  const result = posts.reduce((counts, post) => {
    const status = statusOf(post);
    if (status === "preview-wait") counts.previewWait += 1;
    if (status === "public-wait") counts.publicWait += 1;
    if (status === "rejected") counts.rejected += 1;
    if (status === "published") counts.published += 1;
    return counts;
  }, { previewWait: 0, publicWait: 0, rejected: 0, published: 0 });
  const remotePosts = readRemotePosts();
  const localRevision = gitRevision("HEAD");
  const remoteRevision = gitRevision("origin/main");
  const distance = revisionDistance();
  if (!remotePosts) return {
    ...result,
    repositoryComparisonAvailable: false,
    localRevision,
    remoteRevision,
    ...distance
  };
  const remoteBySlug = new Map(remotePosts.map((post) => [post.slug, post]));
  const remotePublished = new Set(remotePosts.filter((post) => statusOf(post) === "published").map((post) => post.slug));
  const localPublished = posts.filter((post) => statusOf(post) === "published");
  const statusDifferenceCount = posts.filter((post) => {
    const remotePost = remoteBySlug.get(post.slug);
    return remotePost && (post.published !== remotePost.published || statusOf(post) !== statusOf(remotePost));
  }).length;
  const remoteCounts = remotePosts.reduce((counts, post) => {
    const status = statusOf(post);
    if (status === "preview-wait") counts.previewWait += 1;
    if (status === "public-wait") counts.publicWait += 1;
    if (status === "rejected") counts.rejected += 1;
    if (status === "published") counts.published += 1;
    return counts;
  }, { previewWait: 0, publicWait: 0, rejected: 0, published: 0 });
  return {
    ...result,
    publishedReflected: localPublished.filter((post) => remotePublished.has(post.slug)).length,
    publishedUnreflected: localPublished.filter((post) => !remotePublished.has(post.slug)).length,
    repositoryComparisonAvailable: true,
    localRevision,
    remoteRevision,
    ...distance,
    statusDifferenceCount,
    remotePreviewWait: remoteCounts.previewWait,
    remotePublicWait: remoteCounts.publicWait,
    remoteRejected: remoteCounts.rejected,
    remotePublished: remoteCounts.published
  };
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function sendText(response, status, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, { "content-type": contentType, "content-length": Buffer.byteLength(body) });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>|<\/div>|<\/li>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function makeExcerpt(content) {
  const text = stripHtml(content);
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

function publicPost(post, includeContent = false) {
  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    image: post.image,
    content: includeContent ? post.content : undefined,
    sortTimestamp: post._sortTimestamp,
    reviewStatus: statusOf(post)
  };
}

function postFromPath(pathname) {
  const match = pathname.match(/^\/api\/posts\/(.+?)(?:\/(?:approve|publish|preview|reject))?\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function isApprovePath(pathname) {
  return /^\/api\/posts\/.+\/approve\/?$/.test(pathname);
}

function isPublishPath(pathname) {
  return /^\/api\/posts\/.+\/publish\/?$/.test(pathname);
}

function isRejectPath(pathname) {
  return /^\/api\/posts\/.+\/reject\/?$/.test(pathname);
}

function isPreviewPath(pathname) {
  return /^\/api\/posts\/.+\/preview\/?$/.test(pathname);
}

function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(dashboardRoot, `.${requested}`);
  if (!filePath.startsWith(`${dashboardRoot}${path.sep}`) || !fs.existsSync(filePath)) {
    sendText(response, 404, "Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
  response.writeHead(200, {
    "content-type": contentTypes[ext] || "application/octet-stream",
    "cache-control": "no-store"
  });
  fs.createReadStream(filePath).pipe(response);
}

function serveAsset(response, pathname) {
  const assetPath = path.resolve(repoRoot, `.${pathname}`);
  const assetsRoot = path.join(repoRoot, "assets");
  if (!assetPath.startsWith(`${assetsRoot}${path.sep}`) || !fs.existsSync(assetPath)) {
    sendText(response, 404, "Not found");
    return;
  }
  response.writeHead(200, { "content-type": "application/octet-stream" });
  fs.createReadStream(assetPath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname === "/api/counts" && request.method === "GET") {
      sendJson(response, 200, publicationCounts(readPosts()));
      return;
    }

    if (url.pathname === "/api/sync" && request.method === "POST") {
      try {
        fetchRemoteMain();
        sendJson(response, 200, { ...publicationCounts(readPosts()), fetchSucceeded: true });
      } catch (error) {
        sendJson(response, 200, {
          ...publicationCounts(readPosts()),
          fetchSucceeded: false,
          fetchError: "GitHubの最新情報を自動取得できませんでした。GitHub DesktopでFetchまたはPullを実行してください。"
        });
      }
      return;
    }

    if (url.pathname === "/api/posts" && request.method === "GET") {
      const requestedStatus = url.searchParams.get("status") || "preview-wait";
      const posts = readPosts()
        .filter((post) => statusOf(post) === requestedStatus)
        .sort((a, b) => (a._sortTimestamp ?? Number.MAX_SAFE_INTEGER) - (b._sortTimestamp ?? Number.MAX_SAFE_INTEGER));
      sendJson(response, 200, { status: requestedStatus, posts: posts.map((post) => publicPost(post)) });
      return;
    }

    if (url.pathname.startsWith("/api/posts/") && request.method === "GET") {
      const slug = postFromPath(url.pathname);
      const post = readPosts().find((item) => item.slug === slug);
      if (!post) return sendJson(response, 404, { error: "記事が見つかりません。" });
      sendJson(response, 200, publicPost(post, true));
      return;
    }

    if (url.pathname.startsWith("/api/posts/") && request.method === "PUT") {
      const slug = postFromPath(url.pathname);
      const posts = readPosts();
      const post = posts.find((item) => item.slug === slug);
      if (!post) return sendJson(response, 404, { error: "記事が見つかりません。" });
      if (statusOf(post) !== "preview-wait") return sendJson(response, 409, { error: "プレビュー待ちの記事だけ編集できます。" });
      const body = await readJson(request);
      const title = String(body.title ?? "").trim();
      const content = String(body.content ?? "").trim();
      if (!title || !content) return sendJson(response, 400, { error: "タイトルと本文を入力してください。" });
      post.title = title;
      post.content = content;
      post.excerpt = makeExcerpt(content);
      writePosts(posts);
      sendJson(response, 200, publicPost(post, true));
      return;
    }

    if (url.pathname.startsWith("/api/posts/") && request.method === "POST" && isApprovePath(url.pathname)) {
      const slug = postFromPath(url.pathname);
      const posts = readPosts();
      const post = posts.find((item) => item.slug === slug);
      if (!post) return sendJson(response, 404, { error: "記事が見つかりません。" });
      if (statusOf(post) !== "preview-wait") return sendJson(response, 409, { error: "この記事はすでにプレビュー待ちではありません。" });
      post.published = false;
      post.reviewStatus = "public-wait";
      writePosts(posts);
      sendJson(response, 200, publicPost(post, true));
      return;
    }

    if (url.pathname.startsWith("/api/posts/") && request.method === "POST" && isRejectPath(url.pathname)) {
      const slug = postFromPath(url.pathname);
      const posts = readPosts();
      const post = posts.find((item) => item.slug === slug);
      if (!post) return sendJson(response, 404, { error: "記事が見つかりません。" });
      if (statusOf(post) !== "preview-wait") return sendJson(response, 409, { error: "プレビュー待ちの記事だけを不採用にできます。" });
      post.published = false;
      post.reviewStatus = "rejected";
      writePosts(posts);
      sendJson(response, 200, publicPost(post, true));
      return;
    }

    if (url.pathname.startsWith("/api/posts/") && request.method === "POST" && isPublishPath(url.pathname)) {
      const slug = postFromPath(url.pathname);
      const posts = readPosts();
      const post = posts.find((item) => item.slug === slug);
      if (!post) return sendJson(response, 404, { error: "記事が見つかりません。" });
      if (statusOf(post) !== "public-wait") return sendJson(response, 409, { error: "公開待ちの記事だけを今すぐ公開できます。" });
      post.published = true;
      post.reviewStatus = "published";
      writePosts(posts);
      sendJson(response, 200, publicPost(post, true));
      return;
    }

    if (url.pathname.startsWith("/api/posts/") && request.method === "POST" && isPreviewPath(url.pathname)) {
      const slug = postFromPath(url.pathname);
      const posts = readPosts();
      const post = posts.find((item) => item.slug === slug);
      if (!post) return sendJson(response, 404, { error: "記事が見つかりません。" });
      if (statusOf(post) !== "public-wait" && statusOf(post) !== "rejected") return sendJson(response, 409, { error: "公開待ちまたは不採用の記事だけをプレビュー待ちに戻せます。" });
      post.published = false;
      post.reviewStatus = "preview-wait";
      writePosts(posts);
      sendJson(response, 200, publicPost(post, true));
      return;
    }

    if (url.pathname.startsWith("/assets/")) return serveAsset(response, url.pathname);
    serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Review dashboard: http://127.0.0.1:${port}/`);
  console.log("この画面はこのパソコンからだけ利用できます。終了するには Ctrl+C を押してください。");
});
