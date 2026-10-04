// 中英文案。界面上所有文字都从这里取；用户自己输入的内容不翻译（放在 data-user-content 元素里）
const zh = {
  app: '玻璃 CAD', tagline: '网页制图与建模',
  'mode-2d': '二维制图', 'mode-3d': '三维建模', 'mode-sheet': '工程图',
  theme: '深色/浅色', themeDark: '切到深色', themeLight: '切到浅色', lang: 'English',
  projectName: '项目名', untitled: '未命名零件',
  save: '保存项目', open: '打开项目', export: '导出',
  'export-dxf': '导出 DXF 图纸', 'export-svg': '导出 SVG', 'export-pdf': '导出 PDF', 'export-3mf': '导出 3MF（3D 打印）', 'export-step': '导出 STEP',
  sketchTools: '草图', featTools: '特征', views: '视图',
  'tool-select': '选择', 'tool-line': '直线', 'tool-rect': '矩形', 'tool-circle': '圆', 'tool-arc': '圆弧', 'tool-dim': '智能尺寸', 'tool-construction': '构造线',
  'new-sketch': '新建草图', 'sketch-done': '退出草图', 'make-sheet': '生成工程图',
  'feat-extrude': '拉伸凸台', 'feat-cut': '拉伸切除', 'feat-revolve': '旋转', 'feat-fillet': '圆角', 'feat-chamfer': '倒角', 'feat-shell': '抽壳',
  'view-front': '前视', 'view-top': '俯视', 'view-left': '左视', 'view-iso': '等轴测', 'view-fit': '全部显示',
  extrude: '拉伸', cut: '切除', revolve: '旋转', fillet: '圆角', chamfer: '倒角', shell: '抽壳', sketch: '草图',
  depth: '深度', radius: '半径', distance: '距离', thickness: '壁厚', angle: '角度', reverse: '反向', through: '完全贯穿', axis: '旋转轴',
  ok: '确定', cancel: '取消', edit: '编辑', del: '删除', suppress: '压缩', unsuppress: '解除压缩',
  tree: '特征树', noFeatures: '还没有特征：先新建草图，画一个封闭轮廓，再拉伸。',
  pickPlane: '选择草图平面：点一个基准面，或在模型上点一个平面',
  'plane-XY': '上视基准面 XY', 'plane-XZ': '前视基准面 XZ', 'plane-YZ': '右视基准面 YZ',
  pickEdges: '在模型上点选边（再点一次取消）', pickFaces: '在模型上点选要去掉的面', selected: '已选',
  needSketch: '请先选中一张草图（在特征树里点它，或刚退出的草图）', needSolid: '请先建出实体',
  volume: '体积', area: '表面积', size: '外形', dof: '自由度', fully: '完全定义', under: '欠定义',
  status2d: '二维制图：左键画图，右键拖动平移，滚轮缩放', status3d: '三维：中键/右键拖动＝旋转（空白处左键拖也行）· Ctrl+中键或 Shift+拖＝平移 · 滚轮缩放 · 双击中键＝全部显示',
  statusSheet: '工程图：滚轮缩放、拖动平移；导出 DXF/PDF/SVG',
  sheetSize: '图幅', scale: '比例', drawnBy: '制图', material: '材料', date: '日期', titleName: '零件名称', front: '主视图', top: '俯视图', left: '左视图',
  noSolidSheet: '先在三维里建出实体，再生成工程图',
  hint: '提示', error: '出错了', conflict: '约束冲突', kernelLoading: '几何内核加载中…', kernelReady: '几何内核就绪',
  rebuild: '重建中…', saved: '已自动保存', opened: '已打开项目', exported: '已导出',
  undo: '撤销', redo: '重做',
  len: '长', ang: '角', snapEnd: '端点', snapMid: '中点', snapCenter: '圆心', snapQuad: '象限点', snapInt: '交点', snapOn: '在线上', snapOrigin: '原点',
  snapH: '水平', snapV: '竖直', snapAlign: '对齐',
  numLine: '输入长度，回车', numRect: '输入 宽,高，回车', numCircle: '输入半径，回车',
  autoSketch: '已自动选用草图', profileOpen: '草图轮廓没有封闭：红点是没接上的端点', keys: '快捷键：L 直线 · R 矩形 · C 圆 · A 圆弧 · D 尺寸 · S 选择 · 画图时直接敲数字定长度',
};
const en = {
  app: 'GlassCAD', tagline: 'Web drafting & modeling',
  'mode-2d': '2D Drafting', 'mode-3d': '3D Modeling', 'mode-sheet': 'Drawing Sheet',
  theme: 'Light/Dark', themeDark: 'Switch to dark', themeLight: 'Switch to light', lang: '中文',
  projectName: 'Project name', untitled: 'Untitled part',
  save: 'Save project', open: 'Open project', export: 'Export',
  'export-dxf': 'Export DXF', 'export-svg': 'Export SVG', 'export-pdf': 'Export PDF', 'export-3mf': 'Export 3MF (3D print)', 'export-step': 'Export STEP',
  sketchTools: 'Sketch', featTools: 'Features', views: 'Views',
  'tool-select': 'Select', 'tool-line': 'Line', 'tool-rect': 'Rectangle', 'tool-circle': 'Circle', 'tool-arc': 'Arc', 'tool-dim': 'Smart Dimension', 'tool-construction': 'Construction',
  'new-sketch': 'New Sketch', 'sketch-done': 'Exit Sketch', 'make-sheet': 'Make Drawing',
  'feat-extrude': 'Extruded Boss', 'feat-cut': 'Extruded Cut', 'feat-revolve': 'Revolve', 'feat-fillet': 'Fillet', 'feat-chamfer': 'Chamfer', 'feat-shell': 'Shell',
  'view-front': 'Front', 'view-top': 'Top', 'view-left': 'Left', 'view-iso': 'Isometric', 'view-fit': 'Zoom to Fit',
  extrude: 'Extrude', cut: 'Cut', revolve: 'Revolve', fillet: 'Fillet', chamfer: 'Chamfer', shell: 'Shell', sketch: 'Sketch',
  depth: 'Depth', radius: 'Radius', distance: 'Distance', thickness: 'Thickness', angle: 'Angle', reverse: 'Reverse', through: 'Through all', axis: 'Axis',
  ok: 'OK', cancel: 'Cancel', edit: 'Edit', del: 'Delete', suppress: 'Suppress', unsuppress: 'Unsuppress',
  tree: 'Feature Tree', noFeatures: 'No features yet: create a sketch, draw a closed profile, then extrude.',
  pickPlane: 'Pick a sketch plane: a datum plane, or click a planar face on the model',
  'plane-XY': 'Top plane XY', 'plane-XZ': 'Front plane XZ', 'plane-YZ': 'Right plane YZ',
  pickEdges: 'Click edges on the model (click again to deselect)', pickFaces: 'Click faces to remove', selected: 'Selected',
  needSketch: 'Select a sketch first (click it in the tree, or the sketch you just exited)', needSolid: 'Build a solid first',
  volume: 'Volume', area: 'Area', size: 'Size', dof: 'DOF', fully: 'Fully defined', under: 'Under defined',
  status2d: '2D: left-click to draw, right-drag to pan, wheel to zoom', status3d: '3D: middle/right-drag to rotate (or left-drag on empty space) · Ctrl+middle or Shift+drag to pan · wheel to zoom · double-middle-click to fit',
  statusSheet: 'Sheet: wheel to zoom, drag to pan; export DXF/PDF/SVG',
  sheetSize: 'Sheet', scale: 'Scale', drawnBy: 'Drawn', material: 'Material', date: 'Date', titleName: 'Part name', front: 'Front view', top: 'Top view', left: 'Left view',
  noSolidSheet: 'Build a solid in 3D first, then make the drawing',
  hint: 'Hint', error: 'Error', conflict: 'Constraint conflict', kernelLoading: 'Loading geometry kernel…', kernelReady: 'Geometry kernel ready',
  rebuild: 'Rebuilding…', saved: 'Autosaved', opened: 'Project opened', exported: 'Exported',
  undo: 'Undo', redo: 'Redo',
  len: 'L', ang: '∠', snapEnd: 'Endpoint', snapMid: 'Midpoint', snapCenter: 'Center', snapQuad: 'Quadrant', snapInt: 'Intersection', snapOn: 'On curve', snapOrigin: 'Origin',
  snapH: 'Horizontal', snapV: 'Vertical', snapAlign: 'Aligned',
  numLine: 'Type length, Enter', numRect: 'Type W,H, Enter', numCircle: 'Type radius, Enter',
  autoSketch: 'Sketch picked automatically', profileOpen: 'Sketch profile is not closed: red dots are loose endpoints', keys: 'Keys: L line · R rect · C circle · A arc · D dimension · S select · type a number while drawing',
};
const DICT = { zh, en };
let lang = 'zh';
try { const v = localStorage.getItem('glasscad.lang'); if (v === 'en' || v === 'zh') lang = v; } catch (e) { }
export const getLang = () => lang;
export function setLang(l) { lang = l; try { localStorage.setItem('glasscad.lang', l); } catch (e) { } }
export const t = k => (DICT[lang][k] ?? DICT.zh[k] ?? k);
// 特征默认名：拉伸1 / Extrude1（不存进文档，切语言自动跟着变）
export function featName(f, list) {
  const n = list.filter(x => x.type === f.type).indexOf(f) + 1;
  return lang === 'zh' ? `${t(f.type)}${n}` : `${t(f.type)}${n}`;
}
