/** 最小静态服务器。零依赖，只用 node:http。
 *
 * 跑：node Tools/serve.mjs   → http://localhost:8123/web/
 *
 * `web/index.html` 双击也能打开（配置表是构建期内联的，不依赖 fetch），
 * 这个服务器是为了方便改代码时刷新，以及给 Claude 的浏览器做预览。
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 8123);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8", ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (rel === "/") rel = "/web/index.html";
    const file = path.join(ROOT, rel);
    // 不许跳出项目目录
    if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
    const s = await stat(file);
    const target = s.isDirectory() ? path.join(file, "index.html") : file;
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": TYPES[path.extname(target)] ?? "application/octet-stream",
      "cache-control": "no-store",
    }).end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
      .end("404 " + req.url);
  }
}).listen(PORT, () => {
  console.log(`静态服务器：http://localhost:${PORT}/web/`);
});
