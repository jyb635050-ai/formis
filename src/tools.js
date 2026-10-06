// 鼠标工具：草图里画线/矩形/圆/圆弧（点两下或按住拖都行）、对象捕捉、水平竖直参考线、光标旁实时尺寸、键盘输数、
// 智能尺寸、选择（点选/框选/拖点）；三维里悬停高亮、点选草图、选平面、选边、选面
import { S, ops, txn, beginDrag, endDrag, sketchById, dimLabel, emit, ptOf, moveDimLabel, dimBase, measureDim } from './doc.js';
import { kindOf } from './solver.js';
import { solveSketch } from './solver.js';
import { arcPoints } from './kernel/build.js';
import * as view from './view.js';
import { t } from './i18n.js';
import { fmt } from './util.js';

export const T = { tool: 'select', st: {}, pick: null, sel: new Set(), pendingTool: null };
let toast = () => { };
export const setToast = f => { toast = f; };

// ───── 叠加层：捕捉标记、参考线、读数、框选框 ─────
const host = document.querySelector('[data-testid="viewport"]');
const NS = 'http://www.w3.org/2000/svg';
const ov = document.createElementNS(NS, 'svg'); ov.setAttribute('class', 'overlay'); host.appendChild(ov);
const readout = document.createElement('div'); readout.className = 'readout'; readout.hidden = true; host.appendChild(readout);
const numbox = document.createElement('div'); numbox.className = 'numbox glass'; numbox.hidden = true;
numbox.innerHTML = '<input inputmode="decimal" autocomplete="off"><small></small>'; host.appendChild(numbox);
const numInp = numbox.querySelector('input'), numHint = numbox.querySelector('small');
function hostXY(x, y) { const r = host.getBoundingClientRect(); return [x - r.left, y - r.top]; }
function clearOverlay() { ov.innerHTML = ''; readout.hidden = true; }
function svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); ov.appendChild(e); return e; }
const KIND = { end: 'snapEnd', mid: 'snapMid', center: 'snapCenter', quad: 'snapQuad', int: 'snapInt', on: 'snapOn', origin: 'snapOrigin' };
function drawSnap(sid, p, cursor) {
  ov.innerHTML = '';
  if (!p) return;
  for (const g of p.guides || []) {
    const a = hostXY(...Object.values(view.toScreen(sid, g.from))), b = hostXY(...Object.values(view.toScreen(sid, p.uv)));
    svgEl('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'guide' });
    svgEl('circle', { cx: a[0], cy: a[1], r: 3, class: 'guide-dot' });
  }
  if (p.kind && KIND[p.kind]) {
    const q = hostXY(...Object.values(view.toScreen(sid, p.uv))); const k = p.kind;
    if (k === 'end' || k === 'origin') svgEl('rect', { x: q[0] - 5, y: q[1] - 5, width: 10, height: 10, class: 'snap' });
    else if (k === 'mid') svgEl('path', { d: `M${q[0]} ${q[1] - 6}L${q[0] + 6} ${q[1] + 5}L${q[0] - 6} ${q[1] + 5}Z`, class: 'snap' });
    else if (k === 'center') { svgEl('circle', { cx: q[0], cy: q[1], r: 6, class: 'snap' }); svgEl('path', { d: `M${q[0] - 3} ${q[1]}h6M${q[0]} ${q[1] - 3}v6`, class: 'snap' }); }
    else if (k === 'quad') svgEl('path', { d: `M${q[0]} ${q[1] - 6}L${q[0] + 6} ${q[1]}L${q[0]} ${q[1] + 6}L${q[0] - 6} ${q[1]}Z`, class: 'snap' });
    else if (k === 'int') svgEl('path', { d: `M${q[0] - 5} ${q[1] - 5}l10 10M${q[0] + 5} ${q[1] - 5}l-10 10`, class: 'snap thick' });
    else if (k === 'on') svgEl('path', { d: `M${q[0] - 5} ${q[1] + 5}L${q[0] + 5} ${q[1] - 5}M${q[0] - 5} ${q[1] - 5}L${q[0] + 5} ${q[1] - 5}L${q[0] - 5} ${q[1] + 5}`, class: 'snap' });
  }
}
function showReadout(x, y, lines) {
  if (!lines.length) { readout.hidden = true; return; }
  const [hx, hy] = hostXY(x, y);
  readout.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
  readout.style.transform = `translate(${hx + 18}px, ${hy + 16}px)`; readout.hidden = false;
}

export function setTool(name) {
  T.tool = name; T.st = {}; view.setSketchState({ preview: [], dimPreview: null }); clearOverlay(); closeNum();
  if (name === 'dim' && S.showDims === false) { S.showDims = true; emit('showDims'); } // 尺寸藏着的时候去标尺寸，自动显示出来
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === name));
  host.dataset.tool = name;
}
export function setPick(p) { T.pick = p; view.setSelection(p ? p.sel : (T.sel3d || [])); if (!p) view.setHover(null); emit('pick'); }

// ───── 几何小工具 ─────
const active = () => S.active && sketchById(S.active);
const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function nearestOn(e, uv) {
  if (e.type === 'line') { const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], l2 = dx * dx + dy * dy; let u = l2 ? ((uv[0] - e.a[0]) * dx + (uv[1] - e.a[1]) * dy) / l2 : 0; u = Math.max(0, Math.min(1, u)); return [e.a[0] + dx * u, e.a[1] + dy * u]; }
  const r = Math.hypot(uv[0] - e.c[0], uv[1] - e.c[1]) || 1;
  const p = [e.c[0] + ((uv[0] - e.c[0]) * e.r) / r, e.c[1] + ((uv[1] - e.c[1]) * e.r) / r];
  if (e.type === 'arc') { const ap = arcPoints(e); let a = (Math.atan2(p[1] - e.c[1], p[0] - e.c[0]) * 180) / Math.PI; while (a < ap.a0) a += 360; if (a > ap.a1) return D(uv, ap.a) < D(uv, ap.b) ? ap.a : ap.b; }
  return p;
}
function pointsOf(s, skip) {
  const P = [{ uv: [0, 0], kind: 'origin' }];
  for (const e of s.ents) {
    if (skip && skip.has(e.id)) continue;
    if (e.type === 'line') { P.push({ uv: e.a, kind: 'end', ref: e.id + '.a' }, { uv: e.b, kind: 'end', ref: e.id + '.b' }, { uv: [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2], kind: 'mid', line: e.id }); }
    if (e.type === 'arc') { const p = arcPoints(e); P.push({ uv: p.a, kind: 'end', ref: e.id + '.a' }, { uv: p.b, kind: 'end', ref: e.id + '.b' }, { uv: e.c, kind: 'center', ref: e.id + '.c' }); }
    if (e.type === 'circle') { P.push({ uv: e.c, kind: 'center', ref: e.id + '.c' }); for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) P.push({ uv: [e.c[0] + dx * e.r, e.c[1] + dy * e.r], kind: 'quad', ent: e.id }); }
  }
  return P;
}
// 两条线/圆的交点
function intersections(a, b) {
  const out = [];
  const lineLine = (p, q, r, s) => { const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]); if (Math.abs(d) < 1e-12) return; const t1 = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d, t2 = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d; if (t1 >= -1e-9 && t1 <= 1 + 1e-9 && t2 >= -1e-9 && t2 <= 1 + 1e-9) out.push([p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1]); };
  const lineCirc = (p, q, c, r) => { const dx = q[0] - p[0], dy = q[1] - p[1], fx = p[0] - c[0], fy = p[1] - c[1]; const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r, disc = B * B - 4 * A * C; if (disc < 0 || A < 1e-12) return []; const sq = Math.sqrt(disc); return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].filter(t => t >= -1e-9 && t <= 1 + 1e-9).map(t => [p[0] + dx * t, p[1] + dy * t]); };
  const curve = e => e.type !== 'line';
  if (a.type === 'line' && b.type === 'line') lineLine(a.a, a.b, b.a, b.b);
  else if (a.type === 'line' && curve(b)) out.push(...lineCirc(a.a, a.b, b.c, b.r));
  else if (curve(a) && b.type === 'line') out.push(...lineCirc(b.a, b.b, a.c, a.r));
  return out;
}
const sp = (sid, uv) => view.toScreen(sid, uv);

// 捕捉：端点/中点/圆心/象限点/原点 → 交点 → 水平竖直对齐（参考线）→ 最近点 → 网格
export function snapAt(s, x, y, opt = {}) {
  const R = 10, k = view.pxPerMm();
  const raw = view.screenToPlane(s.plane, x, y); if (!raw) return null;
  const skip = opt.skip || null;
  const pts = pointsOf(s, skip);
  let best = null;
  for (const p of pts) { const q = sp(s.id, p.uv); const d = Math.hypot(q.x - x, q.y - y); if (d <= R && (!best || d < best.d - 0.01 || (Math.abs(d - best.d) < 0.01 && p.kind === 'end'))) best = { ...p, d }; }
  if (best) return { uv: best.uv.slice(), kind: best.kind, ref: best.ref, line: best.line, ent: best.ent, guides: [] };
  const ents = s.ents.filter(e => e.type !== 'text' && !(skip && skip.has(e.id)));
  const near = ents.filter(e => D(nearestOn(e, raw), raw) * k <= 14);
  for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) for (const q of intersections(near[i], near[j])) {
    const sq = sp(s.id, q); const d = Math.hypot(sq.x - x, sq.y - y); if (d <= R && (!best || d < best.d)) best = { uv: q, kind: 'int', ents: [near[i].id, near[j].id], d };
  }
  if (best) return { ...best, guides: [] };
  // 对齐参考线：和已有点（以及起点）水平/竖直对齐
  const refPts = pts.filter(p => p.kind !== 'quad').concat(opt.from ? [{ uv: opt.from, kind: 'from' }] : []);
  let vx = null, hy = null;
  for (const p of refPts) {
    const dx = Math.abs(p.uv[0] - raw[0]) * k, dy = Math.abs(p.uv[1] - raw[1]) * k;
    if (dx <= 7 && D(p.uv, raw) * k > 12 && (!vx || dx < vx.d || (Math.abs(dx - vx.d) < 0.5 && p.kind === 'from'))) vx = { p, d: dx };
    if (dy <= 7 && D(p.uv, raw) * k > 12 && (!hy || dy < hy.d || (Math.abs(dy - hy.d) < 0.5 && p.kind === 'from'))) hy = { p, d: dy };
  }
  const g = k >= 2 ? 1 : k >= 0.5 ? 5 : 10;
  const uv = [vx ? vx.p.uv[0] : raw[0], hy ? hy.p.uv[1] : raw[1]];
  const guides = [];
  if (vx) guides.push({ from: vx.p.uv, dir: 'v', fromStart: vx.p.kind === 'from' });
  if (hy) guides.push({ from: hy.p.uv, dir: 'h', fromStart: hy.p.kind === 'from' });
  if (!vx && !hy) {
    const on = ents.map(e => ({ e, q: nearestOn(e, raw) })).filter(o => D(o.q, raw) * k <= 7).sort((a, b) => D(a.q, raw) - D(b.q, raw))[0];
    if (on) return { uv: on.q, kind: 'on', ent: on.e.id, guides: [] };
  }
  if (!vx) uv[0] = Math.round(raw[0] / g) * g;
  if (!hy) uv[1] = Math.round(raw[1] / g) * g;
  return { uv, kind: guides.length ? 'infer' : 'grid', guides, hv: guides.find(q => q.fromStart) ? guides.find(q => q.fromStart).dir : null };
}
// 把捕捉关系变成约束（新点 newRef 落在 p 上）
function applySnap(sid, newRef, p) {
  if (!p) return;
  const tryC = f => { try { f(); } catch (e) { } };
  if ((p.kind === 'end' || p.kind === 'center') && p.ref) tryC(() => ops.constrain(sid, 'coincident', newRef, p.ref));
  else if (p.kind === 'mid' && p.line) tryC(() => ops.constrain(sid, 'midpoint', newRef, p.line));
  else if ((p.kind === 'on' || p.kind === 'quad') && p.ent) tryC(() => ops.constrain(sid, 'pointon', newRef, p.ent));
  else if (p.kind === 'int' && p.ents) { tryC(() => ops.constrain(sid, 'pointon', newRef, p.ents[0])); tryC(() => ops.constrain(sid, 'pointon', newRef, p.ents[1])); }
  else if (p.kind === 'origin') tryC(() => ops.constrain(sid, 'fix', newRef));
}
const tryC = f => { try { return f(); } catch (e) { return null; } };
function autoHV(sid, id, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (Math.abs(dy) <= Math.abs(dx) * 1e-9) tryC(() => ops.constrain(sid, 'horizontal', id));
  else if (Math.abs(dx) <= Math.abs(dy) * 1e-9) tryC(() => ops.constrain(sid, 'vertical', id));
}

// ───── 命中测试 ─────
function hitPoint(s, x, y, tol = 8) {
  let best = null;
  for (const p of pointsOf(s)) { if (!p.ref) continue; const q = sp(s.id, p.uv); const d = Math.hypot(q.x - x, q.y - y); if (d <= tol && (!best || d < best.d)) best = { ref: p.ref, uv: p.uv, d }; }
  return best;
}
export function hitEnt(s, x, y, tol = 7) {
  const uv = view.screenToPlane(s.plane, x, y); if (!uv) return null;
  const k = view.pxPerMm(); let best = null;
  for (const e of s.ents) {
    if (e.type === 'text') continue;
    const px = D(nearestOn(e, uv), uv) * k;
    if (e.type === 'arc') { const ap = arcPoints(e); let a = (Math.atan2(uv[1] - e.c[1], uv[0] - e.c[0]) * 180) / Math.PI; while (a < ap.a0) a += 360; if (a > ap.a1) continue; }
    if (px <= tol && (!best || px < best.px)) best = { id: e.id, ent: e, px };
  }
  return best;
}

// ───── 画图 ─────
function commitAt(s, p) {
  const sid = s.id;
  try {
    if (T.tool === 'line') {
      if (!T.st.start) { T.st.start = p; return; }
      const a = T.st.start; if (D(a.uv, p.uv) < 1e-9) return;
      const prev = T.st.prevId;
      const id = txn(() => {
        const id = ops.line(sid, a.uv, p.uv);
        if (prev) tryC(() => ops.constrain(sid, 'coincident', prev + '.b', id + '.a')); else applySnap(sid, id + '.a', a);
        applySnap(sid, id + '.b', p);
        autoHV(sid, id, a.uv, p.uv);
        return id;
      });
      const closed = p.kind === 'end' || p.kind === 'center';
      T.st = closed ? {} : { start: { uv: ptOf(sketchById(sid), id + '.b'), kind: 'end', ref: id + '.b' }, prevId: id };
    } else if (T.tool === 'rect') {
      if (!T.st.start) { T.st.start = p; return; }
      const a = T.st.start.uv, b = p.uv; if (Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6) return;
      const s0 = T.st.start;
      txn(() => {
        const P = [a, [b[0], a[1]], b, [a[0], b[1]]], L = [];
        for (let i = 0; i < 4; i++) L.push(ops.line(sid, P[i], P[(i + 1) % 4]));
        for (let i = 0; i < 4; i++) ops.constrain(sid, 'coincident', L[i] + '.b', L[(i + 1) % 4] + '.a');
        ops.constrain(sid, 'horizontal', L[0]); ops.constrain(sid, 'horizontal', L[2]); ops.constrain(sid, 'vertical', L[1]); ops.constrain(sid, 'vertical', L[3]);
        applySnap(sid, L[0] + '.a', s0); applySnap(sid, L[2] + '.a', p);
      });
      T.st = {};
    } else if (T.tool === 'circle') {
      if (!T.st.start) { T.st.start = p; return; }
      const c = T.st.start.uv, r = D(p.uv, c); if (r < 1e-6) return;
      const s0 = T.st.start;
      txn(() => { const id = ops.circle(sid, c, r); applySnap(sid, id + '.c', s0); if (p.ref) tryC(() => ops.constrain(sid, 'pointon', p.ref, id)); });
      T.st = {};
    } else if (T.tool === 'arc') {
      if (!T.st.start) { T.st.start = p; return; }
      if (!T.st.p1) { if (D(p.uv, T.st.start.uv) < 1e-6) return; T.st.p1 = p; return; }
      const c = T.st.start.uv, a = T.st.p1.uv, r = D(a, c);
      const a0 = (Math.atan2(a[1] - c[1], a[0] - c[0]) * 180) / Math.PI, a1 = (Math.atan2(p.uv[1] - c[1], p.uv[0] - c[0]) * 180) / Math.PI;
      const s0 = T.st.start, s1 = T.st.p1;
      txn(() => { const id = ops.arc(sid, c, r, a0, a1); applySnap(sid, id + '.c', s0); applySnap(sid, id + '.a', s1); });
      T.st = {};
    }
  } catch (err) { toast(err.message, true); T.st = {}; }
  view.setSketchState({ preview: [] });
}

function previewFor(s, p) {
  const st = T.st; if (!p || !st.start) return { prev: [], info: [] };
  const a = st.start.uv, b = p.uv; let prev = [], info = [];
  if (T.tool === 'line') { prev = [[a, b]]; const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; info = [`${t('len')} ${fmt(D(a, b))}　${t('ang')} ${fmt(Math.round(ang * 10) / 10)}°`]; }
  if (T.tool === 'rect') { prev = [[a, [b[0], a[1]]], [[b[0], a[1]], b], [b, [a[0], b[1]]], [[a[0], b[1]], a]]; info = [`${fmt(Math.abs(b[0] - a[0]))} × ${fmt(Math.abs(b[1] - a[1]))}`]; }
  if (T.tool === 'circle') { const r = D(a, b); for (let i = 0; i < 64; i++) { const q0 = (i / 64) * 2 * Math.PI, q1 = ((i + 1) / 64) * 2 * Math.PI; prev.push([[a[0] + r * Math.cos(q0), a[1] + r * Math.sin(q0)], [a[0] + r * Math.cos(q1), a[1] + r * Math.sin(q1)]]); } prev.push([a, b]); info = [`R ${fmt(r)}　Ø ${fmt(2 * r)}`]; }
  if (T.tool === 'arc') {
    if (!st.p1) { prev = [[a, b]]; info = [`R ${fmt(D(a, b))}`]; }
    else { const r = D(st.p1.uv, a); let a0 = Math.atan2(st.p1.uv[1] - a[1], st.p1.uv[0] - a[0]), a1 = Math.atan2(b[1] - a[1], b[0] - a[0]); while (a1 <= a0) a1 += 2 * Math.PI; const n = 48; for (let i = 0; i < n; i++) { const q0 = a0 + ((a1 - a0) * i) / n, q1 = a0 + ((a1 - a0) * (i + 1)) / n; prev.push([[a[0] + r * Math.cos(q0), a[1] + r * Math.sin(q0)], [a[0] + r * Math.cos(q1), a[1] + r * Math.sin(q1)]]); } info = [`R ${fmt(r)}　${fmt(Math.round(((a1 - a0) * 1800) / Math.PI) / 10)}°`]; }
  }
  return { prev, info };
}

// ───── 键盘输数（画线时直接敲长度、矩形敲 宽,高、圆敲半径，回车）─────
function openNum(first) {
  const s = active(); if (!s || !T.st.start || !['line', 'rect', 'circle'].includes(T.tool)) return false;
  numbox.hidden = false; numInp.value = first || ''; numHint.textContent = T.tool === 'rect' ? t('numRect') : T.tool === 'circle' ? t('numCircle') : t('numLine');
  const last = T.st.lastXY || [host.clientWidth / 2, host.clientHeight / 2];
  const [hx, hy] = hostXY(last[0], last[1]);
  numbox.style.transform = `translate(${hx + 18}px, ${hy - 44}px)`; numInp.focus();
  numInp.setSelectionRange(numInp.value.length, numInp.value.length);
  return true;
}
function closeNum() { numbox.hidden = true; }
numInp.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Escape') { closeNum(); return; }
  if (e.key !== 'Enter') return;
  const s = active(); const nums = numInp.value.split(/[,，\s×x*]+/).map(parseFloat).filter(v => v > 0); closeNum();
  if (!s || !T.st.start || !nums.length) return;
  const a = T.st.start.uv, cur = T.st.lastUV || [a[0] + 1, a[1]];
  let target;
  if (T.tool === 'line') { const d = [cur[0] - a[0], cur[1] - a[1]], L = Math.hypot(d[0], d[1]) || 1; target = [a[0] + (d[0] / L) * nums[0], a[1] + (d[1] / L) * nums[0]]; }
  if (T.tool === 'rect') { const w = nums[0], hh = nums[1] || nums[0]; target = [a[0] + Math.sign(cur[0] - a[0] || 1) * w, a[1] + Math.sign(cur[1] - a[1] || 1) * hh]; }
  if (T.tool === 'circle') target = [a[0] + nums[0], a[1]];
  if (target) { commitAt(s, { uv: target, kind: 'typed', guides: [] }); clearOverlay(); }
});

// ───── 鼠标事件（草图编辑中）─────
function sketchDown(e) {
  const s = active(); const x = e.clientX, y = e.clientY;
  closeNum();
  if (T.tool === 'select') {
    const hp = hitPoint(s, x, y);
    if (hp) {
      T.st = { drag: hp.ref, moved: false, relax: relaxedDims(s, hp.ref) }; beginDrag(); return;
    }
    const he = hitEnt(s, x, y);
    if (he) { if (!e.shiftKey && !e.ctrlKey) T.sel.clear(); T.sel.has(he.id) ? T.sel.delete(he.id) : T.sel.add(he.id); syncSel(); return; }
    T.st = { box: [x, y], add: e.shiftKey || e.ctrlKey }; return;
  }
  if (T.tool === 'dim') return dimDown(s, x, y);
  const p = snapAt(s, x, y, { from: T.st.start && T.st.start.uv });
  if (!p) return;
  const had = !!T.st.start;
  T.st.down = { x, y, had, startedHere: !had };
  commitAt(s, p);
  if (T.st.start || T.st.p1) T.st.down = { x, y, had, startedHere: !had };
}
function sketchMove(e) {
  const s = active(); const x = e.clientX, y = e.clientY;
  { const u = view.screenToPlane(s.plane, x, y); if (u) T.lastUV = u; }
  if (T.st.drag) {
    let uv = view.screenToPlane(s.plane, x, y); if (!uv) return;
    // 拖动按网格吸附（尺寸拖出来是整数）；按住 Alt 自由拖
    if (!e.altKey) { const k = view.pxPerMm(), g = k >= 2 ? 1 : k >= 0.5 ? 5 : 10; uv = [Math.round(uv[0] / g) * g, Math.round(uv[1] / g) * g]; }
    T.st.moved = true; solveSketch(s, { ref: T.st.drag, uv }, T.st.relax); updateRelaxed(s, T.st.relax); view.drawSketches(); return;
  }
  if (T.st.box) { drawBox(T.st.box[0], T.st.box[1], x, y); return; }
  T.st.lastXY = [x, y];
  let p = null, prev = [], info = [];
  if (['line', 'rect', 'circle', 'arc'].includes(T.tool)) {
    p = snapAt(s, x, y, { from: T.st.start && T.st.start.uv });
    if (p) { T.st.lastUV = p.uv; const r = previewFor(s, p); prev = r.prev; info = r.info; }
    drawSnap(s.id, p);
    const lab = p && (p.kind === 'infer' ? (p.hv === 'h' ? t('snapH') : p.hv === 'v' ? t('snapV') : t('snapAlign')) : KIND[p.kind] ? t(KIND[p.kind]) : '');
    if (lab) info.unshift(`<b>${lab}</b>`);
    if (T.st.start && !info.length) info.push('');
    showReadout(x, y, info.filter(Boolean));
  } else if (T.tool === 'dim' || T.tool === 'select') {
    ov.innerHTML = ''; readout.hidden = true;
    if (T.tool === 'dim' && T.st.place) {
      const uv = view.screenToPlane(s.plane, x, y);
      if (uv) {
        // 已点了第一个对象：鼠标移到可组合的第二个对象上时，它也高亮，预览直接变成两对象尺寸（间距/角度/点到线）
        let st = T.st, hov = null;
        if (st.first && !st.combined) {
          const tg = pickTarget(s, x, y);
          const c = tg && tg.id !== st.first.id ? combine(st.first, tg) : null;
          if (c) {
            st = c; hov = tg.kind === 'pt' ? null : tg.id;
            if (tg.kind === 'pt') drawSnap(s.id, { uv: ptOf(s, tg.ref), kind: 'end' });
            showReadout(x, y, [`<b>${t(c.type === 'ldist' ? 'dimPairDist' : c.type === 'angle' ? 'dimPairAng' : 'dimPairPt')}</b>`]);
          }
        }
        const d = decideDim(s, st, uv); view.setSketchState({ preview: [], hover: hov, dimPreview: { id: '#preview', ...d } }); return;
      }
    }
  }
  const he = T.tool === 'select' || T.tool === 'dim' ? hitEnt(s, x, y) : null;
  view.setSketchState({ preview: prev, hover: he ? he.id : null });
}
function sketchUp(e) {
  const s = active();
  if (T.st.drag) { updateRelaxed(s, T.st.relax); solveSketch(s); T.st = {}; endDrag(); view.drawSketches(); return; }
  if (T.st.box) {
    const [ax, ay] = T.st.box, bx = e.clientX, by = e.clientY; const add = T.st.add; T.st = {}; ov.innerHTML = '';
    if (!add) T.sel.clear();
    if (Math.hypot(bx - ax, by - ay) > 4) for (const id of boxPick(s, ax, ay, bx, by)) T.sel.add(id);
    syncSel(); return;
  }
  // 按住拖画：松手处当作第二下
  const dn = T.st.down;
  if (dn && dn.startedHere && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 6 && T.st.start && ['line', 'rect', 'circle'].includes(T.tool)) {
    const p = snapAt(s, e.clientX, e.clientY, { from: T.st.start.uv });
    if (p) { commitAt(s, p); if (T.tool === 'line') T.st = {}; }
  }
  if (T.st) T.st.down = null;
}
// 框选判定：从左往右拖＝窗口选（整个在框里才选），从右往左拖＝交叉选（碰到框就选）
function samplesOf(en) {
  const P = [];
  if (en.type === 'line') for (let i = 0; i <= 40; i++) P.push([en.a[0] + (en.b[0] - en.a[0]) * i / 40, en.a[1] + (en.b[1] - en.a[1]) * i / 40]);
  else if (en.type === 'circle') for (let i = 0; i < 48; i++) P.push([en.c[0] + en.r * Math.cos(i / 48 * 2 * Math.PI), en.c[1] + en.r * Math.sin(i / 48 * 2 * Math.PI)]);
  else if (en.type === 'arc') { const ap = arcPoints(en); for (let i = 0; i <= 32; i++) { const a = (ap.a0 + (ap.a1 - ap.a0) * i / 32) * Math.PI / 180; P.push([en.c[0] + en.r * Math.cos(a), en.c[1] + en.r * Math.sin(a)]); } }
  else if (en.type === 'text') P.push(en.at);
  return P;
}
function boxPick(s, ax, ay, bx, by) {
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by), cross = bx < ax;
  const inside = uv => { const q = sp(s.id, uv); return q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1; };
  const ids = new Set();
  for (const en of s.ents) { const P = samplesOf(en); if (P.length && (cross ? P.some(inside) : P.every(inside))) ids.add(en.id); }
  for (const d of s.dims) if (inside(dimLabel(s, d))) ids.add(d.id);
  return ids;
}
function drawBox(ax, ay, x, y) {
  ov.innerHTML = ''; const [hx, hy] = hostXY(ax, ay), [qx, qy] = hostXY(x, y);
  svgEl('rect', { x: Math.min(hx, qx), y: Math.min(hy, qy), width: Math.abs(qx - hx), height: Math.abs(qy - hy), class: 'box' + (x < ax ? ' cross' : '') });
}
function syncSel() {
  view.setSketchState({ sel: new Set(T.sel) });
  document.querySelectorAll('.dim-label[data-dim]').forEach(l => l.classList.toggle('sel', T.sel.has(l.dataset.dim)));
  emit('sel');
}

// 拖一个点时，和它相连的线的长度、以它为端点的距离/角度尺寸临时放开，拖完把新数值写回去（尺寸跟着图形变）；
// 直径/半径不放开（拖圆心只是挪位置）。其余尺寸照样约束着
function relaxedDims(s, ref) {
  let p0; try { p0 = ptOf(s, ref); } catch (e) { return new Set(); }
  const pts = new Set(), ents = new Set();
  for (const e of s.ents) {
    const ks = e.type === 'line' ? ['a', 'b'] : e.type === 'arc' ? ['a', 'b', 'c'] : e.type === 'circle' ? ['c'] : [];
    for (const k of ks) { let q; try { q = ptOf(s, e.id + '.' + k); } catch (x) { continue; } if (Math.hypot(q[0] - p0[0], q[1] - p0[1]) < 1e-6) { pts.add(e.id + '.' + k); if (k !== 'c') ents.add(e.id); } }
  }
  const out = new Set();
  for (const d of s.dims) { if (d.type === 'radius' || d.type === 'diameter') continue; if (d.refs.some(r => pts.has(r) || ents.has(r))) out.add(d.id); }
  return out;
}
function updateRelaxed(s, relax) {
  if (!relax || !relax.size) return;
  for (const d of s.dims) {
    if (!relax.has(d.id)) continue;
    try {
      const v = measureDim(s, d.type, d.refs); if (!(v > 1e-6)) continue;
      d.value = v;
      if (d.type === 'hdist' || d.type === 'vdist') { const k = d.type === 'hdist' ? 0 : 1; d.sign = ptOf(s, d.refs[1])[k] >= ptOf(s, d.refs[0])[k] ? 1 : -1; }
      if (d.type === 'angle') { const [l1, l2] = d.refs.map(r => s.ents.find(e => e.id === r)); const a1 = Math.atan2(l1.b[1] - l1.a[1], l1.b[0] - l1.a[0]), a2 = Math.atan2(l2.b[1] - l2.a[1], l2.b[0] - l2.a[0]); d.sign = Math.sin(a2 - a1) >= 0 ? 1 : -1; }
    } catch (e) { }
  }
}

// ───── 复制粘贴（草图里）：框选后 Ctrl+C，鼠标移到新位置 Ctrl+V ─────
let clip = null;
function copySel() {
  const s = active(); if (!s) return false;
  const ids = new Set([...T.sel].filter(id => s.ents.some(e => e.id === id)));
  if (!ids.size) { toast(t('copyNone')); return false; }
  const inSet = r => ids.has(r.split('.')[0]);
  const ents = s.ents.filter(e => ids.has(e.id)).map(e => JSON.parse(JSON.stringify(e)));
  const cons = s.cons.filter(c => c.type !== 'fix' && c.refs.every(inSet)).map(c => JSON.parse(JSON.stringify(c)));
  const dims = s.dims.filter(d => d.refs.every(inSet)).map(d => JSON.parse(JSON.stringify(d)));
  const xs = [], ys = [];
  for (const e of ents) { const P = e.type === 'line' ? [e.a, e.b] : e.type === 'text' ? [e.at] : [[e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]]; for (const p of P) { xs.push(p[0]); ys.push(p[1]); } }
  clip = { ents, cons, dims, center: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2], n: 0 };
  toast(t('copied').replace('{n}', ents.length));
  return true;
}
function pasteClip() {
  const s = active(); if (!s || !clip) return;
  clip.n++;
  const tgt = T.lastUV || [clip.center[0] + 10 * clip.n, clip.center[1] - 10 * clip.n];
  const d = [tgt[0] - clip.center[0], tgt[1] - clip.center[1]], mv = p => [p[0] + d[0], p[1] + d[1]];
  const map = {};
  try {
    txn(() => {
      for (const e of clip.ents) {
        let id;
        if (e.type === 'line') id = ops.line(s.id, mv(e.a), mv(e.b));
        else if (e.type === 'circle') id = ops.circle(s.id, mv(e.c), e.r);
        else if (e.type === 'arc') id = ops.arc(s.id, mv(e.c), e.r, e.a0, e.a1);
        else if (e.type === 'text') id = ops.text(s.id, mv(e.at), e.text, e.h);
        if (id) { map[e.id] = id; if (e.construction) ops.construction(id, true); }
      }
      const R = r => { const [id, k] = r.split('.'); return map[id] + (k ? '.' + k : ''); };
      for (const c of clip.cons) tryC(() => ops.constrain(s.id, c.type, ...c.refs.map(R)));
      for (const dd of clip.dims) tryC(() => ops.dim(s.id, dd.type, dd.refs.map(R), dd.value, dd.off));
    });
  } catch (err) { toast(err.message, true); return; }
  T.sel = new Set(Object.values(map)); syncSel();
  toast(t('pasted').replace('{n}', Object.keys(map).length));
}
// 旧的"标了尺寸就锁死"已取消（2026-10-06 用户要求：线照样能拖，尺寸跟着变）
function dimmedPoints(s) {
  const pts = [];
  for (const d of s.dims) for (const r of d.refs) {
    if (r.includes('.')) { pts.push(ptOf(s, r)); continue; }
    const e = s.ents.find(q => q.id === r); if (!e) continue;
    if (e.type === 'line') pts.push(e.a, e.b);
    else if (e.type === 'circle') pts.push(e.c);
    else if (e.type === 'arc') { const p = arcPoints(e); pts.push(e.c, p.a, p.b); }
  }
  return pts;
}
function lockedAt(s, uv) { return dimmedPoints(s).some(p => Math.hypot(p[0] - uv[0], p[1] - uv[1]) < 1e-6); }

// ───── 智能尺寸 ─────
// 智能尺寸：先点一个对象，可再点第二个对象（组合），最后点空白处放数字
//   线 → 长度；圆 → 直径；圆弧 → 半径；点+点 → 距离（按放的位置自动水平/竖直/直线）
//   两条平行线 → 间距；两条不平行线 → 角度；点/圆心 + 线 → 垂直距离；圆 + 圆 → 圆心距
function pickTarget(s, x, y) {
  const hp = hitPoint(s, x, y); if (hp) return { kind: 'pt', ref: hp.ref, id: hp.ref.split('.')[0] };
  const he = hitEnt(s, x, y); if (he) return { kind: he.ent.type, ent: he.ent, id: he.id };
  return null;
}
function single(t) {
  if (t.kind === 'line') return { type: 'length', refs: [t.id] };
  if (t.kind === 'circle') return { type: 'diameter', refs: [t.id] };
  if (t.kind === 'arc') return { type: 'radius', refs: [t.id] };
  return null;
}
function combine(a, b) {
  const pt = t => (t.kind === 'pt' ? t.ref : t.kind === 'circle' || t.kind === 'arc' ? t.id + '.c' : null);
  if (a.kind === 'line' && b.kind === 'line') {
    const u = [a.ent.b[0] - a.ent.a[0], a.ent.b[1] - a.ent.a[1]], v = [b.ent.b[0] - b.ent.a[0], b.ent.b[1] - b.ent.a[1]];
    const cr = Math.abs(u[0] * v[1] - u[1] * v[0]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
    return cr < 0.02 ? { type: 'ldist', refs: [a.id, b.id] } : { type: 'angle', refs: [a.id, b.id] };
  }
  if (a.kind === 'line' && pt(b)) return { type: 'pldist', refs: [pt(b), a.id] };
  if (b.kind === 'line' && pt(a)) return { type: 'pldist', refs: [pt(a), b.id] };
  if (pt(a) && pt(b) && pt(a) !== pt(b)) return { type: 'distance', refs: [pt(a), pt(b)] };
  return null;
}
// 根据鼠标位置决定尺寸类型和数字偏移：两点距离放在上下方＝水平尺寸，左右＝竖直尺寸，斜着＝两点直线距离
function decideDim(s, st, uv) {
  let type = st.type; const refs = st.refs;
  if (type === 'distance') {
    const p = ptOf(s, refs[0]), q = ptOf(s, refs[1]);
    const dx = Math.abs(q[0] - p[0]), dy = Math.abs(q[1] - p[1]);
    if (dx > 1e-6 && dy > 1e-6) {
      const outY = uv[1] > Math.max(p[1], q[1]) || uv[1] < Math.min(p[1], q[1]), outX = uv[0] > Math.max(p[0], q[0]) || uv[0] < Math.min(p[0], q[0]);
      if (outY && !outX) type = 'hdist'; else if (outX && !outY) type = 'vdist';
    } else type = dy < 1e-6 ? 'hdist' : 'vdist';
  }
  const d = { type, refs };
  const base = dimBase(s, d);
  return { type, refs, off: [uv[0] - base[0], uv[1] - base[1]], value: measureDim(s, type, refs) };
}
function dimDown(s, x, y) {
  const st = T.st;
  const tg = pickTarget(s, x, y);
  // 已经选了第一个对象，又点到另一个对象 → 组合成两对象尺寸
  if (tg && st.first && tg.id !== st.first.id && !st.combined) {
    const c = combine(st.first, tg);
    if (c) { T.st = { place: true, combined: true, first: st.first, ...c }; view.setSketchState({ sel: new Set([st.first.id, tg.id]) }); return; }
  }
  if (st.place) {
    const uv = view.screenToPlane(s.plane, x, y); if (!uv) return;
    const d = decideDim(s, st, uv);
    T.st = {};
    view.setSketchState({ preview: [], sel: new Set(), dimPreview: null });
    try { const id = ops.dim(s.id, d.type, d.refs, d.value, d.off); emit('sketch'); setTimeout(() => openDimEditor(id), 30); }
    catch (err) { toast(err.message, true); }
    return;
  }
  if (!tg) return;
  const one = single(tg);
  T.st = one ? { place: true, first: tg, ...one } : { first: tg };
  view.setSketchState({ sel: new Set([tg.id]) });
}
function currentValue(s, type, refs) { return measureDim(s, type, refs); }

// ───── 三维：悬停、点选草图、拾取平面/边/面 ─────
function sketchUnder(x, y) {
  const used = new Set(S.doc.features.map(f => f.sketch));
  for (const sid of view.shownSketches()) { if (used.has(sid)) continue; const s = sketchById(sid); if (s && hitEnt(s, x, y, 7)) return sid; }
  return null;
}
function solidMove(e) {
  if (S.mode !== '3d') return;
  const want = T.pick ? T.pick.kind : 'any';
  let h = null;
  if (want === 'any') { const sk = sketchUnder(e.clientX, e.clientY); view.setSketchState({ hoverSketch: sk }); if (sk) { view.setHover(null); host.style.cursor = 'pointer'; return; } }
  host.style.cursor = '';
  if (want === 'edges' || want === 'any') { const ed = view.pickEdge(e.clientX, e.clientY); if (ed) h = { kind: 'edge', group: ed.group }; }
  if (!h && want !== 'edges') { const f = view.pickFace(e.clientX, e.clientY); if (f && (want !== 'plane' || (f.info && f.info.planar))) h = { kind: 'face', face: f.face }; }
  view.setHover(h);
}
// 三维里的常驻选择（像 SolidWorks：先选面/边，再点圆角、倒角、抽壳、新建草图）
T.sel3d = [];
export function clearSel3d() { T.sel3d = []; if (!T.pick) view.setSelection([]); emit('sel3d'); }
// 一个面 → 它所有的边
export function faceToEdges(fi) {
  const B = S.built; if (!B || !B.faceEdges || !B.faceEdges[fi]) return [];
  return B.faceEdges[fi].map(g => ({ kind: 'edge', group: g, point: view.edgePoint(g) })).filter(x => x.point);
}
function solidDown(e) {
  const add = e.ctrlKey || e.shiftKey;
  if (!T.pick) {
    const sk = sketchUnder(e.clientX, e.clientY);
    if (sk) { S.selSketch = sk; T.sel3d = []; view.setSelection([]); emit('selSketch'); emit('sel3d'); view.drawSketches(); return; }
    S.selSketch = null; emit('selSketch'); view.drawSketches();
    // 边优先（离边 7 像素内），否则面；Ctrl/Shift 多选，再点一次取消；点空白清空
    const ed = view.pickEdge(e.clientX, e.clientY);
    const f = ed ? null : view.pickFace(e.clientX, e.clientY);
    const item = ed ? { kind: 'edge', group: ed.group, point: ed.point } : f ? { kind: 'face', face: f.face, point: f.point, planar: !!(f.info && f.info.planar) } : null;
    if (!item) { clearSel3d(); return; }
    const same = x => (x.kind === item.kind && (item.kind === 'edge' ? x.group === item.group : x.face === item.face));
    const i = T.sel3d.findIndex(same);
    if (add) { if (i >= 0) T.sel3d.splice(i, 1); else T.sel3d.push(item); }
    else T.sel3d = i >= 0 && T.sel3d.length === 1 ? [] : [item];
    view.setSelection(T.sel3d); emit('sel3d'); return;
  }
  const k = T.pick.kind;
  if (k === 'edges') {
    const ed = view.pickEdge(e.clientX, e.clientY);
    if (!ed) {
      // 点到面上：把这个面的所有边加进来（已经全在里面就全部取消）
      const f = view.pickFace(e.clientX, e.clientY); if (!f) return;
      const es = faceToEdges(f.face);
      const allIn = es.length && es.every(x => T.pick.sel.some(s => s.group === x.group));
      if (allIn) T.pick.sel = T.pick.sel.filter(s => !es.some(x => x.group === s.group));
      else for (const x of es) if (!T.pick.sel.some(s => s.group === x.group)) T.pick.sel.push(x);
      view.setSelection(T.pick.sel); emit('pick'); return;
    }
    const i = T.pick.sel.findIndex(s => s.group === ed.group);
    if (i >= 0) T.pick.sel.splice(i, 1); else T.pick.sel.push({ kind: 'edge', group: ed.group, point: ed.point });
  } else {
    const f = view.pickFace(e.clientX, e.clientY); if (!f) return;
    if (k === 'plane') { if (!f.info || !f.info.planar) return; return T.pick.onPick({ face: f.point }); }
    const i = T.pick.sel.findIndex(s => s.face === f.face);
    if (i >= 0) T.pick.sel.splice(i, 1); else T.pick.sel.push({ kind: 'face', face: f.face, point: f.point });
  }
  view.setSelection(T.pick.sel); emit('pick');
}
let onEditSketch = () => { };
export const setOnEditSketch = f => { onEditSketch = f; };

let rafPending = null;
function box3d(st, e, phase) {
  if (S.mode !== '3d' || S.active) return;
  if (phase === 'move') { drawBox(st.x, st.y, e.clientX, e.clientY); return; }
  ov.innerHTML = '';
  const ax = st.x, ay = st.y, bx = e.clientX, by = e.clientY, add = e.ctrlKey || e.shiftKey;
  if (!T.pick || T.pick.kind === 'edges') {
    if (!T.pick) {
      let best = null;
      const used = new Set(S.doc.features.map(f => f.sketch));
      for (const sid of view.shownSketches()) { const sk = sketchById(sid); if (!sk) continue; const ids = boxPick(sk, ax, ay, bx, by); if (ids.size && (!best || ids.size > best.ids.size)) best = { sid, ids, used: used.has(sid) }; }
      if (best) { onEditSketch(best.sid, { keepView: true }); T.sel = best.ids; syncSel(); toast(t('boxSketch').replace('{n}', best.ids.size)); return; }
    }
    // 模型的边：从左往右＝整条边在框里，从右往左＝碰到就算
    const groups = view.edgesInBox(ax, ay, bx, by, bx < ax);
    const list = T.pick ? T.pick.sel : (add ? T.sel3d : (T.sel3d = []));
    for (const g of groups) if (!list.some(x => x.kind === 'edge' && x.group === g)) { const pt = view.edgePoint(g); if (pt) list.push({ kind: 'edge', group: g, point: pt }); }
    view.setSelection(list); emit(T.pick ? 'pick' : 'sel3d');
  }
}
view.setHandler({
  box: box3d,
  down(e) { if (S.mode === 'sheet') return; if (S.active) sketchDown(e); else solidDown(e); },
  move(e) {
    if (S.mode === 'sheet') return;
    if (S.active && (T.st.drag || T.st.box)) return sketchMove(e);
    rafPending = e;
    requestAnimationFrame(() => { const ev = rafPending; if (!ev) return; rafPending = null; if (S.active) sketchMove(ev); else solidMove(ev); });
  },
  up(e) { if (S.active) sketchUp(e); },
  dbl(e) {
    if (S.active) { if (T.tool === 'line') { T.st = {}; view.setSketchState({ preview: [] }); clearOverlay(); } return; }
    const sk = sketchUnder(e.clientX, e.clientY); if (sk) onEditSketch(sk);
  },
});
host.addEventListener('pointerleave', () => { if (!T.st.drag && !T.st.box) { ov.innerHTML = ''; readout.hidden = true; } });

// ───── 改尺寸输入框 ─────
const box = document.getElementById('dimbox'), inp = box.querySelector('input');
let editing = null;
export function openDimEditor(id) {
  const s = S.active && sketchById(S.active); if (!s) return;
  const d = s.dims.find(x => x.id === id); if (!d) return;
  editing = id;
  const L = dimLabel(s, d), p = view.toScreen(s.id, L);
  box.style.left = p.x + 'px'; box.style.top = p.y + 'px'; box.hidden = false;
  inp.value = fmt(d.value); inp.focus(); inp.select();
}
export function closeDimEditor() { editing = null; box.hidden = true; }
inp.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') { const v = parseFloat(inp.value); const id = editing; closeDimEditor(); if (id && v > 0) { try { ops.setDim(id, v); } catch (err) { toast(err.message, true); } } }
  if (e.key === 'Escape') closeDimEditor();
});
inp.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== inp) closeDimEditor(); }, 150));
host.addEventListener('dblclick', e => {
  const l = e.target.closest('.dim-label'); if (l && l.dataset.dim) {
    e.stopPropagation();
    if (l.dataset.sk && l.dataset.sk !== S.active) { onEditSketch(l.dataset.sk); setTimeout(() => openDimEditor(l.dataset.dim), 350); return; }
    openDimEditor(l.dataset.dim);
  }
});
// 拖动尺寸数字换位置（不改尺寸值）
let labDrag = null;
host.addEventListener('pointerdown', e => {
  const l = e.target.closest('.dim-label[data-dim]'); if (!l || !S.active || l.dataset.sk !== S.active || e.button !== 0) return;
  labDrag = { id: l.dataset.dim, x: e.clientX, y: e.clientY, on: false, el: l };
  try { l.setPointerCapture(e.pointerId); } catch (x) { }
});
window.addEventListener('pointermove', e => {
  if (!labDrag) return;
  if (!labDrag.on && Math.hypot(e.clientX - labDrag.x, e.clientY - labDrag.y) < 3) return;
  const s = active(); if (!s) { labDrag = null; return; }
  const d = s.dims.find(q => q.id === labDrag.id); if (!d) { labDrag = null; return; }
  if (!labDrag.on) { labDrag.on = true; beginDrag(); closeDimEditor(); }
  const uv = view.screenToPlane(s.plane, e.clientX, e.clientY); if (!uv) return;
  moveDimLabel(s, d, uv); view.drawSketches();
  const nl = host.querySelector(`.dim-label[data-dim="${d.id}"]`); if (nl) nl.classList.add('dragging');
});
window.addEventListener('pointerup', () => {
  if (!labDrag) return;
  const was = labDrag.on; labDrag = null;
  if (was) { endDrag(); view.drawSketches(); labMoved = true; setTimeout(() => { labMoved = false; }, 0); }
});
let labMoved = false;
host.addEventListener('click', e => {
  if (labMoved) return;
  const l = e.target.closest('.dim-label'); if (!l || !l.dataset.dim || !S.active) return;
  if (!e.shiftKey && !e.ctrlKey) T.sel.clear(); T.sel.add(l.dataset.dim); syncSel();
});

// 键盘
window.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
  if ((e.ctrlKey || e.metaKey) && S.active && !e.shiftKey && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'c') { if (copySel()) e.preventDefault(); return; }
    if (k === 'v') { if (clip) { e.preventDefault(); pasteClip(); } return; }
    if (k === 'a') { e.preventDefault(); const s = active(); T.sel = new Set(s.ents.map(x => x.id)); syncSel(); return; }
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (S.active && T.st.start && /^[0-9.]$/.test(e.key)) { if (openNum(e.key)) e.preventDefault(); return; }
  if (e.key === 'Escape') {
    if (T.st.start || T.st.first || T.st.place) { T.st = {}; view.setSketchState({ preview: [], dimPreview: null, sel: new Set() }); clearOverlay(); }
    else if (S.active) { setTool('select'); T.sel.clear(); syncSel(); }
    else if (T.sel3d.length) clearSel3d();
    emit('escape');
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.active && T.sel.size) { const ids = [...T.sel]; T.sel.clear(); txn(() => ids.forEach(id => tryC(() => ops.del(id)))); syncSel(); }
  if (S.active && !T.st.start) {
    const map = { l: 'line', r: 'rect', c: 'circle', a: 'arc', d: 'dim', s: 'select' };
    if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
  }
});
