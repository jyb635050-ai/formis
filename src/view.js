// 视口：three.js 正交相机。右键拖动旋转（二维里是平移）、中键平移、滚轮以光标为中心缩放；拾取面/边；画实体、草图、尺寸
import * as THREE from 'three';
import { S, dimLabel, sketchById, dimPoints, dimStyle } from './doc.js';
import { toWorld, arcPoints, V } from './kernel/build.js';
import { ptOf } from './solver.js';
import { fmt } from './util.js';

const host = document.querySelector('[data-testid="viewport"]');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
host.appendChild(renderer.domElement);
renderer.domElement.className = 'gl';
const labels = document.createElement('div'); labels.className = 'labels'; host.appendChild(labels);

const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e5, 1e5);
const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6); scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 1.4); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.6); scene.add(fill);

// 相机状态：target 是屏幕中心对着的世界点，scale＝每毫米多少像素，quat 是相机朝向（看向 -Z）
const C = { target: new THREE.Vector3(30, 20, 0), quat: new THREE.Quaternion(), scale: 4, anim: null };
const isoQuat = () => quatFromDir(new THREE.Vector3(-1, 1, -1).normalize(), new THREE.Vector3(0, 0, 1));
C.quat.copy(isoQuat());
function quatFromDir(forward, up) {
  const z = forward.clone().negate().normalize();
  let x = new THREE.Vector3().crossVectors(up, z); if (x.lengthSq() < 1e-12) x = new THREE.Vector3(1, 0, 0); x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
export const VIEWS = {
  front: () => quatFromDir(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)),
  top: () => quatFromDir(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)),
  left: () => quatFromDir(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)),
  iso: isoQuat,
};

let W = 1, H = 1, dirty = true, theme = {};
function resize() {
  const r = host.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
  renderer.setSize(W, H, false); dirty = true;
}
new ResizeObserver(resize).observe(host); resize();

function applyCam() {
  cam.left = -W / 2 / C.scale; cam.right = W / 2 / C.scale; cam.top = H / 2 / C.scale; cam.bottom = -H / 2 / C.scale;
  cam.quaternion.copy(C.quat);
  const back = new THREE.Vector3(0, 0, 1).applyQuaternion(C.quat);
  cam.position.copy(C.target).addScaledVector(back, 5000);
  cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  key.position.copy(cam.position).add(new THREE.Vector3(1, 1, 2).applyQuaternion(C.quat).multiplyScalar(100));
  fill.position.copy(cam.position).add(new THREE.Vector3(-2, -1, 1).applyQuaternion(C.quat).multiplyScalar(100));
}
export function requestRender() { dirty = true; }

// 世界点 → 视口内 CSS 像素（相对整页）
export function project(p) {
  applyCam();
  const v = new THREE.Vector3(p[0], p[1], p[2]).project(cam);
  const r = host.getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * W, y: r.top + (1 - v.y) / 2 * H };
}
// 屏幕点 → 世界射线（正交：起点在平面上，方向＝视线）
function ray(x, y) {
  applyCam();
  const r = host.getBoundingClientRect();
  const nx = ((x - r.left) / W) * 2 - 1, ny = -(((y - r.top) / H) * 2 - 1);
  const o = new THREE.Vector3(nx, ny, -1).unproject(cam);
  const d = new THREE.Vector3(0, 0, -1).applyQuaternion(C.quat);
  return { o, d };
}
export function screenToPlane(pl, x, y) {
  const { o, d } = ray(x, y);
  const n = new THREE.Vector3(...pl.normal), p0 = new THREE.Vector3(...pl.origin);
  const den = n.dot(d); if (Math.abs(den) < 1e-9) return null;
  const t = n.dot(p0.clone().sub(o)) / den;
  const w = o.clone().addScaledVector(d, t).sub(p0);
  return [w.dot(new THREE.Vector3(...pl.u)), w.dot(new THREE.Vector3(...pl.v))];
}
export const toScreen = (sid, uv) => { const s = sketchById(sid); return project(toWorld(s.plane, uv)); };
export const pxPerMm = () => C.scale;
export function camDir() { return new THREE.Vector3(0, 0, -1).applyQuaternion(C.quat).toArray(); }

// ───── 相机动作 ─────
function animate(to, ms = 260) {
  const from = { target: C.target.clone(), quat: C.quat.clone(), scale: C.scale };
  C.anim = { from, to: { target: to.target ? new THREE.Vector3(...to.target) : from.target, quat: to.quat || from.quat, scale: to.scale || from.scale }, t0: performance.now(), ms };
  dirty = true;
}
function stepAnim(now) {
  const A = C.anim; if (!A) return;
  let k = Math.min(1, (now - A.t0) / A.ms); const e = 1 - Math.pow(1 - k, 3);
  C.target.lerpVectors(A.from.target, A.to.target, e);
  C.quat.slerpQuaternions(A.from.quat, A.to.quat, e);
  C.scale = A.from.scale * Math.pow(A.to.scale / A.from.scale, e);
  if (k >= 1) C.anim = null;
  dirty = true;
}
export function freeRect() {
  // 视口里没被浮动面板挡住的区域
  const r = host.getBoundingClientRect();
  let L = r.left, T = r.top, R = r.right, B = r.bottom;
  for (const el of document.querySelectorAll('[data-float]')) {
    if (!el.getClientRects().length || getComputedStyle(el).display === 'none') continue;
    const b = el.getBoundingClientRect(); if (b.width < 2) continue;
    const side = el.dataset.float;
    if (side === 'top') T = Math.max(T, b.bottom); else if (side === 'left') L = Math.max(L, b.right);
    else if (side === 'right') R = Math.min(R, b.left); else if (side === 'bottom') B = Math.min(B, b.top);
  }
  return { L: L + 12, T: T + 12, R: R - 12, B: B - 12 };
}
// 让一个世界包围盒（在给定朝向下）落进空闲区
function fitBox(points, quat, fill = 0.8) {
  const inv = quat.clone().invert();
  const pts = points.map(p => new THREE.Vector3(...p).applyQuaternion(inv));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y), zs = pts.map(p => p.z);
  const fr = freeRect(), hr = host.getBoundingClientRect();
  const fw = Math.max(50, fr.R - fr.L), fh = Math.max(50, fr.B - fr.T);
  const w = Math.max(1e-3, Math.max(...xs) - Math.min(...xs)), h = Math.max(1e-3, Math.max(...ys) - Math.min(...ys));
  const scale = Math.min((fw * fill) / w, (fh * fill) / h);
  // 空闲区中心相对视口中心的偏移（像素）→ 世界偏移
  const offx = ((fr.L + fr.R) / 2 - (hr.left + hr.right) / 2) / scale, offy = -((fr.T + fr.B) / 2 - (hr.top + hr.bottom) / 2) / scale;
  const c = new THREE.Vector3((Math.max(...xs) + Math.min(...xs)) / 2 - offx, (Math.max(...ys) + Math.min(...ys)) / 2 - offy, (Math.max(...zs) + Math.min(...zs)) / 2);
  return { target: c.applyQuaternion(quat).toArray(), scale };
}
export function viewTo(name, instant) {
  const q = VIEWS[name]();
  const pts = modelPoints() || (!S.active && shownSketchPoints());
  const to = pts ? { quat: q, ...fitBox(pts, q) } : { quat: q };
  if (instant) { C.quat.copy(q); if (to.target) { C.target.set(...to.target); C.scale = to.scale; } dirty = true; return; }
  animate(to);
}
// 正视于：相机转到正对给定平面（法向朝向屏幕外），屏幕中心和缩放不变
export function lookNormal(normal, up) {
  const n = new THREE.Vector3(...normal).normalize();
  let u = up ? new THREE.Vector3(...up) : (Math.abs(n.z) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1));
  animate({ quat: quatFromDir(n.clone().negate(), u) }, 300);
}
export function fitAll(instant) {
  const pts = modelPoints() || (S.active ? sketchPoints() : shownSketchPoints()); if (!pts) return;
  const to = fitBox(pts, C.quat);
  if (instant) { C.target.set(...to.target); C.scale = to.scale; dirty = true; } else animate(to);
}
function modelPoints() {
  const b = S.built && S.built.measure; if (!b || !(b.volume > 0)) return null;
  const P = []; for (const x of [b.bbox[0][0], b.bbox[1][0]]) for (const y of [b.bbox[0][1], b.bbox[1][1]]) for (const z of [b.bbox[0][2], b.bbox[1][2]]) P.push([x, y, z]); return P;
}
// 画面上显示的草图的实际图形范围（刷新后没有实体时用它把图居中）
function shownSketchPoints() {
  const P = [];
  for (const sid of shown) {
    const s = sketchById(sid); if (!s) continue;
    for (const e of s.ents) {
      const uv = e.type === 'line' ? [e.a, e.b] : e.type === 'text' ? [e.at] : e.c ? [[e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]] : [];
      for (const p of uv) P.push(toWorld(s.plane, p));
    }
  }
  if (!P.length) return null;
  // 太小的图（一个字、一个点）至少按 20mm 见方框，免得放大到满屏
  const lo = [0, 1, 2].map(k => Math.min(...P.map(p => p[k]))), hi = [0, 1, 2].map(k => Math.max(...P.map(p => p[k])));
  const c = lo.map((x, k) => (x + hi[k]) / 2);
  if (Math.max(...hi.map((x, k) => x - lo[k])) < 20) for (const dx of [-10, 10]) for (const dy of [-10, 10]) for (const dz of [-10, 10]) P.push([c[0] + dx, c[1] + dy, c[2] + dz]);
  return P;
}
function sketchPoints() { const s = S.active && sketchById(S.active); if (!s) return null; return [[-10, -50], [100, 60]].map(uv => toWorld(s.plane, uv)); }
// 正对草图：u∈[−10,100]、v∈[−50,60] 完整落在空闲区
export function lookAtSketch(sid, instant) {
  const s = sketchById(sid); if (!s) return;
  const pl = s.plane;
  const q = quatFromDir(new THREE.Vector3(...pl.normal).negate(), new THREE.Vector3(...pl.v));
  const corners = [[-10, -50], [100, -50], [100, 60], [-10, 60]].map(uv => toWorld(pl, uv));
  const to = { quat: q, ...fitBox(corners, q, 0.92) };
  if (instant) { C.quat.copy(q); C.target.set(...to.target); C.scale = to.scale; dirty = true; } else animate(to, 300);
}

// ───── 交互 ─────
// 视图导航（照 SolidWorks 习惯）：中键拖＝旋转、Ctrl+中键＝平移、Shift+中键＝缩放、双击中键＝全部显示；
// 右键拖＝旋转（编辑草图/二维里是平移）；三维里左键在空白处拖也能旋转，Shift+左键拖＝平移；滚轮以光标为中心缩放。
// 旋转绕模型中心转（模型中心在屏幕上不动），不是绕屏幕中心。
let handler = null; // 工具层：{down(e), move(e), up(e), dbl(e)}
export const setHandler = h => { handler = h; };
let drag = null, leftPending = null;
const el = renderer.domElement;
host.addEventListener('contextmenu', e => e.preventDefault());
// 拦住 Chrome 的"中键自动滚动"，否则中键拖动被浏览器吃掉
host.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
host.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); if (e.detail === 2 && S.mode === '3d') fitAll(); } });
// 鼠标（2026-10-06 按用户要求）：左键＝选择；中键拖＝平移（Shift+中键＝缩放）；右键拖＝旋转翻转（二维制图里没有旋转，右键也是平移）
function navMode(b, e) {
  if (b === 1) return e.shiftKey ? 'zoom' : 'pan';
  if (b === 2) return S.mode === '2d' || e.shiftKey ? 'pan' : 'orbit';
  return 'pan';
}
function pivot() {
  const b = S.built && S.built.measure;
  if (b && b.volume > 0 && model.visible) return new THREE.Vector3((b.bbox[0][0] + b.bbox[1][0]) / 2, (b.bbox[0][1] + b.bbox[1][1]) / 2, (b.bbox[0][2] + b.bbox[1][2]) / 2);
  return C.target.clone();
}
function startDrag(b, e) {
  drag = { b, x: e.clientX, y: e.clientY, mode: navMode(b, e), pivot: pivot() };
  try { host.setPointerCapture(e.pointerId); } catch (x) { }
  C.anim = null; host.classList.add('nav-' + drag.mode);
}
function endDrag(e) { if (drag) host.classList.remove('nav-' + drag.mode); drag = null; try { host.releasePointerCapture(e.pointerId); } catch (x) { } }
function navMove(dx, dy) {
  if (drag.mode === 'pan') {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(C.quat), up = new THREE.Vector3(0, 1, 0).applyQuaternion(C.quat);
    C.target.addScaledVector(right, -dx / C.scale).addScaledVector(up, dy / C.scale);
  } else if (drag.mode === 'zoom') {
    C.scale = Math.min(500, Math.max(0.02, C.scale * Math.pow(1.006, -dy)));
  } else {
    const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -dx * 0.008);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(C.quat);
    const qx = new THREE.Quaternion().setFromAxisAngle(right, -dy * 0.008);
    const q = qx.multiply(qz);
    C.quat.premultiply(q).normalize();
    // 绕模型中心转：屏幕中心对着的点跟着绕 pivot 转
    C.target.sub(drag.pivot).applyQuaternion(q).add(drag.pivot);
  }
  dirty = true;
}
host.addEventListener('pointerdown', e => {
  if (e.target.closest('.dim-label') || e.target.closest('.numbox')) return;
  if (drag) return;
  if (e.button === 1 || e.button === 2) { e.preventDefault(); startDrag(e.button, e); return; }
  if (e.button !== 0) return;
  // 三维里没在画草图：先记下来，拖动超过 4 像素就当旋转，否则松手时按"点击"处理（选草图/选边/选面）
  if (S.mode === '3d' && !S.active) { leftPending = { x: e.clientX, y: e.clientY, ev: e }; try { host.setPointerCapture(e.pointerId); } catch (x) { } return; }
  if (handler && handler.down) handler.down(e);
});
host.addEventListener('pointermove', e => {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    navMove(dx, dy); return;
  }
  if (leftPending && (e.buttons & 1)) {
    if (Math.hypot(e.clientX - leftPending.x, e.clientY - leftPending.y) > 4) leftPending.moved = true; // 拖动了就是框选，不算点击
    if (leftPending.moved && handler && handler.box) handler.box(leftPending, e, 'move');
    return;
  }
  if (handler && handler.move) handler.move(e);
});
host.addEventListener('pointerup', e => {
  if (drag && e.button === drag.b) { endDrag(e); return; }
  if (leftPending && e.button === 0) {
    const p = leftPending; leftPending = null; try { host.releasePointerCapture(e.pointerId); } catch (x) { }
    if (p.moved) { if (handler && handler.box) handler.box(p, e, 'end'); } else if (handler && handler.down) handler.down(p.ev);
    return;
  }
  if (e.button === 0 && handler && handler.up) handler.up(e);
});
host.addEventListener('pointercancel', e => { if (drag) endDrag(e); leftPending = null; });
host.addEventListener('dblclick', e => { if (handler && handler.dbl) handler.dbl(e); });
host.addEventListener('wheel', e => {
  e.preventDefault();
  if (S.mode === 'sheet') return;
  C.anim = null;
  const k = Math.pow(1.0015, -e.deltaY);
  const ns = Math.min(500, Math.max(0.02, C.scale * k));
  // 以光标为中心：光标下的世界点（视平面内）缩放前后不动
  const r = host.getBoundingClientRect();
  const cx = e.clientX - r.left - W / 2, cy = -(e.clientY - r.top - H / 2);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(C.quat), up = new THREE.Vector3(0, 1, 0).applyQuaternion(C.quat);
  const f = 1 / C.scale - 1 / ns;
  C.target.addScaledVector(right, cx * f).addScaledVector(up, cy * f);
  C.scale = ns; dirty = true;
}, { passive: false });

// ───── 实体显示与拾取 ─────
const model = new THREE.Group(); scene.add(model);
let meshObj = null, edgeObj = null, hoverFace = null, hoverEdge = null, selObj = new THREE.Group(); scene.add(selObj);
let edgeData = null, meshData = null;
const matMesh = new THREE.MeshStandardMaterial({ color: 0xb8c4d6, metalness: 0.25, roughness: 0.45, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide });
const matEdge = new THREE.LineBasicMaterial({ color: 0x1d2633 });
const matHoverFace = new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0.45, depthTest: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide });
const matSelFace = new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: THREE.DoubleSide });
const matHoverEdge = new THREE.LineBasicMaterial({ color: 0x2f8cff, depthTest: false });
const matSelEdge = new THREE.LineBasicMaterial({ color: 0xff7a00, depthTest: false });

export function setModel(B) {
  setHover(null); setSelection([]); // 旧模型上的高亮先清掉
  for (const o of [...model.children]) { model.remove(o); o.geometry && o.geometry.dispose(); }
  meshObj = edgeObj = null; meshData = B && B.mesh; edgeData = B && B.edges;
  if (meshData) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(meshData.vertices, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
    g.setIndex(new THREE.BufferAttribute(meshData.triangles, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    meshObj = new THREE.Mesh(g, matMesh); model.add(meshObj);
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(edgeData.lines, 3));
    edgeObj = new THREE.LineSegments(eg, matEdge); model.add(edgeObj);
  }
  setHover(null); dirty = true;
}
export function showModel(v) { model.visible = v; dirty = true; }

const raycaster = new THREE.Raycaster();
export function pickFace(x, y) {
  if (!meshObj || !model.visible) return null;
  const { o, d } = ray(x, y);
  raycaster.set(o.clone().addScaledVector(d, -1e4), d);
  const hit = raycaster.intersectObject(meshObj, false)[0];
  if (!hit) return null;
  const fi = meshData.triFace[hit.faceIndex];
  return { face: fi, point: hit.point.toArray(), info: S.built.faces[fi] };
}
// 边：屏幕距离 ≤ tol 像素的最近一条（被面挡住的边不算）
export function pickEdge(x, y, tol = 7) {
  if (!edgeData || !model.visible) return null;
  applyCam();
  const r = host.getBoundingClientRect(), L = edgeData.lines, m = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  const sx = p => (p.x + 1) / 2 * W + r.left, sy = p => (1 - p.y) / 2 * H + r.top;
  let best = null;
  for (let g = 0; g < edgeData.groups.length; g++) {
    const [start, count] = edgeData.groups[g];
    for (let i = start; i + 1 < start + count; i += 2) {
      v.set(L[i * 3], L[i * 3 + 1], L[i * 3 + 2]).applyMatrix4(m); w.set(L[i * 3 + 3], L[i * 3 + 4], L[i * 3 + 5]).applyMatrix4(m);
      const ax = sx(v), ay = sy(v), bx = sx(w), by = sy(w);
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const dist = Math.hypot(ax + dx * t - x, ay + dy * t - y);
      if (dist <= tol && (!best || dist < best.dist)) {
        const P = [0, 1, 2].map(k => L[i * 3 + k] + (L[i * 3 + 3 + k] - L[i * 3 + k]) * t);
        best = { dist, group: g, point: P, depth: v.z + (w.z - v.z) * t };
      }
    }
  }
  if (!best) return null;
  // 被遮挡检查：光标处射线先打到的面比这条边更靠近相机（超过容差）就不算
  const f = pickFace(x, y);
  if (f) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(C.quat);
    const s = new THREE.Vector3(...f.point).sub(new THREE.Vector3(...best.point)).dot(dir);
    if (s < -Math.max(0.5, (tol * 1.5) / C.scale)) return null;
  }
  return best;
}
// 框选模型的边（只算能看见的）：cross＝碰到框就算，否则整条边都在框里
export function edgesInBox(ax, ay, bx, by, cross) {
  if (!edgeData || !model.visible) return [];
  applyCam();
  const r = host.getBoundingClientRect(), L = edgeData.lines, m = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse), v = new THREE.Vector3();
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by), out = [];
  for (let g = 0; g < edgeData.groups.length; g++) {
    const [start, count] = edgeData.groups[g]; let any = false, all = true;
    for (let i = start; i < start + count; i++) {
      v.set(L[i * 3], L[i * 3 + 1], L[i * 3 + 2]).applyMatrix4(m);
      const sx = (v.x + 1) / 2 * W + r.left, sy = (1 - v.y) / 2 * H + r.top, inn = sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
      any = any || inn; all = all && inn;
    }
    if (cross ? any : all) out.push(g);
  }
  return out;
}
// 取一条边上的一个点（用中间的顶点，避开两端——端点是几条边共用的，按点找边会找错）
export function edgePoint(g) {
  if (!edgeData || g < 0 || g >= edgeData.groups.length) return null;
  const [start, count] = edgeData.groups[g], L = edgeData.lines;
  const P = i => [L[(start + i) * 3], L[(start + i) * 3 + 1], L[(start + i) * 3 + 2]];
  const nseg = count / 2;
  if (nseg <= 1) { const a = P(0), b = P(1); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; }
  return P(Math.floor(nseg / 2) * 2); // 第 k 段的起点＝第 k-1 段的终点，是曲线上的内部点
}
function edgeGeom(g) {
  const [start, count] = edgeData.groups[g];
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(edgeData.lines.slice(start * 3, (start + count) * 3), 3));
  return eg;
}
function faceGeom(fi) {
  const idx = []; const T = meshData.triangles;
  for (let t = 0; t < meshData.triFace.length; t++) if (meshData.triFace[t] === fi) idx.push(T[t * 3], T[t * 3 + 1], T[t * 3 + 2]);
  // 用自己的顶点缓冲（共用模型那份的话，高亮清掉时 dispose 会把模型的缓冲一起删掉）
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(meshData.vertices, 3)); g.setIndex(idx); return g;
}
let hoverKey = null;
export function setHover(h) {
  const k = h ? h.kind + ':' + (h.kind === 'edge' ? h.group : h.face) : null;
  if (k === hoverKey) return;
  hoverKey = k;
  for (const o of [hoverFace, hoverEdge]) if (o) { scene.remove(o); o.geometry.dispose(); }
  hoverFace = hoverEdge = null;
  if (h && h.kind === 'face' && meshObj) { hoverFace = new THREE.Mesh(faceGeom(h.face), matHoverFace); hoverFace.renderOrder = 2; scene.add(hoverFace); }
  if (h && h.kind === 'edge' && edgeData) { hoverEdge = new THREE.LineSegments(edgeGeom(h.group), matHoverEdge); hoverEdge.renderOrder = 3; scene.add(hoverEdge); }
  dirty = true;
}
export function setSelection(sel) {
  for (const o of [...selObj.children]) { selObj.remove(o); o.geometry.dispose(); }
  for (const s of sel || []) {
    if (s.kind === 'edge' && edgeData && s.group < edgeData.groups.length) { const o = new THREE.LineSegments(edgeGeom(s.group), matSelEdge); o.renderOrder = 4; selObj.add(o); }
    if (s.kind === 'face' && meshObj) { const o = new THREE.Mesh(faceGeom(s.face), matSelFace); o.renderOrder = 2; selObj.add(o); }
  }
  dirty = true;
}

// ───── 草图显示 ─────
const sketchGrp = new THREE.Group(); scene.add(sketchGrp);
const grid = new THREE.Group(); scene.add(grid);
let sketchState = { hover: null, sel: new Set(), preview: [], hoverSketch: null, dimPreview: null };
let shown = [];
export const shownSketches = () => shown.slice();
export function setSketchState(st) { sketchState = { ...sketchState, ...st }; drawSketches(); }
const matLine = c => new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true });
function sampleEnt(e, s) {
  if (e.type === 'line') return [[e.a, e.b]];
  const pts = [];
  if (e.type === 'circle') for (let i = 0; i <= 72; i++) pts.push([e.c[0] + e.r * Math.cos((i / 72) * 2 * Math.PI), e.c[1] + e.r * Math.sin((i / 72) * 2 * Math.PI)]);
  if (e.type === 'arc') { const p = arcPoints(e); const n = 48; for (let i = 0; i <= n; i++) { const a = ((p.a0 + ((p.a1 - p.a0) * i) / n) * Math.PI) / 180; pts.push([e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)]); } }
  const segs = []; for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]); return segs;
}
function segObj(pl, segs, color, dashed) {
  const arr = new Float32Array(segs.length * 6);
  segs.forEach((sg, i) => { const a = toWorld(pl, sg[0]), b = toWorld(pl, sg[1]); arr.set(a, i * 6); arr.set(b, i * 6 + 3); });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const m = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 2, gapSize: 1.2, depthTest: false }) : matLine(color);
  const o = new THREE.LineSegments(g, m); if (dashed) o.computeLineDistances(); o.renderOrder = 10; return o;
}
function clearGroup(gp) { for (const o of [...gp.children]) { gp.remove(o); o.geometry && o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); } }
export function drawSketches() {
  clearGroup(sketchGrp); clearGroup(grid);
  labels.querySelectorAll('.dim-label').forEach(x => x.remove());
  const show = [];
  if (S.mode === '2d' && S.active) show.push(sketchById(S.active));
  if (S.mode === '3d') {
    if (S.active) show.push(sketchById(S.active));
    else {
      const used = new Set(S.doc.features.filter(f => !f.suppressed).map(f => f.sketch)); // 特征被压缩了，它的草图要显示出来
      for (const s of S.doc.sketches) if (s.id !== S.doc.drawing2d && (!used.has(s.id) || s.id === S.selSketch)) show.push(s);
    }
  }
  shown = show.filter(Boolean).map(s => s.id);
  for (const s of show.filter(Boolean)) {
    const editing = s.id === S.active, pl = s.plane;
    if (editing) drawGrid(pl);
    const full = (s.dof || 0) === 0;
    let base = theme.sketchFull, under = theme.sketchUnder;
    if (!editing && s.id === S.selSketch) base = under = theme.select;
    else if (!editing && s.id === sketchState.hoverSketch) base = under = theme.hover;
    const normal = [], cons = [], hov = [], sel = [];
    for (const e of s.ents) {
      if (e.type === 'text') continue;
      const segs = sampleEnt(e, s);
      if (sketchState.sel.has(e.id)) sel.push(...segs); else if (sketchState.hover === e.id) hov.push(...segs); else if (e.construction) cons.push(...segs); else normal.push(...segs);
    }
    if (normal.length) sketchGrp.add(segObj(pl, normal, full ? base : under));
    if (cons.length) sketchGrp.add(segObj(pl, cons, theme.construction, true));
    if (hov.length) sketchGrp.add(segObj(pl, hov, theme.hover));
    if (sel.length) sketchGrp.add(segObj(pl, sel, theme.select));
    if (editing) {
      // 端点
      const P = [];
      for (const e of s.ents) { if (e.type === 'line') P.push(e.a, e.b); if (e.type === 'arc') { const p = arcPoints(e); P.push(p.a, p.b, e.c); } if (e.type === 'circle') P.push(e.c); }
      const arr = new Float32Array(P.length * 3); P.forEach((p, i) => arr.set(toWorld(pl, p), i * 3));
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: full ? base : under, size: 5, sizeAttenuation: false, depthTest: false })); pts.renderOrder = 11; sketchGrp.add(pts);
      // 没接上的端点标红（轮廓不封闭就拉伸不了）
      const ends = [];
      for (const e of s.ents) { if (e.construction) continue; if (e.type === 'line') ends.push(e.a, e.b); if (e.type === 'arc') { const p = arcPoints(e); ends.push(p.a, p.b); } }
      const open = ends.filter(p => ends.filter(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6).length === 1);
      if (open.length) {
        const oa = new Float32Array(open.length * 3); open.forEach((p, i) => oa.set(toWorld(pl, p), i * 3));
        const og = new THREE.BufferGeometry(); og.setAttribute('position', new THREE.BufferAttribute(oa, 3));
        const op = new THREE.Points(og, new THREE.PointsMaterial({ color: 0xe5484d, size: 9, sizeAttenuation: false, depthTest: false })); op.renderOrder = 12; sketchGrp.add(op);
      }
      // 尺寸
      if (sketchState.dimPreview) drawDim(s, sketchState.dimPreview, true, true);
      for (const e of s.ents) if (e.type === 'text') textLabel(s, e);
    }
    if (S.showDims !== false) for (const d of s.dims) drawDim(s, d, false, editing);
    if (sketchState.preview && editing && sketchState.preview.length) sketchGrp.add(segObj(pl, sketchState.preview, theme.preview));
  }
  placeLabels(); // 重建的标签立刻放到位，否则这一帧里点不中尺寸数字
  dirty = true;
}
function drawGrid(pl) {
  const segs = [], major = [];
  for (let i = -500; i <= 500; i += 10) { (i % 50 === 0 ? major : segs).push([[i, -500], [i, 500]], [[-500, i], [500, i]]); }
  const a = segObj(pl, segs, theme.grid); a.renderOrder = 1; a.material.opacity = 0.35; grid.add(a);
  const b = segObj(pl, major, theme.grid); b.renderOrder = 1; b.material.opacity = 0.7; grid.add(b);
  const ax = segObj(pl, [[[0, 0], [12, 0]]], 0xe5484d); const ay = segObj(pl, [[[0, 0], [0, 12]]], 0x30a46c); grid.add(ax, ay);
}
// 线型：把线段按图案切成小段（mm）。dashed＝虚线，dashdot＝点划线
export function patternSegs(segs, line, k) {
  if (!line || line === 'solid') return segs;
  const pat = line === 'dashed' ? [6, 3.5] : [10, 3, 1.5, 3];
  const P = pat.map(v => v / k); const out = [];
  for (const [a, b] of segs) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-9) continue;
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    let t = 0, i = 0;
    while (t < L) { const len = P[i % P.length]; if (i % 2 === 0) { const t1 = Math.min(L, t + len); out.push([[a[0] + u[0] * t, a[1] + u[1] * t], [a[0] + u[0] * t1, a[1] + u[1] * t1]]); } t += len; i++; }
  }
  return out;
}
// 尺寸：尺寸界线垂直于被标注的方向，尺寸线与之平行；数字可以沿尺寸线放，放到界线外面时尺寸线跟着延长
const clampOn = (p, l) => { const dx = l.b[0] - l.a[0], dy = l.b[1] - l.a[1], L2 = dx * dx + dy * dy || 1; let t = ((p[0] - l.a[0]) * dx + (p[1] - l.a[1]) * dy) / L2; t = Math.max(0, Math.min(1, t)); return [l.a[0] + dx * t, l.a[1] + dy * t]; };
function drawDim(s, d, preview, editing) {
  const pl = s.plane, L = dimLabel(s, d), lines = [], heads = [];
  const st = dimStyle();
  try {
    if (d.type === 'radius' || d.type === 'diameter') {
      const e = s.ents.find(x => x.id === d.refs[0]); const dir = V.norm([L[0] - e.c[0], L[1] - e.c[1], 0]);
      const p1 = [e.c[0] + dir[0] * e.r, e.c[1] + dir[1] * e.r];
      if (d.type === 'diameter') lines.push([[e.c[0] - dir[0] * e.r, e.c[1] - dir[1] * e.r], L]); else lines.push([e.c, L]);
      arrow(heads, p1, [dir[0], dir[1]], st.arrow);
      if (d.type === 'diameter') arrow(heads, [e.c[0] - dir[0] * e.r, e.c[1] - dir[1] * e.r], [-dir[0], -dir[1]], st.arrow);
    } else if (d.type === 'angle') {
      // 两线交点为圆心、到数字的距离为半径画一段圆弧
      const l1 = s.ents.find(x => x.id === d.refs[0]), l2 = s.ents.find(x => x.id === d.refs[1]);
      const u = [l1.b[0] - l1.a[0], l1.b[1] - l1.a[1]], v = [l2.b[0] - l2.a[0], l2.b[1] - l2.a[1]], den = u[0] * v[1] - u[1] * v[0];
      if (Math.abs(den) > 1e-12) {
        const t = ((l2.a[0] - l1.a[0]) * v[1] - (l2.a[1] - l1.a[1]) * v[0]) / den, X = [l1.a[0] + u[0] * t, l1.a[1] + u[1] * t];
        const r = Math.hypot(L[0] - X[0], L[1] - X[1]);
        const far = l => (Math.hypot(l.a[0] - X[0], l.a[1] - X[1]) > Math.hypot(l.b[0] - X[0], l.b[1] - X[1]) ? l.a : l.b);
        let a1 = Math.atan2(far(l1)[1] - X[1], far(l1)[0] - X[0]), a2 = Math.atan2(far(l2)[1] - X[1], far(l2)[0] - X[0]);
        let sw = a2 - a1; while (sw > Math.PI) sw -= 2 * Math.PI; while (sw < -Math.PI) sw += 2 * Math.PI;
        const n = 32; for (let i = 0; i < n; i++) { const q0 = a1 + sw * i / n, q1 = a1 + sw * (i + 1) / n; lines.push([[X[0] + r * Math.cos(q0), X[1] + r * Math.sin(q0)], [X[0] + r * Math.cos(q1), X[1] + r * Math.sin(q1)]]); }
        for (const [l, ang] of [[l1, a1], [l2, a1 + sw]]) { const e = [X[0] + r * Math.cos(ang), X[1] + r * Math.sin(ang)], fp = far(l); if (Math.hypot(fp[0] - X[0], fp[1] - X[1]) < r) lines.push([fp, e]); }
      }
    } else {
      const [p, q] = dimPoints(s, d, L);
      // 尺寸方向 u：水平尺寸＝X，竖直尺寸＝Y，其余＝两个定义点的连线
      let u = d.type === 'hdist' ? [1, 0] : d.type === 'vdist' ? [0, 1] : [q[0] - p[0], q[1] - p[1]];
      const ul = Math.hypot(u[0], u[1]) || 1; u = [u[0] / ul, u[1] / ul];
      const n = [-u[1], u[0]];
      const off = pp => (L[0] - pp[0]) * n[0] + (L[1] - pp[1]) * n[1];
      const a = [p[0] + n[0] * off(p), p[1] + n[1] * off(p)], b = [q[0] + n[0] * off(q), q[1] + n[1] * off(q)];
      const ext = k => 1.5 / Math.max(0.3, C.scale / 4) * Math.sign(k || 1);
      const E = id => s.ents.find(x => x.id === id);
      // 尺寸界线：从图形引到尺寸线（线到线、点到线时从线段上最近的点引出）
      const fromP = d.type === 'ldist' ? clampOn(p, E(d.refs[0])) : p, fromQ = (d.type === 'ldist' || d.type === 'pldist') ? clampOn(q, E(d.refs[1])) : q;
      const extTo = (from, at, k) => { const dir = [at[0] - from[0], at[1] - from[1]], dl = Math.hypot(...dir); if (dl < 1e-9) return; lines.push([from, [at[0] + dir[0] / dl * Math.abs(ext(k)), at[1] + dir[1] / dl * Math.abs(ext(k))]]); };
      extTo(fromP, a, off(p)); extTo(fromQ, b, off(q));
      lines.push([a, b]);
      const dd = [b[0] - a[0], b[1] - a[1]], len = Math.hypot(dd[0], dd[1]) || 1, du = [dd[0] / len, dd[1] / len];
      const tpos = (L[0] - a[0]) * du[0] + (L[1] - a[1]) * du[1];
      if (tpos < 0) lines.push([a, [a[0] + du[0] * tpos, a[1] + du[1] * tpos]]);
      if (tpos > len) lines.push([b, [a[0] + du[0] * tpos, a[1] + du[1] * tpos]]);
      if (len * C.scale < 28 && st.arrow === 'arrow') {
        const k = 18 / C.scale;
        lines.push([a, [a[0] - du[0] * k, a[1] - du[1] * k]], [b, [b[0] + du[0] * k, b[1] + du[1] * k]]);
        arrow(heads, a, du, st.arrow); arrow(heads, b, [-du[0], -du[1]], st.arrow);
      } else { arrow(heads, a, [-du[0], -du[1]], st.arrow); arrow(heads, b, du, st.arrow); }
    }
  } catch (e) { }
  const color = preview ? theme.hover : st.color ? new THREE.Color(st.color).getHex() : theme.dim;
  const segs = patternSegs(lines, st.line, C.scale).concat(heads);
  if (segs.length) sketchGrp.add(segObj(pl, segs, color));
  const el = document.createElement('div'); el.className = 'dim-label' + (sketchState.sel.has(d.id) ? ' sel' : '') + (preview ? ' preview' : '') + (editing === false ? ' ro' : '');
  if (!preview) { el.dataset.dim = d.id; el.dataset.sk = s.id; }
  el.style.fontSize = (st.text || 12) + 'px';
  if (st.color) el.style.color = st.color;
  el.textContent = (d.type === 'diameter' ? 'Ø' : d.type === 'radius' ? 'R' : '') + fmt(d.value) + (d.type === 'angle' ? '°' : '');
  el.dataset.wx = JSON.stringify(toWorld(pl, L)); labels.appendChild(el);
}
function arrow(segs, tip, dir, kind = 'arrow') {
  const k = 2.2 / Math.max(0.5, C.scale / 4), n = [-dir[1], dir[0]];
  if (kind === 'tick') { // 建筑斜线
    const t = [(dir[0] + n[0]) * k * 0.8, (dir[1] + n[1]) * k * 0.8];
    segs.push([[tip[0] - t[0], tip[1] - t[1]], [tip[0] + t[0], tip[1] + t[1]]]); return;
  }
  if (kind === 'dot') { const r = k * 0.45; for (let i = 0; i < 10; i++) { const a0 = i / 10 * Math.PI * 2, a1 = (i + 1) / 10 * Math.PI * 2; segs.push([[tip[0] + r * Math.cos(a0), tip[1] + r * Math.sin(a0)], [tip[0] + r * Math.cos(a1), tip[1] + r * Math.sin(a1)]]); } return; }
  const b1 = [tip[0] - dir[0] * k * 1.6 + n[0] * k * 0.5, tip[1] - dir[1] * k * 1.6 + n[1] * k * 0.5], b2 = [tip[0] - dir[0] * k * 1.6 - n[0] * k * 0.5, tip[1] - dir[1] * k * 1.6 - n[1] * k * 0.5];
  segs.push([tip, b1], [tip, b2]);
  if (kind === 'arrow') segs.push([b1, b2]);
}
function textLabel(s, e) {
  const el = document.createElement('div'); el.className = 'dim-label sk-text'; el.setAttribute('data-user-content', '');
  el.textContent = e.text; el.dataset.wx = JSON.stringify(toWorld(s.plane, e.at)); el.dataset.h = e.h; labels.appendChild(el);
}
function placeLabels() {
  const r = host.getBoundingClientRect();
  for (const el of labels.children) {
    if (!el.dataset.wx) continue;
    const p = project(JSON.parse(el.dataset.wx));
    el.style.transform = `translate(${p.x - r.left}px, ${p.y - r.top}px) translate(-50%, -50%)`;
    if (el.dataset.h) el.style.fontSize = Math.max(9, +el.dataset.h * C.scale) + 'px';
  }
}

// ───── 主题与渲染循环 ─────
export function setTheme(dark) {
  theme = dark
    ? { bg: null, model: 0x8fa3bf, edge: 0x0b1220, sketchFull: 0xe8eef7, sketchUnder: 0x5aa9ff, construction: 0x8a96a8, hover: 0xffb02e, select: 0xff7a00, preview: 0x5aa9ff, grid: 0x3a4456, dim: 0xb8c2d3 }
    : { bg: null, model: 0xbac6d8, edge: 0x1b2533, sketchFull: 0x111820, sketchUnder: 0x1f6fff, construction: 0x7d8796, hover: 0xff9500, select: 0xff6a00, preview: 0x1f6fff, grid: 0xb6c2d2, dim: 0x3a4a60 };
  matMesh.color.setHex(theme.model); matEdge.color.setHex(theme.edge);
  drawSketches(); dirty = true;
}
// 左下角坐标轴指示（像 SolidWorks 的方向指示器）
const triad = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); triad.setAttribute('class', 'triad'); triad.setAttribute('viewBox', '-40 -40 80 80');
host.appendChild(triad);
function drawTriad() {
  if (S.mode !== '3d') { triad.style.display = 'none'; return; }
  triad.style.display = '';
  const inv = C.quat.clone().invert();
  const ax = [['X', [1, 0, 0], '#e5484d'], ['Y', [0, 1, 0], '#30a46c'], ['Z', [0, 0, 1], '#3e82f7']].map(([n, v, c]) => { const w = new THREE.Vector3(...v).applyQuaternion(inv); return { n, c, x: w.x * 26, y: -w.y * 26, z: w.z }; });
  ax.sort((a, b) => a.z - b.z);
  triad.innerHTML = ax.map(a => `<line x1="0" y1="0" x2="${a.x.toFixed(1)}" y2="${a.y.toFixed(1)}" stroke="${a.c}" stroke-width="2.4" stroke-linecap="round"/><text x="${(a.x * 1.28).toFixed(1)}" y="${(a.y * 1.28 + 4).toFixed(1)}" fill="${a.c}" font-size="11" font-weight="700" text-anchor="middle">${a.n}</text>`).join('') + '<circle r="2.6" fill="currentColor"/>';
}
let lastW = 0;
function loop(now) {
  stepAnim(now);
  if (dirty) { dirty = false; applyCam(); renderer.render(scene, cam); placeLabels(); drawTriad(); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
export const camState = () => ({ target: C.target.toArray(), quat: C.quat.toArray(), scale: C.scale });
