import fs from "node:fs";
import path from "node:path";
import { globSync } from "glob";

const SITE = "https://ecash.mx";
const ROOT = process.cwd();

const htmlFiles = globSync(["index.html", "blog/**/*.html"], {
  cwd: ROOT,
  nodir: true,
  ignore: ["**/node_modules/**"],
}).sort();

const urls = htmlFiles.map((file) => {
  let normalized = "";

  if (file === "index.html") {
    normalized = "/";
  } else {
    normalized = `/${file}`;
  }

  const absolute =
    file === "blog/index.html" ? `${SITE}/blog/` : `${SITE}${normalized}`;
  const stat = fs.statSync(path.join(ROOT, file));
  const lastmod = new Date(stat.mtimeMs).toISOString().slice(0, 10);

  return `  <url>
    <loc>${absolute}</loc>
    <lastmod>${lastmod}</lastmod>
  </url>`;
});

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

fs.writeFileSync(path.join(ROOT, "sitemap.xml"), xml, "utf8");
console.log(`Generated sitemap.xml with ${urls.length} absolute URLs.`);
