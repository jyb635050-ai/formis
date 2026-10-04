// 鼠标工具：草图里画线/矩形/圆/圆弧（点两下或按住拖都行）、对象捕捉、水平竖直参考线、光标旁实时尺寸、键盘输数、
// 智能尺寸、选择（点选/框选/拖点）；三维里悬停高亮、点选草图、选平面、选边、选面
import { S, ops, txn, beginDrag, endDrag, sketchById, dimLabel, emit, ptOf } from './doc.js';
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
  T.tool = name; T.st = {}; view.setSketchState({ preview: [] }); clearOverlay(); closeNum();
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === name));
  host.dataset.tool = name;
}
export function setPick(p) { T.pick = p; view.setSelection(p ? p.sel : []); if (!p) view.setHover(null); emit('pick'); }

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
    if (hp) { T.st = { drag: hp.ref, moved: false }; beginDrag(); return; }
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
  if (T.st.drag) {
    const uv = view.screenToPlane(s.plane, x, y); if (!uv) return;
    T.st.moved = true; solveSketch(s, { ref: T.st.drag, uv }); view.drawSketches(); return;
  }
  if (T.st.box) {
    ov.innerHTML = ''; const [ax, ay] = hostXY(...T.st.box), [bx, by] = hostXY(x, y);
    svgEl('rect', { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay), class: 'box' }); return;
  }
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
  } else if (T.tool === 'dim' || T.tool === 'select') { ov.innerHTML = ''; readout.hidden = true; }
  const he = T.tool === 'select' || T.tool === 'dim' ? hitEnt(s, x, y) : null;
  view.setSketchState({ preview: prev, hover: he ? he.id : null });
}
function sketchUp(e) {
  const s = active();
  if (T.st.drag) { solveSketch(s); T.st = {}; endDrag(); view.drawSketches(); return; }
  if (T.st.box) {
    const [ax, ay] = T.st.box, bx = e.clientX, by = e.clientY; const add = T.st.add; T.st = {}; ov.innerHTML = '';
    if (!add) T.sel.clear();
    if (Math.hypot(bx - ax, by - ay) > 4) {
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
      const inside = uv => { const q = sp(s.id, uv); return q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1; };
      for (const en of s.ents) {
        const pts = en.type === 'line' ? [en.a, en.b] : en.type === 'circle' ? [[en.c[0] - en.r, en.c[1]], [en.c[0] + en.r, en.c[1]], [en.c[0], en.c[1] - en.r], [en.c[0], en.c[1] + en.r]] : en.type === 'arc' ? [arcPoints(en).a, arcPoints(en).b, arcPoints(en).m] : [en.at];
        if (pts.every(inside)) T.sel.add(en.id);
      }
      for (const d of s.dims) if (inside(dimLabel(s, d))) T.sel.add(d.id);
    }
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
function syncSel() {
  view.setSketchState({ sel: new Set(T.sel) });
  document.querySelectorAll('.dim-label[data-dim]').forEach(l => l.classList.toggle('sel', T.sel.has(l.dataset.dim)));
  emit('sel');
}

// ───── 智能尺寸 ─────
function dimDown(s, x, y) {
  const st = T.st;
  if (st.place) {
    const uv = view.screenToPlane(s.plane, x, y); if (!uv) return;
    let type = st.type; const refs = st.refs; let off;
    if (type === 'radius' || type === 'diameter') { const e = s.ents.find(q => q.id === refs[0]); off = [uv[0] - e.c[0], uv[1] - e.c[1]]; }
    else {
      const [p, q] = type === 'length' ? [ptOf(s, refs[0] + '.a'), ptOf(s, refs[0] + '.b')] : [ptOf(s, refs[0]), ptOf(s, refs[1])];
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; off = [uv[0] - mid[0], uv[1] - mid[1]];
      if (type === 'distance') {
        const dx = Math.abs(q[0] - p[0]), dy = Math.abs(q[1] - p[1]);
        if (dx > 1e-6 && dy > 1e-6) { if (Math.abs(off[1]) > Math.abs(off[0]) * 2) type = 'hdist'; else if (Math.abs(off[0]) > Math.abs(off[1]) * 2) type = 'vdist'; }
        else type = dy < 1e-6 ? 'hdist' : 'vdist';
      }
    }
    const value = currentValue(s, type, refs);
    T.st = {};
    try { const id = ops.dim(s.id, type, refs, value, off); emit('sketch'); setTimeout(() => openDimEditor(id), 30); }
    catch (err) { toast(err.message, true); }
    view.setSketchState({ preview: [], sel: new Set() }); return;
  }
  const hp = hitPoint(s, x, y);
  if (hp) {
    if (st.first) { if (st.first !== hp.ref) T.st = { place: true, type: 'distance', refs: [st.first, hp.ref] }; return; }
    T.st = { first: hp.ref }; view.setSketchState({ sel: new Set([hp.ref.split('.')[0]]) }); return;
  }
  const he = hitEnt(s, x, y);
  if (!he) return;
  if (he.ent.type === 'line') T.st = { place: true, type: 'length', refs: [he.id] };
  else if (he.ent.type === 'circle') T.st = { place: true, type: 'diameter', refs: [he.id] };
  else if (he.ent.type === 'arc') T.st = { place: true, type: 'radius', refs: [he.id] };
  view.setSketchState({ sel: new Set([he.id]) });
}
function currentValue(s, type, refs) {
  const e = s.ents.find(q => q.id === refs[0]);
  if (type === 'length') return D(e.a, e.b);
  if (type === 'diameter') return 2 * e.r;
  if (type === 'radius') return e.r;
  const p = ptOf(s, refs[0]), q = ptOf(s, refs[1]);
  if (type === 'hdist') return Math.abs(q[0] - p[0]);
  if (type === 'vdist') return Math.abs(q[1] - p[1]);
  return D(p, q);
}

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
function solidDown(e) {
  if (!T.pick) {
    const sk = sketchUnder(e.clientX, e.clientY);
    S.selSketch = sk || null; emit('selSketch'); view.drawSketches(); return;
  }
  const k = T.pick.kind;
  if (k === 'edges') {
    const ed = view.pickEdge(e.clientX, e.clientY); if (!ed) return;
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
view.setHandler({
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
  const l = e.target.closest('.dim-label'); if (l && l.dataset.dim) { e.stopPropagation(); openDimEditor(l.dataset.dim); }
});
host.addEventListener('click', e => {
  const l = e.target.closest('.dim-label'); if (!l || !l.dataset.dim || !S.active) return;
  if (!e.shiftKey && !e.ctrlKey) T.sel.clear(); T.sel.add(l.dataset.dim); syncSel();
});

// 键盘
window.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (S.active && T.st.start && /^[0-9.]$/.test(e.key)) { if (openNum(e.key)) e.preventDefault(); return; }
  if (e.key === 'Escape') {
    if (T.st.start || T.st.first || T.st.place) { T.st = {}; view.setSketchState({ preview: [] }); clearOverlay(); }
    else if (S.active) { setTool('select'); T.sel.clear(); syncSel(); }
    emit('escape');
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.active && T.sel.size) { const ids = [...T.sel]; T.sel.clear(); txn(() => ids.forEach(id => tryC(() => ops.del(id)))); syncSel(); }
  if (S.active && !T.st.start) {
    const map = { l: 'line', r: 'rect', c: 'circle', a: 'arc', d: 'dim', s: 'select' };
    if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
  }
});
