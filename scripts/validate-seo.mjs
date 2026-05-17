import fs from "node:fs";
import { globSync } from "glob";

const requiredRules = [
  { name: "Title Tag", regex: /<title>.+?<\/title>/is },
  {
    name: "Meta Description",
    regex: /<meta\s+name="description"\s+content=".+?"\s*\/?>/is,
  },
  {
    name: "Canonical Link",
    regex:
      /<link\s+rel="canonical"\s+href="https:\/\/ecash\.mx(?:\/|\/.+?)"\s*\/?>/is,
  },
  { name: "H1 Heading", regex: /<h1[\s>].+?<\/h1>/is },
  {
    name: "Open Graph Title",
    regex: /<meta\s+property="og:title"\s+content=".+?"\s*\/?>/is,
  },
  {
    name: "Open Graph Description",
    regex: /<meta\s+property="og:description"\s+content=".+?"\s*\/?>/is,
  },
  {
    name: "Twitter Card",
    regex:
      /<meta\s+name="twitter:card"\s+content="summary_large_image"\s*\/?>/is,
  },
  { name: "Google Analytics snippet", regex: /G-0C5SHBHW2P/s },
];

const files = globSync(["index.html", "blog/**/*.html"], {
  nodir: true,
  ignore: ["**/node_modules/**"],
});
let failures = 0;

for (const file of files) {
  const html = fs.readFileSync(file, "utf8");
  const missing = [];

  for (const rule of requiredRules) {
    if (!rule.regex.test(html)) {
      missing.push(rule.name);
    }
  }

  if (missing.length > 0) {
    console.error(`SEO validation failed for: ${file}`);
    missing.forEach((tag) => console.error(`  Missing property: ${tag}`));
    failures++;
  }
}

if (failures > 0) {
  console.error(
    `\nTotal anomalous files: ${failures}. Continuous integration step blocked.`,
  );
  process.exit(1);
}

console.log("Technical SEO architecture rules passed validation on all files.");
