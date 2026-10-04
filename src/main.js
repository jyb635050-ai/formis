import './style.css';
import { S, on, emit, ops, txn, undo, redo, loadSaved, loadDoc, resetDoc, sketchById, featById, sketchView, refOf, saveNow } from './doc.js';
import { initSolver } from './solver.js';
import { createKernel } from './kernel/client.js';
import * as view from './view.js';
import { T, setTool, setPick, setToast, closeDimEditor } from './tools.js';
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
    for (const [sid, pl] of Object.entries(m.planes || {})) { const s = sketchById(sid); if (s) s.plane = pl; }
    view.setModel(m.mesh ? m : null);
    renderTree(); renderInfo();
    if (S.mode === 'sheet') refreshSheet();
    if (firstModel && m.mesh) { firstModel = false; view.viewTo('iso', true); }
    view.drawSketches();
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
    S.mode = '3d'; syncMode(); view.showModel(true);
    if (S.active) requestAnimationFrame(() => view.lookAtSketch(S.active, true)); else view.viewTo('iso', true);
  } else {
    if (S.mode === '2d' && S.active === S.doc.drawing2d) S.active = null;
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
  if (!S.active) { if (S.mode === '3d') return toast(t('needSketch'), true); }
  setTool(b.dataset.tool);
});
$('#tool-construction').addEventListener('click', () => {
  if (!S.active || !T.sel.size) return;
  const s = sketchById(S.active); const ids = [...T.sel];
  txn(() => ids.forEach(id => { const e = s.ents.find(x => x.id === id); if (e) ops.construction(id, !e.construction); }));
});
$('[data-testid="new-sketch"]').addEventListener('click', () => {
  if (S.mode !== '3d') setMode('3d');
  if (S.active) ops.finish(S.active);
  openProps({ kind: 'plane' });
  setPick({ kind: 'plane', sel: [], onPick: p => createSketch(p) });
});
$('[data-testid="sketch-done"]').addEventListener('click', () => { if (S.active) { ops.finish(S.active); setTool('select'); } closeProps(); setPick(null); renderTree(); });
async function createSketch(plane) {
  try {
    if (plane.face) await idle();
    const sid = ops.sketch(plane);
    setPick(null); closeProps(); setTool('select');
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
  box.hidden = false; box.innerHTML = '';
  if (P.kind === 'plane') {
    box.append(h('h3', {}, t('new-sketch')), h('div', { class: 'hint' }, t('pickPlane')));
    for (const pl of ['XY', 'XZ', 'YZ']) box.append(h('button', { class: 'pl', 'data-testid': 'plane-' + pl, onclick: () => createSketch(pl) }, t('plane-' + pl)));
    box.append(h('div', { class: 'btns' }, h('button', { 'data-testid': 'feat-cancel', onclick: () => { setPick(null); closeProps(); } }, t('cancel'))));
    return;
  }
  const spec = FEAT[P.feat];
  box.append(h('h3', {}, t('feat-' + P.feat)));
  if (spec.pick) box.append(h('div', { class: 'hint' }, `${t(spec.pick === 'edges' ? 'pickEdges' : 'pickFaces')} · ${t('selected')} ${T.pick ? T.pick.sel.length : 0}`));
  for (const [k, tid, def] of spec.fields) {
    const inp = h('input', { type: 'number', step: 'any', min: '0', 'data-testid': tid, value: String(P.values[k] ?? def) });
    inp.addEventListener('input', () => { P.values[k] = parseFloat(inp.value); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') okProps(); if (e.key === 'Escape') cancelProps(); e.stopPropagation(); });
    box.append(h('label', { class: 'row' }, h('span', {}, t(k)), inp));
  }
  for (const c of spec.checks || []) {
    const cb = h('input', { type: 'checkbox', checked: !!P.values[c] });
    cb.addEventListener('change', () => { P.values[c] = cb.checked; });
    box.append(h('label', { class: 'row' }, h('span', {}, t(c)), cb));
  }
  if (spec.axis) {
    const s = sketchById(P.sketch); const lines = s ? s.ents.filter(e => e.type === 'line') : [];
    const sel = h('select', {}, lines.map(l => h('option', { value: l.id, selected: l.id === P.values.axis }, `${l.id}${l.construction ? ' ·' : ''}`)));
    if (!P.values.axis && lines.length) P.values.axis = (lines.find(l => l.construction) || lines[0]).id, sel.value = P.values.axis;
    sel.addEventListener('change', () => { P.values.axis = sel.value; });
    box.append(h('label', { class: 'row' }, h('span', {}, t('axis')), sel));
  }
  if (P.error) box.append(h('div', { class: 'err' }, P.error));
  box.append(h('div', { class: 'btns' }, h('button', { 'data-testid': 'feat-cancel', onclick: cancelProps }, t('cancel')), h('button', { class: 'pri', 'data-testid': 'feat-ok', onclick: okProps }, t('ok'))));
}
function cancelProps() { setPick(null); closeProps(); }
async function okProps() {
  if (!P || P.kind === 'plane') return;
  const v = P.values, spec = FEAT[P.feat];
  try {
    for (const [k] of spec.fields) if (!(v[k] > 0)) throw new Error(t(k) + ' > 0');
    if (P.edit) {
      const p = {}; for (const [k] of spec.fields) p[k] = v[k]; for (const c of spec.checks || []) p[c] = !!v[c]; if (spec.axis) p.axis = v.axis;
      ops.setParam(P.edit, p);
    } else if (P.feat === 'extrude' || P.feat === 'cut') api.cmd.extrude(P.sketch, { depth: v.depth, cut: P.feat === 'cut', through: !!v.through, reverse: !!v.reverse });
    else if (P.feat === 'revolve') api.cmd.revolve(P.sketch, { axis: v.axis, angle: v.angle });
    else {
      const pts = T.pick.sel.map(s => s.point);
      if (!pts.length) throw new Error(t(spec.pick === 'edges' ? 'pickEdges' : 'pickFaces'));
      if (P.feat === 'fillet') await api.cmd.fillet({ radius: v.radius, edges: pts });
      if (P.feat === 'chamfer') await api.cmd.chamfer({ distance: v.distance, edges: pts });
      if (P.feat === 'shell') await api.cmd.shell({ thickness: v.thickness, faces: pts });
    }
    setPick(null); closeProps();
  } catch (e) { P.error = e.message; renderProps(); }
}
for (const b of $$('[data-feat]')) b.addEventListener('click', () => {
  if (S.mode !== '3d') setMode('3d');
  const feat = b.dataset.feat, spec = FEAT[feat];
  setPick(null);
  if (spec.pick) {
    if (!(S.built && S.built.measure.volume > 0)) return toast(t('needSolid'), true);
    if (S.active) ops.finish(S.active);
    openProps({ kind: 'feat', feat, values: {} });
    setPick({ kind: spec.pick, sel: [] });
    return;
  }
  const sid = S.active || S.selSketch;
  if (!sid || !sketchById(sid)) return toast(t('needSketch'), true);
  if (S.active) ops.finish(S.active);
  openProps({ kind: 'feat', feat, sketch: sid, values: {} });
  setTimeout(() => { const i = $('#props input[type=number]'); i && i.focus(); i && i.select(); }, 30);
});
function editFeature(fid) {
  const f = featById(fid); if (!f) return;
  const feat = f.type === 'extrude' && f.params.cut ? 'cut' : f.type;
  setPick(null);
  const values = { ...f.params };
  openProps({ kind: 'feat', feat, edit: fid, sketch: f.sketch, values });
  setTimeout(() => { const i = $('#props input[type=number]'); i && i.focus(); i && i.select(); }, 30);
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
  if (!ready.kernel) s = t('kernelLoading') + ' · ' + s;
  el.textContent = s;
}

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
let sheetBusy = null;
async function refreshSheet() {
  if (!(S.built && S.built.measure.volume > 0)) { SH.data = null; SH.key = null; renderSheet(); return; }
  const key = JSON.stringify([payload(), S.doc.sheet, S.doc.name, getLang()]);
  if (key === SH.key && SH.data) return;
  if (sheetBusy && sheetBusy.key === key) return sheetBusy.p;
  const p = (async () => {
    const r = await kernel.call('project', {});
    SH.data = buildSheet(r.views, r.bbox, (S.doc.sheet && S.doc.sheet.size) || 'A3', S.doc.name);
    SH.key = key; SH.fitted = false; renderSheet();
  })();
  sheetBusy = { key, p }; try { await p; } finally { if (sheetBusy && sheetBusy.key === key) sheetBusy = null; }
}
function renderSheet() {
  const host = $('#sheetview'); if (!host) return;
  $('[data-testid="sheet-size"]').value = (S.doc.sheet && S.doc.sheet.size) || 'A3';
  if (!SH.data) { host.innerHTML = `<div class="empty" style="position:absolute;left:50%;top:45%;transform:translate(-50%,-50%)">${t('noSolidSheet')}</div>`; $('#sheetinfo').textContent = ''; return; }
  const svg = toSvg(SH.data.drawing, { page: SH.data.page, map: SH.data.map, scale: SH.data.scale, ts: 3.5 / SH.data.scale });
  host.innerHTML = '';
  const paper = h('div', { class: 'paper' }); paper.innerHTML = svg.replace(/^<\?xml[^>]*>\s*/, '');
  host.append(paper);
  $('#sheetinfo').textContent = `${t('scale')} ${SH.data.scaleText} · ${t('sheetSize')} ${(S.doc.sheet && S.doc.sheet.size) || 'A3'}`;
  if (!SH.fitted) {
    const r = host.getBoundingClientRect(), [pw, ph] = SH.data.page;
    const k = Math.min((r.width - 300) / pw, (r.height - 140) / ph);
    SH.z = k; SH.x = 230 + (r.width - 300 - pw * k) / 2; SH.y = 80 + (r.height - 140 - ph * k) / 2; SH.fitted = true;
  }
  placePaper();
}
function placePaper() { const p = $('#sheetview .paper'); if (!p || !SH.data) return; p.style.width = SH.data.page[0] + 'px'; p.style.height = SH.data.page[1] + 'px'; p.style.transform = `translate(${SH.x}px, ${SH.y}px) scale(${SH.z})`; }
(() => {
  const host = $('#sheetview'); let d = null;
  host.addEventListener('wheel', e => { e.preventDefault(); const k = Math.pow(1.0015, -e.deltaY), r = host.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top; SH.x = cx - (cx - SH.x) * k; SH.y = cy - (cy - SH.y) * k; SH.z *= k; placePaper(); }, { passive: false });
  host.addEventListener('pointerdown', e => { d = { x: e.clientX, y: e.clientY }; host.setPointerCapture(e.pointerId); });
  host.addEventListener('pointermove', e => { if (!d) return; SH.x += e.clientX - d.x; SH.y += e.clientY - d.y; d = { x: e.clientX, y: e.clientY }; placePaper(); });
  host.addEventListener('pointerup', () => { d = null; });
})();

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
  async load(obj) { loadDoc(obj); firstModel = true; await idle(); },
  undo() { closeDimEditor(); const r = undo(); return r; },
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
  view.viewTo('iso', true);
}).catch(e => toast('求解器加载失败：' + e.message, true));
