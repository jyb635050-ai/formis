# 待裁决清单

1. 判卷 tools/judge/check_dxf.py 的角度尺寸换算疑似多算一次：ezdxf 1.4.4 对角度尺寸（dimtype 2）`get_measurement()` 返回的已经是"度"（实测：45° 的尺寸返回 45），脚本又做了 `math.degrees()`，得到 2578.31。
   当前判卷的 sketch.dxf 不考角度尺寸，所以不影响 84 项判分；但以后若加角度尺寸用例会误判。按规矩判卷不许改，留给管理者裁决。
   复现：在草图里加一条 angle 尺寸后导出 DXF，跑 `python tools/judge/check_dxf.py x.dxf` 看 dims。

2. ~~工程图加轴测图与判卷「恰好 3 个视图」冲突~~ —— **2026-10-04 领导裁决：改判卷，允许三视图之外再有一个轴测图**。只改了 tools/accept.mjs 的 sheet.dxf 这一条（3 或 3+1 团），其余不动。判卷合并指纹由 4b0ca9ea… 变为 `dd50f715427b5d0aacf0f729ca597e0f673369680ab827f4e9d4a31c85077578`。
