// 开发调试：本地起 dist 服务，打开页面跑一段脚本（node tools/dev-probe.mjs "<页面里执行的 JS>" [截图名]）
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const req = createRequire('C:/Users/73405/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = req('playwright');
const DIST = path.resolve('dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.txt': 'text/plain' };
const srv = http.createServer((q, s) => { let u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/formis\//, '/'); let f = path.join(DIST, u); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); }).listen(0, '127.0.0.1');
await new Promise(r => srv.on('listening', r));
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
p.on('console', m => console.log('[console]', m.type(), m.text())); p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.goto(`http://127.0.0.1:${srv.address().port}/formis/`);
await p.waitForFunction(() => window.__cad && window.__cad.ready.kernel, null, { timeout: 30000 });
const r = await p.evaluate(`(async () => { ${process.argv[2] || ''} })()`);
console.log(JSON.stringify(r, null, 1));
if (process.argv[3]) await p.screenshot({ path: 'shots/' + process.argv[3] + '.png' });
await b.close(); srv.close();
