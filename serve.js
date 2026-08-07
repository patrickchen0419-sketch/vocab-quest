/* 本機靜態檔伺服器（零套件，node serve.js 就能跑）。
   用途：Cloudflare Tunnel 要把流量送到一個 http:// 位址，
   直接開 index.html（file://）是沒有位址的，所以需要這一層。

   只綁 127.0.0.1：外面連不進來，只有同一台機器上的 cloudflared 連得到。
   對外開放靠 tunnel，不是靠這個 port。 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 8788;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/* 網站一旦掛上 english.dave0629.com 就是公開的，任何人都能猜網址。
   .git 裡是整個版本庫（含歷史），reference/ 是參考書 PDF，progress/ 是學習紀錄 ——
   這些都不該被外人抓走，所以在這裡擋掉。要公開的只有網站本身。 */
const BLOCKED = ['.git', 'reference', 'progress', 'node_modules'];

const server = http.createServer((req, res) => {
  const send = (code, body, type) => {
    res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(body);
  };

  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch (e) { return send(400, '400 網址格式錯誤'); }

  if (pathname === '/') pathname = '/index.html';

  const parts = pathname.split('/').filter(Boolean);
  // 擋掉隱藏檔與不該公開的資料夾（第一層比對就夠，下面還有 ROOT 邊界檢查）
  if (parts.some(p => p.startsWith('.')) || BLOCKED.includes(parts[0])) return send(403, '403 不開放');

  const file = path.join(ROOT, ...parts);
  // 正規化之後一定要還在 ROOT 底下，擋 ../ 這類跳脫
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(403, '403 不開放');

  fs.readFile(file, (err, buf) => {
    if (err) return send(404, '404 找不到 ' + pathname);
    send(200, buf, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`單字闖關 → http://127.0.0.1:${PORT}`);
  console.log('對外網址 https://english.dave0629.com 由既有的 cloudflared 服務轉進來，');
  console.log('它同時也在服務狼人殺（port 8080）—— 不要重裝那個服務。');
  console.log('停止：Ctrl+C');
});
