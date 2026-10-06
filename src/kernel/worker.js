// 几何内核后台线程：OpenCascade 只在这里跑，主线程只收网格，界面不卡
import opencascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import * as R from 'replicad';
import { zipSync, strToU8 } from 'fflate';
import { makeKernel } from './build.js';

let K = null, solid = null;
const queue = [];
let busy = false;
const ready = (async () => {
  const oc = await opencascade({ locateFile: () => wasmUrl, print: () => { }, printErr: () => { } });
  R.setOC(oc);
  K = makeKernel(R);
  postMessage({ type: 'ready' });
})();

onmessage = e => { queue.push(e.data); pump(); };

async function pump() {
  if (busy) return;
  busy = true;
  await ready;
  while (queue.length) {
    const msg = queue.shift();
    // 后面还有更新的重建请求，这次直接跳过（拖尺寸时只算最后一次）
    if (msg.type === 'build' && queue.some(q => q.type === 'build')) { postMessage({ type: 'skipped', ver: msg.ver }); continue; }
    // 草图里有文字：先把字体载进内核（只载一次）
    if (msg.type === 'build' && msg.doc && msg.doc.font && !R.getFont()) { try { await R.loadFont(msg.doc.font); } catch (e) { } }
    try { handle(msg); }
    catch (err) { postMessage({ type: 'fail', id: msg.id, ver: msg.ver, error: String((err && err.message) || err) }); }
  }
  busy = false;
}

const CT = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
const RELS = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';

function handle(msg) {
  if (msg.type === 'build') {
    const t0 = performance.now();
    const old = solid;
    const r = K.rebuild(msg.doc);
    solid = r.solid;
    if (old && old !== solid) { try { old.delete(); } catch (e) { } }
    const inf = K.info(solid);
    const tr = [];
    if (inf.mesh) tr.push(inf.mesh.vertices.buffer, inf.mesh.normals.buffer, inf.mesh.triangles.buffer, inf.mesh.triFace.buffer, inf.edges.lines.buffer);
    postMessage({ type: 'built', ver: msg.ver, errors: r.errors, planes: r.planes, ms: performance.now() - t0, ...inf }, tr);
  } else if (msg.type === 'export') {
    if (!solid) throw new Error('还没有实体可以导出');
    let bytes;
    if (msg.fmt === '3mf') bytes = zipSync({ '[Content_Types].xml': strToU8(CT), '_rels/.rels': strToU8(RELS), '3D/3dmodel.model': strToU8(K.to3mfModel(solid)) });
    else if (msg.fmt === 'step') {
      const b = solid.blobSTEP();
      return b.arrayBuffer().then(ab => postMessage({ type: 'done', id: msg.id, bytes: ab }, [ab]));
    } else throw new Error('不支持的格式 ' + msg.fmt);
    postMessage({ type: 'done', id: msg.id, bytes: bytes.buffer }, [bytes.buffer]);
  } else if (msg.type === 'project') {
    if (!solid) throw new Error('还没有实体');
    const views = {};
    for (const v of ['front', 'top', 'left', 'iso']) views[v] = K.project(solid, v);
    views.iso.hidden = [];
    postMessage({ type: 'done', id: msg.id, views, bbox: K.bboxOf(solid) });
  }
}
