import ClipperLib from 'clipper-lib';
// 几何建模（纯函数）：Worker 与 node 自测共用。输入项目文档，按特征顺序用 OpenCascade（replicad）重建实体。
// 约定：毫米、Z 朝上；草图平面 {origin, normal, u, v}，v = normal × u。

export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  clean: a => a.map(x => (Math.abs(x) < 1e-12 ? 0 : Math.abs(x - 1) < 1e-12 ? 1 : Math.abs(x + 1) < 1e-12 ? -1 : x)),
};

export const PLANES = {
  XY: { origin: [0, 0, 0], normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  XZ: { origin: [0, 0, 0], normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  YZ: { origin: [0, 0, 0], normal: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
};

// 平面上的 u 轴取法：法向接近 ±Z 时 u = +X，否则 u = Z × 法向（侧面上 v 朝上）
export function planeAt(origin, normal) {
  const n = V.clean(V.norm(normal));
  const up = Math.abs(n[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
  const u = V.clean(V.norm(V.cross(up, n)));
  return { origin: origin.slice(), normal: n, u, v: V.clean(V.cross(n, u)) };
}
export const toWorld = (pl, uv) => V.add(pl.origin, V.add(V.mul(pl.u, uv[0]), V.mul(pl.v, uv[1])));

// 边/面引用：记录拾取点相对于"当时输入实体包围盒"的位置（贴最小面 / 贴最大面 / 离最小角多远），上游改尺寸后按新包围盒还原
export function describe(bbox, p) {
  return p.map((x, i) => (Math.abs(x - bbox[0][i]) < 1e-6 ? ['min'] : Math.abs(x - bbox[1][i]) < 1e-6 ? ['max'] : ['off', x - bbox[0][i]]));
}
export function resolveRef(bbox, d) {
  return d.map((k, i) => (k[0] === 'min' ? bbox[0][i] : k[0] === 'max' ? bbox[1][i] : bbox[0][i] + k[1]));
}

// ───── 草图 → 封闭环 ─────
const rad = d => (d * Math.PI) / 180;
export function arcPoints(e) {
  let a1 = e.a1;
  while (a1 <= e.a0) a1 += 360;
  const am = (e.a0 + a1) / 2;
  const P = a => [e.c[0] + e.r * Math.cos(rad(a)), e.c[1] + e.r * Math.sin(rad(a))];
  return { a: P(e.a0), b: P(a1), m: P(am), a0: e.a0, a1 };
}
function samplePath(segs) {
  const pts = [];
  for (const s of segs) {
    if (s.type === 'line') pts.push(s.a);
    else {
      const { a0, a1 } = s;
      const n = 16;
      for (let i = 0; i < n; i++) { const t = s.rev ? a1 - ((a1 - a0) * i) / n : a0 + ((a1 - a0) * i) / n; pts.push([s.c[0] + s.r * Math.cos(rad(t)), s.c[1] + s.r * Math.sin(rad(t))]); }
    }
  }
  return pts;
}
function inPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const area = poly => { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); };

export function sketchLoops(sk) {
  const ents = sk.ents.filter(e => !e.construction);
  const segs = [];
  for (const e of ents) {
    if (e.type === 'line' && Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) > 1e-9) segs.push({ type: 'line', a: e.a, b: e.b });
    if (e.type === 'arc') { const p = arcPoints(e); segs.push({ type: 'arc', a: p.a, b: p.b, m: p.m, c: e.c, r: e.r, a0: p.a0, a1: p.a1 }); }
  }
  const eq = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-5;
  const used = new Array(segs.length).fill(false), loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const chain = [{ ...segs[i] }]; used[i] = true;
    let end = segs[i].b, closed = eq(end, segs[i].a);
    while (!closed) {
      let k = -1, rev = false;
      for (let j = 0; j < segs.length; j++) { if (used[j]) continue; if (eq(segs[j].a, end)) { k = j; break; } if (eq(segs[j].b, end)) { k = j; rev = true; break; } }
      if (k < 0) break;
      used[k] = true;
      const s = segs[k];
      chain.push(rev ? { ...s, a: s.b, b: s.a, rev: true } : { ...s });
      end = rev ? s.a : s.b;
      closed = eq(end, chain[0].a);
    }
    if (closed) { const poly = samplePath(chain); loops.push({ kind: 'path', segs: chain, poly, area: area(poly) }); }
  }
  for (const e of ents) if (e.type === 'circle' && e.r > 1e-9) {
    const poly = []; for (let i = 0; i < 48; i++) poly.push([e.c[0] + e.r * Math.cos((i / 48) * 2 * Math.PI), e.c[1] + e.r * Math.sin((i / 48) * 2 * Math.PI)]);
    loops.push({ kind: 'circle', c: e.c, r: e.r, poly, area: Math.PI * e.r * e.r });
  }
  // 嵌套：被偶数个环包着的是外轮廓，奇数个的是它直接外层的孔
  const inside = (a, b) => a !== b && b.area > a.area && inPoly(a.kind === 'circle' ? [a.c[0] + a.r, a.c[1]] : a.poly[0], b.poly) && inPoly(a.kind === 'circle' ? a.c : centroidish(a.poly), b.poly);
  for (const L of loops) {
    const parents = loops.filter(o => inside(L, o));
    L.depth = parents.length;
    L.parent = parents.sort((x, y) => x.area - y.area)[0] || null;
  }
  return loops.filter(L => L.depth % 2 === 0).map(o => ({ outer: o, holes: loops.filter(h => h.parent === o && h.depth === o.depth + 1) }));
}
function centroidish(poly) { let x = 0, y = 0; for (const p of poly) { x += p[0]; y += p[1]; } return [x / poly.length, y / poly.length]; }

// ───── 文字轮廓的几何小工具 ─────
const signedArea = P => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
function flattenLoop(L) {
  const out = [];
  for (const s of L) {
    out.push(s.p[0]);
    if (s.k !== 'B') continue;
    const n = s.p.length === 3 ? 8 : 12;
    for (let i = 1; i < n; i++) {
      const t = i / n, m = 1 - t;
      if (s.p.length === 3) out.push([0, 1].map(k => m * m * s.p[0][k] + 2 * m * t * s.p[1][k] + t * t * s.p[2][k]));
      else out.push([0, 1].map(k => m * m * m * s.p[0][k] + 3 * m * m * t * s.p[1][k] + 3 * m * t * t * s.p[2][k] + t * t * t * s.p[3][k]));
    }
  }
  return out;
}
function selfCrossing(P) {
  const n = P.length, cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const a = P[i], b = P[(i + 1) % n], c = P[j], d = P[(j + 1) % n];
    const d1 = cr(c, d, a), d2 = cr(c, d, b), d3 = cr(a, b, c), d4 = cr(a, b, d);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  }
  return false;
}
function untangle(P) {
  const K = 1e5, C = new ClipperLib.Clipper(), tree = new ClipperLib.PolyTree();
  C.AddPath(P.map(p => ({ X: Math.round(p[0] * K), Y: Math.round(p[1] * K) })), ClipperLib.PolyType.ptSubject, true);
  C.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const out = [];
  const walk = node => { for (const ch of node.Childs()) { const c = ch.Contour(); if (c.length >= 3) out.push({ hole: ch.IsHole(), pts: c.map(q => [q.X / K, q.Y / K]) }); walk(ch); } };
  walk(tree);
  return out;
}

export function makeKernel(R) {
  const wireOf = (L, pl) => {
    const W = uv => toWorld(pl, uv);
    if (L.kind === 'circle') return R.assembleWire([R.makeCircle(L.r, W(L.c), pl.normal)]);
    return R.assembleWire(L.segs.map(s => (s.type === 'line' ? R.makeLine(W(s.a), W(s.b)) : R.makeThreePointArc(W(s.a), W(s.m), W(s.b)))));
  };
  // 草图文字（at = 基线左端，h = 字号 mm；字体由 Worker 先 loadFont 好）→ 每个字的轮廓环
  // 这套字体（可变字体实例化出来的）很多字是笔画叠在一起画的，直接按嵌套关系做面会出坏面、网格出不来，
  // 所以每个轮廓环单独做面：和最大的环同向的是"笔画"、反向的是"孔"，拉成柱体后 笔画全并起来 再减孔
  const textGlyphs = (sk, pl) => {
    const out = [];
    for (const e of sk.ents) {
      if (e.type !== 'text' || e.construction || !String(e.text || '').trim()) continue;
      const font = R.getFont(); if (!font) throw new Error('字体还没加载好，请稍后重试');
      for (const path of font.getPaths(String(e.text), 0, 0, +e.h || 5)) {
        const loops = []; let cur = null, start = null, last = null;
        const P = (x, y) => [x + e.at[0], -y + e.at[1]];
        const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7;
        const close = () => { if (cur && last && !same(last, start)) cur.push({ k: 'L', p: [last, start] }); if (cur && cur.length) loops.push(cur); cur = null; };
        for (const c of path.commands) {
          if (c.type === 'M') { close(); cur = []; start = last = P(c.x, c.y); continue; }
          if (c.type === 'Z') { close(); continue; }
          if (!cur) continue;
          const q = P(c.x, c.y); if (same(q, last)) continue;
          if (c.type === 'L') cur.push({ k: 'L', p: [last, q] });
          else if (c.type === 'Q') cur.push({ k: 'B', p: [last, P(c.x1, c.y1), q] });
          else if (c.type === 'C') cur.push({ k: 'B', p: [last, P(c.x1, c.y1), P(c.x2, c.y2), q] });
          last = q;
        }
        close();
        const items = [], W = uv => toWorld(pl, uv);
        for (const L of loops) {
          const poly = flattenLoop(L), a = signedArea(poly);
          if (Math.abs(a) < 1e-8) continue;
          if (!selfCrossing(poly)) { items.push({ wire: R.assembleWire(L.map(s => (s.k === 'L' ? R.makeLine(W(s.p[0]), W(s.p[1])) : R.makeBezierCurve(s.p.map(W))))), area: a }); continue; }
          // 自己和自己交叉的轮廓（如数字 6）：按非零环绕规则拆成简单的外环＋孔，用细折线代替曲线
          for (const r of untangle(poly)) items.push({ wire: ringWire(r.pts, W), area: (r.hole ? -1 : 1) * Math.sign(a) * Math.abs(signedArea(r.pts)) });
        }
        if (items.length) out.push(items);
      }
    }
    return out;
  };
  // 文字拉成实体：fc → 拉伸方向向量 vec，shift → 先整体平移（贯穿切除用）
  const textSolid = (glyphs, vec, shift) => {
    const all = glyphs.flat(); if (!all.length) return null;
    const sgn = Math.sign(all.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a)).area);
    const prism = it => { let f = R.makeFace(it.wire); if (shift) f = f.translate(shift); return R.basicFaceExtrusion(f, new R.Vector(vec)); };
    const solids = [];
    for (const g of glyphs) {
      let s = fuseAll(g.filter(it => Math.sign(it.area) === sgn).map(prism));
      if (!s) continue;
      for (const it of g.filter(it => Math.sign(it.area) !== sgn)) s = s.cut(prism(it));
      solids.push(s);
    }
    return fuseAll(solids);
  };
  const facesOf = (sk, pl, allowEmpty) => {
    const regions = sketchLoops(sk);
    if (!regions.length && !allowEmpty) throw new Error('草图里没有封闭轮廓');
    // 内孔环必须与外环反向，否则孔会被当成实体加进去
    const rev = w => R.cast(w.wrapped.Reversed());
    return regions.map(r => R.makeFace(wireOf(r.outer, pl), r.holes.map(h => rev(wireOf(h, pl)))));
  };
  // 折线环 → 线框：在拐角处断开，平滑的一段拟合成样条（侧面是一整块光滑面，不会出一堆竖线），直的一段用直线
  const ringWire = (pts, W) => {
    const n = pts.length, ang = i => { const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n]; const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]]; return Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1])); };
    let cs = []; for (let i = 0; i < n; i++) if (ang(i) > 0.5) cs.push(i);
    if (cs.length < 2) cs = [0, Math.floor(n / 2)];
    const edges = [];
    try {
      for (let k = 0; k < cs.length; k++) {
        const i0 = cs[k], i1 = cs[(k + 1) % cs.length], run = [];
        for (let i = i0; ; i = (i + 1) % n) { run.push(pts[i]); if (i === i1 && run.length > 1) break; }
        const a = run[0], b = run[run.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const dev = Math.max(...run.map(q => Math.abs((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) / L));
        edges.push(run.length <= 2 || dev < 1e-3 ? R.makeLine(W(a), W(b)) : R.makeBSplineApproximation(run.map(W), { tolerance: 1e-3, degMax: 3 }));
      }
      return R.assembleWire(edges);
    } catch (e) { return R.assembleWire(pts.map((q, i) => R.makeLine(W(q), W(pts[(i + 1) % n])))); }
  };
  const fuseAll = shapes => shapes.reduce((a, b) => (a ? a.fuse(b) : b), null);
  const bboxOf = s => { const b = s.boundingBox.bounds; return [b[0].slice(), b[1].slice()]; };
  const diag = s => { const b = bboxOf(s); return V.len(V.sub(b[1], b[0])); };

  function facePlane(solid, p, normalHint) {
    let best = null;
    for (const f of solid.faces) {
      if (f.geomType !== 'PLANE') continue;
      const c = f.center; const nv = f.normalAt(c); const n = V.clean(V.norm([nv.x, nv.y, nv.z]));
      const d = V.dot(n, [c.x, c.y, c.z]);
      if (Math.abs(V.dot(n, p) - d) > 1e-4) continue;
      if (normalHint && V.dot(n, normalHint) < 0.999) continue;
      let dist = 1;
      try { const vx = R.makeVertex(p); dist = R.measureDistanceBetween(f, vx); } catch (e) { }
      if (dist < 1e-4) { const q = V.sub(p, V.mul(n, V.dot(n, p) - d)); best = planeAt(q, n); break; }
    }
    if (!best) throw new Error('该点不在实体的平面上');
    return best;
  }

  // 全量重建；返回实体、每个特征的错误、实体平面上草图的当前平面
  function rebuild(doc) {
    const errors = {}, planes = {};
    const sk = id => doc.sketches.find(s => s.id === id);
    let solid = null;
    for (const f of doc.features) {
      if (f.suppressed) continue;
      try {
        const p = f.params || {};
        if (f.type === 'extrude' || f.type === 'cut') {
          const S = sk(f.sketch); if (!S) throw new Error('草图不存在');
          let pl = S.plane;
          if (S.faceRef) { if (!solid) throw new Error('草图所在的面不存在'); pl = facePlane(solid, resolveRef(bboxOf(solid), S.faceRef.desc), S.faceRef.normal); planes[S.id] = pl; }
          const isCut = f.type === 'cut' || p.cut;
          let dir = isCut ? -1 : 1; if (p.reverse) dir = -dir;
          const glyphs = textGlyphs(S, pl);
          let faces = facesOf(S, pl, glyphs.length > 0), vec, shift = null;
          if (p.through) {
            if (!solid) throw new Error('没有实体可切');
            const L = diag(solid) + 10;
            shift = V.mul(pl.normal, L);
            faces = faces.map(fc => fc.translate(shift));
            vec = V.mul(pl.normal, -2 * L);
          } else {
            if (!(p.depth > 0)) throw new Error('深度必须大于 0');
            vec = V.mul(pl.normal, dir * p.depth);
          }
          const parts = faces.map(fc => R.basicFaceExtrusion(fc, new R.Vector(vec)));
          const ts = textSolid(glyphs, vec, shift); if (ts) parts.push(ts);
          const tool = fuseAll(parts);
          if (isCut) { if (!solid) throw new Error('没有实体可切'); solid = solid.cut(tool); }
          else solid = solid ? solid.fuse(tool) : tool;
        } else if (f.type === 'revolve') {
          const S = sk(f.sketch); if (!S) throw new Error('草图不存在');
          const ax = S.ents.find(e => e.id === p.axis); if (!ax || ax.type !== 'line') throw new Error('旋转轴必须是草图里的一条直线');
          const pl = S.plane;
          const p0 = toWorld(pl, ax.a), p1 = toWorld(pl, ax.b);
          const ang = p.angle == null ? 360 : p.angle;
          if (!(ang > 0 && ang <= 360)) throw new Error('角度必须在 0–360 之间');
          const tool = fuseAll(facesOf(S, pl).map(fc => R.revolution(fc, p0, V.norm(V.sub(p1, p0)), ang)));
          if (p.cut) { if (!solid) throw new Error('没有实体可切'); solid = solid.cut(tool); }
          else solid = solid ? solid.fuse(tool) : tool;
        } else {
          if (!solid) throw new Error('没有实体');
          const bb = bboxOf(solid);
          const pts = (p.refs || []).map(d => resolveRef(bb, d));
          if (!pts.length) throw new Error('没有选中边或面');
          const finder = e => e.either(pts.map(q => g => g.atDistance(0, q, 0.05)));
          let out;
          if (f.type === 'fillet') { if (!(p.radius > 0)) throw new Error('半径必须大于 0'); out = solid.fillet(p.radius, finder); }
          else if (f.type === 'chamfer') { if (!(p.distance > 0)) throw new Error('距离必须大于 0'); out = solid.chamfer(p.distance, finder); }
          else if (f.type === 'shell') { if (!(p.thickness > 0)) throw new Error('壁厚必须大于 0'); out = solid.shell(p.thickness, finder); }
          else throw new Error('未知特征类型 ' + f.type);
          const v = R.measureVolume(out);
          if (!(v > 1e-9) || !isFinite(v)) throw new Error('结果为空');
          solid = out;
        }
      } catch (e) {
        const m = e && e.message;
        errors[f.id] = !m || /WebAssembly|object/.test(String(m)) || String(e).includes('[object') ? '几何内核计算失败（参数可能过大或无法生成）' : String(m);
      }
    }
    return { solid, errors, planes };
  }

  function info(solid, tol = 0.02) {
    if (!solid) return { measure: { volume: 0, area: 0, bbox: [[0, 0, 0], [0, 0, 0]] }, mesh: null, edges: null, faces: [] };
    const bbox = bboxOf(solid);
    const measure = { volume: R.measureVolume(solid), area: R.measureArea(solid), bbox };
    const m = solid.mesh({ tolerance: tol, angularTolerance: 0.15 });
    const ed = solid.meshEdges({ tolerance: tol, angularTolerance: 0.15 });
    const fl = solid.faces;
    const idx = new Map(fl.map((f, i) => [f.hashCode, i]));
    const faces = fl.map(f => {
      if (f.geomType !== 'PLANE') return { planar: false };
      const c = f.center, nv = f.normalAt(c); const n = V.clean(V.norm([nv.x, nv.y, nv.z]));
      return { planar: true, normal: n, d: V.dot(n, [c.x, c.y, c.z]) };
    });
    const triFace = new Int32Array(m.triangles.length / 3);
    let unmapped = 0;
    for (const g of m.faceGroups) { const fi = idx.has(g.faceId) ? idx.get(g.faceId) : (unmapped++, -1); for (let i = 0; i < g.count / 3; i++) triFace[g.start / 3 + i] = fi; }
    // 每个面由哪几条边围成（选一个面倒角/圆角＝它的所有边）
    const edgeIdx = new Map(ed.edgeGroups.map((g, i) => [g.edgeId, i]));
    const faceEdges = fl.map(f => { try { return [...new Set(f.edges.map(e => edgeIdx.get(e.hashCode)).filter(i => i !== undefined))]; } catch (e) { return []; } });
    return {
      measure,
      mesh: { vertices: Float32Array.from(m.vertices), normals: Float32Array.from(m.normals), triangles: Uint32Array.from(m.triangles), triFace },
      edges: { lines: Float32Array.from(ed.lines), groups: ed.edgeGroups.map(g => [g.start, g.count]) },
      faces, faceEdges, unmapped,
    };
  }

  function to3mfModel(solid) {
    const m = solid.mesh({ tolerance: 0.01, angularTolerance: 0.1 });
    const key = new Map(), V3 = [], T = [];
    const vi = i => {
      const x = m.vertices[i * 3], y = m.vertices[i * 3 + 1], z = m.vertices[i * 3 + 2];
      const k = x.toFixed(5) + ',' + y.toFixed(5) + ',' + z.toFixed(5);
      let id = key.get(k);
      if (id === undefined) { id = V3.length; key.set(k, id); V3.push(`<vertex x="${x}" y="${y}" z="${z}"/>`); }
      return id;
    };
    for (let i = 0; i < m.triangles.length; i += 3) {
      const a = vi(m.triangles[i]), b = vi(m.triangles[i + 1]), c = vi(m.triangles[i + 2]);
      if (a !== b && b !== c && a !== c) T.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="zh-CN" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Formis</metadata><resources><object id="1" type="model"><mesh><vertices>${V3.join('')}</vertices><triangles>${T.join('')}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
  }

  // 工程图投影：返回视图坐标系里的线段/圆/弧（visible / hidden）
  // 视线：主视从 −Y、俯视从 +Z、左视从 −X（第一角投影）；ProjectionCamera 的方向指向观察者
  const r3 = 1 / Math.sqrt(3), r2 = 1 / Math.sqrt(2);
  const CAMS = { front: [[0, -1, 0], [1, 0, 0]], top: [[0, 0, 1], [1, 0, 0]], left: [[-1, 0, 0], [0, -1, 0]], iso: [[r3, -r3, r3], [r2, r2, 0]] }; // iso：从右前上方看的正等轴测
  function project(solid, view) {
    const [dir, xAxis] = CAMS[view];
    const { visible, hidden } = R.drawProjection(solid, new R.ProjectionCamera([0, 0, 0], dir, xAxis));
    const take = d => {
      const out = [];
      const walk = s => {
        if (!s) return;
        if (Array.isArray(s.curves)) { for (const c of s.curves) out.push(curveOut(c)); return; }
        if (Array.isArray(s.blueprints)) { for (const b of s.blueprints) walk(b); return; }
        if (s.outerBlueprint) { walk(s.outerBlueprint); for (const b of s.holes || []) walk(b); return; }
      };
      walk(d && d.innerShape);
      return out.filter(Boolean);
    };
    const vis = take(visible);
    // 与可见线重合的隐藏线不要（背面轮廓）
    const onSeg = (p, l) => { const dx = l.b[0] - l.a[0], dy = l.b[1] - l.a[1], L2 = dx * dx + dy * dy; if (L2 < 1e-12) return false; const t = ((p[0] - l.a[0]) * dx + (p[1] - l.a[1]) * dy) / L2; if (t < -1e-6 || t > 1 + 1e-6) return false; return Math.abs((p[0] - l.a[0]) * dy - (p[1] - l.a[1]) * dx) / Math.sqrt(L2) < 1e-5; };
    const visLines = vis.filter(c => c.type === 'line');
    const hid = take(hidden).filter(c => !(c.type === 'line' && visLines.some(l => onSeg(c.a, l) && onSeg(c.b, l))));
    return { visible: vis, hidden: hid };
  }
  function curveOut(c) {
    const a = c.firstPoint, b = c.lastPoint, t = c.geomType;
    if (t === 'LINE') return { type: 'line', a, b };
    const f0 = c.firstParameter, f1 = c.lastParameter;
    if (t === 'CIRCLE') {
      const m = c.value((f0 + f1) / 2), q = c.value(f0 + (f1 - f0) * 0.25);
      const cc = circle3(a, q, m);
      if (cc) {
        const closed = Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7;
        if (closed) return { type: 'circle', c: cc.c, r: cc.r };
        // 判断走向：起点→中点→终点是否逆时针
        const ang = p => (Math.atan2(p[1] - cc.c[1], p[0] - cc.c[0]) * 180) / Math.PI;
        const cr = (q[0] - a[0]) * (m[1] - a[1]) - (q[1] - a[1]) * (m[0] - a[0]);
        return cr > 0 ? { type: 'arc', c: cc.c, r: cc.r, a0: ang(a), a1: ang(b) } : { type: 'arc', c: cc.c, r: cc.r, a0: ang(b), a1: ang(a) };
      }
    }
    const pts = []; const n = 24; for (let i = 0; i <= n; i++) pts.push(c.value(f0 + ((f1 - f0) * i) / n));
    return { type: 'poly', pts };
  }
  function circle3(p, q, r) {
    const ax = p[0], ay = p[1], bx = q[0], by = q[1], cx = r[0], cy = r[1];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-12) return null;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return { c: [ux, uy], r: Math.hypot(ax - ux, ay - uy) };
  }

  return { rebuild, info, to3mfModel, project, bboxOf, facePlane };
}
