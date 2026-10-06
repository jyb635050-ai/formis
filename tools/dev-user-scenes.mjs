// 真人操作场景（开发调试用）
const info = p => p.evaluate(() => ({ f: __cad.features().map(f => [f.type, f.error]), v: Math.round(__cad.measure().volume), sk: __cad.sketches().map(s => { const k = __cad.sketch(s); return [s, k.entities.length, k.dof]; }) }));
export async function extrude3d({ p, click, drag, tap, shot, sleep }) {
  await click('new-sketch'); await sleep(300); await click('plane-XY'); await sleep(700);
  await drag([600, 350], [850, 550]); await shot('a-rect');          // 新建草图后默认矩形工具，按住拖
  await click('sketch-done'); await sleep(400);
  await click('feat-extrude'); await sleep(800); await shot('b-preview');
  await p.fill('[data-testid="feat-depth"]', '25'); await sleep(800);
  await click('feat-ok'); await sleep(800); await click('view-iso'); await sleep(600); await shot('c-extruded');
  console.log('extrude3d', JSON.stringify(await info(p)));
}
export async function lines2d({ p, click, drag, tap, shot, sleep }) {
  await click('mode-2d'); await sleep(700); await click('tool-line');
  await tap(500, 400); await p.mouse.move(700, 403, { steps: 6 }); await sleep(150); await shot('d-infer');
  await tap(800, 403); await tap(803, 600); await tap(503, 598);
  await p.mouse.move(498, 405, { steps: 6 }); await sleep(150); await shot('e-snap-end');
  await tap(498, 405);                                                      // 闭合：吸附到起点
  await click('tool-circle'); await tap(650, 500); await p.keyboard.type('30'); await sleep(100); await shot('f-num'); await p.keyboard.press('Enter'); await sleep(200);
  await shot('g-closed');
  console.log('lines2d', JSON.stringify(await p.evaluate(() => { const s = __cad.sketch(__cad.active()); return { n: s.entities.map(e => e.type + (e.r ? ':' + e.r : '')), c: s.constraints.map(c => c.type), dof: s.dof }; })));
}
export async function pick3d({ p, click, drag, tap, shot, sleep }) {
  await click('new-sketch'); await sleep(300); await click('plane-XY'); await sleep(700);
  await drag([600, 350], [850, 550]); await click('tool-circle'); await drag([1000, 450], [1060, 450]);
  await click('sketch-done'); await sleep(300); await click('view-iso'); await sleep(700);
  const q = await p.evaluate(() => { const s = __cad.sketches()[0]; const k = __cad.sketch(s); const l = k.entities[0]; return __cad.toScreen(s, [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2]); });
  await tap(200, 800); await p.mouse.move(q.x, q.y, { steps: 5 }); await sleep(200); await shot('h-hover-sketch');
  await tap(q.x, q.y); await sleep(200);
  const sel = await p.evaluate(() => document.querySelector('.ti.sel') && document.querySelector('.ti.sel').textContent);
  await click('feat-extrude'); await sleep(600); await click('feat-ok'); await sleep(800); await shot('i-extruded');
  console.log('pick3d', sel, JSON.stringify(await info(p)));
}
export async function orbit({ p, click, drag, tap, shot, sleep }) {
  await p.evaluate(async () => { const C = __cad.cmd; const s = await C.sketch('XY'); C.line(s, [10, 10], [50, 10]); C.line(s, [50, 10], [50, 40]); C.line(s, [50, 40], [10, 40]); C.line(s, [10, 40], [10, 10]); C.finish(s); C.extrude(s, { depth: 12 }); await __cad.idle(); });
  await click('view-iso'); await sleep(500); await click('view-fit'); await sleep(700);
  const cam0 = await p.evaluate(() => JSON.stringify(window.__cad.project([0, 0, 0])));
  await shot('o1'); await p.mouse.move(720, 450); await p.mouse.down({ button: 'right' });
  for (let i = 1; i <= 40; i++) { await p.mouse.move(720 + 220 * Math.sin(i / 25), 450 + 60 * Math.sin(i / 13)); await sleep(22); }
  await p.mouse.up({ button: 'right' }); await sleep(500); await shot('o2');
  console.log('orbit', cam0, JSON.stringify(await p.evaluate(() => window.__cad.project([0, 0, 0]))));
}
export async function nav({ p, click, drag, tap, shot, sleep }) {
  await p.evaluate(async () => { const C = __cad.cmd; const s = await C.sketch('XY'); C.line(s, [10, 10], [50, 10]); C.line(s, [50, 10], [50, 40]); C.line(s, [50, 40], [10, 40]); C.line(s, [10, 40], [10, 10]); C.finish(s); C.extrude(s, { depth: 12 }); await __cad.idle(); });
  await click('view-iso'); await sleep(500); await click('view-fit'); await sleep(600);
  const P = () => p.evaluate(() => { const a = __cad.project([30, 25, 6]), b = __cad.project([30, 25, 20]); return [Math.round(a.x), Math.round(a.y), Math.round(b.x - a.x), Math.round(b.y - a.y)]; });
  const dragBtn = async (button, a, b, mods = []) => { for (const m of mods) await p.keyboard.down(m); await p.mouse.move(a[0], a[1]); await p.mouse.down({ button }); for (let i = 1; i <= 15; i++) { await p.mouse.move(a[0] + (b[0] - a[0]) * i / 15, a[1] + (b[1] - a[1]) * i / 15); await sleep(16); } await p.mouse.up({ button }); for (const m of mods) await p.keyboard.up(m); await sleep(200); };
  const r = { start: await P() };
  await dragBtn('middle', [700, 450], [850, 420]); r.middle = await P(); await shot('n-middle');
  await dragBtn('left', [300, 700], [420, 650]); r.leftEmpty = await P();
  await dragBtn('right', [700, 450], [600, 500]); r.right = await P();
  await dragBtn('middle', [700, 450], [800, 450], ['Control']); r.ctrlMiddlePan = await P();
  await dragBtn('left', [700, 450], [760, 450], ['Shift']); r.shiftLeftPan = await P();
  await click('view-iso'); await sleep(600);
  // 单击空草图仍能选中
  await p.evaluate(async () => { const C = __cad.cmd; const s = await C.sketch('XY'); C.circle(s, [80, 25], 8); C.finish(s); });
  await sleep(300);
  const q = await p.evaluate(() => __cad.toScreen(__cad.sketches().at(-1), [88, 25]));
  await tap(200, 820); await tap(q.x, q.y); await sleep(200);
  r.selected = await p.evaluate(() => document.querySelector('.ti.sel') && document.querySelector('.ti.sel').textContent);
  r.consoleErr = 0; await shot('n-end');
  console.log(JSON.stringify(r));
}
export async function dims({ p, click, drag, tap, shot, sleep }) {
  await click('mode-2d'); await sleep(700);
  const S = uv => p.evaluate(uv => __cad.toScreen(__cad.active(), uv), uv);
  await click('tool-line');
  for (const uv of [[10, 0], [10, 20], [60, 20], [60, 16], [30, 16]]) { const q = await S(uv); await tap(q.x, q.y); }
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  await click('tool-dim');
  let q = await S([10, 10]); await tap(q.x, q.y);                  // 竖线
  const pl = await S([2, 14]); await p.mouse.move(pl.x, pl.y, { steps: 6 }); await sleep(150); await shot('p-dim-preview');
  await tap(pl.x, pl.y); await sleep(200); await p.keyboard.press('Enter'); await sleep(200);
  q = await S([60, 20]); await tap(q.x, q.y); q = await S([60, 16]); await tap(q.x, q.y); // 两点
  const p2 = await S([68, 21]); await p.mouse.move(p2.x, p2.y, { steps: 6 }); await sleep(150); await tap(p2.x, p2.y); await sleep(200); await p.keyboard.press('Enter');
  await p.keyboard.press('Escape'); await click('tool-select'); await sleep(200); await shot('q-dims');
  // 拖尺寸数字
  const before = await p.evaluate(() => __cad.sketch(__cad.active()).dims.map(d => d.label.map(v => Math.round(v * 10) / 10)));
  const lab = await p.$('.dim-label[data-dim]'); const bb = await lab.boundingBox();
  await drag([bb.x + bb.width / 2, bb.y + bb.height / 2], [bb.x - 60, bb.y + 80]);
  const after = await p.evaluate(() => __cad.sketch(__cad.active()).dims.map(d => d.label.map(v => Math.round(v * 10) / 10)));
  // 拖被标注的线端点
  const g0 = await p.evaluate(() => JSON.stringify(__cad.sketch(__cad.active()).entities[0]));
  q = await S([10, 20]); await drag([q.x, q.y], [q.x + 80, q.y - 40]);
  const g1 = await p.evaluate(() => JSON.stringify(__cad.sketch(__cad.active()).entities[0]));
  const toast = await p.evaluate(() => document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent);
  await shot('r-after');
  console.log(JSON.stringify({ before, after, lineUnchanged: g0 === g1, toast, dims: await p.evaluate(() => __cad.sketch(__cad.active()).dims.map(d => [d.type, d.value])) }));
}
export async function labdbg({ p, click, drag, tap, shot, sleep }) {
  await click('mode-2d'); await sleep(700);
  await p.evaluate(() => { const C = __cad.cmd, s = __cad.active(); const l = C.line(s, [10, 0], [10, 20]); C.dim(s, 'length', [l], 20); });
  await sleep(300);
  const lab = await p.$('.dim-label[data-dim]'); const bb = await lab.boundingBox();
  const hit = await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e.className + ' ' + (e.dataset.dim || ''); }, [bb.x + bb.width / 2, bb.y + bb.height / 2]);
  await p.evaluate(() => { window.__log = []; for (const t of ['pointerdown', 'pointermove', 'pointerup']) window.addEventListener(t, e => window.__log.push(t + ':' + (e.target.className || e.target.tagName)), true); });
  await drag([bb.x + bb.width / 2, bb.y + bb.height / 2], [bb.x - 60, bb.y + 80]);
  console.log(hit, JSON.stringify(await p.evaluate(() => [__log.slice(0, 4), __log.length, __cad.sketch(__cad.active()).dims[0].label])));
}
export async function dims2({ p, click, drag, tap, shot, sleep }) {
  await click('new-sketch'); await sleep(300); await click('plane-XY'); await sleep(700);
  const S = uv => p.evaluate(uv => __cad.toScreen(__cad.active(), uv), uv);
  const line = async (a, b) => { await click('tool-line'); let q = await S(a); await tap(q.x, q.y); q = await S(b); await tap(q.x, q.y); await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); };
  await line([0, 0], [60, 0]); await line([0, 25], [60, 25]); await line([80, 0], [100, 30]); await line([80, -10], [110, -5]);
  await click('tool-circle'); let q = await S([30, 45]); await tap(q.x, q.y); q = await S([34, 45]); await tap(q.x, q.y); await p.keyboard.press('Escape');
  await click('tool-dim');
  const pick = async (...uvs) => { for (const uv of uvs) { const q = await S(uv); await tap(q.x, q.y); } await sleep(150); await p.keyboard.press('Enter'); await sleep(150); };
  await pick([30, 0], [30, 25], [-8, 12]);          // 两条平行线 → 间距
  await pick([34, 45], [45, 25], [50, 37]);         // 圆 + 线 → 圆心到线距离
  await pick([90, 15], [95, -7.5], [100, 5]);       // 两条斜线 → 角度
  await shot('s-dims2');
  const dims = await p.evaluate(() => __cad.sketch(__cad.active()).dims.map(d => [d.type, Math.round(d.value * 1000) / 1000]));
  // 虚线样式
  await p.click('#dim-style-btn'); await p.selectOption('#ds-line', 'dashed'); await p.selectOption('#ds-arrow', 'tick'); await sleep(300); await shot('t-dashed');
  await p.mouse.click(700, 880); await click('sketch-done'); await sleep(300);
  // 去工程图再回来（先要有实体）
  await click('mode-sheet'); await sleep(500); await click('mode-3d'); await sleep(800); await shot('u-back');
  const labels = await p.evaluate(() => document.querySelectorAll('.dim-label[data-dim]').length);
  // 导出 DXF 校验
  await p.evaluate(() => { __cad.mode('2d'); });
  const s3 = await p.evaluate(async () => { const sid = __cad.sketches()[0]; document.querySelector('[data-testid=mode-3d]').click(); return sid; });
  const dxf = await p.evaluate(async sid => { const { S: st } = {}; window.__cadActive = sid; return null; }, s3);
  console.log(JSON.stringify({ dims, labelsAfterSheet: labels }));
}
export async function sheet2({ p, click, drag, tap, shot, sleep }) {
  await p.evaluate(async () => {
    const C = __cad.cmd; const s = await C.sketch('XY'); const R = await window.__fxRect(s);
  }).catch(() => { });
  await p.evaluate(async () => {
    const C = __cad.cmd; const s = await C.sketch('XY');
    const L = [[0, 0], [80, 0], [80, 60], [0, 60]].map((q, i, a) => C.line(s, q, a[(i + 1) % 4]));
    for (const [x, y] of [[10, 10], [70, 10], [10, 50], [70, 50]]) C.circle(s, [x, y], 4);
    C.finish(s); C.extrude(s, { depth: 10 }); await __cad.idle();
    await C.fillet({ radius: 5, edges: [[0, 0, 5], [80, 0, 5], [80, 60, 5], [0, 60, 5]] });
    const s2 = await C.sketch({ face: [40, 30, 10] }); C.circle(s2, [0, 0], 10); C.finish(s2); C.extrude(s2, { depth: 4, cut: true }); await __cad.idle();
    document.querySelector('#pname').value = '安装板'; document.querySelector('#pname').dispatchEvent(new Event('change'));
  });
  await click('make-sheet'); await sleep(2500); await shot('v-sheet-plate');
  await click('mode-3d'); await p.evaluate(async () => {
    await __cad.reset(); const C = __cad.cmd; const s = await C.sketch('XZ');
    const P = [[0, 0], [24, 0], [24, 97], [18, 97], [18, 40], [6, 40], [6, 97], [0, 97]];
    P.forEach((q, i) => C.line(s, q, P[(i + 1) % P.length])); C.finish(s); C.extrude(s, { depth: 8 }); await __cad.idle();
    document.querySelector('#pname').value = '立柱'; document.querySelector('#pname').dispatchEvent(new Event('change'));
  });
  await click('make-sheet'); await sleep(2500); await shot('w-sheet-tall');
  console.log(await p.evaluate(() => document.querySelector('#sheetinfo').textContent));
}
export async function typing({ p, click, drag, tap, shot, sleep }) {
  await click('new-sketch'); await sleep(300); await click('plane-XY'); await sleep(700);
  await drag([600, 350], [850, 550]); await click('sketch-done'); await sleep(300);
  await click('feat-extrude'); await sleep(600);
  const inp = p.locator('[data-testid="feat-depth"]');
  await inp.click(); await p.keyboard.press('Control+a'); await p.keyboard.press('Backspace');
  for (const ch of '97.5') { await p.keyboard.type(ch); await sleep(500); }   // 每个字之间等实时重建完成
  const v = await inp.inputValue();
  await click('feat-ok'); await sleep(800);
  console.log(JSON.stringify({ typed: v, depth: await p.evaluate(() => __cad.features()[0].params.depth) }));
}
export async function sheetedit({ p, click, drag, tap, shot, sleep }) {
  await p.evaluate(async () => {
    const C = __cad.cmd; const s = await C.sketch('XY');
    [[0, 0], [80, 0], [80, 60], [0, 60]].forEach((q, i, a) => C.line(s, q, a[(i + 1) % 4]));
    for (const [x, y] of [[10, 10], [70, 10], [10, 50], [70, 50]]) C.circle(s, [x, y], 4);
    C.finish(s); C.extrude(s, { depth: 10 }); await __cad.idle();
  });
  await click('make-sheet'); await sleep(2500);
  const dimInfo = () => p.evaluate(async () => { const t = await (await __cad.export('dxf')).text(); return (t.match(/\nDIMENSION\r?\n/g) || []).length; });
  const box = key => p.evaluate(k => { const g = document.querySelector(`g.dimg[data-key="${k}"] text`); const r = g.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, key);
  const keys = await p.evaluate(() => [...document.querySelectorAll('g.dimg[data-key]')].map(g => g.dataset.key));
  const n0 = await dimInfo();
  console.log('keys', JSON.stringify(keys)); console.log(await p.evaluate(() => document.querySelector('g.dimg[data-key="front:ao"]')?.outerHTML.slice(0,300))); const b80 = await box('front:ao'); await drag(b80, [b80[0] + 40, b80[1] - 30]); await sleep(400); await shot('x-moved'); console.log('after', JSON.stringify(await p.evaluate(() => [[...document.querySelectorAll('g.dimg[data-key]')].map(g => g.dataset.key), JSON.stringify(window.__cad && 0), document.querySelector('#sheetinfo').textContent])));
  const after80 = await box('front:ao');
  const b40 = await box('top:b:70'); await tap(b40[0], b40[1]); await p.keyboard.press('Delete'); await sleep(400); await shot('y-deleted');
  const n1 = await dimInfo(); const has70 = await p.evaluate(() => !!document.querySelector('g.dimg[data-key="top:b:70"]'));
  await p.keyboard.press('Control+z'); await sleep(400); const undo70 = await p.evaluate(() => !!document.querySelector('g.dimg[data-key="top:b:70"]'));
  const restore = await p.evaluate(() => { const b = [...document.querySelectorAll('#sheetinfo .mini-btn')].find(x => /恢复/.test(x.textContent)); if (b) b.click(); return !!b; });
  await sleep(400); const back80 = await box('front:ao');
  console.log(JSON.stringify({ keys, n0, b80, after80, n1, deleted70: !has70, undo70, restore, back80 }));
}
export async function channel({ p, click, drag, tap, shot, sleep }) {
  // 用户截图里那种细长槽形件：24×8 截面、高 89、壁厚 1
  await p.evaluate(async () => {
    const C = __cad.cmd; const s = await C.sketch('XY');
    const P = [[0, 0], [24, 0], [24, 1], [1, 1], [1, 7], [24, 7], [24, 8], [0, 8]];
    P.forEach((q, i) => C.line(s, q, P[(i + 1) % P.length])); C.finish(s); C.extrude(s, { depth: 89 }); await __cad.idle();
    document.querySelector('#pname').value = '666'; document.querySelector('#pname').dispatchEvent(new Event('change'));
  });
  await click('make-sheet'); await sleep(2500); await shot('z1-a4');
  const info = await p.evaluate(() => document.querySelector('#sheetinfo').textContent);
  // 拖主视图（带着俯视、左视一起走）
  const vr = await p.evaluate(() => { const g = document.querySelector('#sheetview .paper').getBoundingClientRect(); return [g.left, g.top]; });
  const before = await p.evaluate(async () => { const t = await (await __cad.export('dxf')).text(); return t.length; });
  const fr = await p.evaluate(() => { const r = document.querySelector('#sheetview .paper svg line.vs').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await drag(fr, [fr[0] - 60, fr[1] + 20]); await sleep(500); await shot('z2-dragged');
  const edits = await p.evaluate(() => JSON.stringify((window.__cad && 1) && JSON.parse(localStorage.getItem('glasscad.doc.v1') || '{}').sheet));
  console.log(JSON.stringify({ info, edits }));
}
export async function channel2({ p, click, drag, tap, shot, sleep }) {
  await p.evaluate(async () => {
    const C = __cad.cmd; const s = await C.sketch('XY');
    const P = [[0, 0], [24, 0], [24, 1], [1, 1], [1, 7], [24, 7], [24, 8], [0, 8]];
    P.forEach((q, i) => C.line(s, q, P[(i + 1) % P.length])); C.finish(s); C.extrude(s, { depth: 89 }); await __cad.idle();
    document.querySelector('#pname').value = '666'; document.querySelector('#pname').dispatchEvent(new Event('change'));
  });
  await click('make-sheet'); await sleep(2500); await shot('z1-a4');
  const scr = async (name) => p.evaluate(n => { const v = __cad.sheetViews()[n]; const pr = document.querySelector('#sheetview .paper').getBoundingClientRect(); const z = pr.width / 297; return [pr.left + (v[0] + v[2]) / 2 * z, pr.top + (210 - (v[1] + v[3]) / 2) * z]; }, name);
  const v0 = await p.evaluate(() => __cad.sheetViews());
  const f = await scr('front'); await drag(f, [f[0] - 80, f[1] + 10]); await sleep(500);
  const i = await scr('iso'); await drag(i, [i[0] + 20, i[1] - 30]); await sleep(500); await shot('z2-dragged');
  const v1 = await p.evaluate(() => __cad.sheetViews());
  const info = await p.evaluate(() => document.querySelector('#sheetinfo').textContent);
  const r = x => x.map(v => Math.round(v));
  console.log(JSON.stringify({ info, before: Object.fromEntries(Object.entries(v0).map(([k, v]) => [k, r(v)])), after: Object.fromEntries(Object.entries(v1).map(([k, v]) => [k, r(v)])) }));
}
export async function preselect({ p, click, drag, tap, shot, sleep }) {
  await p.evaluate(async () => {
    const C = __cad.cmd; const s = await C.sketch('XY');
    [[0, 0], [40, 0], [40, 30], [0, 30]].forEach((q, i, a) => C.line(s, q, a[(i + 1) % 4])); C.finish(s); C.extrude(s, { depth: 20 }); await __cad.idle();
  });
  await click('view-iso'); await sleep(600); await click('view-fit'); await sleep(700);
  const P = q => p.evaluate(q => __cad.project(q), q);
  const v0 = await p.evaluate(() => __cad.measure().volume);
  let q = await P([20, 15, 20]); await tap(q.x, q.y); await sleep(300);           // 点顶面
  const st1 = await p.evaluate(() => document.querySelector('#status').textContent);
  await p.mouse.move(200, 820); await sleep(300); await shot('pa-face-selected');  // 鼠标移开，选中要保持
  q = await P([40, 0, 10]); await p.keyboard.down('Control'); await tap(q.x, q.y); await p.keyboard.up('Control'); await sleep(200); // Ctrl 加一条竖边
  const st2 = await p.evaluate(() => document.querySelector('#status').textContent);
  await click('feat-chamfer'); await sleep(400);
  const hint = await p.evaluate(() => document.querySelector('#props .hint').textContent);
  await p.fill('[data-testid="feat-distance"]', '2'); await click('feat-ok'); await sleep(1500); await shot('pb-chamfered');
  const v1 = await p.evaluate(() => __cad.measure().volume);
  const err = await p.evaluate(() => __cad.features().map(f => [f.type, f.error]));
  // 选一个侧面 → 新建草图直接在它上面
  q = await P([40, 15, 8]); await tap(q.x, q.y); await sleep(200); await click('new-sketch'); await sleep(900);
  const sk = await p.evaluate(() => { const a = __cad.active(); return a ? __cad.sketch(a).plane.normal : null; });
  console.log(JSON.stringify({ st1, st2, hint, v0, v1, err, sketchNormal: sk }));
}
export async function mouse6({ p, click, drag, tap, shot, sleep }) {
  await p.evaluate(async () => { const C = __cad.cmd; const s = await C.sketch('XY'); [[0, 0], [40, 0], [40, 30], [0, 30]].forEach((q, i, a) => C.line(s, q, a[(i + 1) % 4])); C.finish(s); C.extrude(s, { depth: 20 }); await __cad.idle(); });
  await click('view-iso'); await sleep(600); await click('view-fit'); await sleep(700);
  const P = q => p.evaluate(q => { const r = __cad.project(q); return [Math.round(r.x), Math.round(r.y)]; }, q);
  const dragBtn = async (button, a, b) => { await p.mouse.move(a[0], a[1]); await p.mouse.down({ button }); for (let i = 1; i <= 12; i++) { await p.mouse.move(a[0] + (b[0] - a[0]) * i / 12, a[1] + (b[1] - a[1]) * i / 12); await sleep(16); } await p.mouse.up({ button }); await sleep(250); };
  const vec = async () => { const a = await P([0, 0, 0]), b = await P([0, 0, 20]); return [a, [b[0] - a[0], b[1] - a[1]]]; };
  const r = { start: await vec() };
  await dragBtn('middle', [700, 450], [800, 480]); r.middlePan = await vec();
  await dragBtn('right', [700, 450], [800, 400]); r.rightRotate = await vec();
  await dragBtn('left', [250, 750], [400, 650]); r.leftDragNothing = await vec();
  // 左键点顶面 → 正视于
  let q = await p.evaluate(() => __cad.project([20, 15, 20])); await tap(q.x, q.y); await sleep(200);
  await p.click('#view-normal'); await sleep(700);
  r.afterNormal = await vec();   // 正视顶面：Z 方向的线应缩成一个点
  console.log('mouse6', JSON.stringify(r));
}
export async function copydrag({ p, click, drag, tap, shot, sleep }) {
  await click('mode-2d'); await sleep(700);
  await p.evaluate(() => { const C = __cad.cmd, s = __cad.active(); const L = [[0, 0], [40, 0], [40, 20], [0, 20]].map((q, i, a) => C.line(s, q, a[(i + 1) % 4])); for (let i = 0; i < 4; i++) C.constrain(s, 'coincident', L[i] + '.b', L[(i + 1) % 4] + '.a'); C.constrain(s, 'horizontal', L[0]); C.constrain(s, 'horizontal', L[2]); C.constrain(s, 'vertical', L[1]); C.constrain(s, 'vertical', L[3]); C.dim(s, 'length', [L[0]], 40); C.dim(s, 'length', [L[1]], 20); });
  const S = uv => p.evaluate(uv => { const r = __cad.toScreen(__cad.active(), uv); return [r.x, r.y]; }, uv);
  await click('tool-select');
  // 拖右下角往右：底边变长，底边尺寸跟着变
  let a = await S([40, 0]); await drag(a, [a[0] + 70, a[1]]); await sleep(300);
  const afterDrag = await p.evaluate(() => __cad.sketch(__cad.active()).dims.map(d => [d.type, Math.round(d.value * 100) / 100]));
  await shot('c1-dragged');
  // 框选全部 → Ctrl+C → 鼠标移到右边 → Ctrl+V
  const b1 = await S([-5, -6]), b2 = await S([60, 26]); await drag(b1, b2); await sleep(200);
  await p.keyboard.press('Control+c'); await sleep(200);
  const tgt = await S([30, -30]); await p.mouse.move(tgt[0], tgt[1], { steps: 5 }); await sleep(200);
  await p.keyboard.press('Control+v'); await sleep(500); await shot('c2-pasted');
  const sk = await p.evaluate(() => { const k = __cad.sketch(__cad.active()); return { lines: k.entities.length, dims: k.dims.map(d => Math.round(d.value * 100) / 100), cons: k.constraints.length }; });
  console.log('copydrag', JSON.stringify({ afterDrag, sk }));
}
export async function box3d({ p, click, drag, tap, shot, sleep }) {
  await p.evaluate(async () => {
    const C = __cad.cmd; const s = await C.sketch('XY'); [[0, 0], [40, 0], [40, 30], [0, 30]].forEach((q, i, a) => C.line(s, q, a[(i + 1) % 4])); C.finish(s); C.extrude(s, { depth: 20 }); await __cad.idle();
    const s2 = await C.sketch('XY'); const L = [[60, 0], [90, 0], [90, 20], [60, 20]].map((q, i, a) => C.line(s2, q, a[(i + 1) % 4])); C.dim(s2, 'length', [L[0]], 30); C.circle(s2, [75, 10], 5); C.finish(s2);
  });
  await click('view-iso'); await sleep(600); await click('view-fit'); await sleep(700);
  const P = q => p.evaluate(q => { const r = __cad.project(q); return [r.x, r.y]; }, q);
  // 1) 从左往右框住草图2 的全部
  const pts = []; for (const q of [[55, -5, 0], [95, -5, 0], [95, 25, 0], [55, 25, 0]]) pts.push(await P(q));
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  await drag([Math.min(...xs) - 5, Math.min(...ys) - 30], [Math.max(...xs) + 5, Math.max(...ys) + 5]); await sleep(300); await shot('bx1-boxed');
  const st1 = await p.evaluate(() => ({ active: __cad.active(), toast: document.querySelector('#toast').textContent }));
  await p.keyboard.press('Control+c'); await sleep(150);
  const tgt = await P([75, 50, 0]); await p.mouse.move(tgt[0], tgt[1], { steps: 4 }); await p.keyboard.press('Control+v'); await sleep(500); await shot('bx2-pasted');
  const n = await p.evaluate(() => __cad.sketch(__cad.active()).entities.length);
  // 2) 退出草图，框选模型的边（从右往左＝碰到就算）
  await p.keyboard.press('Escape'); await click('sketch-done'); await sleep(300); await click('view-iso'); await sleep(500); await click('view-fit'); await sleep(600);
  const c = await P([40, 0, 20]); await drag([c[0] + 30, c[1] + 25], [c[0] - 30, c[1] - 25]); await sleep(300); await shot('bx3-edges');
  const st3 = await p.evaluate(() => document.querySelector('#status').textContent);
  console.log(JSON.stringify({ st1, entsAfterPaste: n, st3 }));
}
