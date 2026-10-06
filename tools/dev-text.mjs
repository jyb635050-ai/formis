// 开发自测：草图文字在盒子顶面上刻字（切除）和凸字（拉伸），核对体积变化≈字形面积×深度
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import opencascade from 'replicad-opencascadejs'; import * as R from 'replicad';
import { makeKernel, PLANES, describe } from '../src/kernel/build.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const oc = await opencascade({ wasmBinary: fs.readFileSync(path.join(ROOT, 'node_modules/replicad-opencascadejs/dist/replicad_single.wasm')), print: () => { }, printErr: () => { } });
R.setOC(oc); const K = makeKernel(R);
await R.loadFont(fs.readFileSync(path.join(ROOT, 'public/fonts/NotoSansSC-GB2312.ttf')).buffer);
const rect = (id, x0, y0, w, h) => [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]].map((p, i, a) => ({ id: id + i, type: 'line', a: p, b: a[(i + 1) % 4] }));
const S1 = { id: 'S1', plane: PLANES.XY, ents: rect('r', 0, 0, 100, 40) };
const base = { sketches: [S1], features: [{ id: 'F1', type: 'extrude', sketch: 'S1', params: { depth: 10 } }] };
let r = K.rebuild(base); const bb = K.bboxOf(r.solid); const v0 = R.measureVolume(r.solid);
const S2 = { id: 'S2', faceRef: { desc: describe(bb, [50, 20, 10]), normal: [0, 0, 1] }, ents: [{ id: 'T1', type: 'text', at: [10, 14], text: '形制 Formis 6203', h: 9 }] };
for (const type of ['cut', 'extrude']) {
  const t0 = Date.now();
  r = K.rebuild({ sketches: [S1, S2], features: [...base.features, { id: 'F2', type, sketch: 'S2', params: { depth: 1 } }] });
  const v = r.solid ? R.measureVolume(r.solid) : 0;
  console.log(type, 'errors', JSON.stringify(r.errors), 'Δvol', (v - v0).toFixed(2), 'bbox', JSON.stringify(K.bboxOf(r.solid).map(p => p.map(x => +x.toFixed(2)))), (Date.now() - t0) + 'ms');
}
// 位置核对：只有文字的草图，内核包围盒 vs opentype 包围盒
{
  const ot = (await import('opentype.js')).default || await import('opentype.js');
  const f = ot.parse(fs.readFileSync(path.join(ROOT, 'public/fonts/NotoSansSC-GB2312.ttf')).buffer);
  for (const [txt, at, h] of [['ABC', [10, 14], 9], ['形制', [-5, 3], 12]]) {
    const r = K.rebuild({ sketches: [{ id: 'S9', plane: PLANES.XY, ents: [{ id: 'T', type: 'text', at, text: txt, h }] }], features: [{ id: 'F', type: 'extrude', sketch: 'S9', params: { depth: 2 } }] });
    const b = f.getPath(txt, 0, 0, h).getBoundingBox();
    console.log(txt, 'kernel', JSON.stringify(K.bboxOf(r.solid).map(p => p.slice(0, 2).map(x => +x.toFixed(2)))), 'expect', JSON.stringify([[at[0] + b.x1, at[1] - b.y2], [at[0] + b.x2, at[1] - b.y1]].map(p => p.map(x => +x.toFixed(2)))));
  }
}
// 网格核对：刻字后的顶面有没有三角形
{
  const r = K.rebuild({ sketches: [S1, S2], features: [...base.features, { id: 'F2', type: 'cut', sketch: 'S2', params: { depth: 1 } }] });
  const inf = K.info(r.solid);
  const per = new Map(); for (const f of inf.mesh.triFace) per.set(f, (per.get(f) || 0) + 1);
  const top = inf.faces.map((f, i) => [i, f]).filter(([i, f]) => f.planar && f.normal[2] === 1);
  console.log('faces', inf.faces.length, 'top faces', top.map(([i, f]) => `#${i} z=${f.d.toFixed(2)} tris=${per.get(i) || 0}`).join(', '));
}
