// 工程图：主视/俯视/左视三视图（国标第一角：俯视在主视正下方，左视在主视正右方），自动外形尺寸，图框与标题栏
// 图纸坐标＝真实尺寸（1:1 毫米），图框按比例放大，DXF 直接用；SVG/PDF 再乘比例落到纸面
import { PAPER } from './export.js';
import { t, getLang } from './i18n.js';

const SCALES = [10, 5, 4, 2.5, 2, 1, 0.5, 0.4, 0.25, 0.2, 0.1, 0.05, 0.02, 0.01];
const scaleText = s => (s >= 1 ? `${s}:1` : `1:${+(1 / s).toFixed(2)}`);

function boxOf(curves) {
  const xs = [], ys = [];
  for (const c of curves) {
    if (c.type === 'line') { xs.push(c.a[0], c.b[0]); ys.push(c.a[1], c.b[1]); }
    else if (c.type === 'circle' || c.type === 'arc') { xs.push(c.c[0] - c.r, c.c[0] + c.r); ys.push(c.c[1] - c.r, c.c[1] + c.r); }
    else if (c.type === 'poly') for (const p of c.pts) { xs.push(p[0]); ys.push(p[1]); }
  }
  return xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 1, 1];
}
// 只按实线（不含圆弧外扩）的端点求外形，和零件包围盒一致
function shiftCurve(c, dx, dy) {
  const m = p => [p[0] + dx, p[1] + dy];
  if (c.type === 'line') return { ...c, a: m(c.a), b: m(c.b) };
  if (c.type === 'circle' || c.type === 'arc') return { ...c, c: m(c.c) };
  return { ...c, pts: c.pts.map(m) };
}

export function buildSheet(proj, bbox, size = 'A3', name = '') {
  const [X0, Y0, Z0] = bbox[0], [X1, Y1, Z1] = bbox[1];
  const wX = X1 - X0, wY = Y1 - Y0, wZ = Z1 - Z0;
  const paper = PAPER[size] || PAPER.A3;
  const margin = 10, tbH = 32, tbW = 150;
  const areaW = paper[0] - 2 * margin - 20, areaH = paper[1] - 2 * margin - tbH - 20;
  const gapP = 22; // 视图间距（纸面毫米，含尺寸位置）
  let scale = SCALES[SCALES.length - 1];
  for (const s of SCALES) { if ((wX + wY) * s + gapP * 2 <= areaW && (wZ + wY) * s + gapP * 2 <= areaH) { scale = s; break; } }
  const gap = gapP / scale;
  // 各视图在自己坐标系里的外形：主视 (X, Z)，俯视 (X, Y)，左视 (−Y, Z)
  const fb = boxOf(proj.front.visible), tb = boxOf(proj.top.visible), lb = boxOf(proj.left.visible);
  // 主视左下角放在 (0,0)；俯视 x 对齐、在下方；左视 y 对齐、在右方
  const off = { front: [-fb[0], -fb[1]], top: [-tb[0] + (fb[0] - fb[0]), 0], left: [0, -lb[1]] };
  off.top = [-fb[0] - (tb[0] - fb[0]) + (tb[0] - fb[0]), -tb[3] - gap]; // x 用同一 X 平移，俯视顶边在主视底边下 gap
  off.top[0] = -fb[0];
  off.left = [fb[2] - fb[0] + gap - lb[0], -fb[1]];
  const ents = [], dims = [], texts = [];
  for (const v of ['front', 'top', 'left']) {
    const [dx, dy] = off[v];
    for (const c of proj[v].visible) ents.push({ ...shiftCurve(c, dx, dy), layer: 'VISIBLE', dashed: false });
    for (const c of proj[v].hidden) ents.push({ ...shiftCurve(c, dx, dy), layer: 'HIDDEN', dashed: true });
  }
  const F = [fb[0] + off.front[0], fb[1] + off.front[1], fb[2] + off.front[0], fb[3] + off.front[1]];
  const Tp = [tb[0] + off.top[0], tb[1] + off.top[1], tb[2] + off.top[0], tb[3] + off.top[1]];
  const Lf = [lb[0] + off.left[0], lb[1] + off.left[1], lb[2] + off.left[0], lb[3] + off.left[1]];
  const ts = 3.5 / scale, d8 = 9 / scale;
  // 外形尺寸：总长（主视上方）、总高（主视左侧）、总宽（俯视左侧）
  dims.push({ kind: 'linear', p1: [F[0], F[3]], p2: [F[2], F[3]], angle: 0, at: [(F[0] + F[2]) / 2, F[3] + d8], value: F[2] - F[0], ts });
  dims.push({ kind: 'linear', p1: [F[0], F[1]], p2: [F[0], F[3]], angle: 90, at: [F[0] - d8, (F[1] + F[3]) / 2], value: F[3] - F[1], ts });
  dims.push({ kind: 'linear', p1: [Tp[0], Tp[1]], p2: [Tp[0], Tp[3]], angle: 90, at: [Tp[0] - d8, (Tp[1] + Tp[3]) / 2], value: Tp[3] - Tp[1], ts });
  // 视图名
  const lab = (txt, x, y) => texts.push({ at: [x, y], h: 3.5 / scale, text: txt, layer: 'TEXT', anchor: 'middle' });
  lab(t('front'), (F[0] + F[2]) / 2, F[1] - 7 / scale);
  lab(t('top'), (Tp[0] + Tp[2]) / 2, Tp[1] - 7 / scale);
  lab(t('left'), (Lf[0] + Lf[2]) / 2, Lf[1] - 7 / scale);
  // 图框：把全部视图（含尺寸）居中放进绘图区
  const all = [Math.min(F[0], Tp[0], Lf[0]) - d8 - 6 / scale, Math.min(F[1], Tp[1], Lf[1]) - 10 / scale, Math.max(F[2], Tp[2], Lf[2]), Math.max(F[3], Tp[3], Lf[3]) + d8 + 4 / scale];
  const cx = (all[0] + all[2]) / 2, cy = (all[1] + all[3]) / 2;
  const PW = paper[0] / scale, PH = paper[1] / scale, m = margin / scale;
  const areaCx = PW / 2, areaCy = (tbH / scale + m + (PH - m)) / 2;
  const ox = cx - areaCx, oy = cy - areaCy; // 纸面左下角在图纸坐标里的位置
  const R = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]];
  const frame = [...R(ox, oy, ox + PW, oy + PH), ...R(ox + m, oy + m, ox + PW - m, oy + PH - m)];
  const tx0 = ox + PW - m - tbW / scale, ty0 = oy + m, tx1 = ox + PW - m, ty1 = oy + m + tbH / scale;
  frame.push(...R(tx0, ty0, tx1, ty1));
  const rowH = tbH / 4 / scale;
  for (let i = 1; i < 4; i++) frame.push([[tx0, ty0 + rowH * i], [tx1, ty0 + rowH * i]]);
  frame.push([[tx0 + 30 / scale, ty0], [tx0 + 30 / scale, ty1]]);
  for (const [a, b] of frame) ents.push({ type: 'line', a, b, layer: 'FRAME', dashed: false });
  const cell = (row, label, value) => {
    texts.push({ at: [tx0 + 3 / scale, ty1 - rowH * row - rowH * 0.7], h: 3 / scale, text: label, layer: 'FRAME' });
    texts.push({ at: [tx0 + 33 / scale, ty1 - rowH * row - rowH * 0.7], h: 3 / scale, text: value, layer: 'FRAME' });
  };
  const date = new Date().toISOString().slice(0, 10);
  cell(0, t('titleName'), name || t('untitled'));
  cell(1, t('scale'), scaleText(scale) + '   ' + t('sheetSize') + ' ' + size);
  cell(2, t('drawnBy'), 'GlassCAD');
  cell(3, t('date'), date + (getLang() === 'zh' ? '   第一角投影' : '   First-angle'));
  const map = p => [(p[0] - ox) * scale, (oy + PH - p[1]) * scale];
  return { drawing: { ents, dims, texts }, page: paper.slice(), scale, map, scaleText: scaleText(scale) };
}
