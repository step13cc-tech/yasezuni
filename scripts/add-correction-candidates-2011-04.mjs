import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = path.join(repoRoot, "src", "_data", "posts.json");

const candidatesByTitle = {
  "できるだけ近い人": [
    { original: "とても大事なことです。。", suggestion: "とても大事なことです。", reason: "句点が重複している可能性があります。" }
  ],
  "特に一人暮らしの方へ": [
    { original: "そのことばかりを考えしまう", suggestion: "そのことばかりを考えてしまう", reason: "「て」が抜けている可能性があります。" },
    { original: "出かけと同じくらい", suggestion: "出かけるときと同じくらい", reason: "文のつながりを確認する候補です。" },
    { original: "対策をして見ましょう", suggestion: "対策をしてみましょう", reason: "補助動詞の表記を確認する候補です。" }
  ],
  "不幸になる人、不幸にならない人": [
    { original: "片思いもでも両思いでも", suggestion: "片思いでも両思いでも", reason: "「も」が重複している可能性があります。" }
  ],
  "だんだん情報を増やす": [
    { original: "わかってような気にならない", suggestion: "わかったような気にならない", reason: "「わかったような」が自然な表現です。" },
    { original: "思うことないんだな", suggestion: "思うことはないんだな", reason: "助詞が抜けている可能性があります。" }
  ],
  "元カノはライバルではありません": [
    { original: "最初から美人奈人と付き合う", suggestion: "最初から美人な人と付き合う", reason: "「な」の誤記の可能性があります。" }
  ],
  "これってどういう意味ですか？": [
    { original: "同じ様なこと", suggestion: "同じようなこと", reason: "一般的な表記を確認する候補です。" }
  ],
  "離れるしかない": [
    { original: "認めらていない", suggestion: "認められていない", reason: "「れ」が抜けている可能性があります。" },
    { original: "築きなおして", suggestion: "築き直して", reason: "漢字表記を確認する候補です。" }
  ],
  "うれしいご報告": [
    { original: "「リリ」ーです", suggestion: "「リリー」です", reason: "名前の表記を確認する候補です。" },
    { original: "公開相談に載りましたメール", suggestion: "公開相談に載ったメール", reason: "過去形の表現を確認する候補です。" }
  ],
  "忙しい人とのデートは": [
    { original: "ご機嫌のままで終れる短めデート", suggestion: "ご機嫌のままで終われる短めデート", reason: "「終われる」の誤記の可能性があります。" }
  ],
  "求めすぎ？サボりぎみ？": [
    { original: "良く気がきく男性", suggestion: "よく気が利く男性", reason: "一般的な表記を確認する候補です。" }
  ],
  "報告～彼氏ができました～": [
    { original: "ひき続きたくさんたくさん募集中", suggestion: "引き続きたくさんたくさん募集中", reason: "漢字表記を確認する候補です。" }
  ]
};

function paragraphPosition(content, original) {
  const paragraphs = [...content.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)];
  const index = paragraphs.findIndex((match) => match[1].includes(original));
  return index >= 0 ? `本文第${index + 1}段落` : "本文内（位置を確認）";
}

const posts = JSON.parse(fs.readFileSync(dataPath, "utf8"));
let updated = 0;
let count = 0;
for (const post of posts) {
  const specs = candidatesByTitle[post.title];
  if (!specs || post.reviewStatus !== "preview-wait") continue;
  post.correctionCandidates = specs.map((candidate) => ({
    ...candidate,
    position: paragraphPosition(post.content, candidate.original)
  }));
  updated += 1;
  count += specs.length;
}

fs.writeFileSync(dataPath, `${JSON.stringify(posts, null, 2)}\n`);
console.log(`修正候補を${updated}記事・${count}件登録しました。`);
