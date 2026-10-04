// 判卷工具（冻结）：用判卷自己的一份 OpenCascade 独立读网站导出的 STEP，输出体积与包围盒 JSON。
// 用法：node tools/judge/step_volume.mjs 文件.step
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const log = console.log; console.log = () => {}; // OCC 往 stdout 打统计，屏蔽
try {
  const { default: opencascade } = await import('replicad-opencascadejs');
  const R = await import('replicad');
  const oc = await opencascade({ wasmBinary: fs.readFileSync(path.join(here, 'node_modules/replicad-opencascadejs/dist/replicad_single.wasm')), print: () => {}, printErr: () => {} });
  R.setOC(oc);
  const shape = await R.importSTEP(new Blob([fs.readFileSync(process.argv[2])]));
  const bb = shape.boundingBox;
  log(JSON.stringify({ ok: true, volume: R.measureVolume(shape), bbox: [bb.bounds[0], bb.bounds[1]] }));
} catch (e) {
  log(JSON.stringify({ ok: false, error: String(e && e.message || e).slice(0, 200) }));
}
process.exit(0);
