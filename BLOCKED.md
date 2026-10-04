# 待裁决清单

1. 判卷 tools/judge/check_dxf.py 的角度尺寸换算疑似多算一次：ezdxf 1.4.4 对角度尺寸（dimtype 2）`get_measurement()` 返回的已经是"度"（实测：45° 的尺寸返回 45），脚本又做了 `math.degrees()`，得到 2578.31。
   当前判卷的 sketch.dxf 不考角度尺寸，所以不影响 84 项判分；但以后若加角度尺寸用例会误判。按规矩判卷不许改，留给管理者裁决。
   复现：在草图里加一条 angle 尺寸后导出 DXF，跑 `python tools/judge/check_dxf.py x.dxf` 看 dims。
