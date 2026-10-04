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
