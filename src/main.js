import './style.css';
import { S, on, emit, ops, txn, undo, redo, loadSaved, loadDoc, resetDoc, sketchById, featById, sketchView, refOf, saveNow, beginLive, endLive, dimStyle } from './doc.js';
import { initSolver } from './solver.js';
import { createKernel } from './kernel/client.js';
import * as view from './view.js';
import { T, setTool, setPick, setToast, closeDimEditor, setOnEditSketch, clearSel3d, faceToEdges } from './tools.js';
import { sketchLoops } from './kernel/build.js';
import { t, getLang, setLang, featName } from './i18n.js';
import { $, $$, h, fmt, download, safeName } from './util.js';
import { sketchDrawing, toDxf, toSvg, toPdf, sketchPage } from './export.js';
import { buildSheet } from './sheet.js';

const ready = { ui: false, kernel: false };

// ───── 提示 ─────
let toastT = null;
function toast(msg, bad) { const el = $('#toast'); el.textContent = msg; el.classList.toggle('bad', !!bad); el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, bad ? 3600 : 2000); }
setToast(toast);

// ───── 主题与语言 ─────
function applyTheme() { const dark = document.documentElement.dataset.theme === 'dark'; view.setTheme(dark); }
$('[data-testid="theme"]').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next; try { localStorage.setItem('glasscad.theme', next); } catch (e) { }
  applyTheme(); renderSheet();
});
$('[data-testid="lang"]').addEventListener('click', () => { setLang(getLang() === 'zh' ? 'en' : 'zh'); applyLang(); });
function applyLang() {
  document.documentElement.lang = getLang() === 'zh' ? 'zh-CN' : 'en';
  for (const el of $$('[data-i]')) el.textContent = t(el.dataset.i);
  for (const el of $$('[data-ti]')) { const s = t(el.dataset.ti); el.title = s; el.setAttribute('aria-label', s); if (el.closest('.bar')) el.dataset.tip = s; }
  $('#pname').placeholder = t('untitled');
  renderTree(); renderProps(); renderStatus(); if (S.mode === 'sheet') renderSheet();
}

// ───── 内核 ─────
const kernel = createKernel({
  onReady() { ready.kernel = true; renderStatus(); },
  onBuilt(m) {
    S.built = m;
    if (T.sel3d && T.sel3d.length) { T.sel3d = []; emit('sel3d'); }
    for (const [sid, pl] of Object.entries(m.planes || {})) { const s = sketchById(sid); if (s) s.plane = pl; }
    view.setModel(m.mesh ? m : null);
    renderTree(); renderInfo(); if (P && P.live) updatePropsError();
    if (S.mode === 'sheet') refreshSheet();
    view.drawSketches();
    // 刷新后第一次重建完：模型（没有实体就用显示着的草图）居中放进画面
    if (firstModel && (m.mesh || (S.mode === '3d' && !S.active))) { firstModel = false; view.viewTo('iso', true); }
  },
});
let firstModel = true;
function payload() {
  const used = new Set(S.doc.features.map(f => f.sketch).filter(Boolean));
  return {
    sketches: S.doc.sketches.filter(s => used.has(s.id)).map(s => ({ id: s.id, plane: s.faceRef ? null : s.plane, faceRef: s.faceRef || null, ents: s.ents })),
    features: S.doc.features.map(f => ({ id: f.id, type: f.type, sketch: f.sketch, params: f.params, suppressed: !!f.suppressed })),
  };
}
function schedule() { if (S.dragging) return; kernel.build(payload()); }
on(w => {
  if (w === 'doc' || w === 'all') { schedule(); renderTree(); renderInfo(); renderStatus(); $('#pname').value = S.doc.name || ''; }
  if (w === 'all' || w === 'sketch' || w === 'doc') { view.drawSketches(); syncMode(); }
  if (w === 'pick' || w === 'all') renderProps();
  if (w === 'selSketch') renderTree();
  if (w === 'sel3d') { if (!T.pick) view.setSelection(T.sel3d); renderStatus(); }
  if ((w === 'doc' || w === 'all') && S.mode === 'sheet' && SH.proj) layoutSheet();
  if (w === 'sketch' || w === 'all') renderStatus();
});
const idle = async () => { await kernel.idle(); await new Promise(r => setTimeout(r, 0)); await kernel.idle(); };

// ───── 工作区 ─────
function setMode(m) {
  if (!['2d', '3d', 'sheet'].includes(m)) throw new Error('工作区只能是 2d/3d/sheet');
  closeDimEditor(); setPick(null); closeProps();
  if (m === '2d') {
    let sid = S.doc.drawing2d && sketchById(S.doc.drawing2d) ? S.doc.drawing2d : null;
    if (!sid) { sid = ops.sketch('XY'); S.doc.drawing2d = sid; saveNow(); }
    S.active = sid; S.mode = '2d'; syncMode(); setTool('select');
    view.showModel(false); requestAnimationFrame(() => view.lookAtSketch(sid, true));
  } else if (m === '3d') {
    if (S.mode === '2d' && S.active === S.doc.drawing2d) S.active = null;
    if (S.mode === 'sheet' && S.resume && sketchById(S.resume)) { S.active = S.resume; S.selSketch = S.resume; }
    S.resume = null;
    S.mode = '3d'; syncMode(); view.showModel(true);
    if (S.active) requestAnimationFrame(() => view.lookAtSketch(S.active, true)); else view.viewTo('iso', true);
  } else {
    if (S.mode === '2d' && S.active === S.doc.drawing2d) S.active = null;
    S.resume = S.mode === '3d' ? S.active : null; // 回到三维时接着编辑这张草图
    if (S.active) ops.finish();
    S.mode = 'sheet'; syncMode(); refreshSheet();
  }
  view.drawSketches(); renderStatus();
}
function syncMode() {
  document.body.classList.toggle('m2d', S.mode === '2d'); document.body.classList.toggle('m3d', S.mode === '3d'); document.body.classList.toggle('msheet', S.mode === 'sheet');
  for (const b of $$('[data-mode]')) b.classList.toggle('on', b.dataset.mode === S.mode);
  $('#sheetview').hidden = S.mode !== 'sheet'; $('#sheetbar').hidden = S.mode !== 'sheet';
  $('[data-testid="sketch-done"]').classList.toggle('on', !!S.active && S.mode === '3d');
}
for (const b of $$('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));

// ───── 草图工具按钮 ─────
for (const b of $$('[data-tool]')) b.addEventListener('click', () => {
  if (!S.active && S.mode !== '2d') {
    // 三维里没在编辑草图：选中的空草图就进去编辑，否则先选平面新建草图，选完自动切到这个工具
    const sel = S.selSketch && sketchById(S.selSketch);
    if (sel && !S.doc.features.some(f => f.sketch === sel.id)) { editSketch(sel.id); setTool(b.dataset.tool); return; }
    T.pendingTool = b.dataset.tool;
    const f = selectedPlanarFace();
    if (f) { clearSel3d(); createSketch({ face: f.point }); return; }
    startNewSketch(); return;
  }
  setTool(b.dataset.tool);
});
function editSketch(sid, opt = {}) { if (S.mode !== '3d') setMode('3d'); closeProps(); setPick(null); S.active = sid; S.selSketch = sid; setTool('select'); emit('sketch'); renderTree(); if (!opt.keepView) view.lookAtSketch(sid); }
setOnEditSketch(editSketch);
$('#tool-construction').addEventListener('click', () => {
  if (!S.active || !T.sel.size) return;
  const s = sketchById(S.active); const ids = [...T.sel];
  txn(() => ids.forEach(id => { const e = s.ents.find(x => x.id === id); if (e) ops.construction(id, !e.construction); }));
});
function startNewSketch() {
  if (S.mode !== '3d') setMode('3d');
  if (S.active) ops.finish(S.active);
  if (P && P.live) endLive(false);
  openProps({ kind: 'plane' });
  setPick({ kind: 'plane', sel: [], onPick: p => createSketch(p) });
}
function selectedPlanarFace() { const f = T.sel3d.length === 1 && T.sel3d[0].kind === 'face' && T.sel3d[0].planar ? T.sel3d[0] : null; return f; }
$('[data-testid="new-sketch"]').addEventListener('click', () => {
  T.pendingTool = null;
  const f = selectedPlanarFace();
  if (f && S.mode === '3d' && !S.active) { clearSel3d(); return createSketch({ face: f.point }); }
  startNewSketch();
});
$('[data-testid="sketch-done"]').addEventListener('click', () => { if (S.active) { ops.finish(S.active); setTool('select'); } closeProps(); setPick(null); renderTree(); });
async function createSketch(plane) {
  try {
    if (plane.face) await idle();
    const sid = ops.sketch(plane);
    setPick(null); closeProps(); setTool(T.pendingTool || 'rect'); T.pendingTool = null;
    requestAnimationFrame(() => view.lookAtSketch(sid));
  } catch (e) { toast(e.message, true); }
}

// ───── 特征面板（相当于 SolidWorks 的属性管理器）─────
let P = null; // {kind, feat?, edit?: fid, values}
const FEAT = {
  extrude: { fields: [['depth', 'feat-depth', 10]], checks: ['reverse'] },
  cut: { fields: [['depth', 'feat-depth', 5]], checks: ['through', 'reverse'] },
  revolve: { fields: [['angle', 'feat-angle', 360]], axis: true },
  fillet: { fields: [['radius', 'feat-radius', 2]], pick: 'edges' },
  chamfer: { fields: [['distance', 'feat-distance', 1]], pick: 'edges' },
  shell: { fields: [['thickness', 'feat-thickness', 2]], pick: 'faces' },
};
function openProps(p) { P = p; renderProps(); }
function closeProps() { P = null; $('#props').hidden = true; $('#props').innerHTML = ''; }
function renderProps() {
  const box = $('#props');
  if (!P) { box.hidden = true; return; }
  const focused = document.activeElement && box.contains(document.activeElement) ? document.activeElement.dataset.testid : null;
  box.hidden = false; box.innerHTML = '';
  if (P.kind === 'plane') {
    box.append(h('h3', {}, t('new-sketch')), h('div', { class: 'hint' }, t('pickPlane')));
    for (const pl of ['XY', 'XZ', 'YZ']) box.append(h('button', { class: 'pl', 'data-testid': 'plane-' + pl, onclick: () => createSketch(pl) }, t('plane-' + pl)));
    box.append(h('div', { class: 'btns' }, h('button', { 'data-testid': 'feat-cancel', onclick: () => { T.pendingTool = null; setPick(null); closeProps(); } }, t('cancel'))));
    return;
  }
  const spec = FEAT[P.feat];
  box.append(h('h3', {}, t('feat-' + P.feat)));
  if (spec.pick) box.append(h('div', { class: 'hint' }, `${t(spec.pick === 'edges' ? 'pickEdges' : 'pickFaces')} · ${t('selected')} ${T.pick ? T.pick.sel.length : 0}`));
  for (const [k, tid, def] of spec.fields) {
    const inp = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'num', 'data-testid': tid, value: String(P.values[k] ?? def) });
    inp.addEventListener('input', () => { P.values[k] = parseFloat(inp.value); live(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') okProps(); if (e.key === 'Escape') cancelProps(); e.stopPropagation(); });
    box.append(h('label', { class: 'row' }, h('span', {}, t(k)), inp));
  }
  for (const c of spec.checks || []) {
    const cb = h('input', { type: 'checkbox', checked: !!P.values[c] });
    cb.addEventListener('change', () => { P.values[c] = cb.checked; live(); });
    box.append(h('label', { class: 'row' }, h('span', {}, t(c)), cb));
  }
  if (spec.axis) {
    const s = sketchById(P.sketch); const lines = s ? s.ents.filter(e => e.type === 'line') : [];
    const sel = h('select', {}, lines.map(l => h('option', { value: l.id, selected: l.id === P.values.axis }, `${l.id}${l.construction ? ' ·' : ''}`)));
    sel.addEventListener('change', () => { P.values.axis = sel.value; live(); });
    box.append(h('label', { class: 'row' }, h('span', {}, t('axis')), sel));
  }
  box.append(h('div', { class: 'err', hidden: true }));
  updatePropsError();
  box.append(h('div', { class: 'btns' }, h('button', { 'data-testid': 'feat-cancel', onclick: cancelProps }, t('cancel')), h('button', { class: 'pri', 'data-testid': 'feat-ok', onclick: okProps }, t('ok'))));
  if (focused) { const f = box.querySelector(`[data-testid="${focused}"]`); if (f) { f.focus(); try { f.setSelectionRange(f.value.length, f.value.length); } catch (e) { } } }
}
// 重建完成后只更新错误提示，不重画输入框（重画会把光标甩到最前面）
function updatePropsError() {
  const el = $('#props .err'); if (!el || !P) return;
  const err = P.error || (P.fid && S.built && S.built.errors && S.built.errors[P.fid]);
  el.hidden = !err; el.textContent = err ? (/封闭轮廓/.test(err) ? err + '。' + t('profileOpen') : err) : '';
}
function paramsOf(spec, v) { const p = {}; for (const [k] of spec.fields) p[k] = v[k]; for (const c of spec.checks || []) p[c] = !!v[c]; if (spec.axis) p.axis = v.axis; return p; }
// 面板开着时边改边重建（实时预览）；整个面板算一步撤销
function live() {
  if (!P || !P.live || !P.fid) return;
  const spec = FEAT[P.feat];
  for (const [k] of spec.fields) if (!(P.values[k] > 0)) return;
  P.error = null; ops.setParam(P.fid, paramsOf(spec, P.values));
}
function cancelProps() { if (P && P.live) endLive(false); setPick(null); closeProps(); }
async function okProps() {
  if (!P || P.kind === 'plane') return;
  const v = P.values, spec = FEAT[P.feat];
  try {
    for (const [k] of spec.fields) if (!(v[k] > 0)) throw new Error(t(k) + ' > 0');
    if (P.live) {
      live(); await idle();
      const err = S.built && S.built.errors && S.built.errors[P.fid];
      if (err) { P.error = err; updatePropsError(); toast(err, true); return; }
      endLive(true);
    } else {
      const pts = T.pick.sel.map(q => q.point);
      if (!pts.length) throw new Error(t(spec.pick === 'edges' ? 'pickEdges' : 'pickFaces'));
      let fid;
      if (P.feat === 'fillet') fid = await api.cmd.fillet({ radius: v.radius, edges: pts });
      if (P.feat === 'chamfer') fid = await api.cmd.chamfer({ distance: v.distance, edges: pts });
      if (P.feat === 'shell') fid = await api.cmd.shell({ thickness: v.thickness, faces: pts });
      await idle();
      const err = S.built && S.built.errors && S.built.errors[fid];
      if (err) { undo(); await idle(); throw new Error(err); }
    }
    setPick(null); closeProps();
  } catch (e) { P.error = e.message; updatePropsError(); toast(e.message, true); }
}
// 找特征要用的草图：正在编辑的 → 选中的 → 最近一张还没用过、有封闭轮廓的
function sketchForFeature() {
  if (S.active) return S.active;
  if (S.selSketch && sketchById(S.selSketch)) return S.selSketch;
  const used = new Set(S.doc.features.map(f => f.sketch));
  const cand = S.doc.sketches.filter(s => s.id !== S.doc.drawing2d && !used.has(s.id) && s.ents.length);
  const closed = cand.filter(s => { try { return sketchLoops(s).length > 0; } catch (e) { return false; } });
  const pick = (closed.length ? closed : cand).slice(-1)[0];
  if (pick) toast(t('autoSketch'));
  return pick ? pick.id : null;
}
for (const b of $$('[data-feat]')) b.addEventListener('click', () => {
  if (S.mode !== '3d') setMode('3d');
  if (P && P.live) endLive(false);
  const feat = b.dataset.feat, spec = FEAT[feat];
  setPick(null); closeProps();
  if (spec.pick) {
    if (!(S.built && S.built.measure.volume > 0)) return toast(t('needSolid'), true);
    if (S.active) ops.finish(S.active);
    // 先选后做：已选的面/边直接带进来（圆角/倒角时，选面＝这个面的所有边）
    let pre = [];
    if (spec.pick === 'edges') { for (const x of T.sel3d) for (const y of (x.kind === 'edge' ? [x] : faceToEdges(x.face))) if (!pre.some(z => z.group === y.group)) pre.push(y); }
    else pre = T.sel3d.filter(x => x.kind === 'face');
    T.sel3d = [];
    openProps({ kind: 'feat', feat, values: {} });
    setPick({ kind: spec.pick, sel: pre });
    if (pre.length) setTimeout(() => { const i = $('#props input.num'); i && i.focus(); i && i.select(); }, 30);
    return;
  }
  const sid = sketchForFeature();
  if (!sid || !sketchById(sid)) return toast(t('needSketch'), true);
  if (S.active) ops.finish(S.active);
  const values = {};
  for (const [k, , def] of spec.fields) values[k] = def;
  if (spec.axis) { const s = sketchById(sid); const lines = s.ents.filter(e => e.type === 'line'); const ax = lines.find(l => l.construction) || lines[0]; values.axis = ax && ax.id; }
  beginLive();
  let fid;
  try {
    if (feat === 'revolve') fid = api.cmd.revolve(sid, { axis: values.axis, angle: values.angle });
    else fid = api.cmd.extrude(sid, { depth: values.depth, cut: feat === 'cut', through: false, reverse: false });
  } catch (e) { endLive(false); return toast(e.message, true); }
  openProps({ kind: 'feat', feat, sketch: sid, values, live: true, fid });
  setTimeout(() => { const i = $('#props input.num'); i && i.focus(); i && i.select(); }, 30);
});
function editFeature(fid) {
  const f = featById(fid); if (!f) return;
  if (P && P.live) endLive(false);
  const feat = f.type === 'extrude' && f.params.cut ? 'cut' : f.type;
  setPick(null);
  const values = { ...f.params };
  beginLive();
  openProps({ kind: 'feat', feat, edit: fid, sketch: f.sketch, values, live: true, fid });
  setTimeout(() => { const i = $('#props input.num'); i && i.focus(); i && i.select(); }, 30);
}

// ───── 特征树 ─────
const icoEye = '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const icoDel = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
function renderTree() {
  const box = $('#treelist'); if (!box) return;
  box.innerHTML = '';
  const F = S.doc.features, errs = (S.built && S.built.errors) || {};
  if (!F.length && !S.doc.sketches.some(s => s.id !== S.doc.drawing2d)) box.append(h('div', { class: 'empty' }, t('noFeatures')));
  const usedSk = new Set();
  for (const f of F) {
    const err = errs[f.id];
    const row = h('div', { class: 'ti' + (f.suppressed ? ' sup' : ''), 'data-testid': 'tree-item', 'data-id': f.id, 'data-error': err ? '' : null, title: err || '' },
      h('span', { class: 'nm' }, featName(f, F)), err ? h('span', { class: 'err' }, '⚠') : null);
    const eye = h('button', { class: 'mini', title: t(f.suppressed ? 'unsuppress' : 'suppress') }); eye.innerHTML = icoEye; eye.onclick = e => { e.stopPropagation(); ops.suppress(f.id, !f.suppressed); };
    const del = h('button', { class: 'mini', title: t('del') }); del.innerHTML = icoDel; del.onclick = e => { e.stopPropagation(); ops.del(f.id); };
    row.append(eye, del);
    row.addEventListener('click', () => { if (f.sketch) { S.selSketch = f.sketch; renderTree(); view.drawSketches(); } });
    row.addEventListener('dblclick', () => editFeature(f.id));
    box.append(row);
    if (f.sketch && !usedSk.has(f.sketch)) { usedSk.add(f.sketch); box.append(sketchRow(f.sketch, true)); }
  }
  for (const s of S.doc.sketches) if (!usedSk.has(s.id) && s.id !== S.doc.drawing2d) box.append(sketchRow(s.id, false));
}
function sketchRow(sid, child) {
  const n = S.doc.sketches.filter(s => s.id !== S.doc.drawing2d).findIndex(s => s.id === sid) + 1;
  const row = h('div', { class: 'ti' + (child ? ' child' : '') + (S.selSketch === sid || S.active === sid ? ' sel' : ''), 'data-testid': 'tree-sketch', 'data-id': sid }, h('span', { class: 'nm' }, `${t('sketch')}${n}`));
  if (!child) { const del = h('button', { class: 'mini', title: t('del') }); del.innerHTML = icoDel; del.onclick = e => { e.stopPropagation(); ops.del(sid); }; row.append(del); }
  row.addEventListener('click', () => { S.selSketch = sid; renderTree(); view.drawSketches(); });
  row.addEventListener('dblclick', () => { if (S.mode !== '3d') setMode('3d'); S.active = sid; S.selSketch = sid; setTool('select'); emit('sketch'); view.lookAtSketch(sid); });
  return row;
}
function renderInfo() {
  const m = S.built && S.built.measure, box = $('#info'); if (!box) return;
  box.innerHTML = '';
  if (!m || !(m.volume > 0)) return;
  const sz = [0, 1, 2].map(i => fmt(m.bbox[1][i] - m.bbox[0][i])).join(' × ');
  box.append(h('span', {}, t('volume')), h('b', {}, fmt(m.volume) + ' mm³'), h('span', {}, t('area')), h('b', {}, fmt(m.area) + ' mm²'), h('span', {}, t('size')), h('b', {}, sz + ' mm'));
}
function renderStatus() {
  const el = $('#status'); if (!el) return;
  let s = S.mode === '2d' ? t('status2d') : S.mode === 'sheet' ? t('statusSheet') : t('status3d');
  const a = S.active && sketchById(S.active);
  if (a) s += ` · ${t('dof')} ${a.dof || 0}（${(a.dof || 0) === 0 ? t('fully') : t('under')}）`;
  if (a) s += ' · ' + t('keys');
  if (!ready.kernel) s = t('kernelLoading') + ' · ' + s;
  if (S.mode === '3d' && !S.active && T.sel3d && T.sel3d.length) {
    const ne = T.sel3d.filter(x => x.kind === 'edge').length, nf = T.sel3d.length - ne;
    el.innerHTML = ''; el.append(h('b', { class: 'selinfo' }, t('selNow').replace('{e}', ne).replace('{f}', nf)), ' ' + t('selNext')); return;
  }
  el.textContent = s;
}

// ───── 尺寸样式 ─────
function syncDimStyle() {
  const st = dimStyle();
  $('#ds-line').value = st.line; $('#ds-arrow').value = st.arrow;
  $('#ds-color').value = st.color || (document.documentElement.dataset.theme === 'dark' ? '#b8c2d3' : '#3a4a60');
  $('#ds-text').value = st.text; $('#ds-text-v').textContent = st.text + 'px';
  $('#ds-show').checked = S.showDims !== false;
}
$('#dim-style-btn').addEventListener('click', () => { const p = $('#dimstyle'); p.hidden = !p.hidden; $('#dim-style-btn').classList.toggle('on', !p.hidden); syncDimStyle(); });
$('#ds-line').addEventListener('change', e => ops.setDimStyle({ line: e.target.value }));
$('#ds-arrow').addEventListener('change', e => ops.setDimStyle({ arrow: e.target.value }));
$('#ds-color').addEventListener('change', e => ops.setDimStyle({ color: e.target.value }));
$('#ds-color-reset').addEventListener('click', e => { e.preventDefault(); ops.setDimStyle({ color: '' }); syncDimStyle(); });
$('#ds-text').addEventListener('input', e => { $('#ds-text-v').textContent = e.target.value + 'px'; });
$('#ds-text').addEventListener('change', e => ops.setDimStyle({ text: +e.target.value }));
// 一键显示/隐藏全部尺寸（左侧工具条的眼睛按钮；尺寸样式面板里的勾选框同步）
function setShowDims(v, quiet) {
  S.showDims = v; try { localStorage.setItem('glasscad.showDims', v ? '1' : '0'); } catch (e) { }
  $('#ds-show').checked = v; $('#dims-toggle').classList.toggle('off', !v);
  view.drawSketches(); if (!quiet) toast(t(v ? 'dimsShown' : 'dimsHidden'));
}
$('#ds-show').addEventListener('change', e => setShowDims(e.target.checked, true));
$('#dims-toggle').addEventListener('click', () => setShowDims(S.showDims === false));
try { if (localStorage.getItem('glasscad.showDims') === '0') setShowDims(false, true); } catch (e) { }
on(w => { if (w === 'showDims') setShowDims(S.showDims !== false, true); });
document.addEventListener('pointerdown', e => { const p = $('#dimstyle'); if (!p.hidden && !p.contains(e.target) && !e.target.closest('#dim-style-btn')) { p.hidden = true; $('#dim-style-btn').classList.remove('on'); } });

// ───── 正视于：选中的平面 → 正在编辑/选中的草图 ─────
$('#view-normal').addEventListener('click', () => {
  if (S.mode !== '3d') setMode('3d');
  const f = T.sel3d && T.sel3d.find(x => x.kind === 'face' && x.planar);
  if (f && S.built && S.built.faces[f.face]) return view.lookNormal(S.built.faces[f.face].normal);
  const sid = S.active || S.selSketch, sk = sid && sketchById(sid);
  if (sk) return view.lookNormal(sk.plane.normal, sk.plane.v);
  toast(t('normalNeed'), true);
});
// ───── 视图按钮 ─────
for (const b of $$('[data-view]')) b.addEventListener('click', () => { if (S.mode !== '3d') setMode('3d'); const v = b.dataset.view; if (v === 'fit') view.fitAll(); else view.viewTo(v); });

// ───── 项目名、保存、打开、撤销 ─────
$('#pname').addEventListener('change', e => ops.rename(e.target.value.trim()));
$('#pname').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
$('[data-testid="save"]').addEventListener('click', () => download(new Blob([JSON.stringify(S.doc, null, 1)], { type: 'application/json' }), safeName(S.doc.name || t('untitled')) + '.glasscad.json'));
$('[data-testid="open"]').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { await api.load(JSON.parse(await f.text())); toast(t('opened')); } catch (err) { toast(err.message, true); }
});
$('#undo').addEventListener('click', () => api.undo());
$('#redo').addEventListener('click', () => api.redo());
window.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); api.undo(); }
  else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); api.redo(); }
  else if (e.key === 'Escape' && P) cancelProps();
});

// ───── 导出 ─────
function currentSketchForExport() { const sid = S.active || S.doc.drawing2d || S.selSketch; return sid && sketchById(sid); }
async function exportBlob(fmt) {
  await idle();
  if (fmt === '3mf' || fmt === 'step') {
    if (!(S.built && S.built.measure.volume > 0)) throw new Error(t('needSolid'));
    const r = await kernel.call('export', { fmt });
    return new Blob([r.bytes], { type: fmt === '3mf' ? 'model/3mf' : 'model/step' });
  }
  if (fmt === 'project') return new Blob([JSON.stringify(S.doc)], { type: 'application/json' });
  let dr, pageOpt, title = S.doc.name || t('untitled');
  if (S.mode === 'sheet') { await refreshSheet(); if (!SH.data) throw new Error(t('noSolidSheet')); dr = SH.data.drawing; pageOpt = { page: SH.data.page, map: SH.data.map, scale: SH.data.scale, ts: 3.5 / SH.data.scale }; }
  else { const s = currentSketchForExport(); if (!s) throw new Error(t('needSketch')); dr = sketchDrawing(s); pageOpt = sketchPage(dr); }
  if (fmt === 'dxf') return new Blob([toDxf(dr, pageOpt.ts || 3.5)], { type: 'application/dxf' });
  if (fmt === 'svg') return new Blob([toSvg(dr, pageOpt)], { type: 'image/svg+xml' });
  if (fmt === 'pdf') {
    if (S.mode !== 'sheet') { // 草图 PDF：放进 A4/A3 横向，选一个整比例
      const b = sketchPage(dr); const need = b.page; let size = 'A4', sc = 1;
      const fits = (pw, ph, s) => need[0] * s <= pw && need[1] * s <= ph;
      const cand = [5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
      sc = cand.find(s => fits(297, 210, s)) ?? 0.01;
      if (sc < 1 && fits(420, 297, 1)) { size = 'A3'; sc = 1; }
      const page = size === 'A4' ? [297, 210] : [420, 297];
      const ox = (page[0] - need[0] * sc) / 2, oy = (page[1] - need[1] * sc) / 2;
      pageOpt = { page, scale: sc, map: p => { const q = b.map(p); return [q[0] * sc + ox, q[1] * sc + oy]; } };
    }
    return new Blob([await toPdf(dr, pageOpt, { title })], { type: 'application/pdf' });
  }
  throw new Error('不支持的导出格式 ' + fmt);
}
for (const f of ['dxf', 'svg', 'pdf', '3mf', 'step']) $(`[data-testid="export-${f}"]`).addEventListener('click', async () => {
  try {
    const b = await exportBlob(f);
    const base = safeName(S.doc.name || t('untitled')) + (S.mode === 'sheet' && /dxf|svg|pdf/.test(f) ? '-' + (getLang() === 'zh' ? '工程图' : 'drawing') : '');
    download(b, `${base}.${f}`); toast(t('exported') + ' ' + f.toUpperCase());
  } catch (e) { toast(e.message, true); }
});

// ───── 工程图 ─────
const SH = { key: null, data: null, z: 1, x: 0, y: 0 };
$('[data-testid="make-sheet"]').addEventListener('click', async () => {
  await idle();
  if (!(S.built && S.built.measure.volume > 0)) return toast(t('noSolidSheet'), true);
  setMode('sheet');
});
$('[data-testid="sheet-size"]').addEventListener('change', e => { ops.setSheet({ size: e.target.value }); refreshSheet(); });
$('#sheet-scale').addEventListener('change', e => { ops.setSheet({ scale: e.target.value === 'auto' ? 'auto' : +e.target.value }); SH.fitted = false; refreshSheet(); });
$('#sheet-iso').addEventListener('change', e => { ops.setSheet({ iso: e.target.checked }); refreshSheet(); });
$('#sheet-names').addEventListener('change', e => { ops.setSheet({ names: e.target.checked }); refreshSheet(); });
let sheetBusy = null;
async function refreshSheet() {
  if (!(S.built && S.built.measure.volume > 0)) { SH.data = null; SH.key = null; SH.proj = null; renderSheet(); return; }
  const pkey = JSON.stringify(payload());
  if (!SH.proj || SH.proj.key !== pkey) {
    if (!(sheetBusy && sheetBusy.key === pkey)) {
      const p = (async () => { const r = await kernel.call('project', {}); SH.proj = { key: pkey, views: r.views, bbox: r.bbox }; })();
      sheetBusy = { key: pkey, p };
      try { await p; } finally { if (sheetBusy && sheetBusy.key === pkey) sheetBusy = null; }
    } else await sheetBusy.p;
  }
  layoutSheet();
}
function layoutSheet() {
  if (!SH.proj) return;
  const so = S.doc.sheet || {};
  const key = JSON.stringify([SH.proj.key, so, S.doc.name, getLang(), SH.tempViews || null]);
  if (key === SH.key && SH.data) return;
  const keepView = SH.data && SH.data.page[0] === ((PAPER_SIZES[so.size || 'A4'] || [])[0]);
  SH.data = buildSheet(SH.proj.views, SH.proj.bbox, so.size || 'A4', S.doc.name, { scale: so.scale || 'auto', iso: so.iso !== false, names: so.names !== false, edits: so.dimEdits || {}, viewEdits: SH.tempViews || so.viewEdits || {} });
  SH.key = key; if (!keepView) SH.fitted = false; renderSheet();
}
const PAPER_SIZES = { A4: [297, 210], A3: [420, 297] };
function renderSheet() {
  const host = $('#sheetview'); if (!host) return;
  $('[data-testid="sheet-size"]').value = (S.doc.sheet && S.doc.sheet.size) || 'A4';
  if (!SH.data) { host.innerHTML = `<div class="empty" style="position:absolute;left:50%;top:45%;transform:translate(-50%,-50%)">${t('noSolidSheet')}</div>`; $('#sheetinfo').textContent = ''; return; }
  const svg = toSvg(SH.data.drawing, { page: SH.data.page, map: SH.data.map, scale: SH.data.scale, ts: 3.5 / SH.data.scale });
  host.innerHTML = '';
  const paper = h('div', { class: 'paper' }); paper.innerHTML = svg.replace(/^<\?xml[^>]*>\s*/, '');
  host.append(paper);
  // 尺寸热区：细线很难点中，按每个尺寸的外框放一块透明的可点区域
  for (const g of paper.querySelectorAll('g.dimg[data-key]')) {
    try {
      // 热区只放在数字周围和尺寸线上（不覆盖整块外框，免得抢了视图的拖动）
      const NS = 'http://www.w3.org/2000/svg', tx = g.querySelector('text');
      if (tx) { const b = tx.getBBox(), pad = 1.2; const r = document.createElementNS(NS, 'rect'); r.setAttribute('x', b.x - pad); r.setAttribute('y', b.y - pad); r.setAttribute('width', b.width + pad * 2); r.setAttribute('height', b.height + pad * 2); r.setAttribute('class', 'hit'); const tr = tx.getAttribute('transform'); if (tr) r.setAttribute('transform', tr); g.insertBefore(r, g.firstChild); }
      for (const ln of g.querySelectorAll('line.dm')) { const c = ln.cloneNode(); c.setAttribute('class', 'hitl'); g.insertBefore(c, g.firstChild); }
    } catch (e) { }
    if (SH.sel === g.dataset.key) g.classList.add('sel');
  }
  const so = S.doc.sheet || {};
  $('#sheet-scale').value = so.scale && so.scale !== 'auto' ? String(so.scale) : 'auto'; $('#sheet-iso').checked = so.iso !== false; $('#sheet-names').checked = so.names !== false;
  $('#sheetinfo').innerHTML = '';
  $('#sheetinfo').append(h('div', {}, `${t('scale')} ${SH.data.scaleText}${SH.data.auto ? '（' + t('autoShort') + '）' : ''} · ${t('sheetSize')} ${so.size || 'A4'}`));
  if (SH.data.overflow) $('#sheetinfo').append(h('div', { class: 'warn' }, t('scaleOverflow')));
  if (so.iso !== false && !SH.data.iso) $('#sheetinfo').append(h('div', {}, t('isoSkipped')));
  const nh = (SH.data.hiddenDims || []).length, nm = Object.values(so.dimEdits || {}).filter(e => e.o).length;
  $('#sheetinfo').append(h('div', { class: 'hint2' }, t('sheetDimHint')));
  const ex = h('div', { class: 'sheetbtns ex' });
  for (const f of ['pdf', 'dxf', 'svg']) ex.append(h('button', { class: 'mini-btn pri', onclick: () => $(`[data-testid="export-${f}"]`).click() }, t('exportAs') + ' ' + f.toUpperCase()));
  $('#sheetinfo').append(ex);
  if (so.viewEdits && Object.keys(so.viewEdits).length) $('#sheetinfo').append(h('div', { class: 'sheetbtns' }, h('button', { class: 'mini-btn', onclick: () => { ops.setSheet({ viewEdits: {} }); layoutSheet(); } }, t('resetLayout'))));
  const row = h('div', { class: 'sheetbtns' });
  if (SH.sel) row.append(h('button', { class: 'mini-btn', onclick: () => deleteSheetDim(SH.sel) }, t('delDim')));
  if (nh || nm) row.append(h('button', { class: 'mini-btn', onclick: () => { SH.sel = null; ops.setSheet({ dimEdits: {} }); layoutSheet(); } }, `${t('restoreDims')}${nh ? `（${t('deletedN')} ${nh}）` : ''}`));
  $('#sheetinfo').append(row);
  if (!SH.fitted) {
    const r = host.getBoundingClientRect(), [pw, ph] = SH.data.page;
    const k = Math.min((r.width - 300) / pw, (r.height - 140) / ph);
    SH.z = k; SH.x = 230 + (r.width - 300 - pw * k) / 2; SH.y = 80 + (r.height - 140 - ph * k) / 2; SH.fitted = true;
  }
  placePaper();
}
function placePaper() { const p = $('#sheetview .paper'); if (!p || !SH.data) return; p.style.width = SH.data.page[0] + 'px'; p.style.height = SH.data.page[1] + 'px'; p.style.transform = `translate(${SH.x}px, ${SH.y}px) scale(${SH.z})`; }
function viewAt(x, y) {
  const paper = $('#sheetview .paper'); if (!paper || !SH.data || !SH.data.viewRects) return null;
  const r = paper.getBoundingClientRect(), [, PH] = SH.data.page;
  const px = (x - r.left) / SH.z, py = PH - (y - r.top) / SH.z, pad = 3;
  for (const [n, b] of Object.entries(SH.data.viewRects)) if (px >= b[0] - pad && px <= b[2] + pad && py >= b[1] - pad && py <= b[3] + pad) return n;
  return null;
}
function deleteSheetDim(key) {
  if (!key) return;
  const so = S.doc.sheet || {};
  SH.sel = null;
  ops.setSheet({ dimEdits: { ...(so.dimEdits || {}), [key]: { d: true } } });
  layoutSheet();
}
(() => {
  const host = $('#sheetview'); let d = null;
  host.addEventListener('wheel', e => { e.preventDefault(); const k = Math.pow(1.0015, -e.deltaY), r = host.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top; SH.x = cx - (cx - SH.x) * k; SH.y = cy - (cy - SH.y) * k; SH.z *= k; placePaper(); }, { passive: false });
  host.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.button !== 1) return;
    const g = e.button === 0 && e.target.closest && e.target.closest('g.dimg[data-key]');
    if (g) {
      SH.sel = g.dataset.key;
      host.querySelectorAll('g.dimg.sel').forEach(x => x.classList.remove('sel')); g.classList.add('sel');
      d = { dim: g, key: g.dataset.key, x0: e.clientX, y0: e.clientY, moved: false };
      host.setPointerCapture(e.pointerId); renderSheetInfoOnly(); return;
    }
    if (SH.sel && e.button === 0) { SH.sel = null; host.querySelectorAll('g.dimg.sel').forEach(x => x.classList.remove('sel')); renderSheetInfoOnly(); }
    const vn = e.button === 0 && viewAt(e.clientX, e.clientY);
    if (vn) { d = { view: vn, x0: e.clientX, y0: e.clientY, base: { ...((S.doc.sheet || {}).viewEdits || {}) } }; host.setPointerCapture(e.pointerId); host.classList.add('dragview'); return; }
    d = { x: e.clientX, y: e.clientY }; host.setPointerCapture(e.pointerId); host.classList.add('panning');
  });
  host.addEventListener('pointermove', e => {
    if (!d) { host.classList.toggle('overview', !!viewAt(e.clientX, e.clientY) && !(e.target.closest && e.target.closest('g.dimg'))); return; }
    if (d.view) {
      // 拖视图：实时重排（主视图带着俯视、左视；俯视只上下；左视只左右）
      const dx = (e.clientX - d.x0) / SH.z, dy = -(e.clientY - d.y0) / SH.z, o = d.base[d.view] || [0, 0];
      const nv = d.view === 'top' ? [0, o[1] + dy] : d.view === 'left' ? [o[0] + dx, 0] : [o[0] + dx, o[1] + dy];
      SH.tempViews = { ...d.base, [d.view]: nv }; d.moved = true;
      if (!d.raf) d.raf = requestAnimationFrame(() => { if (d) d.raf = null; layoutSheet(); });
      return;
    }
    if (d.dim) {
      const dx = (e.clientX - d.x0) / SH.z, dy = (e.clientY - d.y0) / SH.z;
      if (Math.hypot(dx, dy) * SH.z > 2) d.moved = true;
      d.dim.setAttribute('transform', `translate(${dx} ${dy})`); return;
    }
    SH.x += e.clientX - d.x; SH.y += e.clientY - d.y; d.x = e.clientX; d.y = e.clientY; placePaper();
  });
  host.addEventListener('pointerup', e => {
    host.classList.remove('panning'); host.classList.remove('dragview');
    if (d && d.view) { const tv = SH.tempViews; SH.tempViews = null; if (d.moved && tv) ops.setSheet({ viewEdits: tv }); layoutSheet(); d = null; return; }
    if (d && d.dim && d.moved) {
      // 纸面毫米（y 向上）累加到这个尺寸的偏移里
      const dx = (e.clientX - d.x0) / SH.z, dy = -(e.clientY - d.y0) / SH.z;
      const so = S.doc.sheet || {}, ed = { ...(so.dimEdits || {}) }, old = ed[d.key] && ed[d.key].o || [0, 0];
      ed[d.key] = { o: [old[0] + dx, old[1] + dy] };
      ops.setSheet({ dimEdits: ed }); layoutSheet();
    }
    d = null;
  });
  window.addEventListener('keydown', e => {
    if (S.mode !== 'sheet' || !SH.sel) return;
    if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSheetDim(SH.sel); }
    if (e.key === 'Escape') { SH.sel = null; renderSheet(); }
  });
})();
function renderSheetInfoOnly() { const keepFit = SH.fitted; const paper = $('#sheetview .paper'); if (!paper) return; SH.fitted = keepFit; /* 只刷新信息栏按钮 */ const info = $('#sheetinfo .sheetbtns'); if (!info) return; info.innerHTML = ''; const so = S.doc.sheet || {}; const nh = (SH.data.hiddenDims || []).length, nm = Object.values(so.dimEdits || {}).filter(x => x.o).length; if (SH.sel) info.append(h('button', { class: 'mini-btn', onclick: () => deleteSheetDim(SH.sel) }, t('delDim'))); if (nh || nm) info.append(h('button', { class: 'mini-btn', onclick: () => { SH.sel = null; ops.setSheet({ dimEdits: {} }); layoutSheet(); } }, `${t('restoreDims')}${nh ? `（${t('deletedN')} ${nh}）` : ''}`)); }

// ───── 判卷入口 window.__cad（与界面同一套操作）─────
const api = {
  ready,
  idle: () => idle(),
  mode(m) { if (m) setMode(m); return S.mode; },
  async reset() { closeProps(); setPick(null); resetDoc(); if (S.mode === '2d') setMode('3d'); firstModel = true; await idle(); },
  active: () => S.active,
  toScreen: (sid, uv) => view.toScreen(sid, uv),
  project: p => view.project(p),
  sketch: sid => sketchView(sid),
  sketches: () => S.doc.sketches.map(s => s.id),
  features: () => S.doc.features.map(f => ({ id: f.id, type: f.type, params: JSON.parse(JSON.stringify(f.params)), suppressed: !!f.suppressed, error: (S.built && S.built.errors && S.built.errors[f.id]) || null })),
  measure: () => { const m = S.built && S.built.measure; return m ? JSON.parse(JSON.stringify(m)) : { volume: 0, area: 0, bbox: [[0, 0, 0], [0, 0, 0]] }; },
  export: f => exportBlob(f),
  sheetViews: () => (SH.data && SH.data.viewRects ? JSON.parse(JSON.stringify(SH.data.viewRects)) : null), // 调试用：工程图各视图在纸面上的位置（毫米）
  async load(obj) { loadDoc(obj); firstModel = true; await idle(); },
  undo() { closeDimEditor(); if (P && P.live) { cancelProps(); return true; } const r = undo(); return r; },
  redo() { closeDimEditor(); return redo(); },
  cmd: {
    async sketch(plane) { if (plane && plane.face) await idle(); return ops.sketch(plane); },
    line: (s, a, b) => ops.line(s, a, b),
    circle: (s, c, r) => ops.circle(s, c, r),
    arc: (s, c, r, a0, a1) => ops.arc(s, c, r, a0, a1),
    text: (s, at, txt, hh) => ops.text(s, at, txt, hh),
    construction: (id, v) => ops.construction(id, v),
    constrain: (s, type, ...refs) => ops.constrain(s, type, ...refs),
    dim: (s, type, refs, v) => ops.dim(s, type, refs, v),
    setDim: (id, v) => ops.setDim(id, v),
    del: id => ops.del(id),
    finish: sid => ops.finish(sid),
    extrude: (sid, p = {}) => ops.addFeature(p.cut ? 'cut' : 'extrude', sid, { depth: +p.depth || 0, through: !!p.through, reverse: !!p.reverse }),
    revolve: (sid, p = {}) => ops.addFeature('revolve', sid, { axis: p.axis, angle: p.angle == null ? 360 : +p.angle, cut: !!p.cut }),
    async fillet(p) { await idle(); return ops.addFeature('fillet', null, { radius: +p.radius, refs: p.edges.map(refOf) }); },
    async chamfer(p) { await idle(); return ops.addFeature('chamfer', null, { distance: +p.distance, refs: p.edges.map(refOf) }); },
    async shell(p) { await idle(); return ops.addFeature('shell', null, { thickness: +p.thickness, refs: p.faces.map(refOf) }); },
    setParam: (fid, p) => ops.setParam(fid, p),
    suppress: (fid, v) => ops.suppress(fid, v),
  },
};
window.__cad = api;

// ───── 启动 ─────
applyLang(); applyTheme();
const hadSaved = loadSaved();
$('#pname').value = S.doc.name || '';
syncMode(); renderTree(); renderStatus();
initSolver().then(() => {
  ready.ui = true; renderStatus();
  emit('all');
  view.drawSketches(); view.viewTo('iso', true);
}).catch(e => toast('求解器加载失败：' + e.message, true));
