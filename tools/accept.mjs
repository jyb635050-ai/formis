// ═══ GlassCAD 网页 CAD 验收脚本 —— 判卷标准，冻结 ═══
// 本文件与 tools/judge/ 下全部文件都是判卷标准：任何人不许改、不许删、不许绕开。改了就算不合格。
// 用法（在 D:\blender\GlassCAD 下）：
//   node tools/accept.mjs              本地全量：先 npm run build，再把 dist/ 挂在 http://127.0.0.1:<随机端口>/glass-cad/ 验（和 GitHub Pages 一样是子路径）
//   node tools/accept.mjs --url https://jyb635050-ai.github.io/glass-cad/
//                                      线上全量（不 build；另验线上 index.html 与本地 dist/index.html 逐字节相同）
//   node tools/accept.mjs --prove      反向验证：逐个往页面注入 14 种破坏，每种对应的检查必须变红。全部抓到→退出码 1；有漏抓→退出码 2
//   --only 组,组   只跑某几组（调试用）：build boot ui sketch solver model heavy ui3d sheet persist。交付必须跑全量
// 退出码：0 全部 PASS；1 有 FAIL；3 判卷自身出错／超时／参数不认识（这不是 FAIL，是判卷没跑完）。截图写到 shots/ 给人看观感。
// 判卷依赖（已装好；缺了按此装）：npm ci --prefix tools/judge ；python -m pip install --target tools/judge/pylib -r tools/judge/requirements.txt
// 判卷不信网页自己报的数：体积按公式算；STEP 用判卷自己的 OpenCascade 读；3MF 判卷自己解压算体积、再交给本机 Bambu Studio 切片；
// DXF 用 ezdxf、PDF 用 pypdf 读；界面用真鼠标键盘点，画面用截图比像素，流畅度用注入的帧探针量。
//
// ───── 坐标约定 ─────
// 单位毫米，世界坐标 Z 朝上。基准面：XY（u=+X，v=+Y，法向 +Z）、XZ（u=+X，v=+Z，法向 −Y）、YZ（u=+Y，v=+Z，法向 +X）。
// 草图里的点用面内坐标 [u,v]，v 轴＝法向 × u 轴。在实体平面上建的草图：法向＝该面朝外法向，原点和 u 轴由网页定，sketch(sid).plane 如实报告。
// 三维视图用正交投影。前视＝从 −Y 看（屏幕右＝+X、上＝+Z）；俯视＝从 +Z 看（右＝+X、上＝+Y）；左视＝从 −X 看（右＝−Y、上＝+Z）；
// 等轴测＝从 (+1,−1,+1) 方向看。工程图用第一角投影（国标）：俯视图在主视图正下方，左视图在主视图正右方。
//
// ───── 页面契约 ─────
// 单页应用 dist/index.html，npm run build 产出 dist/，放在任意子路径下都能跑（相对路径）。所有请求同源，不许任何外部域名（字体也不许）。
// 用普通赋值 window.__cad = {...} 暴露判卷入口（反向验证要包装它，别用 defineProperty / Object.freeze）。
// 下文 #X 指 [data-testid="X"] 元素：
//   顶栏右上角（top<80 且 left>视口宽−420）：#theme 深色/浅色切换（<html data-theme="light|dark">，首次访问跟随系统 prefers-color-scheme）；
//     #lang 中文/English 切换（<html lang="zh-CN|en">，首次访问中文）。两项选择刷新后保持。
//   #mode-2d 二维制图（没有草图就自动新建一张 XY 草图并进入编辑）、#mode-3d 三维建模、#mode-sheet 工程图；__cad.mode() 返回 '2d'|'3d'|'sheet'。
//   #viewport 绘图/三维区域（画布所在元素）。判卷在这里用真鼠标：左键点画；右键拖动旋转视角；滚轮以光标为中心缩放（光标下的点不动）。
//   新建草图（二维里，或三维里选完基准面后）视图转正对草图：u∈[−10,100]、v∈[−50,60] 的区域完整显示在 #viewport 里、不被任何面板挡住，且 1mm ≥ 3 像素。
//   二维工具 #tool-select #tool-line #tool-rect #tool-circle #tool-dim（三维里编辑草图时也用这一套）：
//     画线：逐点左键单击，Esc 结束，相邻线段端点自动加重合约束。矩形：单击两对角，自动加水平/竖直/角点重合（不固定位置）。
//     圆：单击圆心，再单击圆上一点。标注：单击一条线（得长度/水平/距离标注）或圆周（得直径/半径标注），再单击放置位置；
//     放置后要么自动弹出、要么双击标注数字弹出 #dim-input，输入数字回车＝改尺寸，图形按约束跟着变（尺寸驱动）。
//     选择工具下拖动点，图形按约束实时跟随。Ctrl+Z 撤销，Ctrl+Y 或 Ctrl+Shift+Z 重做，Esc 取消，Delete 删除选中。
//   三维：#new-sketch 后单击 #plane-XY / #plane-XZ / #plane-YZ，或在 #viewport 里单击实体的一个平面；#sketch-done 退出草图（刚退出的草图成为选中草图）。
//     特征按钮 #feat-extrude #feat-cut #feat-revolve #feat-fillet #feat-chamfer #feat-shell 作用于选中草图；圆角/倒角先点按钮，再在 #viewport 单击边（拾取容差 ≥6px）。
//     参数框 #feat-depth #feat-radius #feat-distance #feat-thickness #feat-angle；#feat-ok 确认、#feat-cancel 取消。
//     特征树每项 #tree-item（data-id＝特征 id），双击打开编辑（参数框预填当前值）；失败的特征该项带 data-error 属性。
//     鼠标停在面/边上要有高亮（判卷比对光标附近像素）。视图按钮 #view-front #view-top #view-left #view-iso #view-fit。
//   工程图：#make-sheet 用当前实体生成工程图并切到 sheet 模式；#sheet-size 是 <select>（选项值 A4、A3）；#project-name 是项目名 <input>（进标题栏）。
//   导出：#export-dxf #export-svg #export-pdf（2d 模式导出当前草图，sheet 模式导出工程图）；#export-3mf #export-step（三维实体）；
//     #save 下载项目 .json；#open 是 <input type=file> 打开项目。一律走普通下载（<a download>），别用 showSaveFilePicker。
//   界面文字：切到 en 后可见文字里不许有中文（#lang 按钮自身、以及放进带 data-user-content 属性元素里的用户内容，判卷跳过）；中文时可见汉字 ≥20 个。
//     所有 #tool-* #feat-* #view-* 按钮要有 title、aria-label 或文字，并随语言切换（中文时含汉字，英文时不含）。
//   磨砂玻璃：两种主题下都要有 ≥3 个可见元素（≥24×24px）的 backdrop-filter 含 blur(≥8px)，且 background-color 半透明（0.02<alpha<0.9）。
//   1440×900 与 1280×720 下 document.documentElement.scrollWidth ≤ 视口宽，#viewport 面积 ≥ 窗口 45%。
//   改动后 3 秒内自动保存到 localStorage 或 IndexedDB，刷新页面原样恢复。
//
// ───── window.__cad（cmd 必须与界面走同一套代码；每个 cmd 是一步可撤销操作；都可以返回 Promise）─────
//   ready: {ui, kernel}        界面可用／几何内核就绪。本地：ui ≤3s、kernel ≤10s；线上：ui ≤8s、kernel ≤40s（从开始导航算）
//   idle(): Promise            求解、重建、导出全部完成后 resolve        mode(m?)  读/切工作区        reset(): Promise  新建空项目
//   active()                   正在编辑的草图 id，没有为 null
//   toScreen(sid,[u,v]) → {x,y}   该草图点此刻画在屏幕哪（视口 CSS 像素）；project([x,y,z]) → {x,y}  三维点此刻在屏幕哪
//   cmd.sketch(plane) → sid    plane＝'XY'|'XZ'|'YZ'|{face:[x,y,z]}（该点所在的实体平面）
//   cmd.line(sid,[u,v],[u,v]) → id   端点引用 `${id}.a` `${id}.b`     cmd.circle(sid,[u,v],r) → id   圆心 `${id}.c`
//   cmd.arc(sid,[u,v],r,a0,a1) → id  角度制，从 +u 逆时针，a0→a1 逆时针；圆心 .c、起点 .a、终点 .b
//   cmd.text(sid,[u,v],文字,字高) → id       cmd.construction(id,true|false)  设为构造线（不参与轮廓，可做旋转轴）
//   cmd.constrain(sid,类型,...引用) → id   coincident(点,点) horizontal(线) vertical(线) parallel(线,线) perpendicular(线,线)
//                                         tangent(线或弧,弧或圆) equal(线,线｜圆弧,圆弧) fix(点：钉在当前位置)
//   cmd.dim(sid,类型,[引用…],值) → id      驱动尺寸，加上即解到该值：distance(点,点) hdist(点,点) vdist(点,点)（取绝对值、保持原来在哪一侧）
//                                         length(线) radius(圆/弧) diameter(圆/弧) angle(线,线；两线方向夹角，角度制)
//   cmd.setDim(id,值)  与双击改数同一代码。冲突的约束/尺寸：要么 cmd 抛错且草图不变，要么接受但 status='conflict' 且图形保持上一次的解；坐标任何时候不许 NaN
//   cmd.del(id)  cmd.finish(sid)
//   cmd.extrude(sid,{depth,cut?,through?,reverse?}) → fid   非 cut：沿草图法向长出并与已有实体合并；cut：默认逆法向切进实体，through＝完全贯穿。
//     草图里封闭的非构造曲线围成轮廓，轮廓里套着的封闭环是孔。
//   cmd.revolve(sid,{axis:构造线id,angle,cut?}) → fid
//   cmd.fillet({radius,edges:[[x,y,z],…]}) → fid   每个点落在（≤0.05mm）一条边上，选中整条边；cmd.chamfer({distance,edges}) → fid
//   cmd.shell({thickness,faces:[[x,y,z],…]}) → fid  去掉这些点所在的面、向内抽壳
//   cmd.setParam(fid,{部分参数}) 改参数并重建；cmd.suppress(fid,true|false) 压缩/解压
//   选中的边、面在上游改深度、改草图尺寸后必须仍指向"同一条"边/面（判卷改完核对体积）。
//   失败的特征（如圆角半径过大）：features() 里该项 error 非空，模型＝跳过它的结果；不许崩溃，不许出现页面报错。
//   undo() redo()
//   sketch(sid) → {plane:{origin,normal,u,v}, entities:[{id,type:'line'|'circle'|'arc'|'text',a,b,c,r,a0,a1,text,at,h,construction}],
//                  constraints:[{id,type,refs}], dims:[{id,type,refs,value,label:[u,v]}], dof:剩余自由度（求解器实算）, status:'ok'|'conflict'}
//     label＝该尺寸数字显示的位置（草图坐标）。sketches() → [sid…]
//   features() → [{id,type:'extrude'|'cut'|'revolve'|'fillet'|'chamfer'|'shell',params,suppressed,error}]
//   measure() → {volume,area,bbox:[[x0,y0,z0],[x1,y1,z1]]}  当前实体（没有实体时 volume=0）
//   export(fmt) → Promise<Blob>   fmt：'3mf' 'step' 'dxf' 'svg' 'pdf' 'project'（dxf/svg/pdf 规则同 #export-*）；load(project对象) → Promise
//
// ───── 导出判据 ─────
//   3MF：zip 内有 [Content_Types].xml、_rels/.rels 及其指向的 .model；单位毫米；每个网格封闭且朝向一致（每条有向边恰好一次、反向边也恰好一次）；
//        网格体积与公式相差 ≤0.5%；本机 Bambu Studio（A1 0.4／PLA／0.20mm）命令行切片 return_code=0，模型尺寸与 measure().bbox 相差 ≤0.1mm
//   STEP：判卷 OpenCascade 读入后体积与公式相差 ≤0.01%，包围盒 ≤0.01mm
//   DXF：ezdxf 严格读取通过，audit 零错误零修复；$INSUNITS=4；草图每条线/圆/弧对应一个 LINE/CIRCLE/ARC（草图坐标原样，≤1e-6；弧角 ≤1e-4°）；
//        每个尺寸是一个 DIMENSION，带有效几何块（*D…），ezdxf 量出的值与尺寸值相差 ≤1e-6（角度用度）；文字是 TEXT/MTEXT，中文原样。
//        工程图 DXF：1:1 实际尺寸；图框、标题栏放在名字含 FRAME 的图层；三个视图各成一团（判卷按包围盒聚团），实线外形＝零件尺寸；
//        （2026-10-04 领导批准修改：三视图之外允许再有一个轴测图团，即共 3 或 4 团）
//        隐藏线用虚线线型（LTYPE 带虚线图案）；自动带总长、总宽、总高三个 DIMENSION；标题栏文字含项目名。
//   SVG：浏览器 DOMParser 解析无错；有 viewBox，width/height 以 mm 结尾；图形元素数 ≥ 草图实体数；文字原样；渲染出来不是白板
//   PDF：pypdf 能读；页面 A4 或 A3（横竖都行，误差 2pt）；矢量（画线指令 ≥10、没有位图）；文字可提取（中文原样，尺寸数字搜得到）
//   项目：export('project') 是 JSON；reset 后 load 它，features() 与体积完全一致
// ───── 流畅度判据 ─────
//   三维右键旋转约 2.5 秒：帧间隔 p95 ≤25ms，超 50ms 的帧 ≤2 个；二维拖点：p95 ≤34ms，超 50ms ≤3 个；
//   重模型（200×200 板 64 孔 + 4 圆角）改深度后边旋转边等：期间最长帧间隔 ≤150ms、最长主线程长任务 ≤150ms、20 秒内重建完。

import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JUDGE = path.join(ROOT, 'tools', 'judge');
const PW = 'C:/Users/73405/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SUB = '/glass-cad/';
const GROUPS = ['build', 'boot', 'ui', 'sketch', 'solver', 'model', 'heavy', 'ui3d', 'sheet', 'persist'];

// ───── 参数（不认识的一律报错退出，防止 --url 地址 被静默忽略）─────
const argv = process.argv.slice(2);
let URL0 = null, PROVE = false, ONLY = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--prove') PROVE = true;
  else if (a === '--url') URL0 = argv[++i] || '';
  else if (a.startsWith('--url=')) URL0 = a.slice(6);
  else if (a === '--only') ONLY = (argv[++i] || '').split(',');
  else if (a.startsWith('--only=')) ONLY = a.slice(7).split(',');
  else { console.log('判卷参数不认识：' + a); process.exit(3); }
}
if (URL0 !== null && !/^https?:\/\/[^/]+\/.*\/$/.test(URL0)) { console.log('--url 要给以 / 结尾的完整网址'); process.exit(3); }
if (ONLY && ONLY.some(g => !GROUPS.includes(g))) { console.log('--only 组名不认识：' + ONLY.join(',')); process.exit(3); }
if (PROVE && (URL0 || ONLY)) { console.log('--prove 不能和 --url / --only 同用'); process.exit(3); }

for (const f of [path.join(JUDGE, 'node_modules/replicad/package.json'), path.join(JUDGE, 'node_modules/fflate/package.json'),
  path.join(JUDGE, 'pylib/ezdxf/__init__.py'), path.join(JUDGE, 'pylib/pypdf/__init__.py'), PW, CHROME]) {
  if (!fs.existsSync(f)) {
    console.log('判卷依赖缺失：' + f + '\n安装：npm ci --prefix tools/judge ；python -m pip install --target tools/judge/pylib -r tools/judge/requirements.txt');
    process.exit(3);
  }
}
const preq = createRequire(PW);
const { chromium } = preq('playwright');
const { PNG } = preq('pngjs');
const fflate = createRequire(path.join(JUDGE, 'package.json'))('fflate');

const LIM = URL0 ? { ui: 8000, kernel: 40000 } : { ui: 3000, kernel: 10000 };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'glasscad-judge-'));
const SHOT = path.join(ROOT, 'shots');
fs.mkdirSync(SHOT, { recursive: true });

let results = [], ERRORS = [], EXTERNAL = [], SAB = {}, BASE = '', ORIGIN = '';
const rec = (id, ok, msg = '') => { results.push({ id, ok: !!ok, msg }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${msg}`); };
const tid = id => `[data-testid="${id}"]`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const relErr = (a, b) => Math.abs(a - b) / Math.max(1e-9, Math.abs(b));
const f2 = x => (typeof x === 'number' && isFinite(x)) ? (Math.round(x * 1e4) / 1e4).toString() : String(x);
const PI = Math.PI;
async function chk(id, fn) {
  try { const [ok, msg] = await fn(); rec(id, ok, msg); return !!ok; }
  catch (e) { rec(id, false, '出错：' + String(e && e.message || e).split('\n')[0].slice(0, 220)); return false; }
}

// ───── 外部工具 ─────
function py(script, file) {
  const r = spawnSync('python', [path.join(JUDGE, script), file], {
    env: { ...process.env, PYTHONPATH: path.join(JUDGE, 'pylib'), PYTHONIOENCODING: 'utf-8' }, encoding: 'utf-8', timeout: 400000, maxBuffer: 64 << 20,
  });
  try { return JSON.parse((r.stdout || '').trim().split('\n').pop()); }
  catch (e) { return { ok: false, error: 'python 输出解析失败：' + String(r.stderr || r.stdout || r.error || '').slice(-300) }; }
}
function stepVolume(file) {
  const r = spawnSync(process.execPath, [path.join(JUDGE, 'step_volume.mjs'), file], { encoding: 'utf-8', timeout: 180000, cwd: JUDGE, maxBuffer: 64 << 20 });
  try { return JSON.parse((r.stdout || '').trim().split('\n').pop()); }
  catch (e) { return { ok: false, error: String(r.stderr || r.error || '').slice(-300) }; }
}
const png = b => PNG.sync.read(b);
function diffRatio(b1, b2) {
  const a = png(b1), b = png(b2);
  if (a.width !== b.width || a.height !== b.height) return 1;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2])) > 24) n++;
  }
  return n / (a.width * a.height);
}
function lum(b) { const a = png(b); let s = 0; for (let i = 0; i < a.data.length; i += 4) s += 0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2]; return s / (a.width * a.height) / 255; }
function dirStat(d) { let tot = 0, max = 0; if (!fs.existsSync(d)) return { tot, max }; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { const s = dirStat(p); tot += s.tot; max = Math.max(max, s.max); } else { const z = fs.statSync(p).size; tot += z; max = Math.max(max, z); } } return { tot, max }; }

// 3MF：判卷自己解压、展开 build/components 变换、查封闭与朝向、算体积和包围盒
function parse3mf(buf) {
  let files;
  try { files = fflate.unzipSync(new Uint8Array(buf)); } catch (e) { return { ok: false, error: '不是合法 zip：' + e.message }; }
  if (!files['[Content_Types].xml'] || !files['_rels/.rels']) return { ok: false, error: '缺 [Content_Types].xml 或 _rels/.rels' };
  const rels = fflate.strFromU8(files['_rels/.rels']);
  const m = rels.match(/Target="\/?([^"]+\.model)"/i);
  const name = m && m[1];
  if (!name || !files[name]) return { ok: false, error: '.rels 没指向存在的 .model' };
  const xml = fflate.strFromU8(files[name]);
  const unit = (xml.match(/<model\b[^>]*\sunit="([^"]+)"/) || [])[1] || 'millimeter';
  if (unit !== 'millimeter') return { ok: false, error: '单位不是毫米：' + unit };
  const at = (s, k) => { const r = s.match(new RegExp('\\s' + k + '="([^"]*)"')); return r ? r[1] : null; };
  const objs = {};
  for (const om of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const V = [], T = [], C = [];
    for (const v of om[2].matchAll(/<vertex\b([^>]*?)\/?>/g)) V.push([+at(v[1], 'x'), +at(v[1], 'y'), +at(v[1], 'z')]);
    for (const t of om[2].matchAll(/<triangle\b([^>]*?)\/?>/g)) T.push([+at(t[1], 'v1'), +at(t[1], 'v2'), +at(t[1], 'v3')]);
    for (const c of om[2].matchAll(/<component\b([^>]*?)\/?>/g)) C.push({ id: at(c[1], 'objectid'), tf: at(c[1], 'transform') });
    objs[at(om[1], 'id')] = { V, T, C };
  }
  const M = s => { if (!s) return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]; const a = s.trim().split(/\s+/).map(Number); return a.length === 12 ? a : null; };
  const mul = (A, B) => { // 行向量约定：p' = p·A·B
    const r = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const a = k => (i < 3 ? A[i * 3 + k] : A[9 + k]);
      r[i * 3 + j] = a(0) * B[j] + a(1) * B[3 + j] + a(2) * B[6 + j] + (i === 3 ? B[9 + j] : 0);
    }
    return r;
  };
  const items = [...xml.matchAll(/<item\b([^>]*?)\/?>/g)].map(i => ({ id: at(i[1], 'objectid'), tf: at(i[1], 'transform') }));
  if (!items.length) return { ok: false, error: '<build> 里没有 <item>' };
  let vol = 0, tris = 0; const lo = [1e18, 1e18, 1e18], hi = [-1e18, -1e18, -1e18]; let err = null;
  const walk = (id, T, depth) => {
    const o = objs[id];
    if (!o || depth > 8) { err = err || '引用了不存在的 object ' + id; return; }
    for (const c of o.C) { const t = M(c.tf); if (!t) { err = 'component transform 格式错'; return; } walk(c.id, mul(t, T), depth + 1); }
    if (!o.T.length) return;
    const P = o.V.map(p => [0, 1, 2].map(j => p[0] * T[j] + p[1] * T[3 + j] + p[2] * T[6 + j] + T[9 + j]));
    const edges = new Map();
    for (const [a, b, c] of o.T) {
      if (!(a >= 0 && b >= 0 && c >= 0 && a < P.length && b < P.length && c < P.length) || a === b || b === c || a === c) { err = err || '三角形顶点下标越界或退化'; return; }
      for (const [x, y] of [[a, b], [b, c], [c, a]]) { const k = x + ',' + y; edges.set(k, (edges.get(k) || 0) + 1); }
      const [p, q, r] = [P[a], P[b], P[c]];
      vol += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
      tris++;
    }
    for (const [k, n] of edges) { const [x, y] = k.split(','); if (n !== 1 || edges.get(y + ',' + x) !== 1) { err = err || '网格不封闭或朝向不一致（有向边 ' + k + ' 出现 ' + n + ' 次，反向 ' + (edges.get(y + ',' + x) || 0) + ' 次）'; break; } }
    for (const p of P) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], p[j]); hi[j] = Math.max(hi[j], p[j]); }
  };
  for (const it of items) { const t = M(it.tf); if (!t) return { ok: false, error: 'item transform 格式错' }; walk(it.id, t, 0); }
  if (err) return { ok: false, error: err };
  if (!tris) return { ok: false, error: '没有三角形' };
  return { ok: true, volume: vol, tris, bbox: [lo, hi] };
}

// ───── 静态服务器 ─────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
function serve() {
  const DIST = path.join(ROOT, 'dist');
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (u === '/favicon.ico') { rsp.writeHead(204); return rsp.end(); }
      if (!u.startsWith(SUB)) { rsp.writeHead(302, { location: SUB }); return rsp.end(); }
      let f = path.join(DIST, u.slice(SUB.length));
      if (!f.startsWith(DIST)) { rsp.writeHead(403); return rsp.end(); }
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!fs.existsSync(f)) { rsp.writeHead(404); return rsp.end('404'); }
      rsp.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'content-length': fs.statSync(f).size, 'cache-control': 'no-store' });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

// ───── 注入页面：帧探针、判卷自己的建模小工具、反向验证用的破坏（都是判卷的，和网页代码无关）─────
function initScript(sab) {
  const RAF = window.requestAnimationFrame.bind(window);
  const P = window.__probe = { frames: [], longtasks: [] };
  const fr = () => { P.frames.push(performance.now()); if (P.frames.length > 30000) P.frames.splice(0, 10000); RAF(fr); };
  RAF(fr);
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) P.longtasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) { }
  P.stats = (t0, t1) => {
    const f = [t0, ...P.frames.filter(x => x > t0 && x < t1), t1], d = [];
    for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]);
    const lt = P.longtasks.filter(([s, du]) => s + du >= t0 && s <= t1).map(x => x[1]);
    const s = d.slice().sort((a, b) => a - b);
    return { n: d.length, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], slow: d.filter(x => x > 50).length, max: s[s.length - 1], lt: lt.length ? Math.max(...lt) : 0 };
  };
  window.__fx = {
    async rect(s, x0, y0, w, h, fix) {
      const C = window.__cad.cmd, p = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]], L = [];
      for (let i = 0; i < 4; i++) L.push(await C.line(s, p[i], p[(i + 1) % 4]));
      for (let i = 0; i < 4; i++) await C.constrain(s, 'coincident', L[i] + '.b', L[(i + 1) % 4] + '.a');
      await C.constrain(s, 'horizontal', L[0]); await C.constrain(s, 'horizontal', L[2]);
      await C.constrain(s, 'vertical', L[1]); await C.constrain(s, 'vertical', L[3]);
      if (fix) await C.constrain(s, 'fix', L[0] + '.a');
      const dW = await C.dim(s, 'length', [L[0]], w), dH = await C.dim(s, 'length', [L[1]], h);
      return { L, dW, dH };
    },
    async hole(s, corner, x, y, r) {
      const C = window.__cad.cmd, c = await C.circle(s, [x, y], r);
      await C.dim(s, 'diameter', [c], 2 * r); await C.dim(s, 'hdist', [corner, c + '.c'], x); await C.dim(s, 'vdist', [corner, c + '.c'], y);
      return c;
    },
    uv(pl, Q) { const d = [0, 1, 2].map(i => Q[i] - pl.origin[i]); const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; return [dot(d, pl.u), dot(d, pl.v)]; },
  };
  const css = t => { const f = () => { const s = document.createElement('style'); s.textContent = t; (document.head || document.documentElement).appendChild(s); }; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', f); else f(); };
  if (sab.noglass) css('*,*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}');
  if (sab.hscroll) css('html::after{content:"";display:block;position:absolute;left:0;top:0;width:3000px;height:2px}');
  if (sab.cjk) setInterval(() => {
    if (document.documentElement.lang === 'en' && document.body && !document.getElementById('__sabcjk')) {
      const d = document.createElement('div'); d.id = '__sabcjk'; d.textContent = '拉伸草图';
      d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;color:#000;background:#fff;font-size:14px'; document.body.appendChild(d);
    }
  }, 200);
  if (sab.freeze) for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    for (const f of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'clear']) {
      const o = C.prototype[f]; if (!o) continue;
      C.prototype[f] = function (...a) { if (window.__freeze) return; return o.apply(this, a); };
    }
  }
  if (sab.jank) { const r = window.requestAnimationFrame; window.requestAnimationFrame = cb => r.call(window, t => { const s = performance.now(); while (performance.now() - s < 30); cb(t); }); }
  if (sab.hog && window.Worker) { const W = window.Worker; window.Worker = class extends W { constructor(...a) { super(...a); this.addEventListener('message', () => { const s = performance.now(); while (performance.now() - s < 400); }); } }; }
  if (sab.extern) setTimeout(() => { try { fetch('https://example.com/glasscad-judge-probe', { mode: 'no-cors' }).catch(() => { }); } catch (e) { } }, 300);
  if (sab.error) setTimeout(() => { throw new Error('judge sabotage error'); }, 800);
  if (sab.noundo) window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) e.stopImmediatePropagation(); }, true);
  if (sab.nopersist) {
    try { Storage.prototype.getItem = function () { return null; }; } catch (e) { }
    try { const o = IDBFactory.prototype.open; IDBFactory.prototype.open = function (n, v) { return o.call(this, n + '-judge-' + Math.random().toString(36).slice(2), v); }; } catch (e) { }
  }
  if (sab.noorbit) for (const ev of ['pointerdown', 'mousedown', 'wheel']) window.addEventListener(ev, e => { if (ev === 'wheel' || e.button === 2 || e.button === 1) e.stopImmediatePropagation(); }, { capture: true, passive: true });
  if (sab.lievol || sab.corrupt || sab.dimlie || sab.noundo) {
    let v;
    const wrap = x => new Proxy(x, {
      get(t, k) {
        const o = Reflect.get(t, k);
        if (k === 'measure' && sab.lievol) return (...a) => { const r = o.apply(t, a); const f = m => ({ ...m, volume: m.volume * 1.03 }); return r && r.then ? r.then(f) : f(r); };
        if (k === 'export' && (sab.corrupt || sab.dimlie)) return async (fmt, ...a) => {
          const b = await o.call(t, fmt, ...a);
          if (sab.corrupt && fmt === '3mf') { const u = new Uint8Array(await b.arrayBuffer()); return new Blob([u.slice(0, Math.floor(u.length * 0.6))]); }
          if (sab.dimlie && fmt === 'dxf') { const s = await b.text(); return new Blob([s.split('DIMENSION').join('DIMENSXON')]); }
          return b;
        };
        if ((k === 'undo' || k === 'redo') && sab.noundo) return () => { };
        return typeof o === 'function' ? o.bind(t) : o;
      },
    });
    Object.defineProperty(window, '__cad', { configurable: true, get() { return v; }, set(x) { v = x && typeof x === 'object' ? wrap(x) : x; } });
  }
}

// ───── 浏览器小工具 ─────
async function newCtx(browser, o = {}) {
  const ctx = await browser.newContext({ viewport: o.vp || { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true, colorScheme: o.scheme || 'light', locale: 'zh-CN' });
  ctx.setDefaultTimeout(10000);
  await ctx.addInitScript(initScript, SAB);
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (/^(data|blob):/.test(u) || u.startsWith(ORIGIN + '/')) return route.continue();
    EXTERNAL.push(u.slice(0, 120)); return route.abort();
  });
  return ctx;
}
function hook(page) {
  page.on('pageerror', e => ERRORS.push('页面异常：' + String(e && e.message || e).slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error') ERRORS.push('console.error：' + m.text().slice(0, 160)); });
}
async function openApp(ctx, page) {
  if (!page) { page = await ctx.newPage(); hook(page); }
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  let tUi = null, tK = null;
  try { await page.waitForFunction(() => window.__cad && window.__cad.ready && window.__cad.ready.ui === true, null, { timeout: LIM.ui * 4, polling: 50 }); tUi = Date.now() - t0; } catch (e) { }
  if (tUi !== null) try { await page.waitForFunction(() => window.__cad.ready.kernel === true, null, { timeout: LIM.kernel * 3, polling: 100 }); tK = Date.now() - t0; } catch (e) { }
  if (SAB.freeze) await page.evaluate(() => { window.__freeze = true; });
  return { page, tUi, tK };
}
const idle = (page, ms = 30000) => page.evaluate(ms => Promise.race([Promise.resolve(window.__cad.idle()).then(() => true), new Promise(r => setTimeout(() => r(false), ms))]), ms);
const vol = async page => (await page.evaluate(() => window.__cad.measure())).volume;
const feats = page => page.evaluate(() => window.__cad.features());
async function getFile(page, fmt) {
  const b64 = await page.evaluate(async fmt => {
    const b = await window.__cad.export(fmt);
    return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(b); });
  }, fmt);
  const buf = Buffer.from(b64, 'base64');
  const f = path.join(TMP, `${fmt}-${crypto.randomBytes(4).toString('hex')}.${fmt === 'project' ? 'json' : fmt}`);
  fs.writeFileSync(f, buf);
  return { buf, f };
}
async function download(page, id) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click(tid(id))]);
  const f = path.join(TMP, crypto.randomBytes(4).toString('hex') + '-' + dl.suggestedFilename());
  await dl.saveAs(f);
  return { name: dl.suggestedFilename(), buf: fs.readFileSync(f), f };
}
const SIG = { dxf: [/\.dxf$/i, b => /^\s*0\s*\r?\n\s*SECTION/.test(b.slice(0, 64).toString('latin1'))], svg: [/\.svg$/i, b => /<svg[\s>]/.test(b.toString('utf8'))], pdf: [/\.pdf$/i, b => b.slice(0, 5).toString('latin1') === '%PDF-'], '3mf': [/\.3mf$/i, b => b[0] === 0x50 && b[1] === 0x4b], step: [/\.(step|stp)$/i, b => b.slice(0, 64).toString('latin1').includes('ISO-10303-21')], json: [/\.json$/i, b => { try { JSON.parse(b.toString('utf8')); return true; } catch (e) { return false; } }] };
async function blur(page) { await page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); }); }
async function vpRect(page) { return page.evaluate(() => { const e = document.querySelector('[data-testid="viewport"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }); }
async function freeAt(page, pts) {
  return page.evaluate(pts => pts.map(p => { const vp = document.querySelector('[data-testid="viewport"]'); const e = document.elementFromPoint(p.x, p.y); return !!(vp && e && vp.contains(e)); }).every(Boolean), pts);
}
async function shotVp(page) { const r = await vpRect(page); return page.screenshot(r ? { clip: { x: r.x, y: r.y, width: Math.max(1, r.w), height: Math.max(1, r.h) } } : {}); }
const stats = (page, t0, t1) => page.evaluate(([a, b]) => window.__probe.stats(a, b), [t0, t1]);
const now = page => page.evaluate(() => performance.now());
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/g;

// ═════ 各组检查 ═════
async function gBuild() {
  await chk('build.npm', async () => {
    if (!fs.existsSync(path.join(ROOT, 'package.json'))) return [false, '没有 package.json'];
    const r = spawnSync('npm run build', { cwd: ROOT, shell: true, encoding: 'utf-8', timeout: 900000, maxBuffer: 64 << 20 });
    const has = fs.existsSync(path.join(ROOT, 'dist', 'index.html'));
    return [r.status === 0 && has, `npm run build 退出码 ${r.status}，dist/index.html ${has ? '有' : '没有'}${r.status ? '：' + String(r.stderr || r.stdout || '').slice(-200) : ''}`];
  });
  await chk('build.size', async () => { const s = dirStat(path.join(ROOT, 'dist')); return [s.tot > 0 && s.tot <= 80e6 && s.max <= 50e6, `dist 合计 ${(s.tot / 1e6).toFixed(1)}MB（≤80），最大单文件 ${(s.max / 1e6).toFixed(1)}MB（≤50）`]; });
}

async function gBoot(browser) {
  const ctx = await newCtx(browser);
  const { page, tUi, tK } = await openApp(ctx);
  rec('boot.ui', tUi !== null && tUi <= LIM.ui, `界面就绪 ${tUi ?? '超时'}ms（≤${LIM.ui}）`);
  rec('boot.kernel', tK !== null && tK <= LIM.kernel, `内核就绪 ${tK ?? '超时'}ms（≤${LIM.kernel}）`);
  await chk('boot.api', async () => {
    const miss = await page.evaluate(() => {
      const c = window.__cad || {};
      const top = ['idle', 'mode', 'reset', 'active', 'toScreen', 'project', 'sketch', 'sketches', 'features', 'measure', 'export', 'load', 'undo', 'redo'];
      const cmd = ['sketch', 'line', 'circle', 'arc', 'text', 'construction', 'constrain', 'dim', 'setDim', 'del', 'finish', 'extrude', 'revolve', 'fillet', 'chamfer', 'shell', 'setParam', 'suppress'];
      return [...top.filter(k => typeof c[k] !== 'function'), ...cmd.filter(k => !c.cmd || typeof c.cmd[k] !== 'function').map(k => 'cmd.' + k), ...(c.ready && typeof c.ready === 'object' ? [] : ['ready'])];
    });
    return [miss.length === 0, miss.length ? '缺：' + miss.join(' ') : '判卷入口齐全'];
  });
  await page.screenshot({ path: path.join(SHOT, 'boot.png') });
  await ctx.close();
}

async function textInfo(page) {
  return page.evaluate(() => {
    const out = [];
    const walk = n => {
      if (n.nodeType === 1) {
        if (n.hasAttribute('data-user-content') || n.dataset.testid === 'lang' || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.tagName)) return;
        const st = getComputedStyle(n); if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity === 0) return;
      }
      if (n.nodeType === 3) { const p = n.parentElement; if (p && p.getClientRects().length) out.push(n.textContent); return; }
      for (const c of n.childNodes) walk(c);
    };
    walk(document.body);
    const txt = out.join(' ');
    const btns = [...document.querySelectorAll('[data-testid^="tool-"],[data-testid^="feat-"],[data-testid^="view-"]')].filter(b => !/^(INPUT|SELECT|TEXTAREA)$/.test(b.tagName));
    return { cjk: (txt.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length, sample: (txt.match(/[\u3400-\u9fff]+/g) || []).slice(0, 6).join('、'), labels: btns.map(b => [b.dataset.testid, (b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent || '').trim()]) };
  });
}
async function glassInfo(page) {
  return page.evaluate(() => {
    const alpha = s => { const m = s.match(/\/\s*([\d.]+%?)\s*\)$/); if (m) return m[1].endsWith('%') ? parseFloat(m[1]) / 100 : +m[1]; const r = s.match(/rgba?\(([^)]+)\)/); if (!r) return 1; const p = r[1].split(/[\s,]+/).filter(Boolean); return p.length >= 4 ? +p[3] : 1; };
    const list = [];
    for (const el of document.querySelectorAll('body *')) {
      const st = getComputedStyle(el); const bf = st.backdropFilter || st.webkitBackdropFilter || '';
      const m = bf.match(/blur\(([\d.]+)px\)/); if (!m || +m[1] < 8) continue;
      const r = el.getBoundingClientRect(); if (r.width < 24 || r.height < 24 || st.visibility === 'hidden' || +st.opacity < 0.5 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      const a = alpha(st.backgroundColor); if (!(a > 0.02 && a < 0.9)) continue;
      list.push(el.dataset.testid || String(el.className).slice(0, 20) || el.tagName);
    }
    return { n: list.length, list: list.slice(0, 6) };
  });
}
const NEED_2D = ['tool-select', 'tool-line', 'tool-rect', 'tool-circle', 'tool-dim', 'export-dxf', 'export-svg', 'export-pdf'];
const NEED_3D = ['new-sketch', 'sketch-done', 'feat-extrude', 'feat-cut', 'feat-revolve', 'feat-fillet', 'feat-chamfer', 'feat-shell', 'view-front', 'view-top', 'view-left', 'view-iso', 'view-fit', 'export-3mf', 'export-step', 'make-sheet', 'project-name'];

async function gUi(browser) {
  const dctx = await newCtx(browser, { scheme: 'dark' });
  const d = await openApp(dctx);
  const dt = await d.page.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.lang]);
  await dctx.close();
  const ctx = await newCtx(browser);
  const { page } = await openApp(ctx);
  const lt = await page.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.lang]);
  rec('ui.defaults', lt[0] === 'light' && dt[0] === 'dark' && lt[1] === 'zh-CN', `系统浅色→${lt[0]}，系统深色→${dt[0]}，首次语言 ${lt[1]}`);
  await chk('ui.topright', async () => {
    const r = await page.evaluate(() => ['theme', 'lang'].map(k => { const e = document.querySelector(`[data-testid="${k}"]`); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), b.width > 0 && b.height > 0]; }));
    const ok = r.every(x => x && x[2] && x[1] < 80 && x[0] > 1440 - 420);
    return [ok, `#theme ${JSON.stringify(r[0])} #lang ${JSON.stringify(r[1])}（要 top<80、left>1020）`];
  });
  const g1 = await glassInfo(page);
  const l1 = lum(await page.screenshot());
  await page.screenshot({ path: path.join(SHOT, 'ui-light-zh.png') });
  let th2 = null, l2 = 0, g2 = { n: 0, list: [] };
  try { await page.click(tid('theme'), { timeout: 5000 }); await sleep(700); th2 = await page.evaluate(() => document.documentElement.dataset.theme); l2 = lum(await page.screenshot()); g2 = await glassInfo(page); } catch (e) { }
  rec('ui.theme', lt[0] === 'light' && th2 === 'dark' && l1 > 0.55 && l2 < 0.35, `浅色 data-theme=${lt[0]} 平均亮度 ${l1.toFixed(2)}（>0.55）→ 点 #theme 后 ${th2} 亮度 ${l2.toFixed(2)}（<0.35）`);
  rec('ui.glass', g1.n >= 3 && g2.n >= 3, `浅色 ${g1.n} 个（${g1.list.join(' ')}），深色 ${g2.n} 个（${g2.list.join(' ')}），各要 ≥3`);
  await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(1500);
  const th3 = await page.evaluate(() => document.documentElement.dataset.theme);
  // 语言：2d 与 3d 两种模式下都查
  const zh = [], en = []; let has = null;
  for (const m of ['mode-2d', 'mode-3d']) {
    try { await page.click(tid(m), { timeout: 5000 }); await sleep(500); } catch (e) { }
    zh.push(await textInfo(page));
    const miss = await page.evaluate(ids => ids.filter(i => !document.querySelector(`[data-testid="${i}"]`)), [...NEED_2D, ...NEED_3D, 'theme', 'lang', 'mode-2d', 'mode-3d', 'mode-sheet', 'viewport', 'save', 'open']);
    has = has ? has.filter(i => miss.includes(i)) : miss; // 二维、三维任一模式里有就算有
  }
  let lang2 = null;
  try { await page.click(tid('lang'), { timeout: 5000 }); await sleep(600); lang2 = await page.evaluate(() => document.documentElement.lang); } catch (e) { }
  for (const m of ['mode-2d', 'mode-3d']) { try { await page.click(tid(m), { timeout: 5000 }); await sleep(500); } catch (e) { } en.push(await textInfo(page)); }
  await page.screenshot({ path: path.join(SHOT, 'ui-dark-en.png') });
  await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(1500);
  const lang3 = await page.evaluate(() => document.documentElement.lang);
  rec('ui.prefs-persist', th3 === 'dark' && lang3 === 'en', `刷新后主题 ${th3}（要 dark），语言 ${lang3}（要 en）`);
  rec('ui.controls', has.length === 0, has.length ? '页面里找不到：' + has.join(' ') : '按钮齐全');
  const zhBad = zh.flatMap(t => t.labels.filter(([, l]) => !l || !l.match(CJK)).map(x => x[0]));
  const enBad = en.flatMap(t => t.labels.filter(([, l]) => !l || l.match(CJK)).map(x => x[0]));
  const zhMin = Math.min(...zh.map(t => t.cjk)), enMax = Math.max(...en.map(t => t.cjk));
  rec('ui.i18n', lang2 === 'en' && zhMin >= 20 && enMax === 0 && !zhBad.length && !enBad.length,
    `中文可见汉字 ${zhMin}（≥20）；切 en 后 lang=${lang2}、可见汉字 ${enMax}（要 0）${en.map(t => t.sample).filter(Boolean).join('；') ? '：' + en.map(t => t.sample).join('；') : ''}；按钮标签不合格 中文[${[...new Set(zhBad)].join(' ')}] 英文[${[...new Set(enBad)].join(' ')}]`);
  try { await page.click(tid('lang'), { timeout: 5000 }); await page.click(tid('theme'), { timeout: 5000 }); } catch (e) { }
  const lay = [];
  for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(vp); await sleep(600);
    lay.push(await page.evaluate(() => { const e = document.querySelector('[data-testid="viewport"]'); const r = e ? e.getBoundingClientRect() : { width: 0, height: 0 }; return { sw: document.documentElement.scrollWidth, w: innerWidth, area: (r.width * r.height) / (innerWidth * innerHeight) }; }));
  }
  rec('ui.layout', lay.every(l => l.sw <= l.w && l.area >= 0.45), lay.map(l => `scrollWidth ${l.sw}/${l.w}，#viewport 占 ${(l.area * 100).toFixed(0)}%`).join('；'));
  await ctx.close();
}

// 二维：真鼠标画矩形、标尺寸改尺寸、画圆、连续线、拖点、撤销重做、以光标缩放、三种导出
async function gSketch(browser) {
  const ctx = await newCtx(browser);
  const { page } = await openApp(ctx);
  const S = (sid, uv) => page.evaluate(([s, p]) => window.__cad.toScreen(s, p), [sid, uv]);
  const sk = sid => page.evaluate(s => window.__cad.sketch(s), sid);
  const click = async (p, steps = 5) => { await page.mouse.move(p.x, p.y, { steps }); await page.mouse.down(); await page.mouse.up(); await sleep(150); };
  await page.evaluate(() => window.__cad.reset()); await idle(page);
  try { await page.click(tid('mode-2d'), { timeout: 5000 }); } catch (e) { }
  await idle(page); await sleep(500);
  const sid = await page.evaluate(() => window.__cad.active());
  let ppm = 0, viewOk = false;
  if (sid) {
    const a = await S(sid, [0, 0]), b = await S(sid, [10, 0]);
    ppm = Math.hypot(b.x - a.x, b.y - a.y) / 10;
    const corners = [];
    for (const u of [-10, 45, 100]) for (const v of [-50, 5, 60]) corners.push(await S(sid, [u, v]));
    viewOk = ppm >= 3 && await freeAt(page, corners);
  }
  rec('sketch.view', !!sid && viewOk, `进入二维后编辑中草图 ${sid}，1mm＝${ppm.toFixed(2)}px（≥3），u[−10,100]×v[−50,60] 全部可见且未被挡住：${viewOk}`);
  if (!sid || !viewOk) { for (const k of ['rect', 'dim-create', 'dim-drive', 'dof', 'circle', 'circle-dim', 'polyline', 'drag', 'drag-fps', 'undo', 'zoom', 'dxf', 'svg', 'pdf', 'download']) rec('sketch.' + k, false, '前置失败：sketch.view 没过'); await ctx.close(); return; }
  const tol = Math.max(0.6, 2 / ppm);
  const lines = s => s.entities.filter(e => e.type === 'line' && !e.construction);
  const isHV = l => Math.abs(l.a[0] - l.b[0]) <= 1e-6 || Math.abs(l.a[1] - l.b[1]) <= 1e-6;
  const len = l => Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
  const rectOf = (s, ids) => lines(s).filter(l => ids.includes(l.id));
  // 矩形
  await page.click(tid('tool-rect'));
  await click(await S(sid, [10, 10])); await click(await S(sid, [50, 40]), 8);
  await page.keyboard.press('Escape'); await idle(page);
  let s1 = await sk(sid);
  const R = lines(s1); const rid = R.map(l => l.id);
  const xs = R.flatMap(l => [l.a[0], l.b[0]]), ys = R.flatMap(l => [l.a[1], l.b[1]]);
  rec('sketch.rect', R.length === 4 && R.every(isHV) && Math.abs(Math.min(...xs) - 10) <= tol && Math.abs(Math.max(...xs) - 50) <= tol && Math.abs(Math.min(...ys) - 10) <= tol && Math.abs(Math.max(...ys) - 40) <= tol && s1.dof === 4,
    `线 ${R.length} 条（要 4）、全部横平竖直 ${R.every(isHV)}、范围 x[${f2(Math.min(...xs))},${f2(Math.max(...xs))}] y[${f2(Math.min(...ys))},${f2(Math.max(...ys))}]（要≈[10,50]×[10,40]±${f2(tol)}）、自由度 ${s1.dof}（要 4）`);
  async function dimEdit(val) {
    const inp = page.locator(tid('dim-input'));
    if (!(await inp.isVisible().catch(() => false))) {
      await page.keyboard.press('Escape'); await page.click(tid('tool-select')); await sleep(200);
      const s = await sk(sid); const d = s.dims[s.dims.length - 1]; if (!d) return false;
      const p = await S(sid, d.label); await page.mouse.dblclick(p.x, p.y); await sleep(400);
    }
    if (!(await inp.isVisible().catch(() => false))) return false;
    await inp.fill(String(val)); await inp.press('Enter'); await idle(page); await sleep(200);
    return true;
  }
  async function dimOn(at, place) {
    await page.click(tid('tool-dim')); await sleep(150);
    await click(await S(sid, at)); await click(await S(sid, place), 6); await sleep(300);
  }
  // 标底边 → 改 50
  if (R.length === 4) {
    const hz = R.filter(l => Math.abs(l.a[1] - l.b[1]) < 1e-6).sort((p, q) => p.a[1] - q.a[1]);
    const bot = hz[0] || R[0];
    const mid = [(bot.a[0] + bot.b[0]) / 2, bot.a[1]];
    const n0 = s1.dims.length;
    await dimOn(mid, [mid[0], mid[1] - 8]);
    let s2 = await sk(sid); const d = s2.dims[s2.dims.length - 1];
    rec('sketch.dim-create', s2.dims.length === n0 + 1 && d && Math.abs(d.value - len(bot)) <= 1e-6, `新增尺寸 ${s2.dims.length - n0} 个（要 1），类型 ${d && d.type}，值 ${d && f2(d.value)}（要等于当前边长 ${f2(len(bot))}）`);
    const e1 = await dimEdit(50);
    s2 = await sk(sid); const R2 = rectOf(s2, rid); const bot2 = R2.find(l => l.id === bot.id);
    rec('sketch.dim-drive', e1 && bot2 && Math.abs(len(bot2) - 50) <= 1e-6 && R2.length === 4 && R2.every(isHV), `改尺寸输入框 ${e1 ? '弹出' : '没弹出'}；底边 ${bot2 && f2(len(bot2))}（要 50）；仍横平竖直 ${R2.every(isHV)}`);
    const vt = R2.filter(l => Math.abs(l.a[0] - l.b[0]) < 1e-6).sort((p, q) => q.a[0] - p.a[0]);
    const right = vt[0] || R2[0];
    const rm = [right.a[0], (right.a[1] + right.b[1]) / 2];
    await dimOn(rm, [rm[0] + 8, rm[1]]);
    const e2 = await dimEdit(30);
    const s3 = await sk(sid); const r3 = rectOf(s3, rid).find(l => l.id === right.id);
    rec('sketch.dof', e2 && r3 && Math.abs(len(r3) - 30) <= 1e-6 && s3.dof === 2 && s3.status === 'ok', `右边 ${r3 && f2(len(r3))}（要 30），自由度 ${s3.dof}（要 2），status ${s3.status}`);
  } else { rec('sketch.dim-create', false, '没有矩形可标'); rec('sketch.dim-drive', false, '没有矩形可标'); rec('sketch.dof', false, '没有矩形可标'); }
  // 圆
  await page.keyboard.press('Escape'); await page.click(tid('tool-circle'));
  const nC0 = (await sk(sid)).entities.filter(e => e.type === 'circle').length;
  await click(await S(sid, [80, 25])); await click(await S(sid, [86, 25]), 6);
  await page.keyboard.press('Escape'); await idle(page);
  let sc = await sk(sid); const C = sc.entities.filter(e => e.type === 'circle').slice(nC0)[0];
  rec('sketch.circle', !!C && Math.hypot(C.c[0] - 80, C.c[1] - 25) <= tol && C.r >= 4 && C.r <= 7, C ? `圆心 (${f2(C.c[0])},${f2(C.c[1])}) 半径 ${f2(C.r)}（要≈(80,25)、4–7）` : '没画出圆');
  if (C) {
    const nd0 = sc.dims.length;
    await dimOn([C.c[0] + C.r, C.c[1]], [C.c[0] + C.r + 8, C.c[1] + 8]);
    const sd = await sk(sid); const dd = sd.dims[sd.dims.length - 1];
    const ok1 = sd.dims.length === nd0 + 1 && dd && /^(diameter|radius)$/.test(dd.type);
    const e3 = ok1 ? await dimEdit(dd.type === 'diameter' ? 12 : 6) : false;
    const C2 = (await sk(sid)).entities.find(e => e.id === C.id);
    rec('sketch.circle-dim', ok1 && e3 && C2 && Math.abs(C2.r - 6) <= 1e-6, `圆上标注类型 ${dd && dd.type}，改后半径 ${C2 && f2(C2.r)}（要 6）`);
  } else rec('sketch.circle-dim', false, '没有圆');
  // 连续线
  await page.keyboard.press('Escape'); await page.click(tid('tool-line'));
  const nL0 = lines(await sk(sid)).length;
  await click(await S(sid, [10, -20])); await click(await S(sid, [40, -20]), 6); await click(await S(sid, [40, -40]), 6);
  await page.keyboard.press('Escape'); await idle(page);
  const sl = await sk(sid); const NL = lines(sl).slice(nL0);
  const shared = NL.length === 2 && [[NL[0].a, NL[1].a], [NL[0].a, NL[1].b], [NL[0].b, NL[1].a], [NL[0].b, NL[1].b]].some(([p, q]) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= 1e-6);
  rec('sketch.polyline', NL.length === 2 && shared, `新增线 ${NL.length} 条（要 2），首尾相接 ${shared}`);
  // 拖点
  await page.keyboard.press('Escape'); await page.click(tid('tool-select')); await sleep(200);
  const sb = await sk(sid); const Rb = rectOf(sb, rid);
  let dragOk = false, dragMsg = '没有矩形', st = null, before = null;
  if (Rb.length === 4) {
    const pts = Rb.flatMap(l => [l.a, l.b]);
    const minx = Math.min(...pts.map(p => p[0])), maxy = Math.max(...pts.map(p => p[1])), miny = Math.min(...pts.map(p => p[1]));
    before = [minx, miny];
    const corner = [minx, maxy]; const p0 = await S(sid, corner);
    await page.mouse.move(p0.x, p0.y, { steps: 3 }); await sleep(100); await page.mouse.down();
    const t0 = await now(page);
    for (let i = 1; i <= 40; i++) { await page.mouse.move(p0.x + i * ppm * 15 / 40, p0.y - i * ppm * 10 / 40); await sleep(16); }
    await page.mouse.up(); const t1 = await now(page); await idle(page);
    st = await stats(page, t0, t1);
    const sa = await sk(sid); const Ra = rectOf(sa, rid); const pa = Ra.flatMap(l => [l.a, l.b]);
    const ax = Math.min(...pa.map(p => p[0])), ay = Math.min(...pa.map(p => p[1]));
    const lens = Ra.map(len).sort((a, b) => a - b);
    const moved = Math.hypot(ax - before[0], ay - before[1]);
    dragOk = Ra.length === 4 && Ra.every(isHV) && Math.abs(lens[0] - 30) <= 1e-6 && Math.abs(lens[3] - 50) <= 1e-6 && moved >= 5;
    dragMsg = `拖角点后矩形 ${f2(lens[3])}×${f2(lens[0])}（要 50×30）、横平竖直 ${Ra.every(isHV)}、整体移动 ${f2(moved)}mm（≥5）`;
  }
  rec('sketch.drag', dragOk, dragMsg);
  rec('sketch.drag-fps', !!st && st.p95 <= 34 && st.slow <= 3, st ? `拖动帧间隔 p95 ${st.p95.toFixed(1)}ms（≤34），超 50ms ${st.slow} 帧（≤3），帧数 ${st.n}` : '没拖成');
  // 撤销重做：撤掉刚才那次拖动
  await blur(page);
  const pos = async () => { const s = await sk(sid); const p = rectOf(s, rid).flatMap(l => [l.a, l.b]); return [Math.min(...p.map(q => q[0])), Math.min(...p.map(q => q[1]))]; };
  const afterDrag = await pos();
  await page.keyboard.press('Control+z'); await idle(page); await sleep(200);
  const u1 = await pos();
  await page.keyboard.press('Control+y'); await idle(page); await sleep(200);
  let r1 = await pos();
  if (Math.hypot(r1[0] - afterDrag[0], r1[1] - afterDrag[1]) > 1e-6) { await page.keyboard.press('Control+Shift+z'); await idle(page); await sleep(200); r1 = await pos(); }
  rec('sketch.undo', !!before && Math.hypot(u1[0] - before[0], u1[1] - before[1]) <= 1e-6 && Math.hypot(r1[0] - afterDrag[0], r1[1] - afterDrag[1]) <= 1e-6,
    `Ctrl+Z 后矩形回到 (${u1.map(f2)})（要 (${before && before.map(f2)})），重做后 (${r1.map(f2)})（要 (${afterDrag.map(f2)})）`);
  // 以光标为中心缩放
  const q0 = await S(sid, [30, 25]), q1 = await S(sid, [40, 25]);
  await page.mouse.move(q0.x, q0.y, { steps: 3 }); await page.mouse.wheel(0, -300); await sleep(700);
  const z0 = await S(sid, [30, 25]), z1 = await S(sid, [40, 25]);
  const k = Math.hypot(z1.x - z0.x, z1.y - z0.y) / Math.max(1e-6, Math.hypot(q1.x - q0.x, q1.y - q0.y));
  rec('sketch.zoom', Math.hypot(z0.x - q0.x, z0.y - q0.y) <= 4 && Math.abs(k - 1) >= 0.1, `滚轮后光标下的点漂了 ${Math.hypot(z0.x - q0.x, z0.y - q0.y).toFixed(1)}px（≤4），缩放倍数 ${k.toFixed(2)}（变化 ≥10%）`);
  await page.mouse.wheel(0, 300); await sleep(500);
  // 弧、文字，然后导出
  await page.evaluate(async s => { await window.__cad.cmd.arc(s, [80, -20], 8, 0, 90); await window.__cad.cmd.text(s, [10, 60], '测试零件 图纸', 5); }, sid);
  await idle(page);
  const sf = await sk(sid);
  await page.screenshot({ path: path.join(SHOT, 'sketch-2d.png') });
  const geo = sf.entities.filter(e => !e.construction && /^(line|circle|arc)$/.test(e.type));
  await chk('sketch.dxf', async () => {
    const { f } = await getFile(page, 'dxf'); const j = py('check_dxf.py', f);
    if (!j.ok) return [false, 'DXF 读不了：' + j.error];
    const E = j.entities, miss = [];
    const eq = (p, q) => Math.abs(p[0] - q[0]) <= 1e-6 && Math.abs(p[1] - q[1]) <= 1e-6;
    const ang = (a, b) => { const d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d <= 1e-4; };
    for (const e of geo) {
      const hit = e.type === 'line' ? E.some(x => x.type === 'LINE' && ((eq(x.a, e.a) && eq(x.b, e.b)) || (eq(x.a, e.b) && eq(x.b, e.a))))
        : e.type === 'circle' ? E.some(x => x.type === 'CIRCLE' && eq(x.c, e.c) && Math.abs(x.r - e.r) <= 1e-6)
          : E.some(x => x.type === 'ARC' && eq(x.c, e.c) && Math.abs(x.r - e.r) <= 1e-6 && ang(x.a0, e.a0) && ang(x.a1, e.a1));
      if (!hit) miss.push(e.type + ':' + e.id);
    }
    const ms = j.dims.map(x => x.measurement).filter(x => typeof x === 'number');
    const dimMiss = sf.dims.filter(d => { const i = ms.findIndex(m => Math.abs(m - d.value) <= 1e-6); if (i < 0) return true; ms.splice(i, 1); return false; });
    const okDims = j.dims.length === sf.dims.length && j.dims.every(x => x.blockOk) && !dimMiss.length;
    const okText = j.texts.some(t => t.includes('测试零件 图纸'));
    const ok = !j.auditErrors.length && !j.auditFixes.length && j.insunits === 4 && !miss.length && okDims && okText;
    return [ok, `audit 错 ${j.auditErrors.length} 修 ${j.auditFixes.length}${j.auditFixes.length ? '（' + j.auditFixes[0] + '）' : ''}；$INSUNITS=${j.insunits}；草图几何 ${geo.length} 个缺 ${miss.length}${miss.length ? '（' + miss.slice(0, 3).join(' ') + '）' : ''}；尺寸 DXF ${j.dims.length}/草图 ${sf.dims.length}、几何块全有效 ${j.dims.every(x => x.blockOk)}、值对不上 ${dimMiss.length}；中文文字 ${okText}`];
  });
  await chk('sketch.svg', async () => {
    const { buf } = await getFile(page, 'svg');
    const r = await page.evaluate(async t => {
      const d = new DOMParser().parseFromString(t, 'image/svg+xml');
      if (d.querySelector('parsererror') || d.documentElement.nodeName.toLowerCase() !== 'svg') return { ok: false, why: '解析失败' };
      const s = d.documentElement;
      const n = s.querySelectorAll('line,path,circle,polyline,polygon,rect,ellipse').length;
      const img = new Image(); img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(t)));
      try { await img.decode(); } catch (e) { return { ok: false, why: '渲染失败' }; }
      const c = document.createElement('canvas'); c.width = 800; c.height = 600; const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 800, 600); g.drawImage(img, 0, 0, 800, 600);
      const px = g.getImageData(0, 0, 800, 600).data; let ink = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 600) ink++;
      return { ok: true, vb: !!s.getAttribute('viewBox'), mm: /mm$/.test(s.getAttribute('width') || '') && /mm$/.test(s.getAttribute('height') || ''), n, text: s.textContent.includes('测试零件 图纸'), ink: ink / 480000 };
    }, buf.toString('utf8'));
    return [r.ok && r.vb && r.mm && r.n >= geo.length && r.text && r.ink >= 0.002, r.ok ? `viewBox ${r.vb}，宽高用 mm ${r.mm}，图形元素 ${r.n}（≥${geo.length}），中文文字 ${r.text}，墨迹 ${(r.ink * 100).toFixed(2)}%（≥0.2%）` : r.why];
  });
  await chk('sketch.pdf', async () => {
    const { f } = await getFile(page, 'pdf'); const j = py('check_pdf.py', f);
    if (!j.ok) return [false, 'PDF 读不了：' + j.error];
    const p = j.pages[0]; const sz = [p.w, p.h].sort((a, b) => a - b);
    const okSize = [[595.28, 841.89], [841.89, 1190.55]].some(([a, b]) => Math.abs(sz[0] - a) <= 2 && Math.abs(sz[1] - b) <= 2);
    const txt = j.pages.map(x => x.text).join('\n');
    return [okSize && p.pathOps >= 10 && j.pages.every(x => x.images === 0) && txt.includes('测试零件') && /(^|[^\d.])50([^\d]|$)/.test(txt),
      `页面 ${p.w.toFixed(0)}×${p.h.toFixed(0)}pt（A4/A3）${okSize}，画线指令 ${p.pathOps}（≥10），位图 ${j.pages.map(x => x.images).join('/')}（要 0），文字含"测试零件" ${txt.includes('测试零件')}、含尺寸 50 ${/(^|[^\d.])50([^\d]|$)/.test(txt)}`];
  });
  await chk('sketch.download', async () => {
    const got = [];
    for (const [id, k] of [['export-dxf', 'dxf'], ['export-svg', 'svg'], ['export-pdf', 'pdf']]) { const d = await download(page, id); got.push(`${d.name}:${SIG[k][0].test(d.name) && SIG[k][1](d.buf)}`); }
    return [got.every(g => g.endsWith(':true')), got.join(' ')];
  });
  await ctx.close();
}

// 约束求解（走判卷入口，数值核对）
async function gSolver(browser) {
  const ctx = await newCtx(browser);
  const { page } = await openApp(ctx);
  await page.evaluate(() => window.__cad.reset()); await idle(page);
  const r = await page.evaluate(async () => {
    const C = window.__cad.cmd, out = {};
    const s = await C.sketch('XY');
    const P = [[0.3, -0.2], [47, 3], [52, 28], [-2, 33]], L = [];
    for (let i = 0; i < 4; i++) L.push(await C.line(s, P[i], P[(i + 1) % 4]));
    await C.constrain(s, 'fix', L[0] + '.a');
    for (let i = 0; i < 4; i++) await C.constrain(s, 'coincident', L[i] + '.b', L[(i + 1) % 4] + '.a');
    await C.constrain(s, 'horizontal', L[0]); await C.constrain(s, 'horizontal', L[2]); await C.constrain(s, 'vertical', L[1]); await C.constrain(s, 'vertical', L[3]);
    const dW = await C.dim(s, 'length', [L[0]], 50); await C.dim(s, 'length', [L[1]], 30);
    await window.__cad.idle();
    out.rect = window.__cad.sketch(s); out.L = L; out.s = s; out.dW = dW;
    let threw = false;
    try { await C.dim(s, 'length', [L[0]], 60); await window.__cad.idle(); } catch (e) { threw = true; }
    out.conf = window.__cad.sketch(s); out.threw = threw;
    if (!threw) { await window.__cad.undo(); await window.__cad.idle(); }
    out.afterConf = window.__cad.sketch(s);
    await C.setDim(dW, 70); await window.__cad.idle(); out.set70 = window.__cad.sketch(s);
    await window.__cad.undo(); await window.__cad.idle(); out.undo = window.__cad.sketch(s);
    const s2 = await C.sketch('XY');
    const A = await C.arc(s2, [0, 0], 10, 0, 90); const T = await C.line(s2, [0, 10.5], [-30, 13]);
    await C.constrain(s2, 'fix', A + '.c'); await C.dim(s2, 'radius', [A], 10);
    await C.constrain(s2, 'coincident', T + '.a', A + '.b'); await C.constrain(s2, 'tangent', T, A);
    await window.__cad.idle(); out.tan = window.__cad.sketch(s2); out.A = A; out.T = T;
    const s3 = await C.sketch('XY');
    const L1 = await C.line(s3, [0, 0], [40, 2]), L2 = await C.line(s3, [40, 2], [45, 30]), L3 = await C.line(s3, [0, 10], [38, 14]), L4 = await C.line(s3, [0, 0], [30, 20]);
    await C.constrain(s3, 'coincident', L1 + '.b', L2 + '.a'); await C.constrain(s3, 'coincident', L4 + '.a', L1 + '.a');
    await C.constrain(s3, 'perpendicular', L1, L2); await C.constrain(s3, 'parallel', L1, L3); await C.constrain(s3, 'equal', L1, L3);
    await C.dim(s3, 'angle', [L1, L4], 30);
    await window.__cad.idle(); out.rel = window.__cad.sketch(s3); out.R = [L1, L2, L3, L4];
    const s4 = await C.sketch('XY'); await C.line(s4, [0, 0], [10, 5]); await window.__cad.idle(); out.free = window.__cad.sketch(s4).dof;
    return out;
  }).catch(e => ({ err: String(e.message || e).slice(0, 200) }));
  if (r.err) { for (const k of ['rect', 'conflict', 'setdim', 'undo', 'tangent', 'relations', 'dof']) rec('solver.' + k, false, '出错：' + r.err); await ctx.close(); return; }
  const ln = (s, id) => s.entities.find(e => e.id === id);
  const corners = s => { const p = r.L.map(id => ln(s, id)).flatMap(l => [l.a, l.b]); return [Math.min(...p.map(q => q[0])), Math.min(...p.map(q => q[1])), Math.max(...p.map(q => q[0])), Math.max(...p.map(q => q[1]))]; };
  const isRect = s => r.L.map(id => ln(s, id)).every(l => Math.abs(l.a[0] - l.b[0]) <= 1e-6 || Math.abs(l.a[1] - l.b[1]) <= 1e-6);
  const noNaN = s => s.entities.every(e => [e.a, e.b, e.c].filter(Boolean).flat().every(Number.isFinite) && (e.r === undefined || e.r === null || Number.isFinite(e.r)));
  const c0 = corners(r.rect);
  rec('solver.rect', isRect(r.rect) && [0.3, -0.2, 50.3, 29.8].every((v, i) => Math.abs(c0[i] - v) <= 1e-6) && r.rect.dof === 0 && r.rect.status === 'ok',
    `歪四边形解成 [${c0.map(f2)}]（要 [0.3,-0.2,50.3,29.8]），自由度 ${r.rect.dof}（要 0），status ${r.rect.status}`);
  const cc = corners(r.conf);
  rec('solver.conflict', noNaN(r.conf) && Math.abs(cc[2] - cc[0] - 50) <= 1e-6 && (r.threw || r.conf.status === 'conflict') && r.afterConf.status === 'ok' && noNaN(r.afterConf),
    `加冲突尺寸：${r.threw ? '被拒（抛错）' : 'status=' + r.conf.status}，宽仍 ${f2(cc[2] - cc[0])}（要 50），无 NaN ${noNaN(r.conf)}；撤掉后 status ${r.afterConf.status}`);
  const c7 = corners(r.set70), cu = corners(r.undo);
  rec('solver.setdim', isRect(r.set70) && Math.abs(c7[2] - c7[0] - 70) <= 1e-6 && Math.abs(c7[3] - c7[1] - 30) <= 1e-6, `宽改 70 后 ${f2(c7[2] - c7[0])}×${f2(c7[3] - c7[1])}，矩形 ${isRect(r.set70)}`);
  rec('solver.undo', Math.abs(cu[2] - cu[0] - 50) <= 1e-6, `撤销后宽 ${f2(cu[2] - cu[0])}（要 50）`);
  const a = ln(r.tan, r.A), t = ln(r.tan, r.T);
  const d = [t.b[0] - t.a[0], t.b[1] - t.a[1]], rv = [t.a[0] - a.c[0], t.a[1] - a.c[1]];
  const lineDist = Math.abs(d[0] * rv[1] - d[1] * rv[0]) / Math.hypot(...d); // 圆心到切线（无限长直线）的距离
  rec('solver.tangent', Math.abs(lineDist - 10) <= 1e-6 && Math.abs(Math.hypot(...rv) - 10) <= 1e-6 && Math.abs(a.r - 10) <= 1e-6, `圆心到切线距离 ${lineDist.toFixed(9)}（要 10），线端点到圆心 ${Math.hypot(...rv).toFixed(9)}（要 10，即切点在弧端）`);
  const [l1, l2, l3, l4] = r.R.map(id => ln(r.rel, id)); const v = l => [l.b[0] - l.a[0], l.b[1] - l.a[1]];
  const cosA = (p, q) => (p[0] * q[0] + p[1] * q[1]) / (Math.hypot(...p) * Math.hypot(...q));
  const crs = (p, q) => (p[0] * q[1] - p[1] * q[0]) / (Math.hypot(...p) * Math.hypot(...q));
  const angle = Math.acos(Math.min(1, Math.abs(cosA(v(l1), v(l4))))) * 180 / PI;
  rec('solver.relations', Math.abs(cosA(v(l1), v(l2))) <= 1e-6 && Math.abs(crs(v(l1), v(l3))) <= 1e-6 && Math.abs(Math.hypot(...v(l1)) - Math.hypot(...v(l3))) <= 1e-6 && Math.abs(angle - 30) <= 1e-6,
    `垂直 ${cosA(v(l1), v(l2)).toExponential(1)}、平行 ${crs(v(l1), v(l3)).toExponential(1)}、等长差 ${(Math.hypot(...v(l1)) - Math.hypot(...v(l3))).toExponential(1)}、夹角 ${angle.toFixed(6)}°（要 30）`);
  rec('solver.dof', r.free === 4, `一条自由线段的自由度 ${r.free}（要 4）`);
  await ctx.close();
}

// 建模：拉伸、圆角、面上草图切除、倒角、改深度、改草图宽度、压缩、失败特征、撤销、STEP/3MF/切片、抽壳、旋转
const VPLATE = (W, D, fil = true) => W * 60 * D - 4 * PI * 16 * D - (fil ? 4 * (25 - 25 * PI / 4) * D : 0) - PI * 100 * 4 - 4 * PI * (4 + 1 / 3);
async function gModel(browser) {
  const ctx = await newCtx(browser);
  const { page } = await openApp(ctx);
  await page.evaluate(() => window.__cad.reset()); await idle(page);
  const step = async (id, fn, expect, extra) => chk(id, async () => {
    const info = await page.evaluate(fn); await idle(page, 60000);
    const v = await vol(page); const ok = relErr(v, expect) <= 1e-4 && (!extra || await extra(info));
    return [ok, `体积 ${f2(v)}（公式 ${f2(expect)}，相对误差 ${relErr(v, expect).toExponential(1)} ≤1e-4）`];
  });
  await step('model.extrude', async () => {
    const C = window.__cad.cmd; const s = await C.sketch('XY');
    const R = await window.__fx.rect(s, 0, 0, 80, 60, true);
    for (const [x, y] of [[10, 10], [70, 10], [10, 50], [70, 50]]) await window.__fx.hole(s, R.L[0] + '.a', x, y, 4);
    await C.finish(s); window.__m = { s, R };
    window.__m.ex = await C.extrude(s, { depth: 10 });
  }, 80 * 60 * 10 - 4 * PI * 16 * 10);
  await chk('model.sketch', async () => { const s = await page.evaluate(() => window.__cad.sketch(window.__m.s)); return [s.dof === 0 && s.status === 'ok', `板草图自由度 ${s.dof}（要 0），status ${s.status}`]; });
  await step('model.fillet', async () => { window.__m.fi = await window.__cad.cmd.fillet({ radius: 5, edges: [[0, 0, 5], [80, 0, 5], [80, 60, 5], [0, 60, 5]] }); }, 80 * 60 * 10 - 4 * PI * 16 * 10 - 4 * (25 - 25 * PI / 4) * 10);
  let plane = null;
  await chk('model.face-sketch', async () => {
    plane = await page.evaluate(async () => { const s = await window.__cad.cmd.sketch({ face: [40, 30, 10] }); window.__m.s2 = s; await window.__cad.idle(); return window.__cad.sketch(s).plane; });
    const n = plane.normal, u = plane.u, v = plane.v;
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cr = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const ok = Math.abs(n[2] - 1) <= 1e-6 && Math.abs(plane.origin[2] - 10) <= 1e-6 && Math.abs(dot(u, u) - 1) <= 1e-6 && Math.abs(dot(u, n)) <= 1e-6 && cr.every((x, i) => Math.abs(x - v[i]) <= 1e-6);
    return [ok, `顶面草图法向 (${n.map(f2)})（要 0,0,1），原点 z=${f2(plane.origin[2])}（要 10），u 单位且垂直法向、v＝法向×u：${ok}`];
  });
  await step('model.cut', async () => {
    const C = window.__cad.cmd, m = window.__m; const pl = window.__cad.sketch(m.s2).plane;
    await C.circle(m.s2, window.__fx.uv(pl, [40, 30, 10]), 10); await C.finish(m.s2);
    m.cut = await C.extrude(m.s2, { depth: 4, cut: true });
  }, VPLATE(80, 10) + 4 * PI * (4 + 1 / 3));
  await step('model.chamfer', async () => { window.__m.ch = await window.__cad.cmd.chamfer({ distance: 1, edges: [[14, 10, 10], [74, 10, 10], [14, 50, 10], [74, 50, 10]] }); }, VPLATE(80, 10));
  await step('model.param', async () => { await window.__cad.cmd.setParam(window.__m.ex, { depth: 15 }); }, VPLATE(80, 15));
  await step('model.sketch-drive', async () => { await window.__cad.cmd.setDim(window.__m.R.dW, 100); }, VPLATE(100, 15));
  await step('model.suppress', async () => { await window.__cad.cmd.suppress(window.__m.fi, true); }, VPLATE(100, 15, false));
  await step('model.unsuppress', async () => { await window.__cad.cmd.suppress(window.__m.fi, false); }, VPLATE(100, 15));
  await chk('model.error', async () => {
    await page.evaluate(async () => { await window.__cad.cmd.setParam(window.__m.fi, { radius: 40 }); }); await idle(page, 60000);
    const v = await vol(page); const F = await feats(page); const fid = await page.evaluate(() => window.__m.fi);
    const fi = F.find(f => f.id === fid);
    const de = await page.evaluate(id => { const e = document.querySelector(`[data-testid="tree-item"][data-id="${id}"]`); return e ? e.hasAttribute('data-error') : null; }, fid);
    return [!!(fi && fi.error) && relErr(v, VPLATE(100, 15, false)) <= 1e-4 && de === true, `圆角改 R40：error=${fi && JSON.stringify(fi.error)}，体积 ${f2(v)}（要＝无圆角 ${f2(VPLATE(100, 15, false))}），特征树该项 data-error ${de}`];
  });
  await chk('model.undo', async () => {
    await page.evaluate(() => window.__cad.undo()); await idle(page, 60000); const v1 = await vol(page);
    await page.evaluate(() => window.__cad.redo()); await idle(page, 60000); const v2 = await vol(page);
    await page.evaluate(() => window.__cad.undo()); await idle(page, 60000); const v3 = await vol(page);
    return [relErr(v1, VPLATE(100, 15)) <= 1e-4 && relErr(v2, VPLATE(100, 15, false)) <= 1e-4 && relErr(v3, VPLATE(100, 15)) <= 1e-4, `撤销 ${f2(v1)}／重做 ${f2(v2)}／再撤销 ${f2(v3)}（要 ${f2(VPLATE(100, 15))}／${f2(VPLATE(100, 15, false))}／${f2(VPLATE(100, 15))}）`];
  });
  const V = VPLATE(100, 15);
  const bb = await page.evaluate(() => window.__cad.measure().bbox).catch(() => null);
  rec('model.bbox', !!bb && [0, 0, 0, 100, 60, 15].every((x, i) => Math.abs(bb[i < 3 ? 0 : 1][i % 3] - x) <= 0.01), `包围盒 ${JSON.stringify(bb && bb.map(p => p.map(f2)))}（要 [0,0,0]–[100,60,15]）`);
  await chk('model.step', async () => {
    const { f } = await getFile(page, 'step'); const j = stepVolume(f);
    if (!j.ok) return [false, 'STEP 读不了：' + j.error];
    const okB = [0, 0, 0, 100, 60, 15].every((x, i) => Math.abs(j.bbox[i < 3 ? 0 : 1][i % 3] - x) <= 0.01);
    return [relErr(j.volume, V) <= 1e-4 && okB, `判卷 OCC 读 STEP：体积 ${f2(j.volume)}（公式 ${f2(V)}），包围盒对 ${okB}`];
  });
  let f3 = null;
  await chk('model.3mf', async () => {
    const g = await getFile(page, '3mf'); f3 = g.f; const j = parse3mf(g.buf);
    if (!j.ok) { f3 = null; return [false, '3MF 不合格：' + j.error]; }
    const okB = [0, 0, 0, 100, 60, 15].every((x, i) => Math.abs(j.bbox[i < 3 ? 0 : 1][i % 3] - x) <= 0.05);
    return [relErr(j.volume, V) <= 0.005 && okB, `网格 ${j.tris} 个三角形、封闭且朝向一致；体积 ${f2(j.volume)}（公式 ${f2(V)}，≤0.5%）；包围盒对 ${okB}`];
  });
  await chk('model.bambu', async () => {
    if (!f3) return [false, '没有合格的 3MF 可切'];
    const j = py('slice3mf.py', f3);
    if (!j.ok) return [false, `Bambu Studio 切片失败：return_code=${j.return_code} ${j.error || ''}`];
    const dims = (j.objects[0] || []).slice().sort((a, b) => a - b);
    const ok = j.objects.length === 1 && [15, 60, 100].every((x, i) => Math.abs(dims[i] - x) <= 0.1);
    return [ok, `切片成功，G-code ${j.gcodeBytes} 字节，模型尺寸 ${dims.map(f2).join('×')}（要 15×60×100）`];
  });
  await chk('model.download', async () => {
    try { await page.click(tid('mode-3d'), { timeout: 5000 }); } catch (e) { }
    await sleep(400); const got = [];
    for (const [id, k] of [['export-3mf', '3mf'], ['export-step', 'step']]) { const d = await download(page, id); got.push(`${d.name}:${SIG[k][0].test(d.name) && SIG[k][1](d.buf)}`); }
    return [got.every(g => g.endsWith(':true')), got.join(' ')];
  });
  try { await page.click(tid('view-iso'), { timeout: 3000 }); await page.click(tid('view-fit'), { timeout: 3000 }); await sleep(800); } catch (e) { }
  await page.screenshot({ path: path.join(SHOT, 'model-3d.png') });
  await page.evaluate(() => window.__cad.reset()); await idle(page);
  await step('model.shell', async () => {
    const C = window.__cad.cmd; const s = await C.sketch('XY'); await window.__fx.rect(s, 0, 0, 40, 30, true); await C.finish(s);
    await C.extrude(s, { depth: 20 }); await C.shell({ thickness: 2, faces: [[20, 15, 20]] });
  }, 40 * 30 * 20 - 36 * 26 * 18);
  await page.evaluate(() => window.__cad.reset()); await idle(page);
  await step('model.revolve', async () => {
    const C = window.__cad.cmd; const s = await C.sketch('XZ');
    await window.__fx.rect(s, 15, 0, 10, 20, true);
    const ax = await C.line(s, [0, 0], [0, 30]); await C.construction(ax, true); await C.finish(s);
    window.__m = { rv: await C.revolve(s, { axis: ax, angle: 360 }) };
  }, PI * (625 - 225) * 20, async () => { const b = await page.evaluate(() => window.__cad.measure().bbox); return [-25, -25, 0, 25, 25, 20].every((x, i) => Math.abs(b[i < 3 ? 0 : 1][i % 3] - x) <= 0.01); });
  await step('model.revolve-angle', async () => { await window.__cad.cmd.setParam(window.__m.rv, { angle: 180 }); }, PI * (625 - 225) * 20 / 2);
  await ctx.close();
}

// 重模型：改深度时边旋转边等，界面不许卡
async function gHeavy(browser) {
  const ctx = await newCtx(browser);
  const { page } = await openApp(ctx);
  const VH = D => 40000 * D - 64 * 9 * PI * D - 4 * (100 - 25 * PI) * D;
  await page.evaluate(() => window.__cad.reset()); await idle(page);
  await chk('heavy.build', async () => {
    await page.evaluate(async () => {
      const C = window.__cad.cmd; const s = await C.sketch('XY'); await window.__fx.rect(s, 0, 0, 200, 200, true);
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) await C.circle(s, [11.25 + 22.5 * i, 11.25 + 22.5 * j], 3);
      await C.finish(s); window.__hf = await C.extrude(s, { depth: 10 });
      await C.fillet({ radius: 10, edges: [[0, 0, 5], [200, 0, 5], [200, 200, 5], [0, 200, 5]] });
    });
    const ok = await idle(page, 90000); const v = await vol(page);
    return [ok && relErr(v, VH(10)) <= 1e-4, `200×200 板 64 孔＋4 圆角：体积 ${f2(v)}（公式 ${f2(VH(10))}）`];
  });
  try { await page.click(tid('mode-3d'), { timeout: 5000 }); await page.click(tid('view-iso'), { timeout: 5000 }); await page.click(tid('view-fit'), { timeout: 5000 }); } catch (e) { }
  await sleep(800);
  const r = await vpRect(page);
  if (!r) { for (const k of ['time', 'smooth', 'volume']) rec('heavy.' + k, false, '没有 #viewport'); await ctx.close(); return; }
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  await page.mouse.move(cx, cy); await page.mouse.down({ button: 'right' });
  const t0 = await page.evaluate(() => { window.__done = false; const t = performance.now(); window.__t0 = t; Promise.resolve(window.__cad.cmd.setParam(window.__hf, { depth: 14 })).then(() => window.__cad.idle()).then(() => { window.__t1 = performance.now(); window.__done = true; }); return t; });
  const wall = Date.now(); let i = 0;
  while (Date.now() - wall < 25000) {
    i++; await page.mouse.move(cx + 120 * Math.cos(i / 8), cy + 60 * Math.sin(i / 8)); await sleep(16);
    if (i % 10 === 0 && await page.evaluate(() => window.__done)) break;
  }
  await page.mouse.up({ button: 'right' });
  const done = await page.evaluate(() => window.__done); const t1 = await page.evaluate(() => window.__done ? window.__t1 : performance.now());
  const st = await stats(page, t0, t1);
  rec('heavy.time', done && t1 - t0 <= 20000, `改深度重建用时 ${((t1 - t0) / 1000).toFixed(1)}s（≤20），完成 ${done}`);
  rec('heavy.smooth', done && st.max <= 150 && st.lt <= 150, `重建期间边转边等：最长帧间隔 ${st.max.toFixed(0)}ms（≤150），最长主线程长任务 ${st.lt.toFixed(0)}ms（≤150），帧数 ${st.n}`);
  await idle(page, 60000);
  const v = await vol(page);
  rec('heavy.volume', relErr(v, VH(14)) <= 1e-4, `深度 14 体积 ${f2(v)}（公式 ${f2(VH(14))}）`);
  await ctx.close();
}

// 三维界面：真鼠标建草图、拉伸、悬停高亮、点边倒圆角、点面建草图、双击改参数、撤销重做、旋转、缩放、标准视图
async function gUi3d(browser) {
  const ctx = await newCtx(browser);
  const { page } = await openApp(ctx);
  const P = q => page.evaluate(q => window.__cad.project(q), q);
  const S = (sid, uv) => page.evaluate(([s, p]) => window.__cad.toScreen(s, p), [sid, uv]);
  const click = async (p, steps = 5) => { await page.mouse.move(p.x, p.y, { steps }); await page.mouse.down(); await page.mouse.up(); await sleep(150); };
  const tryClick = async id => { try { await page.click(tid(id), { timeout: 5000 }); await sleep(250); return true; } catch (e) { return false; } };
  await page.evaluate(() => window.__cad.reset()); await idle(page);
  await tryClick('mode-3d'); await tryClick('new-sketch'); await tryClick('plane-XY'); await idle(page); await sleep(600);
  const sid = await page.evaluate(() => window.__cad.active());
  let A = 0, box = null;
  await chk('ui3d.sketch', async () => {
    if (!sid) return [false, '点 #new-sketch、#plane-XY 后没有编辑中的草图'];
    const p1 = await S(sid, [10, 10]), p2 = await S(sid, [50, 40]);
    if (!await freeAt(page, [p1, p2])) return [false, '草图点被面板挡住或不在 #viewport 里'];
    await tryClick('tool-rect'); await click(p1); await click(p2, 8); await page.keyboard.press('Escape'); await idle(page);
    const s = await page.evaluate(id => window.__cad.sketch(id), sid);
    const L = s.entities.filter(e => e.type === 'line' && !e.construction);
    const xs = L.flatMap(l => [l.a[0], l.b[0]]), ys = L.flatMap(l => [l.a[1], l.b[1]]);
    box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; A = (box[2] - box[0]) * (box[3] - box[1]);
    return [L.length === 4 && s.plane.normal[2] > 0.999999 && A > 600, `XY 草图上画矩形：线 ${L.length} 条，范围 [${box.map(f2)}]`];
  });
  await tryClick('sketch-done'); await idle(page); await sleep(400);
  const before = await shotVp(page);
  let ex = null;
  await chk('ui3d.extrude', async () => {
    if (!await tryClick('feat-extrude')) return [false, '点不了 #feat-extrude'];
    await page.fill(tid('feat-depth'), '12'); await tryClick('feat-ok'); await idle(page, 60000);
    const F = await feats(page); ex = (F.find(f => f.type === 'extrude') || {}).id;
    const v = await vol(page);
    return [!!ex && relErr(v, A * 12) <= 1e-4, `界面拉伸 12：体积 ${f2(v)}（要 草图面积×12＝${f2(A * 12)}）`];
  });
  await tryClick('view-iso'); await tryClick('view-fit'); await sleep(900);
  const after = await shotVp(page);
  const dr = diffRatio(before, after);
  rec('ui3d.extrude-render', dr >= 0.03, `拉伸并切等轴测后画面变化 ${(dr * 100).toFixed(1)}%（≥3%）`);
  const H = 12, top = box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2, H] : [30, 25, 12];
  await chk('ui3d.hover', async () => {
    const r = await vpRect(page); const q = await P(top);
    await page.mouse.move(r.x + 12, r.y + r.h - 12, { steps: 3 }); await sleep(500);
    const clip = { x: Math.max(0, q.x - 40), y: Math.max(0, q.y - 40), width: 80, height: 80 };
    const a = await page.screenshot({ clip }); await page.mouse.move(q.x, q.y, { steps: 4 }); await sleep(500);
    const b = await page.screenshot({ clip }); const d = diffRatio(a, b);
    return [d >= 0.03, `鼠标移到顶面后光标附近 80×80 像素变化 ${(d * 100).toFixed(1)}%（≥3%）`];
  });
  const FIL = H => (9 - 9 * PI / 4) * H;
  await chk('ui3d.fillet', async () => {
    if (!box) return [false, '没有实体'];
    const v0 = await vol(page);
    if (!await tryClick('feat-fillet')) return [false, '点不了 #feat-fillet'];
    await click(await P([box[2], box[1], 6])); await sleep(300);
    await page.fill(tid('feat-radius'), '3'); await tryClick('feat-ok'); await idle(page, 60000);
    const dv = v0 - await vol(page);
    return [Math.abs(dv - FIL(12)) <= 0.5, `在 #viewport 里点竖边倒 R3：体积减少 ${f2(dv)}（要 ${f2(FIL(12))}±0.5）`];
  });
  await chk('ui3d.face-pick', async () => {
    await tryClick('view-iso'); await sleep(600);
    if (!await tryClick('new-sketch')) return [false, '点不了 #new-sketch'];
    await click(await P(top)); await idle(page); await sleep(500);
    const s = await page.evaluate(() => { const a = window.__cad.active(); return a ? window.__cad.sketch(a) : null; });
    await page.keyboard.press('Escape'); await tryClick('sketch-done'); await idle(page);
    return [!!s && Math.abs(s.plane.normal[2] - 1) <= 1e-6 && Math.abs(s.plane.origin[2] - H) <= 1e-6, s ? `点顶面建草图：法向 (${s.plane.normal.map(f2)})，原点 z=${f2(s.plane.origin[2])}（要 12）` : '点顶面后没有编辑中的草图'];
  });
  const V12 = A * 12 - FIL(12), V20 = A * 20 - FIL(20);
  await chk('ui3d.edit', async () => {
    await tryClick('view-iso'); await sleep(400);
    const it = page.locator(`[data-testid="tree-item"][data-id="${ex}"]`);
    if (!ex || !(await it.count())) return [false, '特征树里找不到拉伸项'];
    await it.dblclick(); await sleep(500);
    const pre = await page.inputValue(tid('feat-depth')).catch(() => '');
    await page.fill(tid('feat-depth'), '20'); await tryClick('feat-ok'); await idle(page, 60000);
    const v = await vol(page);
    return [parseFloat(pre) === 12 && relErr(v, V20) <= 2e-3, `双击拉伸项：深度框预填 "${pre}"（要 12），改 20 后体积 ${f2(v)}（要 ${f2(V20)}，圆角仍在那条边上）`];
  });
  await chk('ui3d.undo', async () => {
    await blur(page);
    await page.keyboard.press('Control+z'); await idle(page, 60000); const v1 = await vol(page);
    await page.keyboard.press('Control+y'); await idle(page, 60000); let v2 = await vol(page);
    if (relErr(v2, V20) > 2e-3) { await page.keyboard.press('Control+Shift+z'); await idle(page, 60000); v2 = await vol(page); }
    return [relErr(v1, V12) <= 2e-3 && relErr(v2, V20) <= 2e-3, `Ctrl+Z 体积 ${f2(v1)}（要 ${f2(V12)}），重做 ${f2(v2)}（要 ${f2(V20)}）`];
  });
  await tryClick('view-iso'); await tryClick('view-fit'); await sleep(700);
  const r = await vpRect(page);
  if (!r) { for (const k of ['orbit', 'orbit-fps', 'zoom', 'views', 'fit']) rec('ui3d.' + k, false, '没有 #viewport'); await ctx.close(); return; }
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const o1 = await shotVp(page);
  await page.mouse.move(cx, cy); await page.mouse.down({ button: 'right' });
  const t0 = await now(page);
  for (let i = 1; i <= 80; i++) { await page.mouse.move(cx + 220 * Math.sin(i / 25), cy + 60 * Math.sin(i / 13)); await sleep(22); }
  const t1 = await now(page); await page.mouse.up({ button: 'right' }); await sleep(500);
  const o2 = await shotVp(page); const od = diffRatio(o1, o2); const st = await stats(page, t0, t1);
  rec('ui3d.orbit', od >= 0.05, `右键拖动后画面变化 ${(od * 100).toFixed(1)}%（≥5%）`);
  rec('ui3d.orbit-fps', od >= 0.05 && st.p95 <= 25 && st.slow <= 2, `旋转帧间隔 p95 ${st.p95.toFixed(1)}ms（≤25），超 50ms ${st.slow} 帧（≤2），帧数 ${st.n}`);
  await chk('ui3d.zoom', async () => {
    await tryClick('view-iso'); await tryClick('view-fit'); await sleep(800);
    const T = [top[0], top[1], 20]; const q0 = await P(T), q1 = await P([T[0] + 10, T[1], T[2]]);
    await page.mouse.move(q0.x, q0.y, { steps: 3 }); await page.mouse.wheel(0, -300); await sleep(800);
    const z0 = await P(T), z1 = await P([T[0] + 10, T[1], T[2]]);
    const drift = Math.hypot(z0.x - q0.x, z0.y - q0.y), k = Math.hypot(z1.x - z0.x, z1.y - z0.y) / Math.max(1e-6, Math.hypot(q1.x - q0.x, q1.y - q0.y));
    return [drift <= 4 && k >= 1.1, `滚轮放大后光标下的点漂 ${drift.toFixed(1)}px（≤4），放大 ${k.toFixed(2)} 倍（≥1.1）`];
  });
  await chk('ui3d.views', async () => {
    const tests = [['view-front', [0, 10, 0], [10, 0, 0], 'x', [0, 0, 10], 'up'], ['view-top', [0, 0, 10], [10, 0, 0], 'x', [0, 10, 0], 'up'], ['view-left', [10, 0, 0], [0, -10, 0], 'x', [0, 0, 10], 'up']];
    const bad = [];
    for (const [id, same, right, , up] of tests) {
      await tryClick(id); await sleep(900);
      const o = await P([0, 0, 0]), s = await P(same), rr = await P(right), u = await P(up);
      if (Math.hypot(s.x - o.x, s.y - o.y) > 1 || rr.x < o.x + 5 || Math.abs(rr.y - o.y) > 1 || u.y > o.y - 5 || Math.abs(u.x - o.x) > 1) bad.push(id);
    }
    return [!bad.length, bad.length ? '方向不对：' + bad.join(' ') : '前/俯/左视方向都对（正交投影）'];
  });
  await chk('ui3d.fit', async () => {
    await tryClick('view-iso'); await tryClick('view-fit'); await sleep(900);
    const b = await page.evaluate(() => window.__cad.measure().bbox); const pts = [];
    for (const x of [b[0][0], b[1][0]]) for (const y of [b[0][1], b[1][1]]) for (const z of [b[0][2], b[1][2]]) pts.push(await P([x, y, z]));
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const inside = Math.min(...xs) >= r.x && Math.max(...xs) <= r.x + r.w && Math.min(...ys) >= r.y && Math.max(...ys) <= r.y + r.h;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / Math.min(r.w, r.h);
    return [inside && span >= 0.4, `全部显示后模型在 #viewport 内 ${inside}，占短边 ${(span * 100).toFixed(0)}%（≥40%）`];
  });
  await page.screenshot({ path: path.join(SHOT, 'ui3d.png') });
  await ctx.close();
}

// 工程图：三视图（第一角）、虚线隐藏线、自动外形尺寸、标题栏项目名、A3、DXF/PDF/SVG
async function gSheet(browser) {
  const ctx = await newCtx(browser);
  const { page } = await openApp(ctx);
  await page.evaluate(() => window.__cad.reset()); await idle(page);
  await page.evaluate(async () => {
    const C = window.__cad.cmd; const s = await C.sketch('XY'); const R = await window.__fx.rect(s, 0, 0, 80, 60, true);
    for (const [x, y] of [[10, 10], [70, 10], [10, 50], [70, 50]]) await window.__fx.hole(s, R.L[0] + '.a', x, y, 4);
    await C.finish(s); await C.extrude(s, { depth: 10 });
  }).catch(() => { });
  await idle(page, 60000);
  try { await page.click(tid('mode-3d'), { timeout: 5000 }); await page.fill(tid('project-name'), '测试零件甲'); await page.press(tid('project-name'), 'Enter'); await sleep(300); await page.click(tid('make-sheet'), { timeout: 5000 }); } catch (e) { }
  await idle(page, 60000); await sleep(600);
  try { await page.selectOption(tid('sheet-size'), 'A3'); } catch (e) { }
  await idle(page); await sleep(600);
  const mode = await page.evaluate(() => window.__cad.mode());
  rec('sheet.mode', mode === 'sheet', `点 #make-sheet 后工作区 ${mode}（要 sheet）`);
  await page.screenshot({ path: path.join(SHOT, 'sheet.png') });
  await chk('sheet.dxf', async () => {
    const { f } = await getFile(page, 'dxf'); const j = py('check_dxf.py', f);
    if (!j.ok) return [false, 'DXF 读不了：' + j.error];
    const cl = j.clusters.filter(c => c.vbbox).map(c => ({ ...c, w: c.vbbox[2] - c.vbbox[0], h: c.vbbox[3] - c.vbbox[1], cx: (c.vbbox[0] + c.vbbox[2]) / 2, cy: (c.vbbox[1] + c.vbbox[3]) / 2 }));
    const find = (w, h) => cl.find(c => Math.abs(c.w - w) <= 0.01 && Math.abs(c.h - h) <= 0.01);
    const F = find(80, 10), T = find(80, 60), L = find(60, 10);
    const lay = !!(F && T && L) && Math.abs(T.cx - F.cx) <= 0.01 && T.vbbox[3] < F.vbbox[1] && Math.abs(L.cy - F.cy) <= 0.01 && L.vbbox[0] > F.vbbox[2];
    const hid = !!(F && L) && F.dashed >= 4 && L.dashed >= 4;
    const ms = j.dims.map(d => d.measurement);
    const dimsOk = [80, 60, 10].every(v => ms.some(m => Math.abs(m - v) <= 1e-6)) && j.dims.every(d => d.blockOk);
    const name = j.texts.some(t => t.includes('测试零件甲'));
    // 2026-10-04 领导批准：三视图之外允许再有一个轴测图（共 3 或 4 团，其中三团必须是主/俯/左视）
    const nViews = (cl.length === 3 || (cl.length === 4 && F && T && L && new Set([F, T, L]).size === 3));
    const ok = !j.auditErrors.length && !j.auditFixes.length && j.insunits === 4 && nViews && lay && hid && dimsOk && name;
    return [ok, `audit 错 ${j.auditErrors.length} 修 ${j.auditFixes.length}；$INSUNITS=${j.insunits}；视图团数 ${cl.length}（要 3，或 3＋1 个轴测图：${cl.map(c => f2(c.w) + '×' + f2(c.h)).join(' ')}）；主视 80×10 ${!!F}、俯视 80×60 ${!!T}、左视 60×10 ${!!L}、第一角布局 ${lay}；主视/左视虚线 ${F ? F.dashed : '-'}/${L ? L.dashed : '-'}（各≥4）；外形尺寸 80/60/10 且几何块有效 ${dimsOk}；标题栏项目名 ${name}`];
  });
  await chk('sheet.pdf', async () => {
    const { f } = await getFile(page, 'pdf'); const j = py('check_pdf.py', f);
    if (!j.ok) return [false, 'PDF 读不了：' + j.error];
    const p = j.pages[0]; const sz = [p.w, p.h].sort((a, b) => a - b); const txt = j.pages.map(x => x.text).join('\n');
    const a3 = Math.abs(sz[0] - 841.89) <= 2 && Math.abs(sz[1] - 1190.55) <= 2;
    return [a3 && p.pathOps >= 20 && j.pages.every(x => x.images === 0) && txt.includes('测试零件甲') && /(^|[^\d.])80([^\d]|$)/.test(txt), `A3 ${a3}（${p.w.toFixed(0)}×${p.h.toFixed(0)}pt），画线指令 ${p.pathOps}（≥20），位图 ${p.images}，项目名 ${txt.includes('测试零件甲')}，尺寸 80 ${/(^|[^\d.])80([^\d]|$)/.test(txt)}`];
  });
  await chk('sheet.svg', async () => {
    const { buf } = await getFile(page, 'svg'); const t = buf.toString('utf8');
    const ok = await page.evaluate(t => { const d = new DOMParser().parseFromString(t, 'image/svg+xml'); return !d.querySelector('parsererror') && d.documentElement.nodeName.toLowerCase() === 'svg' && !!d.documentElement.getAttribute('viewBox') && d.documentElement.textContent.includes('测试零件甲'); }, t);
    return [ok, `工程图 SVG 解析无错、有 viewBox、含项目名：${ok}`];
  });
  await chk('sheet.download', async () => {
    const got = [];
    for (const [id, k] of [['export-dxf', 'dxf'], ['export-pdf', 'pdf']]) { const d = await download(page, id); got.push(`${d.name}:${SIG[k][0].test(d.name) && SIG[k][1](d.buf)}`); }
    return [got.every(g => g.endsWith(':true')), got.join(' ')];
  });
  await ctx.close();
}

// 保存：自动保存刷新恢复、导出/载入项目、界面保存与打开
async function gPersist(browser) {
  const VS = 40 * 30 * 20 - 36 * 26 * 18;
  const ctx = await newCtx(browser);
  const { page } = await openApp(ctx);
  await page.evaluate(() => window.__cad.reset()); await idle(page);
  await page.evaluate(async () => {
    const C = window.__cad.cmd; const s = await C.sketch('XY'); await window.__fx.rect(s, 0, 0, 40, 30, true); await C.finish(s);
    await C.extrude(s, { depth: 20 }); await C.shell({ thickness: 2, faces: [[20, 15, 20]] });
  }).catch(() => { });
  await idle(page, 60000);
  const F0 = await feats(page).catch(() => []);
  await sleep(3500);
  await openApp(ctx, page); await idle(page, 60000);
  const F1 = await feats(page).catch(() => []); const v1 = await vol(page).catch(() => 0);
  const sig = F => JSON.stringify(F.map(f => [f.type, f.suppressed]));
  rec('persist.autosave', F0.length >= 2 && sig(F0) === sig(F1) && relErr(v1, VS) <= 1e-4, `刷新后特征 ${F1.length} 个（之前 ${F0.length}），体积 ${f2(v1)}（要 ${f2(VS)}）`);
  await chk('persist.roundtrip', async () => {
    const { buf } = await getFile(page, 'project'); const obj = JSON.parse(buf.toString('utf8'));
    await page.evaluate(() => window.__cad.reset()); await idle(page);
    const v0 = await vol(page);
    await page.evaluate(o => window.__cad.load(o), obj); await idle(page, 60000);
    const v = await vol(page); const F = await feats(page);
    return [v0 === 0 && relErr(v, VS) <= 1e-6 && sig(F) === sig(F0), `reset 后体积 ${f2(v0)}（要 0），load 后 ${f2(v)}（要 ${f2(VS)}），特征一致 ${sig(F) === sig(F0)}`];
  });
  let saved = null;
  await chk('persist.save', async () => { const d = await download(page, 'save'); saved = d.f; return [SIG.json[0].test(d.name) && SIG.json[1](d.buf), `#save 下载 ${d.name}`]; });
  await ctx.close();
  await chk('persist.open', async () => {
    if (!saved) return [false, '没有保存出的文件'];
    const c2 = await newCtx(browser); const { page: p2 } = await openApp(c2);
    await p2.evaluate(() => window.__cad.reset()); await idle(p2);
    await p2.setInputFiles(tid('open'), saved); await idle(p2, 60000); await sleep(500);
    const v = await vol(p2); await c2.close();
    return [relErr(v, VS) <= 1e-6, `新浏览器里用 #open 打开：体积 ${f2(v)}（要 ${f2(VS)}）`];
  });
}

// ═════ 调度 ═════
const RUN = { boot: gBoot, ui: gUi, sketch: gSketch, solver: gSolver, model: gModel, heavy: gHeavy, ui3d: gUi3d, sheet: gSheet, persist: gPersist };
// 各组检查项。全量：本地 84 项（含 build 2 项、global 2 项），线上 83 项（没有 build，多一项 deploy.same）
const IDS = {
  boot: ['ui', 'kernel', 'api'], ui: ['defaults', 'topright', 'theme', 'glass', 'prefs-persist', 'controls', 'i18n', 'layout'],
  sketch: ['view', 'rect', 'dim-create', 'dim-drive', 'dof', 'circle', 'circle-dim', 'polyline', 'drag', 'drag-fps', 'undo', 'zoom', 'dxf', 'svg', 'pdf', 'download'],
  solver: ['rect', 'conflict', 'setdim', 'undo', 'tangent', 'relations', 'dof'],
  model: ['extrude', 'sketch', 'fillet', 'face-sketch', 'cut', 'chamfer', 'param', 'sketch-drive', 'suppress', 'unsuppress', 'error', 'undo', 'bbox', 'step', '3mf', 'bambu', 'download', 'shell', 'revolve', 'revolve-angle'],
  heavy: ['build', 'time', 'smooth', 'volume'], ui3d: ['sketch', 'extrude', 'extrude-render', 'hover', 'fillet', 'face-pick', 'edit', 'undo', 'orbit', 'orbit-fps', 'zoom', 'views', 'fit'],
  sheet: ['mode', 'dxf', 'pdf', 'svg', 'download'], persist: ['autosave', 'roundtrip', 'save', 'open'],
};
async function runGroups(groups, browser) {
  for (const g of groups) {
    if (g === 'build') { if (!URL0) await gBuild(); continue; }
    try { await RUN[g](browser); } catch (e) {
      const why = '这组中途出错：' + String(e && e.message || e).split('\n')[0].slice(0, 200);
      for (const k of IDS[g]) if (!results.some(r => r.id === g + '.' + k)) rec(g + '.' + k, false, why);
    }
  }
  rec('global.noerror', ERRORS.length === 0, ERRORS.length ? `页面报错 ${ERRORS.length} 条：${[...new Set(ERRORS)].slice(0, 3).join(' | ')}` : '全程零页面报错');
  rec('global.noexternal', EXTERNAL.length === 0, EXTERNAL.length ? `外部请求 ${EXTERNAL.length} 个：${[...new Set(EXTERNAL)].slice(0, 3).join(' ')}` : '全程零外部请求');
}
const SABS = [
  ['noglass', ['ui'], ['ui.glass']], ['cjk', ['ui'], ['ui.i18n']], ['hscroll', ['ui'], ['ui.layout']], ['extern', ['ui'], ['global.noexternal']], ['error', ['ui'], ['global.noerror']],
  ['freeze', ['ui3d'], ['ui3d.extrude-render', 'ui3d.orbit', 'ui3d.hover']], ['jank', ['ui3d'], ['ui3d.orbit-fps']], ['noorbit', ['ui3d'], ['ui3d.orbit', 'ui3d.zoom']], ['noundo', ['ui3d'], ['ui3d.undo']],
  ['hog', ['heavy'], ['heavy.smooth']], ['lievol', ['model'], ['model.']], ['corrupt', ['model'], ['model.3mf', 'model.bambu']], ['dimlie', ['sketch'], ['sketch.dxf']], ['nopersist', ['persist'], ['persist.autosave']],
];

const watchdog = setTimeout(() => { console.log('判卷超时（正常 45 分钟／--prove 150 分钟），强制退出——这是判卷没跑完，不是 FAIL'); process.exit(3); }, (PROVE ? 150 : 45) * 60000);
(async () => {
  let srv = null;
  if (URL0) { BASE = URL0; ORIGIN = new URL(URL0).origin; }
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const sha = crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  console.log(`GlassCAD 判卷 accept.mjs sha256=${sha}\n目标：${URL0 || '本地 dist/（子路径 ' + SUB + '）'}${PROVE ? '｜反向验证' : ''}${ONLY ? '｜只跑 ' + ONLY.join(',') : ''}`);
  if (!URL0) { if (!ONLY || ONLY.includes('build') || PROVE) await gBuild(); srv = await serve(); ORIGIN = `http://127.0.0.1:${srv.address().port}`; BASE = ORIGIN + SUB; }
  if (URL0 && !ONLY) await chk('deploy.same', async () => {
    const loc = path.join(ROOT, 'dist', 'index.html'); if (!fs.existsSync(loc)) return [false, '本地没有 dist/index.html'];
    const r = await fetch(URL0 + '?nocache=' + Date.now()); const t = Buffer.from(await r.arrayBuffer());
    return [r.ok && t.equals(fs.readFileSync(loc)), `线上 index.html ${r.status}，与本地 dist/index.html 逐字节相同：${t.equals(fs.readFileSync(loc))}`];
  });
  if (!PROVE) {
    const groups = (ONLY || GROUPS).filter(g => g !== 'build');
    await runGroups(groups, browser);
    await browser.close(); if (srv) srv.close();
    const bad = results.filter(r => !r.ok);
    console.log(`\n合计 ${results.length - bad.length}/${results.length} PASS${bad.length ? '；FAIL：' + bad.map(r => r.id).join(' ') : ''}`);
    clearTimeout(watchdog); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(bad.length ? 1 : 0);
  }
  const base = results.filter(r => !r.ok).map(r => r.id);
  if (base.length) console.log('（注意：build 本身有 FAIL：' + base.join(' ') + '）');
  let miss = 0;
  for (const [name, groups, ids] of SABS) {
    results = []; ERRORS = []; EXTERNAL = []; SAB = { [name]: true };
    console.log(`\n── 破坏 ${name}：只跑 ${groups.join(',')}，期望 ${ids.join(' / ')} 变红 ──`);
    await runGroups(groups, browser);
    const caught = results.some(r => !r.ok && ids.some(p => r.id.startsWith(p)));
    if (!caught) miss++;
    console.log(`${caught ? '抓到' : '漏抓！'} ${name}`);
  }
  await browser.close(); if (srv) srv.close();
  console.log(`\n反向验证：${SABS.length - miss}/${SABS.length} 种破坏被抓到${miss ? '，有漏抓' : ''}`);
  clearTimeout(watchdog); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(miss ? 2 : 1);
})().catch(e => { console.log('判卷自身出错：' + (e && e.stack || e)); process.exit(3); });
