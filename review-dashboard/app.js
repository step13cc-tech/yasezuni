const list = document.querySelector("#article-list");
const count = document.querySelector("#preview-count");
const publicWaitCount = document.querySelector("#public-wait-count");
const publishedCount = document.querySelector("#published-count");
const publishedReflectedCount = document.querySelector("#published-reflected-count");
const publishedUnreflectedCount = document.querySelector("#published-unreflected-count");
const viewStatus = new URLSearchParams(window.location.search).get("status") === "public-wait" ? "public-wait" : "preview-wait";
const readOnly = viewStatus === "public-wait";
const listHeading = document.querySelector("#list-heading");
const listHelp = document.querySelector("#list-help");
const previewTab = document.querySelector("#preview-tab");
const publicWaitTab = document.querySelector("#public-wait-tab");
const emptyState = document.querySelector("#empty-state");
const editorView = document.querySelector("#editor-view");
const titleEditor = document.querySelector("#title-editor");
const contentEditor = document.querySelector("#content-editor");
const previewTitle = document.querySelector("#preview-title");
const previewContent = document.querySelector("#preview-content");
const previewImage = document.querySelector("#preview-image");
const articleDate = document.querySelector("#article-date");
const message = document.querySelector("#message");
const saveButton = document.querySelector("#save-button");
const saveStatus = document.querySelector("#save-status");
const approveButton = document.querySelector("#approve-button");
const moveToPreviewButton = document.querySelector("#move-to-preview-button");
const publishNowButton = document.querySelector("#publish-now-button");
let currentSlug = "";
let currentPost = null;

function formatDate(timestamp) {
  if (!Number.isFinite(timestamp)) return "元記事の日付なし";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "long" }).format(new Date(timestamp));
}

function showMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`;
}

function showSaveStatus(text, type = "") {
  saveStatus.textContent = text;
  saveStatus.className = `save-status ${type}`;
}

function configureView() {
  listHeading.textContent = readOnly ? "公開待ち" : "プレビュー待ち";
  listHelp.textContent = readOnly
    ? "記事を選ぶと、公開前の内容を確認できます。「今すぐ公開にする」で個別公開できます。"
    : "記事を選ぶと、右側で内容を確認・修正できます。";
  document.querySelector("#content-editor").previousElementSibling.textContent = readOnly ? "本文（読み取り専用）" : "本文（クリックして編集）";
  saveButton.hidden = readOnly;
  approveButton.hidden = readOnly;
  moveToPreviewButton.hidden = !readOnly;
  publishNowButton.hidden = !readOnly;
  saveStatus.hidden = readOnly;
  titleEditor.readOnly = readOnly;
  contentEditor.contentEditable = String(!readOnly);
  previewTab.classList.toggle("active", !readOnly);
  publicWaitTab.classList.toggle("active", readOnly);
}

function updatePreview() {
  previewTitle.textContent = titleEditor.value;
  previewContent.innerHTML = contentEditor.innerHTML;
}

function renderList(posts) {
  list.replaceChildren();
  if (!posts.length) {
    list.innerHTML = `<p class="empty-list">現在、${readOnly ? "公開待ち" : "プレビュー待ち"}の記事はありません。</p>`;
    return;
  }
  for (const post of posts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `article-list-item${post.slug === currentSlug ? " selected" : ""}`;
    button.innerHTML = '<img class="article-list-thumb" alt=""><span class="article-list-copy"><strong class="article-list-title"></strong><span class="article-list-date"></span></span>';
    const image = button.querySelector(".article-list-thumb");
    if (post.image) image.src = post.image;
    else image.hidden = true;
    button.querySelector(".article-list-title").textContent = post.title;
    button.querySelector(".article-list-date").textContent = formatDate(post.sortTimestamp);
    button.addEventListener("click", () => selectPost(post.slug));
    list.append(button);
  }
}

async function loadCounts() {
  const response = await fetch("/api/counts");
  if (response.ok) {
    const data = await response.json();
    count.textContent = data.previewWait;
    publicWaitCount.textContent = data.publicWait;
    publishedCount.textContent = data.published;
    publishedReflectedCount.textContent = data.repositoryComparisonAvailable ? data.publishedReflected : "確認不可";
    publishedUnreflectedCount.textContent = data.repositoryComparisonAvailable ? data.publishedUnreflected : "確認不可";
    return;
  }

  // 起動中の古いレビューサーバーにも対応するため、両方の一覧から件数を求める。
  const [previewResponse, publicWaitResponse, publishedResponse] = await Promise.all([
    fetch("/api/posts?status=preview-wait"),
    fetch("/api/posts?status=public-wait"),
    fetch("/api/posts?status=published")
  ]);
  const previewData = await previewResponse.json();
  const publicWaitData = await publicWaitResponse.json();
  const publishedData = await publishedResponse.json();
  if (!previewResponse.ok || !publicWaitResponse.ok || !publishedResponse.ok) {
    throw new Error(previewData.error || publicWaitData.error || publishedData.error || "件数を読み込めませんでした。");
  }
  count.textContent = previewData.posts.length;
  publicWaitCount.textContent = publicWaitData.posts.length;
  publishedCount.textContent = publishedData.posts.length;
  publishedReflectedCount.textContent = "確認不可";
  publishedUnreflectedCount.textContent = "確認不可";
}

async function loadPosts(keepSelection = true) {
  const response = await fetch(`/api/posts?status=${viewStatus}`);
  const data = await response.json();
  renderList(data.posts);
  await loadCounts().catch((error) => showMessage(error.message, "error"));
  if (!keepSelection || !data.posts.some((post) => post.slug === currentSlug)) {
    if (data.posts[0]) await selectPost(data.posts[0].slug);
    else {
      currentSlug = "";
      currentPost = null;
      editorView.hidden = true;
      emptyState.hidden = false;
    }
  }
}

async function selectPost(slug) {
  const response = await fetch(`/api/posts/${encodeURIComponent(slug)}`);
  const post = await response.json();
  if (!response.ok) return showMessage(post.error || "記事を読み込めませんでした。", "error");
  currentSlug = post.slug;
  currentPost = post;
  titleEditor.value = post.title;
  contentEditor.innerHTML = post.content || "";
  articleDate.textContent = formatDate(post.sortTimestamp);
  if (post.image) {
    previewImage.src = post.image;
    previewImage.hidden = false;
  } else previewImage.hidden = true;
  updatePreview();
  showSaveStatus("");
  emptyState.hidden = true;
  editorView.hidden = false;
  showMessage("");
  document.querySelectorAll(".article-list-item").forEach((item) => item.classList.toggle("selected", item.querySelector("strong").textContent === post.title));
}

async function savePost() {
  if (!currentSlug || readOnly) return false;
  saveButton.disabled = true;
  saveButton.textContent = "保存中…";
  showSaveStatus("保存中…", "saving");
  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(currentSlug)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: titleEditor.value, content: contentEditor.innerHTML })
    });
    const result = await response.json();
    if (!response.ok) {
      showMessage(result.error || "保存できませんでした。", "error");
      showSaveStatus("保存できませんでした", "error");
      return false;
    }
    currentPost = result;
    await loadPosts(true);
    showMessage("修正を保存しました。まだ公開待ちには移動していません。", "success");
    showSaveStatus("保存しました", "success");
    return true;
  } catch (error) {
    showMessage(error.message || "保存できませんでした。", "error");
    showSaveStatus("保存できませんでした", "error");
    return false;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "修正を保存";
  }
}

async function approvePost() {
  if (!currentSlug || readOnly) return;
  if (!window.confirm("修正内容を保存して、この記事を公開待ちに移動しますか？")) return;
  if (!await savePost()) return;
  const response = await fetch(`/api/posts/${encodeURIComponent(currentSlug)}/approve`, { method: "POST" });
  const result = await response.json();
  if (!response.ok) return showMessage(result.error || "公開待ちに移動できませんでした。", "error");
  currentSlug = "";
  currentPost = null;
  showMessage("OKとして登録しました。公開待ちに移動しました。", "success");
  await loadPosts(false);
}

async function publishPostNow() {
  if (!currentSlug || !readOnly) return;
  if (!window.confirm("この記事を公開済みに変更しますか？\n\n変更後、GitHub Desktopでコミット・プッシュすると公開サイトに反映されます。")) return;
  publishNowButton.disabled = true;
  publishNowButton.textContent = "公開処理中…";
  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(currentSlug)}/publish`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) return showMessage(result.error || "公開済みに変更できませんでした。", "error");
    currentSlug = "";
    currentPost = null;
    showMessage("公開済みに変更しました。GitHub Desktopでコミット・プッシュしてください。", "success");
    await loadPosts(false);
  } catch (error) {
    showMessage(error.message || "公開済みに変更できませんでした。", "error");
  } finally {
    publishNowButton.disabled = false;
    publishNowButton.textContent = "今すぐ公開にする";
  }
}

async function movePostToPreview() {
  if (!currentSlug || !readOnly) return;
  if (!window.confirm("この記事をプレビュー待ちに戻しますか？")) return;
  moveToPreviewButton.disabled = true;
  moveToPreviewButton.textContent = "移動中…";
  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(currentSlug)}/preview`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) return showMessage(result.error || "プレビュー待ちに戻せませんでした。", "error");
    currentSlug = "";
    currentPost = null;
    await loadPosts(false);
    showMessage("プレビュー待ちに戻しました。", "success");
  } catch (error) {
    showMessage(error.message || "プレビュー待ちに戻せませんでした。", "error");
  } finally {
    moveToPreviewButton.disabled = false;
    moveToPreviewButton.textContent = "プレビュー待ちに戻す";
  }
}

function markUnsaved() {
  if (readOnly) return;
  updatePreview();
  showSaveStatus("未保存の変更があります", "pending");
}

titleEditor.addEventListener("input", markUnsaved);
contentEditor.addEventListener("input", markUnsaved);
saveButton.addEventListener("click", savePost);
approveButton.addEventListener("click", approvePost);
moveToPreviewButton.addEventListener("click", movePostToPreview);
publishNowButton.addEventListener("click", publishPostNow);
document.querySelector("#refresh-button").addEventListener("click", () => loadPosts(true));
configureView();
loadPosts(false).catch((error) => showMessage(error.message, "error"));
