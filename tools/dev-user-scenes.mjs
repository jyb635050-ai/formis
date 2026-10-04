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
