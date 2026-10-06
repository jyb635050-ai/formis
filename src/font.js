// 草图文字的字形轮廓：和几何内核用同一份字体（Noto Sans SC GB2312 子集），屏幕上看到的就是拉伸/切除出来的样子
// 文字约定：at = 第一个字的基线左端，h = 字号（毫米，等于字体 em 大小），ang = 绕 at 逆时针旋转的角度（度）
import * as opentype from 'opentype.js';

export const fontUrl = () => new URL('fonts/NotoSansSC-GB2312.ttf', document.baseURI).href;
let font = null, loading = null;
export const fontReady = () => !!font;
export function loadFont() {
  if (!loading) loading = fetch(fontUrl()).then(r => { if (!r.ok) throw new Error('字体加载失败'); return r.arrayBuffer(); })
    .then(b => { font = opentype.parse(b); return font; })
    .catch(e => { loading = null; throw e; });
  return loading;
}

// 文字 → 闭合折线（草图坐标），带缓存；字体没加载好返回 null
const cache = new Map();
export function textOutline(e) {
  if (!font) return null;
  const key = e.text + '|' + e.h;
  let base = cache.get(key);
  if (!base) {
    const cmds = font.getPath(String(e.text), 0, 0, +e.h || 5).commands;
    const loops = []; let cur = null, last = null;
    const P = (x, y) => [x, -y];
    for (const c of cmds) {
      if (c.type === 'M') { cur = [P(c.x, c.y)]; loops.push(cur); last = [c.x, c.y]; }
      else if (c.type === 'L') { cur.push(P(c.x, c.y)); last = [c.x, c.y]; }
      else if (c.type === 'Q') { for (let i = 1; i <= 6; i++) { const t = i / 6, m = 1 - t; cur.push(P(m * m * last[0] + 2 * m * t * c.x1 + t * t * c.x, m * m * last[1] + 2 * m * t * c.y1 + t * t * c.y)); } last = [c.x, c.y]; }
      else if (c.type === 'C') { for (let i = 1; i <= 8; i++) { const t = i / 8, m = 1 - t; cur.push(P(m * m * m * last[0] + 3 * m * m * t * c.x1 + 3 * m * t * t * c.x2 + t * t * t * c.x, m * m * m * last[1] + 3 * m * m * t * c.y1 + 3 * m * t * t * c.y2 + t * t * t * c.y)); } last = [c.x, c.y]; }
      else if (c.type === 'Z' && cur && cur.length) cur.push(cur[0]);
    }
    const adv = font.getAdvanceWidth(String(e.text), +e.h || 5);
    const ys = loops.flat().map(p => p[1]);
    base = { loops, box: [[0, ys.length ? Math.min(...ys, 0) : 0], [Math.max(adv, 1e-3), ys.length ? Math.max(...ys, (+e.h || 5) * 0.7) : (+e.h || 5) * 0.7]] };
    if (cache.size > 200) cache.clear();
    cache.set(key, base);
  }
  const X = toSketch(e);
  return { loops: base.loops.map(L => L.map(X)), box: base.box };
}
// 文字自身坐标（基线为 x 轴）→ 草图坐标
export function toSketch(e) {
  const r = ((+e.ang || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), [u, v] = e.at;
  return p => [u + p[0] * c - p[1] * s, v + p[0] * s + p[1] * c];
}
// 文字所占的矩形（文字自身坐标）：字体没好时按字数估
function localBox(e) {
  const o = textOutline(e); if (o) return o.box;
  const h = +e.h || 5, n = [...String(e.text)].length;
  return [[0, -h * 0.12], [n * h * 0.9, h * 0.88]];
}
// 文字框四个角（草图坐标，转过角度的）
export function textCorners(e) {
  const [[x0, y0], [x1, y1]] = localBox(e), X = toSketch(e);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(X);
}
// 点到文字框的距离（毫米，框里为 0）
export function textDist(e, uv) {
  const r = ((+e.ang || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), d = [uv[0] - e.at[0], uv[1] - e.at[1]];
  const q = [d[0] * c + d[1] * s, -d[0] * s + d[1] * c], [[x0, y0], [x1, y1]] = localBox(e);
  return Math.hypot(Math.max(x0 - q[0], 0, q[0] - x1), Math.max(y0 - q[1], 0, q[1] - y1));
}
