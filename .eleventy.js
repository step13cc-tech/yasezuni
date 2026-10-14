module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/style.css": "style.css" });
  eleventyConfig.addPassthroughCopy({ "src/CNAME": "CNAME" });
  eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });

  eleventyConfig.addFilter("getItem", (items, index) => {
    if (!Array.isArray(items) || index < 0 || index >= items.length) return null;
    return items[index];
  });

  eleventyConfig.addFilter("range", (start, end) => {
    const values = [];
    for (let value = Number(start); value <= Number(end); value += 1) values.push(value);
    return values;
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "."
    },
    templateFormats: ["njk", "xml"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk"
  };
};
