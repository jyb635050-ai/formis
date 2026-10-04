# GlassCAD 进度记录

## 开工回执（2026-10-04）
- 目标：浏览器 CAD（尺寸驱动草图 + OpenCascade 实体特征 + 工程图 + DXF/SVG/PDF/3MF/STEP 导出），液态玻璃 UI，上线 GitHub Pages；判卷 tools/accept.mjs 本地 84/84、线上 83/83、--prove 14/14。
- 顺序：骨架+后台内核+主题语言玻璃 → 约束求解 → 三维特征与导出 → 二维界面与图纸导出 → 三维界面 → 工程图 → 保存 → 全量/反向 → 上线。
- 最大风险：三维真鼠标交互（拾取边/面、视图正交、以光标缩放）与判卷像素/坐标判据对齐；重模型重建期间主线程不卡（内核必须在 Worker，主线程只收网格）。
- 任务 0：指纹 4b0ca9ea…2ad8c 一致；`--only boot` 1/5、退出码 1。

## 进度
- 任务1 骨架：build,boot,ui 15/15（2026-10-04）
- 任务2 约束：solver 7/7
- 任务3 建模导出：model 20/20、heavy 4/4（重建最长帧 27ms）
- 任务4–7：sketch 18/18、ui3d 13/13、sheet 5/5、persist 4/4
- 本地全量 84/84、退出码 0（1分24秒）
- 任务8：--prove 14/14 抓到、退出码 1（3分54秒）
- 任务9：仓库 github.com/jyb635050-ai/glass-cad（main=源码，gh-pages=构建产物，带 .nojekyll）；线上 https://jyb635050-ai.github.io/glass-cad/ `--url` 83/83、退出码 0；线上内核 2.2 秒就绪（Pages 对 wasm 走 gzip，7.3MB）
- 判卷外自检：L 形零件拉伸+贯穿切 30500、三角形旋转 270° 15707.96 与公式一致；源码无探测判卷字样；连续改尺寸 30 次重建 31→12ms 不涨
- 遗留：导出的 DXF 只用 ezdxf 验过，没在 AutoCAD/DWG TrueView 里人工打开看（尺寸块名不带 *，Autodesk 是否照常显示未验证）

## 部署方法
1. `npm run build`
2. `rm -rf .deploy && cp -r dist .deploy && touch .deploy/.nojekyll`，在 .deploy 里 `git init -b gh-pages` 并提交
3. 单独一条命令：`git -C .deploy push -f https://github.com/jyb635050-ai/glass-cad.git gh-pages:gh-pages`
4. `node tools/accept.mjs --url https://jyb635050-ai.github.io/glass-cad/`
