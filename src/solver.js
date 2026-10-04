// 草图约束求解：FreeCAD 的 planegcs（WebAssembly），主线程同步求解（小草图 1–10 毫秒）
import { init_planegcs_module, GcsWrapper } from '@salusoft89/planegcs';
import gcsWasm from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';

let GM = null;
export async function initSolver() { GM = await init_planegcs_module({ locateFile: () => gcsWasm }); }
export const solverReady = () => !!GM;

const rad = d => (d * Math.PI) / 180, deg = r => (r * 180) / Math.PI;
export const kindOf = (sk, id) => (sk.ents.find(e => e.id === id) || {}).type;

// 点引用 'L3.a' 当前坐标
export function ptOf(sk, ref) {
  const [id, k] = ref.split('.');
  const e = sk.ents.find(x => x.id === id);
  if (!e) throw new Error('找不到 ' + ref);
  if (e.type === 'arc' && k !== 'c') { const a = k === 'a' ? e.a0 : e.a1; return [e.c[0] + e.r * Math.cos(rad(a)), e.c[1] + e.r * Math.sin(rad(a))]; }
  if (e.type === 'text') return e.at;
  const p = e[k]; if (!p) throw new Error('找不到 ' + ref);
  return p;
}

function prims(sk, drag) {
  const P = [], pt = (id, p) => P.push({ id, type: 'point', x: p[0], y: p[1], fixed: false });
  for (const e of sk.ents) {
    if (e.type === 'line') { pt(e.id + '.a', e.a); pt(e.id + '.b', e.b); P.push({ id: e.id, type: 'line', p1_id: e.id + '.a', p2_id: e.id + '.b' }); }
    else if (e.type === 'circle') { pt(e.id + '.c', e.c); P.push({ id: e.id, type: 'circle', c_id: e.id + '.c', radius: e.r }); }
    else if (e.type === 'arc') {
      pt(e.id + '.c', e.c); pt(e.id + '.a', ptOf(sk, e.id + '.a')); pt(e.id + '.b', ptOf(sk, e.id + '.b'));
      let a1 = e.a1; while (a1 <= e.a0) a1 += 360;
      P.push({ id: e.id, type: 'arc', c_id: e.id + '.c', start_id: e.id + '.a', end_id: e.id + '.b', start_angle: rad(e.a0), end_angle: rad(a1), radius: e.r });
      P.push({ id: e.id + '#rules', type: 'arc_rules', a_id: e.id });
    }
  }
  for (const c of sk.cons) {
    const [p, q] = c.refs, kp = kindOf(sk, p), kq = kindOf(sk, q);
    switch (c.type) {
      case 'coincident': P.push({ id: c.id, type: 'p2p_coincident', p1_id: p, p2_id: q }); break;
      case 'horizontal': P.push({ id: c.id, type: 'horizontal_l', l_id: p }); break;
      case 'vertical': P.push({ id: c.id, type: 'vertical_l', l_id: p }); break;
      case 'parallel': P.push({ id: c.id, type: 'parallel', l1_id: p, l2_id: q }); break;
      case 'perpendicular': P.push({ id: c.id, type: 'perpendicular_ll', l1_id: p, l2_id: q }); break;
      case 'tangent': {
        const [l, o] = kp === 'line' ? [p, q] : [q, p], ko = kindOf(sk, o);
        if (kindOf(sk, l) === 'line') P.push(ko === 'arc' ? { id: c.id, type: 'tangent_la', l_id: l, a_id: o } : { id: c.id, type: 'tangent_lc', l_id: l, c_id: o });
        else if (kp === 'arc' && kq === 'arc') P.push({ id: c.id, type: 'tangent_aa', a1_id: p, a2_id: q });
        else if (kp === 'circle' && kq === 'circle') P.push({ id: c.id, type: 'tangent_cc', c1_id: p, c2_id: q });
        else P.push(kp === 'circle' ? { id: c.id, type: 'tangent_ca', c_id: p, a_id: q } : { id: c.id, type: 'tangent_ca', c_id: q, a_id: p });
        break;
      }
      case 'equal':
        if (kp === 'line') P.push({ id: c.id, type: 'equal_length', l1_id: p, l2_id: q });
        else if (kp === 'circle' && kq === 'circle') P.push({ id: c.id, type: 'equal_radius_cc', c1_id: p, c2_id: q });
        else if (kp === 'arc' && kq === 'arc') P.push({ id: c.id, type: 'equal_radius_aa', a1_id: p, a2_id: q });
        else P.push(kp === 'circle' ? { id: c.id, type: 'equal_radius_ca', c_id: p, a_id: q } : { id: c.id, type: 'equal_radius_ca', c_id: q, a_id: p });
        break;
      case 'midpoint': P.push({ id: c.id, type: 'p2p_symmetric_ppp', p1_id: q + '.a', p2_id: q + '.b', p_id: p }); break;
      case 'pointon': P.push(kq === 'line' ? { id: c.id, type: 'point_on_line_pl', p_id: p, l_id: q } : kq === 'arc' ? { id: c.id, type: 'point_on_arc', p_id: p, a_id: q } : { id: c.id, type: 'point_on_circle', p_id: p, c_id: q }); break;
      case 'hpoints': P.push({ id: c.id, type: 'horizontal_pp', p1_id: p, p2_id: q }); break;
      case 'vpoints': P.push({ id: c.id, type: 'vertical_pp', p1_id: p, p2_id: q }); break;
      case 'fix': P.push({ id: c.id + '#x', type: 'coordinate_x', p_id: p, x: c.at[0] }); P.push({ id: c.id + '#y', type: 'coordinate_y', p_id: p, y: c.at[1] }); break;
      default: throw new Error('不支持的约束 ' + c.type);
    }
  }
  for (const d of sk.dims) {
    const [p, q] = d.refs, v = d.value, kp = kindOf(sk, p);
    switch (d.type) {
      case 'length': P.push({ id: d.id, type: 'p2p_distance', p1_id: p + '.a', p2_id: p + '.b', distance: v }); break;
      case 'distance': P.push({ id: d.id, type: 'p2p_distance', p1_id: p, p2_id: q, distance: v }); break;
      case 'hdist': P.push({ id: d.id, type: 'difference', param1: { o_id: p, prop: 'x' }, param2: { o_id: q, prop: 'x' }, difference: d.sign * v }); break;
      case 'vdist': P.push({ id: d.id, type: 'difference', param1: { o_id: p, prop: 'y' }, param2: { o_id: q, prop: 'y' }, difference: d.sign * v }); break;
      case 'radius': P.push(kp === 'arc' ? { id: d.id, type: 'arc_radius', a_id: p, radius: v } : { id: d.id, type: 'circle_radius', c_id: p, radius: v }); break;
      case 'diameter': P.push(kp === 'arc' ? { id: d.id, type: 'arc_diameter', a_id: p, diameter: v } : { id: d.id, type: 'circle_diameter', c_id: p, diameter: v }); break;
      case 'angle': P.push({ id: d.id, type: 'l2l_angle_ll', l1_id: p, l2_id: q, angle: d.sign * rad(v) }); break;
      default: throw new Error('不支持的尺寸 ' + d.type);
    }
  }
  if (drag) {
    P.push({ id: '#dragx', type: 'coordinate_x', p_id: drag.ref, x: drag.uv[0], temporary: true });
    P.push({ id: '#dragy', type: 'coordinate_y', p_id: drag.ref, y: drag.uv[1], temporary: true });
  }
  return P;
}

// 解草图；成功则就地改坐标、写 dof/status，返回 true；冲突/不收敛返回 false 且不改坐标
export function solveSketch(sk, drag) {
  if (!GM) throw new Error('求解器还没加载好');
  const g = new GcsWrapper(new GM.GcsSystem());
  try {
    g.push_primitives_and_params(prims(sk, drag));
    const st = g.solve();
    const conflict = g.has_gcs_conflicting_constraints() || g.has_gcs_redundant_constraints();
    if (conflict || (st !== 0 && !drag)) return false;
    g.apply_solution();
    const m = new Map(g.sketch_index.get_primitives().map(p => [p.id, p]));
    const P = id => { const p = m.get(id); return [p.x, p.y]; };
    const num = a => a.every(Number.isFinite);
    const upd = [];
    for (const e of sk.ents) {
      if (e.type === 'line') upd.push([e, { a: P(e.id + '.a'), b: P(e.id + '.b') }]);
      else if (e.type === 'circle') upd.push([e, { c: P(e.id + '.c'), r: m.get(e.id).radius }]);
      else if (e.type === 'arc') { const a = m.get(e.id); upd.push([e, { c: P(e.id + '.c'), r: a.radius, a0: deg(a.start_angle), a1: deg(a.end_angle) }]); }
    }
    for (const [, u] of upd) for (const v of Object.values(u)) if (!(Array.isArray(v) ? num(v) : Number.isFinite(v))) return false;
    for (const [e, u] of upd) Object.assign(e, u);
    if (!drag) { sk.dof = g.gcs.dof(); sk.status = 'ok'; }
    return true;
  } finally { try { g.destroy_gcs_module(); } catch (e) { } }
}
