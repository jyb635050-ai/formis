// 图纸导出：草图和工程图先变成同一种"图纸"结构，再分别写成 DXF / SVG / PDF
// 图纸结构：{ ents:[{type:'line'|'circle'|'arc'|'poly', a,b,c,r,a0,a1,pts, layer, dashed}], dims:[...], texts:[{at,h,text,layer}] }
import { DxfWriter, point3d, Units } from '@tarikjabiri/dxf';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { arcPoints } from './kernel/build.js';
import { ptOf } from './solver.js';
import { dimLabel, dimPoints, dimStyle } from './doc.js';
import { fmt } from './util.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1], unit = a => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };

// ───── 草图 → 图纸 ─────
export function sketchDrawing(s) {
  const ents = [], dims = [], texts = [];
  for (const e of s.ents) {
    const layer = e.construction ? 'CONSTRUCTION' : 'VISIBLE', dashed = !!e.construction;
    if (e.type === 'line') ents.push({ type: 'line', a: e.a, b: e.b, layer, dashed });
    else if (e.type === 'circle') ents.push({ type: 'circle', c: e.c, r: e.r, layer, dashed });
    else if (e.type === 'arc') { const p = arcPoints(e); ents.push({ type: 'arc', c: e.c, r: e.r, a0: norm360(e.a0), a1: norm360(e.a1), layer, dashed, _a: p.a, _b: p.b }); }
    else if (e.type === 'text') texts.push({ at: e.at, h: e.h, text: e.text, layer: 'TEXT' });
  }
  for (const d of s.dims) {
    const L = dimLabel(s, d);
    if (d.type === 'length' || d.type === 'distance' || d.type === 'pldist' || d.type === 'ldist') { const [p1, p2] = dimPoints(s, d, L); dims.push({ kind: 'aligned', p1, p2, at: L, value: d.value }); }
    else if (d.type === 'hdist' || d.type === 'vdist') dims.push({ kind: 'linear', p1: ptOf(s, d.refs[0]), p2: ptOf(s, d.refs[1]), angle: d.type === 'hdist' ? 0 : 90, at: L, value: d.value });
    else if (d.type === 'diameter' || d.type === 'radius') { const e = s.ents.find(x => x.id === d.refs[0]); dims.push({ kind: d.type, c: e.c, r: e.r, dir: unit(sub(L, e.c)), at: L, value: d.value }); }
    else if (d.type === 'angle') { const l1 = s.ents.find(x => x.id === d.refs[0]), l2 = s.ents.find(x => x.id === d.refs[1]); dims.push({ kind: 'angle', l1: [l1.a, l1.b], l2: [l2.a, l2.b], at: L, value: d.value }); }
  }
  return { ents, dims, texts, style: dimStyle() };
}
const norm360 = a => ((a % 360) + 360) % 360;

// 尺寸的图形（尺寸界线、尺寸线、箭头、文字），ts＝字高
export function dimGeom(d, ts) {
  const segs = [], ah = ts * 0.9, aw = ts * 0.3;
  const kind = (d.style && d.style.arrow) || 'arrow';
  const arrow = (tip, dir) => {
    const n = [-dir[1], dir[0]];
    if (kind === 'tick') { const t = mul(add(dir, n), ah * 0.45); segs.push([sub(tip, t), add(tip, t)]); return; }
    if (kind === 'dot') { const r = ah * 0.22; for (let i = 0; i < 10; i++) { const a0 = i / 10 * Math.PI * 2, a1 = (i + 1) / 10 * Math.PI * 2; segs.push([add(tip, [r * Math.cos(a0), r * Math.sin(a0)]), add(tip, [r * Math.cos(a1), r * Math.sin(a1)])]); } return; }
    const b1 = add(sub(tip, mul(dir, ah)), mul(n, aw)), b2 = add(sub(tip, mul(dir, ah)), mul(n, -aw));
    segs.push([tip, b1], [tip, b2]); if (kind === 'arrow') segs.push([b1, b2]);
  };
  let text = fmt(d.value), at = d.at, rot = 0;
  if (d.kind === 'aligned' || d.kind === 'linear') {
    const dir = d.kind === 'linear' ? [Math.cos((d.angle * Math.PI) / 180), Math.sin((d.angle * Math.PI) / 180)] : unit(sub(d.p2, d.p1));
    const n = [-dir[1], dir[0]];
    const e1 = add(d.p1, mul(n, dot(sub(d.at, d.p1), n))), e2 = add(d.p2, mul(n, dot(sub(d.at, d.p2), n)));
    const ext = v => { const u = unit(sub(v[1], v[0])); return [v[0], add(v[1], mul(u, ts * 0.6))]; };
    if (Math.hypot(...sub(e1, d.p1)) > 1e-9) segs.push(ext([d.p1, e1])); if (Math.hypot(...sub(e2, d.p2)) > 1e-9) segs.push(ext([d.p2, e2]));
    segs.push([e1, e2]);
    const dd = unit(sub(e2, e1));
    const len = Math.hypot(...sub(e2, e1));
    let tpos = dot(sub(d.at, e1), dd);
    // 尺寸太短放不下箭头和数字：箭头翻到界线外侧朝里指；数字（没被手动挪过时）放到外面
    const tw = Math.max(1, String(d.label || fmt(d.value)).length) * ts * 0.62;
    if (len < ts * 2.4) {
      arrow(e1, dd); arrow(e2, mul(dd, -1));
      segs.push([e1, sub(e1, mul(dd, ts * 1.6))], [e2, add(e2, mul(dd, ts * 1.6))]);
      if (Math.abs(tpos - len / 2) < 1e-6) tpos = len + ts * 1.8 + tw / 2;
    } else { arrow(e1, mul(dd, -1)); arrow(e2, dd); }
    // 数字沿尺寸线放在 at 投影处；放到界线外面时尺寸线延长过去
    if (tpos < 0) segs.push([e1, add(e1, mul(dd, tpos - ts * 0.4))]);
    if (tpos > len) segs.push([e2, add(e1, mul(dd, tpos + ts * 0.4))]);
    rot = (Math.atan2(dd[1], dd[0]) * 180) / Math.PI; if (rot > 90.001 || rot < -89.999) rot += 180;
    rot = ((rot + 540) % 360) - 180;
    const tn = [-Math.sin((rot * Math.PI) / 180), Math.cos((rot * Math.PI) / 180)];
    at = add(add(e1, mul(dd, tpos)), mul(tn, ts * 0.8));
  } else if (d.kind === 'diameter' || d.kind === 'radius') {
    const p = add(d.c, mul(d.dir, d.r)), q = d.kind === 'diameter' ? sub(d.c, mul(d.dir, d.r)) : d.c;
    segs.push([q, d.at.length ? (Math.hypot(...sub(d.at, d.c)) > d.r ? d.at : p) : p]);
    arrow(p, d.dir); if (d.kind === 'diameter') arrow(q, mul(d.dir, -1));
    text = d.label || ((d.kind === 'diameter' ? 'Ø' : 'R') + fmt(d.value));
    at = add(d.at, mul(d.dir, ts * 1.2));
  } else if (d.kind === 'angle') { text = fmt(d.value) + '°'; }
  return { segs, text, at, rot, h: ts };
}

// ───── DXF ─────
export function toDxf(dr, ts = 3.5) {
  const w = new DxfWriter();
  w.setUnits(Units.Millimeters);
  w.addLType('DASHED', 'Dashed __ __ __', [5, -2.5]);
  w.addLType('DASHDOT', 'Dash dot __ . __ .', [8, -2.5, 0, -2.5]);
  w.addLayer('VISIBLE', 7, 'Continuous'); w.addLayer('HIDDEN', 8, 'DASHED'); w.addLayer('CONSTRUCTION', 8, 'DASHED');
  w.addLayer('CENTER', 1, 'DASHDOT'); w.addLayer('ISO', 7, 'Continuous');
  w.addLayer('DIM', 3, 'Continuous'); w.addLayer('TEXT', 7, 'Continuous'); w.addLayer('FRAME', 7, 'Continuous');
  const P = p => point3d(p[0], p[1], 0);
  for (const e of dr.ents) {
    const o = { layerName: e.layer || (e.dashed ? 'HIDDEN' : 'VISIBLE') };
    if (e.type === 'line') w.addLine(P(e.a), P(e.b), o);
    else if (e.type === 'circle') w.addCircle(P(e.c), e.r, o);
    else if (e.type === 'arc') w.addArc(P(e.c), e.r, e.a0, e.a1, o);
    else if (e.type === 'poly') for (let i = 0; i + 1 < e.pts.length; i++) w.addLine(P(e.pts[i]), P(e.pts[i + 1]), o);
  }
  let n = 0;
  for (const d of dr.dims) {
    const g = dimGeom({ ...d, style: dr.style }, d.ts || ts), name = 'D' + ++n;
    const b = w.addBlock(name);
    const lt = dr.style && dr.style.line === 'dashed' ? 'DASHED' : dr.style && dr.style.line === 'dashdot' ? 'DASHDOT' : undefined;
    for (const sg of g.segs) b.addLine(P(sg[0]), P(sg[1]), lt ? { layerName: 'DIM', lineType: lt } : { layerName: 'DIM' });
    b.addText(P(g.at), g.h, g.text, { layerName: 'DIM', rotation: g.rot, horizontalAlignment: 1, verticalAlignment: 2, secondAlignmentPoint: P(g.at) });
    const o = { blockName: name, layerName: 'DIM', ...(d.dxfText ? { text: d.dxfText } : {}) };
    // 对齐尺寸按"旋转角＝两点连线方向"的线性尺寸写（该库的对齐尺寸在竖线上会被量成 0）
    if (d.kind === 'aligned') { const u = unit(sub(d.p2, d.p1)); w.addLinearDim(P(d.p1), P(d.p2), { ...o, angle: (Math.atan2(u[1], u[0]) * 180) / Math.PI, insertionPoint: P(d.at), offset: dot(sub(d.at, d.p1), [-u[1], u[0]]) }); }
    else if (d.kind === 'linear') w.addLinearDim(P(d.p1), P(d.p2), { ...o, angle: d.angle, insertionPoint: P(d.at), offset: d.angle === 0 ? d.at[1] - d.p1[1] : d.p1[0] - d.at[0] });
    else if (d.kind === 'diameter') w.addDiameterDim(P(add(d.c, mul(d.dir, d.r))), P(sub(d.c, mul(d.dir, d.r))), o);
    else if (d.kind === 'radius') w.addRadialDim(P(d.c), P(add(d.c, mul(d.dir, d.r))), o);
    else if (d.kind === 'angle') {
      // 两条线都从交点朝外，并按逆时针顺序写，量出来才是标注的那个角（不是 360° 减它）
      const [l1, l2] = [d.l1, d.l2], u = sub(l1[1], l1[0]), v = sub(l2[1], l2[0]), den = u[0] * v[1] - u[1] * v[0];
      let A = l1, B = l2;
      if (Math.abs(den) > 1e-12) {
        const t = ((l2[0][0] - l1[0][0]) * v[1] - (l2[0][1] - l1[0][1]) * v[0]) / den, X = add(l1[0], mul(u, t));
        const out = l => (Math.hypot(...sub(l[0], X)) > Math.hypot(...sub(l[1], X)) ? [l[1], l[0]] : l);
        A = out(l1); B = out(l2);
        const a = sub(A[1], A[0]), b = sub(B[1], B[0]);
        if (a[0] * b[1] - a[1] * b[0] < 0) [A, B] = [B, A];
      }
      w.addAngularLinesDim({ start: P(A[0]), end: P(A[1]) }, { start: P(B[0]), end: P(B[1]) }, P(d.at), o);
    }
  }
  for (const t of dr.texts) w.addText(P(t.at), t.h, t.text, { layerName: t.layer || 'TEXT' });
  return w.stringify();
}

// ───── 包围盒 ─────
export function drawingBox(dr, ts = 3.5) {
  const xs = [], ys = [];
  const pt = p => { xs.push(p[0]); ys.push(p[1]); };
  for (const e of dr.ents) {
    if (e.type === 'line') { pt(e.a); pt(e.b); }
    else if (e.type === 'circle' || e.type === 'arc') { pt([e.c[0] - e.r, e.c[1] - e.r]); pt([e.c[0] + e.r, e.c[1] + e.r]); }
    else if (e.type === 'poly') e.pts.forEach(pt);
  }
  for (const d of dr.dims) { const g = dimGeom(d, d.ts || ts); g.segs.forEach(s => { pt(s[0]); pt(s[1]); }); pt(g.at); }
  for (const t of dr.texts) { pt(t.at); pt([t.at[0] + t.text.length * t.h, t.at[1] + t.h]); }
  if (!xs.length) return [0, 0, 100, 100];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// ───── SVG ─────
// opt: {page:[宽,高] 毫米, map: 图纸坐标→纸面毫米(y 向下), scale, ts}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function toSvg(dr, opt) {
  const st = dr.style || {}, dimCss = { color: st.color || '#1a4fb4', dash: st.line === 'dashed' ? ';stroke-dasharray:2 1' : st.line === 'dashdot' ? ';stroke-dasharray:3 1 0.4 1' : '' };
  const { page, map, scale } = opt, ts = opt.ts || 3.5, out = [];
  const f = v => +v.toFixed(4);
  const line = (a, b, cls) => { const p = map(a), q = map(b); out.push(`<line x1="${f(p[0])}" y1="${f(p[1])}" x2="${f(q[0])}" y2="${f(q[1])}" class="${cls}"/>`); };
  for (const e of dr.ents) {
    const cls = e.layer === 'FRAME' ? 'fr' : e.dashed ? 'hd' : 'vs';
    if (e.type === 'line') line(e.a, e.b, cls);
    else if (e.type === 'circle') { const c = map(e.c); out.push(`<circle cx="${f(c[0])}" cy="${f(c[1])}" r="${f(e.r * scale)}" class="${cls}"/>`); }
    else if (e.type === 'arc') {
      const A = a => [e.c[0] + e.r * Math.cos((a * Math.PI) / 180), e.c[1] + e.r * Math.sin((a * Math.PI) / 180)];
      let sweep = e.a1 - e.a0; while (sweep <= 0) sweep += 360;
      const p = map(A(e.a0)), q = map(A(e.a1));
      out.push(`<path d="M${f(p[0])} ${f(p[1])} A${f(e.r * scale)} ${f(e.r * scale)} 0 ${sweep > 180 ? 1 : 0} 0 ${f(q[0])} ${f(q[1])}" class="${cls}"/>`);
    } else if (e.type === 'poly') out.push(`<polyline points="${e.pts.map(p => map(p).map(f).join(',')).join(' ')}" class="${cls}"/>`);
  }
  for (const d of dr.dims) {
    const g = dimGeom({ ...d, style: dr.style }, (d.ts || ts));
    out.push(`<g class="dimg"${d.key ? ` data-key="${esc(d.key)}"` : ''}>`);
    for (const s of g.segs) line(s[0], s[1], 'dm');
    const p = map(g.at);
    out.push(`<text x="${f(p[0])}" y="${f(p[1])}" font-size="${f(g.h * scale)}" text-anchor="middle" dominant-baseline="central" transform="rotate(${f(-g.rot)} ${f(p[0])} ${f(p[1])})">${esc(g.text)}</text>`);
    out.push('</g>');
  }
  for (const t of dr.texts) { const p = map(t.at); out.push(`<text x="${f(p[0])}" y="${f(p[1])}" font-size="${f(t.h * scale)}"${t.anchor ? ` text-anchor="${t.anchor}"` : ''}>${esc(t.text)}</text>`); }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${f(page[0])}mm" height="${f(page[1])}mm" viewBox="0 0 ${f(page[0])} ${f(page[1])}">` +
    `<style>.vs{stroke:#111;stroke-width:0.35;fill:none}.hd{stroke:#333;stroke-width:0.25;fill:none;stroke-dasharray:3 1.5}.fr{stroke:#111;stroke-width:0.5;fill:none}.dm{stroke:${dimCss.color};stroke-width:0.18;fill:none${dimCss.dash}}text{fill:#111;font-family:"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif}</style>` +
    `<rect width="100%" height="100%" fill="#fff"/>` + out.join('') + '</svg>';
}

// 草图的纸面：真实尺寸（1:1），四周留 10mm
export function sketchPage(dr) {
  const b = drawingBox(dr), m = 10;
  const page = [b[2] - b[0] + 2 * m, b[3] - b[1] + 2 * m];
  return { page, scale: 1, map: p => [p[0] - b[0] + m, b[3] - p[1] + m] };
}

// ───── PDF ─────
let fontBytes = null;
async function cjkFont() {
  if (!fontBytes) { const r = await fetch(new URL('fonts/NotoSansSC-GB2312.ttf', document.baseURI)); if (!r.ok) throw new Error('中文字体加载失败'); fontBytes = await r.arrayBuffer(); }
  return fontBytes;
}
const PT = 72 / 25.4;
export const PAPER = { A4: [297, 210], A3: [420, 297] };
// opt 同 SVG：page 毫米（横向），map 到纸面毫米（y 向下）
export async function toPdf(dr, opt, meta = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await cjkFont(), { subset: true });
  doc.setTitle(meta.title || 'GlassCAD'); doc.setCreator('GlassCAD'); doc.setProducer('GlassCAD');
  const [pw, ph] = opt.page, page = doc.addPage([pw * PT, ph * PT]);
  const ts = opt.ts || 3.5, scale = opt.scale;
  const X = p => { const q = opt.map(p); return { x: q[0] * PT, y: (ph - q[1]) * PT }; };
  const black = rgb(0.07, 0.07, 0.07), blue = rgb(0.1, 0.31, 0.7);
  const st = dr.style || {}, hex = st.color && /^#[0-9a-f]{6}$/i.test(st.color) ? st.color : null;
  const dimColor = hex ? rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255) : blue;
  const dimDash = st.line === 'dashed' ? [2 * PT, 1 * PT] : st.line === 'dashdot' ? [3 * PT, 1 * PT, 0.4 * PT, 1 * PT] : null;
  const ln = (a, b, w, color, dash) => page.drawLine({ start: X(a), end: X(b), thickness: w * PT, color, dashArray: Array.isArray(dash) ? dash : dash ? [3 * PT, 1.5 * PT] : undefined });
  const arcPts = (c, r, a0, a1) => { let sw = a1 - a0; while (sw <= 0) sw += 360; const n = Math.max(8, Math.ceil(sw / 5)), P = []; for (let i = 0; i <= n; i++) { const a = ((a0 + (sw * i) / n) * Math.PI) / 180; P.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } return P; };
  for (const e of dr.ents) {
    const w = e.layer === 'FRAME' ? 0.5 : e.dashed ? 0.25 : 0.35;
    let P = null;
    if (e.type === 'line') P = [e.a, e.b];
    else if (e.type === 'circle') P = arcPts(e.c, e.r, 0, 360);
    else if (e.type === 'arc') P = arcPts(e.c, e.r, e.a0, e.a1);
    else if (e.type === 'poly') P = e.pts;
    for (let i = 0; P && i + 1 < P.length; i++) ln(P[i], P[i + 1], w, black, e.dashed);
  }
  for (const d of dr.dims) {
    const g = dimGeom({ ...d, style: dr.style }, d.ts || ts);
    for (const s of g.segs) ln(s[0], s[1], 0.18, dimColor, dimDash);
    const size = g.h * scale * PT, wdt = font.widthOfTextAtSize(g.text, size), c = X(g.at), r = (g.rot * Math.PI) / 180;
    page.drawText(g.text, { x: c.x - (Math.cos(r) * wdt) / 2 + (Math.sin(r) * size * 0.35), y: c.y - (Math.sin(r) * wdt) / 2 - (Math.cos(r) * size * 0.35), size, font, color: dimColor, rotate: degrees(g.rot) });
  }
  for (const t of dr.texts) {
    const size = t.h * scale * PT, c = X(t.at); let x = c.x;
    if (t.anchor === 'middle') x -= font.widthOfTextAtSize(t.text, size) / 2;
    page.drawText(t.text, { x, y: c.y, size, font, color: black });
  }
  return await doc.save();
}
