// 鼠标工具：草图里画线/矩形/圆/圆弧、智能尺寸、选择拖点；三维里悬停高亮、选平面、选边、选面
import { S, ops, txn, beginDrag, endDrag, sketchById, dimLabel, emit, ptOf } from './doc.js';
import { solveSketch } from './solver.js';
import { arcPoints } from './kernel/build.js';
import * as view from './view.js';
import { t } from './i18n.js';
import { fmt } from './util.js';

export const T = { tool: 'select', st: {}, pick: null /* {kind:'plane'|'edges'|'faces', sel:[], onPick} */, hoverEnt: null, sel: new Set() };
let toast = () => { };
export const setToast = f => { toast = f; };

export function setTool(name) {
  T.tool = name; T.st = {}; view.setSketchState({ preview: [] });
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === name));
}
export function setPick(p) { T.pick = p; view.setSelection(p ? p.sel : []); if (!p) view.setHover(null); emit('pick'); }

// ───── 草图命中 ─────
const active = () => S.active && sketchById(S.active);
function hitPoint(s, x, y, tol = 8) {
  let best = null;
  const cand = [];
  for (const e of s.ents) {
    if (e.type === 'line') cand.push([e.id + '.a', e.a], [e.id + '.b', e.b]);
    if (e.type === 'arc') { const p = arcPoints(e); cand.push([e.id + '.a', p.a], [e.id + '.b', p.b], [e.id + '.c', e.c]); }
    if (e.type === 'circle') cand.push([e.id + '.c', e.c]);
  }
  for (const [ref, uv] of cand) { const p = view.toScreen(s.id, uv); const d = Math.hypot(p.x - x, p.y - y); if (d <= tol && (!best || d < best.d)) best = { ref, uv, d }; }
  return best;
}
function hitEnt(s, x, y, tol = 7) {
  const uv = view.screenToPlane(s.plane, x, y); if (!uv) return null;
  const k = view.pxPerMm(); let best = null;
  for (const e of s.ents) {
    let d = Infinity;
    if (e.type === 'line') { const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], l2 = dx * dx + dy * dy; let u = l2 ? ((uv[0] - e.a[0]) * dx + (uv[1] - e.a[1]) * dy) / l2 : 0; u = Math.max(0, Math.min(1, u)); d = Math.hypot(e.a[0] + dx * u - uv[0], e.a[1] + dy * u - uv[1]); }
    else if (e.type === 'circle') d = Math.abs(Math.hypot(uv[0] - e.c[0], uv[1] - e.c[1]) - e.r);
    else if (e.type === 'arc') { const p = arcPoints(e); let a = (Math.atan2(uv[1] - e.c[1], uv[0] - e.c[0]) * 180) / Math.PI; while (a < p.a0) a += 360; d = a <= p.a1 ? Math.abs(Math.hypot(uv[0] - e.c[0], uv[1] - e.c[1]) - e.r) : Infinity; }
    else continue;
    const px = d * k; if (px <= tol && (!best || px < best.px)) best = { id: e.id, ent: e, px };
  }
  return best;
}
// 光标 → 草图坐标：先吸附已有端点，再吸附网格
function snapAt(s, x, y) {
  const hp = hitPoint(s, x, y);
  if (hp) return { uv: hp.uv.slice(), ref: hp.ref };
  const uv = view.screenToPlane(s.plane, x, y); if (!uv) return null;
  const k = view.pxPerMm(); const g = k >= 2 ? 1 : k >= 0.5 ? 5 : 10;
  return { uv: [Math.round(uv[0] / g) * g, Math.round(uv[1] / g) * g], ref: null };
}
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9;
function autoHV(sid, id, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (Math.abs(dy) <= Math.abs(dx) * 0.0175) tryC(() => ops.constrain(sid, 'horizontal', id));
  else if (Math.abs(dx) <= Math.abs(dy) * 0.0175) tryC(() => ops.constrain(sid, 'vertical', id));
}
const tryC = f => { try { return f(); } catch (e) { return null; } };

// ───── 鼠标事件 ─────
function sketchDown(e) {
  const s = active(); const x = e.clientX, y = e.clientY;
  if (T.tool === 'select') {
    const hp = hitPoint(s, x, y);
    if (hp) { T.st = { drag: hp.ref, moved: false }; beginDrag(); return; }
    const he = hitEnt(s, x, y);
    if (he) { if (!e.shiftKey) T.sel.clear(); T.sel.has(he.id) ? T.sel.delete(he.id) : T.sel.add(he.id); }
    else T.sel.clear();
    view.setSketchState({ sel: new Set(T.sel) }); return;
  }
  if (T.tool === 'dim') return dimDown(s, x, y);
  const p = snapAt(s, x, y); if (!p) return;
  try {
    if (T.tool === 'line') {
      if (!T.st.start) { T.st = { start: p }; return; }
      const a = T.st.start; if (near(a.uv, p.uv)) return;
      const prev = T.st.prevId;
      const id = txn(() => {
        const id = ops.line(s.id, a.uv, p.uv);
        if (prev) tryC(() => ops.constrain(s.id, 'coincident', prev + '.b', id + '.a'));
        else if (a.ref) tryC(() => ops.constrain(s.id, 'coincident', a.ref, id + '.a'));
        if (p.ref) tryC(() => ops.constrain(s.id, 'coincident', id + '.b', p.ref));
        autoHV(s.id, id, a.uv, p.uv);
        return id;
      });
      const end = ptOf(sketchById(s.id), id + '.b');
      T.st = p.ref ? {} : { start: { uv: end, ref: id + '.b' }, prevId: id };
    } else if (T.tool === 'rect') {
      if (!T.st.start) { T.st = { start: p }; return; }
      const a = T.st.start.uv, b = p.uv; if (Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6) return;
      const c1 = T.st.start.ref, c3 = p.ref;
      txn(() => {
        const P = [a, [b[0], a[1]], b, [a[0], b[1]]], L = [];
        for (let i = 0; i < 4; i++) L.push(ops.line(s.id, P[i], P[(i + 1) % 4]));
        for (let i = 0; i < 4; i++) ops.constrain(s.id, 'coincident', L[i] + '.b', L[(i + 1) % 4] + '.a');
        ops.constrain(s.id, 'horizontal', L[0]); ops.constrain(s.id, 'horizontal', L[2]); ops.constrain(s.id, 'vertical', L[1]); ops.constrain(s.id, 'vertical', L[3]);
        if (c1) tryC(() => ops.constrain(s.id, 'coincident', L[0] + '.a', c1));
        if (c3) tryC(() => ops.constrain(s.id, 'coincident', L[2] + '.a', c3));
      });
      T.st = {};
    } else if (T.tool === 'circle') {
      if (!T.st.start) { T.st = { start: p }; return; }
      const c = T.st.start.uv, r = Math.hypot(p.uv[0] - c[0], p.uv[1] - c[1]); if (r < 1e-6) return;
      const cref = T.st.start.ref;
      txn(() => { const id = ops.circle(s.id, c, r); if (cref) tryC(() => ops.constrain(s.id, 'coincident', id + '.c', cref)); });
      T.st = {};
    } else if (T.tool === 'arc') {
      if (!T.st.start) { T.st = { start: p }; return; }
      if (!T.st.p1) { T.st.p1 = p; return; }
      const c = T.st.start.uv, a = T.st.p1.uv, r = Math.hypot(a[0] - c[0], a[1] - c[1]); if (r < 1e-6) return;
      const a0 = (Math.atan2(a[1] - c[1], a[0] - c[0]) * 180) / Math.PI, a1 = (Math.atan2(p.uv[1] - c[1], p.uv[0] - c[0]) * 180) / Math.PI;
      txn(() => { const id = ops.arc(s.id, c, r, a0, a1); if (T.st.p1.ref) tryC(() => ops.constrain(s.id, 'coincident', id + '.a', T.st.p1.ref)); });
      T.st = {};
    }
  } catch (err) { toast(err.message, true); T.st = {}; }
  view.setSketchState({ preview: [] });
}
function dimDown(s, x, y) {
  const st = T.st;
  if (st.place) {
    // 第二/三下：放置位置
    const uv = view.screenToPlane(s.plane, x, y); if (!uv) return;
    let type = st.type, refs = st.refs;
    let off;
    if (type === 'radius' || type === 'diameter') { const e = s.ents.find(q => q.id === refs[0]); off = [uv[0] - e.c[0], uv[1] - e.c[1]]; }
    else {
      const [p, q] = type === 'length' ? [ptOf(s, refs[0] + '.a'), ptOf(s, refs[0] + '.b')] : [ptOf(s, refs[0]), ptOf(s, refs[1])];
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; off = [uv[0] - mid[0], uv[1] - mid[1]];
      if (type === 'distance') { // 两点：放在上下方＝水平距离，放在左右＝竖直距离，斜着＝直线距离
        const dx = Math.abs(q[0] - p[0]), dy = Math.abs(q[1] - p[1]);
        if (dx > 1e-6 && dy > 1e-6) { if (Math.abs(off[1]) > Math.abs(off[0]) * 2) type = 'hdist'; else if (Math.abs(off[0]) > Math.abs(off[1]) * 2) type = 'vdist'; }
        else type = dy < 1e-6 ? 'hdist' : 'vdist';
      }
    }
    const value = currentValue(s, type, refs);
    T.st = {};
    try {
      const id = ops.dim(s.id, type, refs, value, off);
      emit('sketch');
      setTimeout(() => openDimEditor(id), 30);
    } catch (err) { toast(err.message, true); }
    view.setSketchState({ preview: [], sel: new Set() });
    return;
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
  if (type === 'length') return Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
  if (type === 'diameter') return 2 * e.r;
  if (type === 'radius') return e.r;
  const p = ptOf(s, refs[0]), q = ptOf(s, refs[1]);
  if (type === 'hdist') return Math.abs(q[0] - p[0]);
  if (type === 'vdist') return Math.abs(q[1] - p[1]);
  return Math.hypot(q[0] - p[0], q[1] - p[1]);
}
function sketchMove(e) {
  const s = active(); const x = e.clientX, y = e.clientY;
  if (T.st.drag) {
    const uv = view.screenToPlane(s.plane, x, y); if (!uv) return;
    T.st.moved = true;
    solveSketch(s, { ref: T.st.drag, uv });
    view.drawSketches(); return;
  }
  // 预览
  const p = snapAt(s, x, y); let prev = [];
  if (p && T.st.start) {
    const a = T.st.start.uv, b = p.uv;
    if (T.tool === 'line') prev = [[a, b]];
    if (T.tool === 'rect') prev = [[a, [b[0], a[1]]], [[b[0], a[1]], b], [b, [a[0], b[1]]], [[a[0], b[1]], a]];
    if (T.tool === 'circle') { const r = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let i = 0; i < 64; i++) { const q0 = (i / 64) * 2 * Math.PI, q1 = ((i + 1) / 64) * 2 * Math.PI; prev.push([[a[0] + r * Math.cos(q0), a[1] + r * Math.sin(q0)], [a[0] + r * Math.cos(q1), a[1] + r * Math.sin(q1)]]); } }
    if (T.tool === 'arc') prev = [[a, T.st.p1 ? T.st.p1.uv : b]];
  }
  const he = T.tool === 'select' || T.tool === 'dim' ? hitEnt(s, x, y) : null;
  const hid = he ? he.id : null;
  view.setSketchState({ preview: prev, hover: hid });
}
function sketchUp() {
  if (T.st.drag) { const s = active(); solveSketch(s); T.st = {}; endDrag(); view.drawSketches(); }
}

// 三维：悬停高亮、拾取
function solidMove(e) {
  if (S.mode !== '3d') return;
  const want = T.pick ? T.pick.kind : 'any';
  let h = null;
  if (want === 'edges' || want === 'any') { const ed = view.pickEdge(e.clientX, e.clientY); if (ed) h = { kind: 'edge', group: ed.group }; }
  if (!h && want !== 'edges') { const f = view.pickFace(e.clientX, e.clientY); if (f && (want !== 'plane' || (f.info && f.info.planar))) h = { kind: 'face', face: f.face }; }
  view.setHover(h);
}
function solidDown(e) {
  if (!T.pick) return;
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

let rafPending = null;
view.setHandler({
  down(e) { if (S.mode === 'sheet') return; if (S.active) sketchDown(e); else solidDown(e); },
  move(e) {
    if (S.mode === 'sheet') return;
    if (S.active && T.st.drag) return sketchMove(e);
    rafPending = e;
    requestAnimationFrame(() => { const ev = rafPending; if (!ev) return; rafPending = null; if (S.active) sketchMove(ev); else solidMove(ev); });
  },
  up(e) { if (S.active) sketchUp(e); },
  dbl(e) { if (S.active && T.tool === 'line') { T.st = {}; view.setSketchState({ preview: [] }); } },
});

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
document.querySelector('[data-testid="viewport"]').addEventListener('dblclick', e => {
  const l = e.target.closest('.dim-label'); if (l && l.dataset.dim) { e.stopPropagation(); openDimEditor(l.dataset.dim); }
});

// 键盘
window.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
  if (e.key === 'Escape') { if (T.st.start || T.st.first || T.st.place) { T.st = {}; view.setSketchState({ preview: [] }); } else if (S.active) setTool('select'); emit('escape'); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.active && T.sel.size) { const ids = [...T.sel]; T.sel.clear(); txn(() => ids.forEach(id => tryC(() => ops.del(id)))); view.setSketchState({ sel: new Set() }); }
});
