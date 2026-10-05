// 开发自测：在 node 里直接跑 src/kernel/build.js，核对判卷那几类零件的体积公式与投影方向。
// 用法：node tools/dev-kernel.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opencascade from 'replicad-opencascadejs';
import * as R from 'replicad';
import { makeKernel, PLANES, describe, planeAt } from '../src/kernel/build.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const oc = await opencascade({ wasmBinary: fs.readFileSync(path.join(ROOT, 'node_modules/replicad-opencascadejs/dist/replicad_single.wasm')), print: () => { }, printErr: () => { } });
R.setOC(oc);
const K = makeKernel(R);
const PI = Math.PI;
let bad = 0;
const ok = (name, v, e, tol = 1e-6) => { const r = Math.abs(v - e) / Math.max(1e-9, Math.abs(e)); console.log(`${r <= tol ? 'ok ' : 'BAD'} ${name} ${v.toFixed(4)} vs ${e.toFixed(4)}`); if (r > tol) bad++; };
const rect = (id, x0, y0, w, h) => [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]].map((p, i, a) => ({ id: id + i, type: 'line', a: p, b: a[(i + 1) % 4] }));
const circ = (id, c, r) => ({ id, type: 'circle', c, r });
const vol = doc => { const { solid, errors } = K.rebuild(doc); return [solid ? R.measureVolume(solid) : 0, errors, solid]; };

const VP = (W, D, fil = true) => W * 60 * D - 4 * PI * 16 * D - (fil ? 4 * (25 - 25 * PI / 4) * D : 0) - PI * 100 * 4 - 4 * PI * (4 + 1 / 3);
const holes = [[10, 10], [70, 10], [10, 50], [70, 50]].map(([x, y], i) => circ('h' + i, [x, y], 4));
const S1 = { id: 'S1', plane: PLANES.XY, ents: [...rect('r', 0, 0, 80, 60), ...holes] };
const doc = { sketches: [S1], features: [{ id: 'F1', type: 'extrude', sketch: 'S1', params: { depth: 10 } }] };
let [v, , s] = vol(doc); ok('extrude', v, 48000 - 4 * PI * 160);
let bb = K.bboxOf(s);
doc.features.push({ id: 'F2', type: 'fillet', params: { radius: 5, refs: [[0, 0, 5], [80, 0, 5], [80, 60, 5], [0, 60, 5]].map(p => describe(bb, p)) } });
[v, , s] = vol(doc); ok('fillet', v, 48000 - 4 * PI * 160 - 4 * (25 - 25 * PI / 4) * 10);
bb = K.bboxOf(s);
const pl = K.facePlane(s, [40, 30, 10]);
console.log('face plane', JSON.stringify(pl));
doc.sketches.push({ id: 'S2', plane: pl, faceRef: { desc: describe(bb, [40, 30, 10]), normal: pl.normal }, ents: [circ('c', [0, 0], 10)] });
doc.features.push({ id: 'F3', type: 'extrude', sketch: 'S2', params: { depth: 4, cut: true } });
[v, , s] = vol(doc); ok('cut', v, VP(80, 10) + 4 * PI * (4 + 1 / 3));
bb = K.bboxOf(s);
doc.features.push({ id: 'F4', type: 'chamfer', params: { distance: 1, refs: [[14, 10, 10], [74, 10, 10], [14, 50, 10], [74, 50, 10]].map(p => describe(bb, p)) } });
[v] = vol(doc); ok('chamfer', v, VP(80, 10));
doc.features[0].params.depth = 15; [v] = vol(doc); ok('depth15', v, VP(80, 15));
S1.ents = [...rect('r', 0, 0, 100, 60), ...holes]; [v] = vol(doc); ok('width100', v, VP(100, 15));
doc.features[1].suppressed = true; [v] = vol(doc); ok('suppress', v, VP(100, 15, false)); doc.features[1].suppressed = false;
doc.features[1].params.radius = 40; let errs; [v, errs] = vol(doc); ok('fillet-error', v, VP(100, 15, false)); console.log('  error:', JSON.stringify(errs));
doc.features[1].params.radius = 5;
let t = performance.now(); const [, , sF] = vol(doc); const inf = K.info(sF); console.log('info ms', (performance.now() - t).toFixed(0), 'tris', inf.mesh.triangles.length / 3, 'faces', inf.faces.length, 'maxFaceIdx', Math.max(...inf.mesh.triFace), 'unmapped', inf.unmapped, 'planar', inf.faces.filter(f => f.planar).length, 'faceEdges', JSON.stringify(inf.faceEdges.slice(0, 4)), 'edges', inf.edges.groups.length);
const x3 = K.to3mfModel(sF); console.log('3mf model chars', x3.length);
// 抽壳
const sh = { sketches: [{ id: 'A', plane: PLANES.XY, ents: rect('r', 0, 0, 40, 30) }], features: [{ id: 'E', type: 'extrude', sketch: 'A', params: { depth: 20 } }] };
[v, , s] = vol(sh); sh.features.push({ id: 'Sh', type: 'shell', params: { thickness: 2, refs: [describe(K.bboxOf(s), [20, 15, 20])] } });
[v] = vol(sh); ok('shell', v, 7152);
// 旋转
const rv = { sketches: [{ id: 'B', plane: PLANES.XZ, ents: [...rect('r', 15, 0, 10, 20), { id: 'ax', type: 'line', a: [0, 0], b: [0, 30], construction: true }] }], features: [{ id: 'R', type: 'revolve', sketch: 'B', params: { axis: 'ax', angle: 360 } }] };
[v, , s] = vol(rv); ok('revolve', v, PI * 400 * 20); console.log('  bbox', JSON.stringify(K.bboxOf(s)));
rv.features[0].params.angle = 180; [v] = vol(rv); ok('revolve180', v, PI * 400 * 10);
// 弧形轮廓（长圆孔）
const slot = { sketches: [{ id: 'C', plane: PLANES.XY, ents: [{ id: 'l1', type: 'line', a: [0, 0], b: [40, 0] }, { id: 'a1', type: 'arc', c: [40, 10], r: 10, a0: -90, a1: 90 }, { id: 'l2', type: 'line', a: [40, 20], b: [0, 20] }, { id: 'a2', type: 'arc', c: [0, 10], r: 10, a0: 90, a1: 270 }] }], features: [{ id: 'E', type: 'extrude', sketch: 'C', params: { depth: 5 } }] };
[v] = vol(slot); ok('slot', v, (40 * 20 + PI * 100) * 5);
// 重模型
const hv = { sketches: [{ id: 'H', plane: PLANES.XY, ents: [...rect('r', 0, 0, 200, 200)] }], features: [{ id: 'E', type: 'extrude', sketch: 'H', params: { depth: 10 } }] };
for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) hv.sketches[0].ents.push(circ(`c${i}_${j}`, [11.25 + 22.5 * i, 11.25 + 22.5 * j], 3));
[v, , s] = vol(hv); hv.features.push({ id: 'F', type: 'fillet', params: { radius: 10, refs: [[0, 0, 5], [200, 0, 5], [200, 200, 5], [0, 200, 5]].map(p => describe(K.bboxOf(s), p)) } });
t = performance.now(); hv.features[0].params.depth = 14; [v, , s] = vol(hv); const ti = performance.now(); K.info(s);
console.log('heavy rebuild ms', (ti - t).toFixed(0), 'info ms', (performance.now() - ti).toFixed(0));
ok('heavy', v, 40000 * 14 - 64 * 9 * PI * 14 - 4 * (100 - 25 * PI) * 14);
// 投影方向：一个偏心块 x[0,30] y[0,20] z[0,10]
const blk = { sketches: [{ id: 'P', plane: PLANES.XY, ents: rect('r', 0, 0, 30, 20) }], features: [{ id: 'E', type: 'extrude', sketch: 'P', params: { depth: 10 } }] };
[, , s] = vol(blk);
for (const vw of ['front', 'top', 'left']) {
  const p = K.project(s, vw); const xs = [], ys = [];
  for (const c of p.visible) for (const q of c.type === 'line' ? [c.a, c.b] : []) { xs.push(q[0]); ys.push(q[1]); }
  console.log(vw, 'x', Math.min(...xs).toFixed(1), Math.max(...xs).toFixed(1), 'y', Math.min(...ys).toFixed(1), Math.max(...ys).toFixed(1), 'n', p.visible.length, p.hidden.length);
}
console.log(bad ? `${bad} BAD` : 'ALL OK'); console.log(planeAt([0, 0, 0], [0, -1, 0]));
