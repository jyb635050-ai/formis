// 项目文档、撤销重做、自动保存，以及所有修改操作（界面与 window.__cad.cmd 共用这一套）
import { solveSketch, ptOf, kindOf } from './solver.js';
import { PLANES, describe, planeAt, V } from './kernel/build.js';

const KEY = 'glasscad.doc.v1';
export function newDoc() { return { v: 1, seq: 1, name: '', sketches: [], features: [], drawing2d: null, sheet: { size: 'A3' }, dimStyle: null }; }

export const S = {
  doc: newDoc(),
  active: null,        // 正在编辑的草图 id
  selSketch: null,     // 选中的草图（特征作用对象）
  mode: '3d',
  built: null,         // 内核最近一次结果 {measure, faces, mesh, edges, errors, planes}
  history: [], future: [], txn: 0,
  dragging: false,
};
const subs = new Set();
export const on = fn => subs.add(fn);
export function emit(what) { for (const f of subs) { try { f(what); } catch (e) { setTimeout(() => { throw e; }); } } }

// ───── 撤销 ─────
function snap() { if (S.txn || S.live) return; S.history.push(JSON.stringify({ doc: S.doc, active: S.active, selSketch: S.selSketch })); if (S.history.length > 300) S.history.shift(); S.future = []; }
function unsnap() { if (!S.txn && !S.live) S.history.pop(); }
// 实时编辑（特征面板开着时边改边看）：开始时存一次撤销点，期间的修改不再单独存；取消就整体撤回
export function beginLive() { snap(); S.live = true; }
export function endLive(commit) { S.live = false; if (!commit) { S.future = []; undo(); S.future = []; } }
export function txn(fn) { snap(); S.txn++; try { return fn(); } finally { S.txn--; changed(); } }
function restore(js) { const o = JSON.parse(js); S.doc = o.doc; S.active = S.doc.sketches.some(s => s.id === o.active) ? o.active : null; S.selSketch = o.selSketch; changed(); emit('all'); }
export function undo() { if (!S.history.length) return false; S.future.push(JSON.stringify({ doc: S.doc, active: S.active, selSketch: S.selSketch })); restore(S.history.pop()); return true; }
export function redo() { if (!S.future.length) return false; S.history.push(JSON.stringify({ doc: S.doc, active: S.active, selSketch: S.selSketch })); restore(S.future.pop()); return true; }
export function beginDrag() { snap(); S.dragging = true; }
export function endDrag() { S.dragging = false; changed(); }
export function dropLastSnapshot() { S.history.pop(); }

// ───── 保存 ─────
let saveT = null;
function changed() {
  if (S.txn) return;
  emit('doc');
  clearTimeout(saveT);
  saveT = setTimeout(saveNow, 500);
}
export function saveNow() { try { localStorage.setItem(KEY, JSON.stringify(S.doc)); } catch (e) { } }
export function loadSaved() { try { const s = localStorage.getItem(KEY); if (s) { const d = JSON.parse(s); if (d && d.v === 1) { S.doc = d; return true; } } } catch (e) { } return false; }
export function loadDoc(obj) {
  if (!obj || obj.v !== 1 || !Array.isArray(obj.sketches) || !Array.isArray(obj.features)) throw new Error('不是 GlassCAD 项目文件');
  snap(); S.doc = JSON.parse(JSON.stringify(obj)); S.active = null; S.selSketch = null; changed(); emit('all');
}
export function resetDoc() { snap(); const seq = S.doc.seq; S.doc = newDoc(); S.doc.seq = seq; S.active = null; S.selSketch = null; changed(); emit('all'); }

// ───── 查询 ─────
const nid = p => p + S.doc.seq++;
export const sketchById = id => S.doc.sketches.find(s => s.id === id);
export const featById = id => S.doc.features.find(f => f.id === id);
function sk(id) { const s = sketchById(id); if (!s) throw new Error('草图不存在：' + id); return s; }
export function ownerSketch(entId) { return S.doc.sketches.find(s => s.ents.some(e => e.id === entId) || s.cons.some(c => c.id === entId) || s.dims.some(d => d.id === entId)); }

// 尺寸数字的显示位置（草图坐标）
// 线性类尺寸的两个"定义点"（尺寸线就画在这两点之间的方向上）
const footOn = (p, l) => { const dx = l.b[0] - l.a[0], dy = l.b[1] - l.a[1], L2 = dx * dx + dy * dy || 1, t = ((p[0] - l.a[0]) * dx + (p[1] - l.a[1]) * dy) / L2; return [l.a[0] + dx * t, l.a[1] + dy * t]; };
export function dimPoints(s, d, at) {
  const E = id => s.ents.find(x => x.id === id);
  if (d.type === 'length') return [ptOf(s, d.refs[0] + '.a'), ptOf(s, d.refs[0] + '.b')];
  if (d.type === 'pldist') { const p = ptOf(s, d.refs[0]); return [p, footOn(p, E(d.refs[1]))]; }
  if (d.type === 'ldist') {
    // 两条平行线：取第一条线上离数字最近的点，再垂直落到第二条线上
    const l1 = E(d.refs[0]), l2 = E(d.refs[1]);
    let p = at ? footOn(at, l1) : [(l1.a[0] + l1.b[0]) / 2, (l1.a[1] + l1.b[1]) / 2];
    return [p, footOn(p, l2)];
  }
  return [ptOf(s, d.refs[0]), ptOf(s, d.refs[1])];
}
export function dimBase(s, d) {
  if (d.type === 'radius' || d.type === 'diameter') return s.ents.find(x => x.id === d.refs[0]).c;
  if (d.type === 'angle') return s.ents.find(x => x.id === d.refs[0]).a;
  const [p, q] = dimPoints(s, d);
  return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
}
export function dimLabel(s, d) {
  try {
    const off = d.off || [0, 0];
    if (d.type === 'radius' || d.type === 'diameter') { const e = s.ents.find(x => x.id === d.refs[0]); const ang = Math.atan2(off[1], off[0]) || Math.PI / 4; const L = Math.max(e.r + 4, Math.hypot(off[0], off[1])); return [e.c[0] + L * Math.cos(ang), e.c[1] + L * Math.sin(ang)]; }
    const b = dimBase(s, d);
    return [b[0] + off[0], b[1] + off[1]];
  } catch (e) { return [0, 0]; }
}
// 尺寸当前量出来的值（加尺寸前用）
export function measureDim(s, type, refs) {
  const E = id => s.ents.find(x => x.id === id), D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (type === 'length') { const e = E(refs[0]); return D(e.a, e.b); }
  if (type === 'diameter') return 2 * E(refs[0]).r;
  if (type === 'radius') return E(refs[0]).r;
  if (type === 'angle') { const [l1, l2] = refs.map(E); const u = [l1.b[0] - l1.a[0], l1.b[1] - l1.a[1]], v = [l2.b[0] - l2.a[0], l2.b[1] - l2.a[1]]; const c = Math.abs(u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v)); return Math.acos(Math.min(1, c)) * 180 / Math.PI; }
  if (type === 'pldist') { const p = ptOf(s, refs[0]); return D(p, footOn(p, E(refs[1]))); }
  if (type === 'ldist') { const l1 = E(refs[0]); return D(l1.a, footOn(l1.a, E(refs[1]))); }
  const p = ptOf(s, refs[0]), q = ptOf(s, refs[1]);
  if (type === 'hdist') return Math.abs(q[0] - p[0]);
  if (type === 'vdist') return Math.abs(q[1] - p[1]);
  return D(p, q);
}
export function moveDimLabel(s, d, uv) { const b = dimBase(s, d); d.off = [uv[0] - b[0], uv[1] - b[1]]; }
export function sketchView(id) {
  const s = sk(id);
  const ents = s.ents.map(e => { const o = JSON.parse(JSON.stringify(e)); if (e.type === 'arc') { o.a = ptOf(s, e.id + '.a'); o.b = ptOf(s, e.id + '.b'); } o.construction = !!e.construction; return o; });
  return JSON.parse(JSON.stringify({ id: s.id, plane: s.plane, entities: ents, constraints: s.cons, dims: s.dims.map(d => ({ id: d.id, type: d.type, refs: d.refs, value: d.value, label: dimLabel(s, d) })), dof: s.dof ?? 0, status: s.status || 'ok' }));
}

// ───── 草图操作 ─────
function resolve(s) { if (!solveSketch(s)) throw new Error('约束冲突'); }
function guarded(s, mutate) {
  const before = JSON.stringify(s);
  mutate();
  if (!solveSketch(s)) { const b = JSON.parse(before); Object.keys(s).forEach(k => delete s[k]); Object.assign(s, b); s.status = 'ok'; return false; }
  return true;
}

// 找到点所在的实体平面（用内核给的面信息＋三角形）
export function faceAtPoint(p) {
  const B = S.built; if (!B || !B.mesh) return null;
  const { vertices: Vt, triangles: T, triFace } = B.mesh;
  let best = null;
  for (let t = 0; t < triFace.length; t++) {
    const fi = triFace[t]; const f = B.faces[fi]; if (!f || !f.planar) continue;
    if (Math.abs(V.dot(f.normal, p) - f.d) > 1e-4) continue;
    const a = [Vt[T[t * 3] * 3], Vt[T[t * 3] * 3 + 1], Vt[T[t * 3] * 3 + 2]], b = [Vt[T[t * 3 + 1] * 3], Vt[T[t * 3 + 1] * 3 + 1], Vt[T[t * 3 + 1] * 3 + 2]], c = [Vt[T[t * 3 + 2] * 3], Vt[T[t * 3 + 2] * 3 + 1], Vt[T[t * 3 + 2] * 3 + 2]];
    const n = f.normal, cr = (x, y, z) => V.dot(V.cross(V.sub(y, x), V.sub(z, x)), n);
    const A = cr(a, b, c); if (Math.abs(A) < 1e-12) continue;
    const w0 = cr(p, b, c) / A, w1 = cr(a, p, c) / A, w2 = cr(a, b, p) / A;
    if (w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4) { best = { index: fi, ...f }; break; }
  }
  return best;
}

export const ops = {
  sketch(plane) {
    let s;
    if (typeof plane === 'string') {
      const pl = PLANES[plane.toUpperCase()]; if (!pl) throw new Error('基准面只能是 XY/XZ/YZ');
      s = { id: nid('S'), plane: JSON.parse(JSON.stringify(pl)), ents: [], cons: [], dims: [], dof: 0, status: 'ok' };
    } else if (plane && plane.face) {
      const p = plane.face.map(Number); const f = faceAtPoint(p);
      if (!f) throw new Error('这个点不在实体的平面上');
      const q = V.sub(p, V.mul(f.normal, V.dot(f.normal, p) - f.d));
      s = { id: nid('S'), plane: planeAt(q, f.normal), faceRef: { desc: describe(S.built.measure.bbox, q), normal: f.normal }, ents: [], cons: [], dims: [], dof: 0, status: 'ok' };
    } else throw new Error('平面参数不对');
    snap(); S.doc.sketches.push(s); S.active = s.id; S.selSketch = s.id; changed(); emit('sketch');
    return s.id;
  },
  line(sid, a, b) { const s = sk(sid); snap(); const id = nid('L'); s.ents.push({ id, type: 'line', a: [+a[0], +a[1]], b: [+b[0], +b[1]] }); resolve(s); changed(); return id; },
  circle(sid, c, r) { const s = sk(sid); if (!(r > 0)) throw new Error('半径要大于 0'); snap(); const id = nid('C'); s.ents.push({ id, type: 'circle', c: [+c[0], +c[1]], r: +r }); resolve(s); changed(); return id; },
  arc(sid, c, r, a0, a1) { const s = sk(sid); if (!(r > 0)) throw new Error('半径要大于 0'); snap(); const id = nid('A'); s.ents.push({ id, type: 'arc', c: [+c[0], +c[1]], r: +r, a0: +a0, a1: +a1 }); resolve(s); changed(); return id; },
  text(sid, at, text, h) { const s = sk(sid); snap(); const id = nid('T'); s.ents.push({ id, type: 'text', at: [+at[0], +at[1]], text: String(text), h: +h || 5 }); changed(); return id; },
  construction(id, onoff) { const s = ownerSketch(id); if (!s) throw new Error('找不到 ' + id); snap(); s.ents.find(e => e.id === id).construction = !!onoff; changed(); },
  constrain(sid, type, ...refs) {
    const s = sk(sid);
    for (const r of refs) ptOrEnt(s, r);
    snap();
    const id = nid('K');
    const c = { id, type, refs };
    if (type === 'fix') c.at = ptOf(s, refs[0]).slice();
    if (!guarded(s, () => s.cons.push(c))) { unsnap(); throw new Error('约束冲突或重复'); }
    changed(); return id;
  },
  dim(sid, type, refs, value, off) {
    const s = sk(sid); value = +value;
    if (!(value > 0) && type !== 'angle') throw new Error('尺寸要大于 0');
    for (const r of refs) ptOrEnt(s, r);
    snap();
    const id = nid('D');
    const d = { id, type, refs: refs.slice(), value, sign: 1, off: off || defaultOff(s, type, refs) };
    if (type === 'hdist' || type === 'vdist') { const k = type === 'hdist' ? 0 : 1; d.sign = ptOf(s, refs[1])[k] >= ptOf(s, refs[0])[k] ? 1 : -1; }
    if (type === 'angle') { const [l1, l2] = refs.map(r => s.ents.find(e => e.id === r)); const a1 = Math.atan2(l1.b[1] - l1.a[1], l1.b[0] - l1.a[0]), a2 = Math.atan2(l2.b[1] - l2.a[1], l2.b[0] - l2.a[0]); d.sign = Math.sin(a2 - a1) >= 0 ? 1 : -1; }
    if (!guarded(s, () => s.dims.push(d))) { unsnap(); throw new Error('尺寸与已有约束冲突'); }
    changed(); return id;
  },
  setDim(id, value) {
    value = +value; const s = ownerSketch(id); if (!s) throw new Error('找不到尺寸 ' + id);
    if (!(value > 0)) throw new Error('尺寸要大于 0');
    snap();
    const d = s.dims.find(x => x.id === id);
    if (!guarded(s, () => { d.value = value; })) { unsnap(); throw new Error('这个值解不出来（与其它约束冲突）'); }
    changed();
  },
  del(id) {
    const f = featById(id);
    if (f) { snap(); S.doc.features = S.doc.features.filter(x => x.id !== id); changed(); return; }
    const sx = sketchById(id);
    if (sx) { snap(); S.doc.sketches = S.doc.sketches.filter(x => x.id !== id); S.doc.features = S.doc.features.filter(x => x.sketch !== id); if (S.active === id) S.active = null; changed(); emit('all'); return; }
    const s = ownerSketch(id); if (!s) throw new Error('找不到 ' + id);
    snap();
    const ids = new Set([id]);
    const uses = refs => refs.some(r => ids.has(r.split('.')[0]) || ids.has(r));
    s.ents = s.ents.filter(e => !ids.has(e.id));
    s.cons = s.cons.filter(c => !ids.has(c.id) && !uses(c.refs));
    s.dims = s.dims.filter(d => !ids.has(d.id) && !uses(d.refs));
    solveSketch(s); changed();
  },
  finish(sid) { if (!sid || S.active === sid) { const a = S.active; S.active = null; if (a) S.selSketch = a; emit('sketch'); } },
  addFeature(type, sketchId, params) {
    if (sketchId) sk(sketchId);
    snap();
    const id = nid('F');
    S.doc.features.push({ id, type, sketch: sketchId || null, params: JSON.parse(JSON.stringify(params)), suppressed: false });
    if (sketchId && S.active === sketchId) S.active = null;
    changed(); return id;
  },
  setParam(fid, p) { const f = featById(fid); if (!f) throw new Error('找不到特征 ' + fid); snap(); Object.assign(f.params, JSON.parse(JSON.stringify(p))); changed(); },
  suppress(fid, onoff) { const f = featById(fid); if (!f) throw new Error('找不到特征 ' + fid); snap(); f.suppressed = !!onoff; changed(); },
  rename(name) { if ((S.doc.name || '') === name) return; snap(); S.doc.name = String(name); changed(); },
  setDimStyle(p) { snap(); S.doc.dimStyle = { ...dimStyle(), ...p }; changed(); emit('sketch'); },
  setSheet(p) { snap(); S.doc.sheet = { ...(S.doc.sheet || {}), ...p }; changed(); },
};
function ptOrEnt(s, r) { const [id] = r.split('.'); if (!s.ents.some(e => e.id === id)) throw new Error('草图里没有 ' + r); }
function defaultOff(s, type, refs) {
  try {
    if (type === 'radius' || type === 'diameter') return [8, 8];
    if (type === 'angle') return [10, 5];
    if (type === 'hdist') return [0, -8]; if (type === 'vdist') return [8, 0];
    const [p, q] = dimPoints(s, { type, refs });
    const d = [q[0] - p[0], q[1] - p[1]], L = Math.hypot(d[0], d[1]) || 1;
    if (type === 'pldist' || type === 'ldist') return [(d[1] / L) * 6, (-d[0] / L) * 6];
    return [(-d[1] / L) * 8, (d[0] / L) * 8];
  } catch (e) { return [0, -8]; }
}
export const DIM_STYLE = { line: 'solid', arrow: 'arrow', color: '', text: 12 };
export const dimStyle = () => ({ ...DIM_STYLE, ...(S.doc.dimStyle || {}) });
// 把三维点变成"边/面引用"（相对当前实体包围盒）
export function refOf(p) { const B = S.built; if (!B || !B.measure || !(B.measure.volume > 0)) throw new Error('还没有实体'); return describe(B.measure.bbox, p.map(Number)); }
export { kindOf, ptOf };
