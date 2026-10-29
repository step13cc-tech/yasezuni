const list = document.querySelector("#article-list");
const count = document.querySelector("#preview-count");
const publicWaitCount = document.querySelector("#public-wait-count");
const rejectedCount = document.querySelector("#rejected-count");
const publishedCount = document.querySelector("#published-count");
const publishedReflectedCount = document.querySelector("#published-reflected-count");
const publishedUnreflectedCount = document.querySelector("#published-unreflected-count");
const syncButton = document.querySelector("#sync-button");
const syncStatus = document.querySelector("#sync-status");
const requestedStatus = new URLSearchParams(window.location.search).get("status");
const viewStatus = ["preview-wait", "public-wait", "rejected"].includes(requestedStatus) ? requestedStatus : "preview-wait";
const readOnly = viewStatus !== "preview-wait";
const listHeading = document.querySelector("#list-heading");
const listHelp = document.querySelector("#list-help");
const listMessage = document.querySelector("#list-message");
const previewTab = document.querySelector("#preview-tab");
const publicWaitTab = document.querySelector("#public-wait-tab");
const rejectedTab = document.querySelector("#rejected-tab");
const emptyState = document.querySelector("#empty-state");
const editorView = document.querySelector("#editor-view");
const titleEditor = document.querySelector("#title-editor");
const contentEditor = document.querySelector("#content-editor");
const previewTitle = document.querySelector("#preview-title");
const previewContent = document.querySelector("#preview-content");
const previewImage = document.querySelector("#preview-image");
const articleDate = document.querySelector("#article-date");
const correctionCandidates = document.querySelector("#correction-candidates");
const correctionCandidateList = document.querySelector("#correction-candidate-list");
const message = document.querySelector("#message");
const saveButton = document.querySelector("#save-button");
const saveStatus = document.querySelector("#save-status");
const rejectButton = document.querySelector("#reject-button");
const approveButton = document.querySelector("#approve-button");
const approveAllButton = document.querySelector("#approve-all-button");
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

function showListMessage(text, type = "") {
  listMessage.textContent = text;
  listMessage.className = `message ${type}`;
}

function showSaveStatus(text, type = "") {
  saveStatus.textContent = text;
  saveStatus.className = `save-status ${type}`;
}

function shortRevision(revision) {
  return revision ? revision.slice(0, 7) : "不明";
}

async function readApiResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return {
      error: response.status === 404
        ? "レビューサーバーが古い可能性があります。サーバーを再起動してから、画面を更新してください。"
        : `サーバーから正しい応答を受け取れませんでした（HTTP ${response.status}）。`
    };
  }
}

function renderCounts(data) {
  count.textContent = data.previewWait;
  publicWaitCount.textContent = data.publicWait;
  rejectedCount.textContent = data.rejected;
  publishedCount.textContent = data.published;
  publishedReflectedCount.textContent = data.repositoryComparisonAvailable ? data.publishedReflected : "確認不可";
  publishedUnreflectedCount.textContent = data.repositoryComparisonAvailable ? data.publishedUnreflected : "確認不可";
}

function renderSyncStatus(data) {
  if (data.fetchSucceeded === false) {
    const cacheIsAligned = data.localAheadBy === 0 && data.remoteAheadBy === 0 && data.statusDifferenceCount === 0;
    syncStatus.textContent = cacheIsAligned
      ? `自動取得はできませんでしたが、現在のGitHub Desktop取得済み状態とは一致しています（${shortRevision(data.remoteRevision)}）。`
      : data.fetchError || "GitHub DesktopでFetchまたはPullを実行してください。";
    syncStatus.className = "sync-status warning";
    return;
  }
  if (!data.repositoryComparisonAvailable) {
    syncStatus.textContent = "GitHub側の状態を比較できません。";
    syncStatus.className = "sync-status warning";
    return;
  }
  const remoteAhead = Number(data.remoteAheadBy) > 0;
  const statusDiffers = Number(data.statusDifferenceCount) > 0;
  if (remoteAhead || statusDiffers) {
    const details = [];
    if (remoteAhead) details.push(`GitHub側が${data.remoteAheadBy}コミット先行`);
    if (statusDiffers) details.push(`状態の違い${data.statusDifferenceCount}件`);
    syncStatus.textContent = `${details.join("・")}。GitHub DesktopでPullしてください。`;
    syncStatus.className = "sync-status warning";
    return;
  }
  syncStatus.textContent = `同期済み（${shortRevision(data.remoteRevision)}）`;
  syncStatus.className = "sync-status success";
}

function configureView() {
  const viewLabel = viewStatus === "public-wait" ? "公開待ち" : viewStatus === "rejected" ? "不採用" : "プレビュー待ち";
  listHeading.textContent = viewLabel;
  listHelp.textContent = viewStatus === "public-wait"
    ? "記事を選ぶと、公開前の内容を確認できます。「今すぐ公開にする」で個別公開できます。"
    : viewStatus === "rejected"
      ? "不採用にした記事の一覧です。必要な場合はプレビュー待ちに戻せます。"
      : "記事を選ぶと、右側で内容を確認・修正できます。";
  emptyState.querySelector("p").textContent = `${viewLabel}の記事がここに表示されます。`;
  document.querySelector("#content-editor").previousElementSibling.textContent = readOnly ? "本文（読み取り専用）" : "本文（クリックして編集）";
  saveButton.hidden = readOnly;
  rejectButton.hidden = readOnly;
  approveButton.hidden = readOnly;
  approveAllButton.hidden = viewStatus !== "preview-wait";
  moveToPreviewButton.hidden = viewStatus !== "public-wait" && viewStatus !== "rejected";
  publishNowButton.hidden = viewStatus !== "public-wait";
  saveStatus.hidden = readOnly;
  titleEditor.readOnly = readOnly;
  contentEditor.contentEditable = String(!readOnly);
  previewTab.classList.toggle("active", !readOnly);
  publicWaitTab.classList.toggle("active", viewStatus === "public-wait");
  rejectedTab.classList.toggle("active", viewStatus === "rejected");
}

function updatePreview() {
  previewTitle.textContent = titleEditor.value;
  previewContent.innerHTML = contentEditor.innerHTML;
}

function renderCorrectionCandidates(candidates) {
  correctionCandidateList.replaceChildren();
  if (!Array.isArray(candidates) || candidates.length === 0) {
    correctionCandidates.hidden = true;
    return;
  }
  for (const candidate of candidates) {
    const item = document.createElement("li");
    const original = document.createElement("strong");
    original.textContent = `「${candidate.original || ""}」`;
    const arrow = document.createElement("span");
    arrow.textContent = " → ";
    const suggestion = document.createElement("strong");
    suggestion.textContent = `「${candidate.suggestion || ""}」`;
    const position = document.createElement("span");
    position.className = "candidate-position";
    position.textContent = `（${candidate.position || "本文内の位置を確認"}）`;
    const reason = document.createElement("p");
    reason.textContent = candidate.reason || "修正候補です。";
    item.append(original, arrow, suggestion, position, reason);
    correctionCandidateList.append(item);
  }
  correctionCandidates.hidden = false;
}

function renderList(posts) {
  list.replaceChildren();
  if (!posts.length) {
    const viewLabel = viewStatus === "public-wait" ? "公開待ち" : viewStatus === "rejected" ? "不採用" : "プレビュー待ち";
    list.innerHTML = `<p class="empty-list">現在、${viewLabel}の記事はありません。</p>`;
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
    renderCounts(data);
    renderSyncStatus(data);
    return;
  }

  // 起動中の古いレビューサーバーにも対応するため、両方の一覧から件数を求める。
  const [previewResponse, publicWaitResponse, rejectedResponse, publishedResponse] = await Promise.all([
    fetch("/api/posts?status=preview-wait"),
    fetch("/api/posts?status=public-wait"),
    fetch("/api/posts?status=rejected"),
    fetch("/api/posts?status=published")
  ]);
  const previewData = await previewResponse.json();
  const publicWaitData = await publicWaitResponse.json();
  const rejectedData = await rejectedResponse.json();
  const publishedData = await publishedResponse.json();
  if (!previewResponse.ok || !publicWaitResponse.ok || !rejectedResponse.ok || !publishedResponse.ok) {
    throw new Error(previewData.error || publicWaitData.error || rejectedData.error || publishedData.error || "件数を読み込めませんでした。");
  }
  count.textContent = previewData.posts.length;
  publicWaitCount.textContent = publicWaitData.posts.length;
  rejectedCount.textContent = rejectedData.posts.length;
  publishedCount.textContent = publishedData.posts.length;
  publishedReflectedCount.textContent = "確認不可";
  publishedUnreflectedCount.textContent = "確認不可";
}

async function syncRemoteStatus(showError = true) {
  syncButton.disabled = true;
  syncButton.textContent = "確認中…";
  syncStatus.textContent = "GitHubの最新状態を確認しています…";
  syncStatus.className = "sync-status checking";
  try {
    const response = await fetch("/api/sync", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "GitHubの状態を確認できませんでした。");
    renderCounts(data);
    renderSyncStatus(data);
  } catch (error) {
    syncStatus.textContent = error.message || "GitHubの状態を確認できませんでした。";
    syncStatus.className = "sync-status warning";
    if (showError) showMessage(syncStatus.textContent, "error");
  } finally {
    syncButton.disabled = false;
    syncButton.textContent = "GitHubの最新状態を確認";
  }
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
  renderCorrectionCandidates(post.correctionCandidates);
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

async function approveAllPosts() {
  if (viewStatus !== "preview-wait") return;
  const previewCount = Number.parseInt(count.textContent, 10) || 0;
  if (!previewCount) {
    showListMessage("現在、公開待ちへ移動する記事はありません。", "success");
    return;
  }
  if (!window.confirm(`プレビュー待ちの${previewCount}件を、すべて公開待ちに移動しますか？\n\n記事の本文や画像は変更せず、状態だけを変更します。`)) return;
  approveAllButton.disabled = true;
  approveAllButton.textContent = "移動中…";
  try {
    const response = await fetch("/api/posts/approve-all", { method: "POST" });
    const result = await readApiResponse(response);
    if (!response.ok) return showMessage(result.error || "公開待ちに移動できませんでした。", "error");
    currentSlug = "";
    currentPost = null;
    await loadPosts(false);
    showListMessage(`${result.movedCount}件を公開待ちに移動しました。GitHub Desktopでコミット・プッシュすると反映されます。`, "success");
  } catch (error) {
    showListMessage(error.message || "公開待ちに移動できませんでした。", "error");
  } finally {
    approveAllButton.disabled = false;
    approveAllButton.textContent = "すべて公開待ちへ";
  }
}

async function rejectPost() {
  if (!currentSlug || readOnly) return;
  if (!window.confirm("この記事を不採用にしますか？\n\n不採用にした記事は公開待ちへ移動せず、公開サイトにも掲載されません。")) return;
  rejectButton.disabled = true;
  rejectButton.textContent = "処理中…";
  try {
    const response = await fetch(`/api/posts/${encodeURIComponent(currentSlug)}/reject`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) return showMessage(result.error || "不採用に変更できませんでした。", "error");
    currentSlug = "";
    currentPost = null;
    await loadPosts(false);
    showMessage("不採用として保存しました。", "success");
  } catch (error) {
    showMessage(error.message || "不採用に変更できませんでした。", "error");
  } finally {
    rejectButton.disabled = false;
    rejectButton.textContent = "不採用にする";
  }
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
  if (!currentSlug || !readOnly || viewStatus === "preview-wait") return;
  const confirmation = viewStatus === "rejected"
    ? "この記事を不採用から取り消して、プレビュー待ちに戻しますか？"
    : "この記事をプレビュー待ちに戻しますか？";
  if (!window.confirm(confirmation)) return;
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
rejectButton.addEventListener("click", rejectPost);
approveButton.addEventListener("click", approvePost);
approveAllButton.addEventListener("click", approveAllPosts);
moveToPreviewButton.addEventListener("click", movePostToPreview);
publishNowButton.addEventListener("click", publishPostNow);
document.querySelector("#refresh-button").addEventListener("click", async () => {
  await syncRemoteStatus(true);
  await loadPosts(true);
});
syncButton.addEventListener("click", () => syncRemoteStatus(true));
configureView();
loadPosts(false)
  .then(() => syncRemoteStatus(false))
  .catch((error) => showMessage(error.message, "error"));
