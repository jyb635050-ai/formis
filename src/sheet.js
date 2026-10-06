// 工程图：主视/俯视/左视三视图（国标第一角：俯视在主视正下方，左视在主视正右方）＋右下方正等轴测图
// 比例：国标优先比例，"自动"＝在图幅内放得下（含尺寸）的最大比例；也可手选
// 标注：总长/总宽/总高；孔径（同规格合并成 4×Ø8）；圆角半径（4×R5）；孔心、台阶、槽位的位置用基线尺寸；台阶/盲孔深度（含虚线）
// 图纸坐标＝真实尺寸（1:1 毫米，轴测图除外），图框按比例放大，DXF 直接用；SVG/PDF 再乘比例落到纸面
import { PAPER } from './export.js';
import { t, getLang } from './i18n.js';
import { fmt } from './util.js';

export const SCALES = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01]; // GB/T 14690 优先比例
export const scaleText = s => (s >= 1 ? `${+s.toFixed(2)}:1` : `1:${+(1 / s).toFixed(2)}`);
const EPS = 1e-3;

function boxOf(curves) {
  const xs = [], ys = [];
  for (const c of curves) {
    if (c.type === 'line') { xs.push(c.a[0], c.b[0]); ys.push(c.a[1], c.b[1]); }
    else if (c.type === 'circle' || c.type === 'arc') { xs.push(c.c[0] - c.r, c.c[0] + c.r); ys.push(c.c[1] - c.r, c.c[1] + c.r); }
    else if (c.type === 'poly') for (const p of c.pts) { xs.push(p[0]); ys.push(p[1]); }
  }
  return xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 1, 1];
}
const uniq = vals => { const out = []; for (const v of vals.slice().sort((a, b) => a - b)) if (!out.length || Math.abs(v - out[out.length - 1]) > EPS) out.push(v); return out; };
const inner = (vals, lo, hi) => uniq(vals).filter(v => v > lo + EPS && v < hi - EPS);
const hasVal = (set, v) => set.some(x => Math.abs(x - v) <= EPS);

// 一个视图里可标注的特征（视图自己的坐标）
function featuresOf(view) {
  const f = { vx: [], hy: [], hyHidden: [], circles: [], arcs: [], arcEnds: [], box: boxOf(view.visible) };
  // 折线（端面看过去的圆、椭圆）如果其实是一条直线，就按直线算
  const asLine = c => {
    if (c.type === 'line') return c;
    if (c.type !== 'poly' || c.pts.length < 2) return null;
    const xs = c.pts.map(p => p[0]), ys = c.pts.map(p => p[1]);
    if (Math.max(...ys) - Math.min(...ys) < EPS) return { a: [Math.min(...xs), ys[0]], b: [Math.max(...xs), ys[0]] };
    if (Math.max(...xs) - Math.min(...xs) < EPS) return { a: [xs[0], Math.min(...ys)], b: [xs[0], Math.max(...ys)] };
    return null;
  };
  for (const c of view.visible) {
    const l = asLine(c);
    if (l) { if (Math.abs(l.a[0] - l.b[0]) < EPS) f.vx.push(l.a[0]); if (Math.abs(l.a[1] - l.b[1]) < EPS) f.hy.push(l.a[1]); }
    else if (c.type === 'circle') f.circles.push(c);
    else if (c.type === 'arc') {
      f.arcs.push(c);
      for (const a of [c.a0, c.a1]) f.arcEnds.push([c.c[0] + c.r * Math.cos(a * Math.PI / 180), c.c[1] + c.r * Math.sin(a * Math.PI / 180)]);
    }
  }
  for (const c of view.hidden) { const l = asLine(c); if (l && Math.abs(l.a[1] - l.b[1]) < EPS) f.hyHidden.push(l.a[1]); }
  return f;
}
const groupR = list => { const g = new Map(); for (const c of list) { const k = Math.round(c.r * 1000) / 1000; if (!g.has(k)) g.set(k, []); g.get(k).push(c); } return [...g.entries()].map(([r, cs]) => ({ r, cs })); };
const stack = n => (n > 0 ? 9 + 7 * (n - 1) + 5 : 0); // n 道并排尺寸占的纸面宽度（mm）

// 规划一个视图的尺寸（视图坐标、比例 s 只影响尺寸线离图形多远）
function planView(name, f, ctx) {
  const [x0, y0, x1, y1] = f.box, P = { below: [], left: [], above: [], right: [], radial: [], centers: [] };
  const cx = f.circles.map(c => c.c[0]), cy = f.circles.map(c => c.c[1]);
  if (name === 'top') {
    P.below = inner([...cx, ...f.vx], x0, x1);                 // 孔心/台阶的 X 位置（从左边起）
    P.left = inner([...cy, ...f.hy], y0, y1);                  // 孔心/台阶的 Y 位置（从下边起）
    P.leftOverall = y1 - y0;                                   // 总宽
  } else if (name === 'front') {
    P.left = inner([...f.hy, ...f.hyHidden, ...cy], y0, y1);   // 台阶、槽底、盲孔深度（含虚线）
    P.above = inner([...f.vx, ...cx], x0, x1).filter(v => !hasVal(ctx.topX, v) && !hasVal(ctx.tanX, v)); // 俯视图没标到的 X 位置（圆角切线不算）
    P.aboveOverall = x1 - x0; P.leftOverall = y1 - y0;         // 总长、总高
  } else if (name === 'left') {
    // 左视图 x＝−Y：俯视图已经标过的 Y 位置不重复
    P.above = inner([...f.vx, ...cx], x0, x1).filter(v => !hasVal(ctx.topY, -v) && !hasVal(ctx.tanY, -v));
    P.right = inner([...f.hy, ...f.hyHidden, ...cy], y0, y1).filter(v => !hasVal(ctx.frontZ, v));
  }
  for (const g of groupR(f.circles)) P.radial.push({ kind: 'diameter', ...g });
  for (const g of groupR(f.arcs)) P.radial.push({ kind: 'radius', ...g });
  P.centers = f.circles;
  P.space = {
    below: stack(P.below.length), left: stack(P.left.length + (P.leftOverall ? 1 : 0)),
    above: stack(P.above.length + (P.aboveOverall ? 1 : 0)), right: stack(P.right.length),
  };
  return P;
}

export function buildSheet(proj, bbox, size = 'A4', name = '', opt = {}) {
  const paper = PAPER[size] || PAPER.A4, [PW, PH] = paper;
  const m = 10, tbW = size === 'A4' ? 130 : 150, tbH = 32;
  // 绘图区＝图框以内；右下角标题栏那一块（外扩 5mm）任何视图和尺寸都不许进
  const area = { x0: m + 6, y0: m + 6, x1: PW - m - 6, y1: PH - m - 6 };
  const TBR = [PW - m - tbW - 5, m, PW - m, m + tbH + 5];
  const hitsTB = r => r[0] < TBR[2] && r[2] > TBR[0] && r[1] < TBR[3] && r[3] > TBR[1];
  const AW = area.x1 - area.x0, AH = area.y1 - area.y0;
  const F = featuresOf(proj.front), Tf = featuresOf(proj.top), Lf = featuresOf(proj.left);
  const topP = planView('top', Tf, {});
  const ctx = { topX: [Tf.box[0], Tf.box[2], ...topP.below], topY: [Tf.box[1], Tf.box[3], ...topP.left], frontZ: [F.box[1], F.box[3]], tanX: Tf.arcEnds.map(p => p[0]), tanY: Tf.arcEnds.map(p => p[1]) };
  const frontP = planView('front', F, ctx);
  ctx.frontZ.push(...frontP.left);
  const leftP = planView('left', Lf, ctx);
  const W = b => b[2] - b[0], H = b => b[3] - b[1];
  const showNames = opt.names !== false, nameH = showNames ? 8 : 0;
  const gapH = 16, gapV = 12 + nameH;
  const leftCol = Math.max(frontP.space.left, topP.space.left);
  const topRow = Math.max(frontP.space.above, leftP.space.above);
  const bw = s => leftCol + W(F.box) * s + gapH + W(Lf.box) * s + leftP.space.right + 10; // 10：Ø/R 引线余量
  const bh = s => topRow + H(F.box) * s + gapV + H(Tf.box) * s + topP.space.below + nameH;
  // 摆放：三视图整组优先居中；碰到标题栏就往上挪，再不行往左靠；都不行算放不下
  // 整组的两块：上排（主视＋左视，连尺寸）、下块（俯视，连尺寸，只在左边那一列）
  const rectsAt = (s, bx, by) => {
    const fy = by + topP.space.below + nameH + H(Tf.box) * s + gapV;
    return [
      [bx, by, bx + leftCol + Math.max(W(F.box), W(Tf.box)) * s + 10, by + topP.space.below + nameH + H(Tf.box) * s], // 俯视块
      [bx, fy - nameH, bx + bw(s), fy + H(F.box) * s + topRow],                                                          // 主视＋左视一排
    ];
  };
  const placeBlock = s => {
    if (bw(s) > AW || bh(s) > AH) return null;
    const cx = area.x0 + (AW - bw(s)) / 2, cy = area.y0 + (AH - bh(s)) / 2;
    const cands = [[cx, cy]];
    for (let by = cy; by <= area.y1 - bh(s) + 1e-6; by += 2) cands.push([cx, by]);
    cands.push([cx, area.y1 - bh(s)]);
    for (let bx = cx; bx >= area.x0 - 1e-6; bx -= 2) cands.push([bx, area.y1 - bh(s)], [bx, cy]);
    cands.push([area.x0, area.y1 - bh(s)]);
    for (const [bx, by] of cands) if (!rectsAt(s, bx, by).some(hitsTB)) return [bx, by];
    return null;
  };
  const fits = s => !!placeBlock(s);
  let scale = opt.scale && opt.scale !== 'auto' ? +opt.scale : null, auto = !scale;
  if (!scale) scale = SCALES.find(fits) || SCALES[SCALES.length - 1];
  const s = scale, overflow = !fits(s);
  // 轴测图：优先放在三视图右边（同一行居中），放不下再缩小；还放不下就塞到左视图下方
  const ib = opt.iso !== false && proj.iso && proj.iso.visible.length ? boxOf(proj.iso.visible) : null;
  let isoK = null, isoSide = false;
  if (ib) {
    const room = AW - bw(s) - 14;
    isoK = [1, 0.5, 0.25, 0.2, 0.1, 0.05].find(k => W(ib) * s * k <= room && H(ib) * s * k + nameH <= AH - tbH - 5) || null;
    isoSide = !!isoK;
  }
  // 整组居中（带上右边的轴测图一起算宽度）；碰标题栏就按上面的规则挪
  let [bx, by] = placeBlock(s) || [area.x0, area.y0 + Math.max(0, (AH - bh(s)) / 2)];
  if (isoSide) {
    const gx = area.x0 + Math.max(0, (AW - bw(s) - 14 - W(ib) * s * isoK) / 2);
    if (!rectsAt(s, gx, by).some(hitsTB)) bx = Math.min(bx, gx); else bx = Math.min(bx, area.x0 + Math.max(0, AW - bw(s) - 14 - W(ib) * s * isoK));
  }
  // 用户拖动视图的偏移（纸面毫米，y 向上）：主视图带着俯视、左视一起走；俯视只能上下、左视只能左右（保持投影对齐）；轴测图随意
  const ve = opt.viewEdits || {}, vf = ve.front || [0, 0], vt = ve.top || [0, 0], vl = ve.left || [0, 0], vi = ve.iso || [0, 0];
  const posTop0 = [bx + leftCol, by + topP.space.below + nameH];
  const posFront = [posTop0[0] + vf[0], posTop0[1] + H(Tf.box) * s + gapV + vf[1]];
  const posTop = [posFront[0], posTop0[1] + vf[1] + vt[1]];
  const posLeft = [posFront[0] + W(F.box) * s + gapH + vl[0], posFront[1]];
  // 视图坐标 → 图纸坐标（真实尺寸；纸面＝图纸×比例）
  const place = (box, pos, k = 1) => p => [(p[0] - box[0]) * k + pos[0] / s, (p[1] - box[1]) * k + pos[1] / s];
  const ents = [], dims = [], texts = [];
  const ts = 3.5 / s, d0 = 9 / s, dk = 7 / s;
  const addView = (view, tf, layerVis = 'VISIBLE') => {
    const sc = c => c.type === 'line' ? { ...c, a: tf(c.a), b: tf(c.b) } : c.type === 'poly' ? { ...c, pts: c.pts.map(tf) } : { ...c, c: tf(c.c), r: c.r * (tf([1, 0])[0] - tf([0, 0])[0]) };
    for (const c of view.visible) ents.push({ ...sc(c), layer: layerVis, dashed: false });
    for (const c of view.hidden) ents.push({ ...sc(c), layer: 'HIDDEN', dashed: true });
  };
  const tfF = place(F.box, posFront), tfT = place(Tf.box, posTop), tfL = place(Lf.box, posLeft);
  addView(proj.front, tfF); addView(proj.top, tfT); addView(proj.left, tfL);
  const viewRects = {
    front: [posFront[0], posFront[1], posFront[0] + W(F.box) * s, posFront[1] + H(F.box) * s],
    top: [posTop[0], posTop[1], posTop[0] + W(Tf.box) * s, posTop[1] + H(Tf.box) * s],
    left: [posLeft[0], posLeft[1], posLeft[0] + W(Lf.box) * s, posLeft[1] + H(Lf.box) * s],
  };
  // 中心线
  const center = (P, tf) => { for (const c of P.centers) { const q = tf(c.c), e = c.r + 2 / s; ents.push({ type: 'line', a: [q[0] - e, q[1]], b: [q[0] + e, q[1]], layer: 'CENTER', dashed: true }, { type: 'line', a: [q[0], q[1] - e], b: [q[0], q[1] + e], layer: 'CENTER', dashed: true }); } };
  center(topP, tfT); center(frontP, tfF); center(leftP, tfL);
  // 尺寸
  // 每个尺寸带一个稳定的 key（视图:位置:数值），用户在图上拖动/删除的记录按 key 存，模型改了也对得上
  const kv = v => String(Math.round(v * 1000) / 1000);
  const lin = (key, p1, p2, angle, at, value) => dims.push({ key, kind: 'linear', p1, p2, angle, at, value, ts });
  const sheetDims = (vn, P, f, tf) => {
    const [x0, y0, x1, y1] = f.box, A = tf([x0, y0]), B = tf([x1, y1]);
    P.below.forEach((v, i) => { const q = tf([v, y0]); lin(`${vn}:b:${kv(v - x0)}`, A, q, 0, [(A[0] + q[0]) / 2, A[1] - d0 - dk * i], v - x0); });
    const L = [...P.left.map(v => ({ v, y: tf([x0, v])[1] }))];
    L.forEach((o, i) => lin(`${vn}:l:${kv(o.v - y0)}`, A, [A[0], o.y], 90, [A[0] - d0 - dk * i, (A[1] + o.y) / 2], o.v - y0));
    if (P.leftOverall) lin(`${vn}:lo`, A, [A[0], B[1]], 90, [A[0] - d0 - dk * L.length, (A[1] + B[1]) / 2], P.leftOverall);
    P.above.forEach((v, i) => { const q = tf([v, y1]); lin(`${vn}:a:${kv(v - x0)}`, [A[0], B[1]], q, 0, [(A[0] + q[0]) / 2, B[1] + d0 + dk * i], v - x0); });
    if (P.aboveOverall) lin(`${vn}:ao`, [A[0], B[1]], B, 0, [(A[0] + B[0]) / 2, B[1] + d0 + dk * P.above.length], P.aboveOverall);
    P.right.forEach((v, i) => { const q = tf([x1, v]); lin(`${vn}:r:${kv(v - y0)}`, [B[0], A[1]], q, 90, [B[0] + d0 + dk * i, (A[1] + q[1]) / 2], v - y0); });
    const DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(v => [v[0] * Math.SQRT1_2, v[1] * Math.SQRT1_2]);
    P.radial.forEach((g, gi) => {
      // 每种规格选一个方向（右上、右下、左上、左下轮流），挑这个方向上最靠外的那个圆拉引线；同规格的写数量
      const dir = DIRS[gi % 4];
      const c = g.cs.slice().sort((a, b) => (b.c[0] * dir[0] + b.c[1] * dir[1]) - (a.c[0] * dir[0] + a.c[1] * dir[1]))[0];
      const q = tf(c.c), at = [q[0] + dir[0] * (g.r + 7 / s), q[1] + dir[1] * (g.r + 7 / s)];
      const n = g.cs.length, pre = n > 1 ? `${n}×` : '';
      dims.push({ key: `${vn}:${g.kind === 'diameter' ? 'd' : 'R'}:${kv(g.r)}`, kind: g.kind, c: q, r: g.r, dir, at, value: g.kind === 'diameter' ? 2 * g.r : g.r, ts, label: pre + (g.kind === 'diameter' ? 'Ø' : 'R') + fmt(g.kind === 'diameter' ? 2 * g.r : g.r), dxfText: pre + (g.kind === 'diameter' ? '%%c' : 'R') + '<>' });
    });
  };
  sheetDims('top', topP, Tf, tfT); sheetDims('front', frontP, F, tfF); sheetDims('left', leftP, Lf, tfL);
  // 用户编辑：o＝数字挪动的纸面毫米 [dx,dy]；d＝已删除
  const edits = opt.edits || {}, hidden = [];
  for (let i = dims.length - 1; i >= 0; i--) {
    const d = dims[i], e = edits[d.key]; if (!e) continue;
    if (e.d) { hidden.push(d.key); dims.splice(i, 1); continue; }
    if (e.o) {
      d.at = [d.at[0] + e.o[0] / s, d.at[1] + e.o[1] / s];
      if (d.kind === 'diameter' || d.kind === 'radius') { const v = [d.at[0] - d.c[0], d.at[1] - d.c[1]], l = Math.hypot(v[0], v[1]) || 1; d.dir = [v[0] / l, v[1] / l]; }
    }
  }
  // 视图名
  const lab = (txt, x, y) => texts.push({ at: [x, y], h: 3.5 / s, text: txt, layer: 'TEXT', anchor: 'middle' });
  const vb = (box, tf) => { const a = tf([box[0], box[1]]), b = tf([box[2], box[3]]); return [a[0], a[1], b[0], b[1]]; };
  const FB = vb(F.box, tfF), TB = vb(Tf.box, tfT), LB = vb(Lf.box, tfL);
  if (showNames) { lab(t('front'), (FB[0] + FB[2]) / 2, FB[1] - 6 / s); lab(t('left'), (LB[0] + LB[2]) / 2, LB[1] - 6 / s); lab(t('top'), (TB[0] + TB[2]) / 2, TB[1] - (topP.space.below + 6) / s); }
  // 轴测图
  let isoInfo = null;
  if (ib) {
    let k = isoK, pos = null;
    if (isoSide) {
      // 三视图右边：和主视图上下居中
      const x0 = bx + bw(s) + 14, fy = (viewRects.front[1] + viewRects.front[3]) / 2;
      pos = [x0, Math.max(area.y0 + nameH, Math.min(area.y1 - H(ib) * s * k, fy - H(ib) * s * k / 2))];
      if (hitsTB([pos[0], pos[1] - nameH, pos[0] + W(ib) * s * k, pos[1] + H(ib) * s * k])) pos[1] = Math.min(area.y1 - H(ib) * s * k, TBR[3] + nameH + 2);
    } else {
      // 退一步：左视图下方、俯视图右边那块
      const rx0 = viewRects.left[0], rx1 = area.x1, ry0 = TBR[3] + nameH + 2, ry1 = viewRects.left[1] - nameH - 4;
      k = [1, 0.5, 0.25, 0.2, 0.1, 0.05].find(kk => W(ib) * s * kk <= rx1 - rx0 - 4 && H(ib) * s * kk <= ry1 - ry0);
      if (k) pos = [rx0 + (rx1 - rx0 - W(ib) * s * k) / 2, ry0 + (ry1 - ry0 - H(ib) * s * k) / 2];
    }
    if (k && pos) {
      pos = [pos[0] + vi[0], pos[1] + vi[1]];
      addView(proj.iso, place(ib, pos, k), 'ISO');
      viewRects.iso = [pos[0], pos[1], pos[0] + W(ib) * s * k, pos[1] + H(ib) * s * k];
      isoInfo = { scale: s * k };
      if (showNames) lab(t('iso') + (k !== 1 ? ` (${scaleText(s * k)})` : ''), pos[0] / s + W(ib) * k / 2, pos[1] / s - 6 / s);
    }
  }
  // 图框与标题栏（图纸坐标＝纸面/比例）
  const R = (a, b, c, d) => [[[a, b], [c, b]], [[c, b], [c, d]], [[c, d], [a, d]], [[a, d], [a, b]]].map(([p, q]) => [[p[0] / s, p[1] / s], [q[0] / s, q[1] / s]]);
  const frame = [...R(0, 0, PW, PH), ...R(m, m, PW - m, PH - m)];
  const tx0 = PW - m - tbW, ty0 = m, tx1 = PW - m, ty1 = m + tbH, rowH = tbH / 4;
  frame.push(...R(tx0, ty0, tx1, ty1));
  for (let i = 1; i < 4; i++) frame.push([[tx0 / s, (ty0 + rowH * i) / s], [tx1 / s, (ty0 + rowH * i) / s]]);
  frame.push([[(tx0 + 30) / s, ty0 / s], [(tx0 + 30) / s, ty1 / s]]);
  for (const [a, b] of frame) ents.push({ type: 'line', a, b, layer: 'FRAME', dashed: false });
  const cell = (row, label, value) => {
    texts.push({ at: [(tx0 + 3) / s, (ty1 - rowH * row - rowH * 0.7) / s], h: 3 / s, text: label, layer: 'FRAME' });
    texts.push({ at: [(tx0 + 33) / s, (ty1 - rowH * row - rowH * 0.7) / s], h: 3 / s, text: value, layer: 'FRAME' });
  };
  const date = new Date().toISOString().slice(0, 10);
  cell(0, t('titleName'), name || t('untitled'));
  cell(1, t('scale'), scaleText(s) + '   ' + t('sheetSize') + ' ' + size);
  cell(2, t('drawnBy'), 'Formis');
  cell(3, t('date'), date + (getLang() === 'zh' ? '   第一角投影' : '   First-angle'));
  const map = p => [p[0] * s, PH - p[1] * s];
  return { drawing: { ents, dims, texts }, page: paper.slice(), scale: s, auto, overflow, iso: isoInfo, map, scaleText: scaleText(s), hiddenDims: hidden, viewRects };
}
