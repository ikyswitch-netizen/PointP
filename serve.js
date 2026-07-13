/* 依存なしの静的サーバ（node serve.js → http://localhost:8123） */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && p === '/snap') {
    // 開発検証用: canvas の dataURL を受け取り snap.png に保存
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b64 = body.replace(/^data:image\/png;base64,/, '');
      fs.writeFile(path.join(root, 'snap.png'), Buffer.from(b64, 'base64'), (err) => {
        res.writeHead(err ? 500 : 200);
        res.end(err ? 'err' : 'ok');
      });
    });
    return;
  }
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(root, p));
  if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(8123, () => console.log('serving on http://localhost:8123'));
