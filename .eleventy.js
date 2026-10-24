const path = require("node:path");

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/style.css": "style.css" });
  eleventyConfig.addPassthroughCopy({ "src/CNAME": "CNAME" });
  eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });
  eleventyConfig.addPassthroughCopy({ [path.resolve("assets")]: "assets" });

  eleventyConfig.addFilter("getItem", (items, index) => {
    if (!Array.isArray(items) || index < 0 || index >= items.length) return null;
    return items[index];
  });

  eleventyConfig.addFilter("range", (start, end) => {
    const values = [];
    for (let value = Number(start); value <= Number(end); value += 1) values.push(value);
    return values;
  });

  eleventyConfig.addFilter("wrapArticleQuotes", (html, slug) => {
    if (slug !== "あっという間に彼" || typeof html !== "string") return html;

    const quotePatterns = [
      /<p>ユズさん。お久しぶりです。[\s\S]*?ありがとうございました。<\/p>/,
      /<p>なんだ、そのままの自分でいいじゃん！が上辺だけでなく、[\s\S]*?あっという間に彼ができました。<\/p>/
    ];

    return quotePatterns.reduce(
      (result, pattern) => result.replace(pattern, (quote) => `<blockquote class="article-quote"><p class="article-quote-label">引用文</p>${quote}</blockquote>`),
      html
    );
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site"
    },
    templateFormats: ["njk", "xml"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk"
  };
};
