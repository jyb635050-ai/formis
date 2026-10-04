// 主线程侧：给后台内核发重建/导出请求；idle() 等全部完成
export function createKernel({ onReady, onBuilt }) {
  const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  let ready = false, ver = 0, doneVer = 0, nextId = 1, lastKey = null;
  const calls = new Map(), waiters = [];
  const settle = () => {
    if (!ready || doneVer !== ver || calls.size) return;
    while (waiters.length) waiters.shift()();
  };
  w.onmessage = e => {
    const m = e.data;
    if (m.type === 'ready') { ready = true; onReady && onReady(); settle(); return; }
    if (m.type === 'built') { if (m.ver >= doneVer) { doneVer = m.ver; if (m.ver === ver) onBuilt(m); } settle(); return; }
    if (m.type === 'skipped') return;
    const c = calls.get(m.id);
    if (m.type === 'fail' && m.ver) { if (m.ver >= doneVer) doneVer = m.ver; settle(); return; }
    if (!c) return;
    calls.delete(m.id);
    if (m.type === 'fail') c.rej(new Error(m.error)); else c.res(m);
    settle();
  };
  w.onerror = e => { e.preventDefault && e.preventDefault(); };
  const api = {
    get ready() { return ready; },
    build(payload, force) {
      const key = JSON.stringify(payload);
      if (!force && key === lastKey) return;
      lastKey = key; ver++;
      w.postMessage({ type: 'build', ver, doc: payload });
    },
    call(type, data) {
      const id = nextId++;
      return new Promise((res, rej) => { calls.set(id, { res, rej }); w.postMessage({ type, id, ...data }); });
    },
    idle() { return new Promise(r => { waiters.push(r); settle(); }); },
    busy() { return !ready || doneVer !== ver || calls.size > 0; },
  };
  return api;
}
