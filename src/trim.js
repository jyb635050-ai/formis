// 草图裁剪（像 SolidWorks「强劲裁剪」/ AutoCAD TRIM）：在一个图形上点一下或划过去，
// 被其它图形（含构造线）切开的那一小段去掉。纯几何，doc.js 的 ops.trim 用它算怎么改。
//   直线：参数 t∈[0,1]；圆：角度 0..360；圆弧：从 a0 起逆时针转过的角度 0..span
import { arcPoints } from './kernel/build.js';

const EPS = 1e-6, TOL = 1e-5;
const rad = d => (d * Math.PI) / 180, deg = r => (r * 180) / Math.PI;
const norm360 = a => ((a % 360) + 360) % 360;
const span = e => { const p = arcPoints(e); return p.a1 - p.a0; };

// 点在有限图形上吗
function onEnt(e, p) {
  if (e.type === 'line') {
    const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], l2 = dx * dx + dy * dy; if (l2 < 1e-18) return false;
    const t = ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) / l2;
    if (t < -TOL || t > 1 + TOL) return false;
    return Math.abs((p[0] - e.a[0]) * dy - (p[1] - e.a[1]) * dx) / Math.sqrt(l2) < TOL * 10;
  }
  if (Math.abs(Math.hypot(p[0] - e.c[0], p[1] - e.c[1]) - e.r) > TOL * 10) return false;
  if (e.type === 'circle') return true;
  const s = norm360(deg(Math.atan2(p[1] - e.c[1], p[0] - e.c[0])) - e.a0);
  return s <= span(e) + 1e-6 || s >= 360 - 1e-6;
}
// 两个无限几何（直线 / 整圆）的交点
function rawHits(e, o) {
  const L = x => x.type === 'line', out = [];
  if (L(e) && L(o)) {
    const d1 = [e.b[0] - e.a[0], e.b[1] - e.a[1]], d2 = [o.b[0] - o.a[0], o.b[1] - o.a[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-12) { for (const p of [o.a, o.b, e.a, e.b]) out.push(p); return out; } // 平行重叠：端点当分界
    const t = ((o.a[0] - e.a[0]) * d2[1] - (o.a[1] - e.a[1]) * d2[0]) / den;
    out.push([e.a[0] + d1[0] * t, e.a[1] + d1[1] * t]); return out;
  }
  if (L(e) !== L(o)) {
    const ln = L(e) ? e : o, c = L(e) ? o : e;
    const d = [ln.b[0] - ln.a[0], ln.b[1] - ln.a[1]], f = [ln.a[0] - c.c[0], ln.a[1] - c.c[1]];
    const A = d[0] * d[0] + d[1] * d[1], B = 2 * (f[0] * d[0] + f[1] * d[1]), C = f[0] * f[0] + f[1] * f[1] - c.r * c.r;
    let disc = B * B - 4 * A * C; if (disc < -1e-9 * A) return out; disc = Math.max(0, disc);
    for (const sg of [-1, 1]) { const t = (-B + sg * Math.sqrt(disc)) / (2 * A); out.push([ln.a[0] + d[0] * t, ln.a[1] + d[1] * t]); }
    return out;
  }
  const dx = o.c[0] - e.c[0], dy = o.c[1] - e.c[1], dd = Math.hypot(dx, dy);
  if (dd < 1e-12 || dd > e.r + o.r + 1e-9 || dd < Math.abs(e.r - o.r) - 1e-9) return out;
  const a = (e.r * e.r - o.r * o.r + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, e.r * e.r - a * a));
  const m = [e.c[0] + (a * dx) / dd, e.c[1] + (a * dy) / dd];
  out.push([m[0] + (h * dy) / dd, m[1] - (h * dx) / dd], [m[0] - (h * dy) / dd, m[1] + (h * dx) / dd]);
  return out;
}
// 点在图形上的参数
export function paramOf(e, p) {
  if (e.type === 'line') { const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1]; return ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) / (dx * dx + dy * dy || 1); }
  const a = norm360(deg(Math.atan2(p[1] - e.c[1], p[0] - e.c[0])));
  return e.type === 'circle' ? a : norm360(a - e.a0);
}
export function pointAt(e, t) {
  if (e.type === 'line') return [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t];
  const a = rad(e.type === 'circle' ? t : e.a0 + t);
  return [e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)];
}
// e 被草图里其它图形切开的位置：[{t, by}]，按参数排好、去重
export function cutsOn(s, e) {
  const out = [];
  const end = e.type === 'line' ? 1 : e.type === 'arc' ? span(e) : 360;
  for (const o of s.ents) {
    if (o.id === e.id || o.type === 'text') continue;
    for (const p of rawHits(e, o)) {
      if (!onEnt(e, p) || !onEnt(o, p)) continue;
      let t = paramOf(e, p);
      if (e.type === 'circle') t = norm360(t);
      else { if (e.type === 'arc' && t > end + 1e-6) t = 0; if (t <= EPS * end || t >= end - EPS * end) continue; }
      out.push({ t, by: o.id });
    }
  }
  out.sort((a, b) => a.t - b.t);
  const uniq = [];
  for (const c of out) if (!uniq.length || Math.abs(c.t - uniq[uniq.length - 1].t) > EPS * end) uniq.push(c);
  if (e.type === 'circle' && uniq.length > 1 && Math.abs(uniq[0].t + 360 - uniq[uniq.length - 1].t) <= EPS * 360) uniq.pop();
  return uniq;
}
// 在 p 处裁剪 e 的方案：
//   { del: true } 整个删掉（两头都没被切开）
//   { keep: [{from, to}] , lo, hi }  保留哪些参数段；removed = 去掉的那一段（预览用）
export function trimPlan(s, e, p) {
  if (!e || e.type === 'text') return null;
  const cuts = cutsOn(s, e), tp = paramOf(e, p);
  if (e.type === 'circle') {
    if (cuts.length < 2) return { del: true, removed: { from: 0, to: 360 } };
    let lo = null, hi = null;
    for (const c of cuts) { if (c.t <= tp) lo = c; if (c.t > tp && !hi) hi = c; }
    if (!lo) lo = cuts[cuts.length - 1]; if (!hi) hi = cuts[0];
    const keepFrom = hi.t, keepTo = lo.t <= hi.t ? lo.t + 360 : lo.t;
    const rmFrom = lo.t, rmTo = hi.t <= lo.t ? hi.t + 360 : hi.t;
    return { keep: [{ from: keepFrom, to: keepTo, byFrom: hi.by, byTo: lo.by }], removed: { from: rmFrom, to: rmTo } };
  }
  const end = e.type === 'line' ? 1 : span(e);
  const t = Math.max(0, Math.min(end, tp > end + 1e-9 && e.type === 'arc' ? (tp - end < 360 - tp ? end : 0) : tp));
  let lo = null, hi = null;
  for (const c of cuts) { if (c.t < t) lo = c; else if (!hi) hi = c; }
  if (!lo && !hi) return { del: true, removed: { from: 0, to: end } };
  const keep = [];
  if (lo) keep.push({ from: 0, to: lo.t, byTo: lo.by });
  if (hi) keep.push({ from: hi.t, to: end, byFrom: hi.by });
  return { keep, removed: { from: lo ? lo.t : 0, to: hi ? hi.t : end } };
}
// 去掉那一段的折线（草图坐标），给悬停预览画红线
export function removedPolyline(e, plan) {
  const { from, to } = plan.removed;
  if (e.type === 'line') return [pointAt(e, from), pointAt(e, to)];
  const n = Math.max(8, Math.ceil((to - from) / 4)), out = [];
  for (let i = 0; i <= n; i++) out.push(pointAt(e, from + ((to - from) * i) / n));
  return out;
}
