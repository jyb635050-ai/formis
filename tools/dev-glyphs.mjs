// 开发实验：逐个字符刻在方块上，找出网格失败的字形
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import opencascade from 'replicad-opencascadejs'; import * as R from 'replicad';
import { makeKernel, PLANES } from '../src/kernel/build.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const oc = await opencascade({ wasmBinary: fs.readFileSync(path.join(ROOT, 'node_modules/replicad-opencascadejs/dist/replicad_single.wasm')), print: () => { }, printErr: () => { } });
R.setOC(oc); const K = makeKernel(R);
await R.loadFont(fs.readFileSync(path.join(ROOT, 'public/fonts/NotoSansSC-GB2312.ttf')).buffer);
const rect = (id, x0, y0, w, h) => [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]].map((p, i, a) => ({ id: id + i, type: 'line', a: p, b: a[(i + 1) % 4] }));
const top = { origin: [0, 0, 10], normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] };
const chars = process.argv[2] || 'PHJY6203ABCDEFGOQRSabdegopq形制轴承零件';
const h = +(process.argv[3] || 9);
const bad = [];
for (const ch of chars) {
  const r = K.rebuild({ sketches: [{ id: 'S1', plane: PLANES.XY, ents: rect('r', 0, 0, 30, 30) }, { id: 'S2', plane: top, ents: [{ id: 'T', type: 'text', at: [5, 8], text: ch, h }] }], features: [{ id: 'F1', type: 'extrude', sketch: 'S1', params: { depth: 10 } }, { id: 'F2', type: 'cut', sketch: 'S2', params: { depth: 1 } }] });
  const s = r.solid, m = s.mesh({ tolerance: 0.02, angularTolerance: 0.15 }); const ids = new Set(m.faceGroups.filter(g => g.count).map(g => g.faceId));
  const n = s.faces.filter(f => !ids.has(f.hashCode)).length; if (n) bad.push(ch + ':' + n);
}
console.log('h', h, 'bad', bad.join(' ') || 'none');
