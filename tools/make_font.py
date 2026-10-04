# 生成 PDF 导出用的中文字体子集：Noto Sans SC（OFL）可变字体 → 400 字重静态 → 只留 ASCII + GB2312 + 常用制图符号
# 用法：PYTHONPATH=tools/judge/pylib python tools/make_font.py   （源字体 tools/font/NotoSansSC-VF.ttf，来自 github.com/google/fonts ofl/notosanssc）
import os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(ROOT, "tools", "font", "NotoSansSC-VF.ttf")
out = os.path.join(ROOT, "public", "fonts", "NotoSansSC-GB2312.ttf")
chars = set(chr(c) for c in range(0x20, 0x7F)) | set("ØøΦφ°±×÷≤≥≈∅⌀²³µΩ·—–…“”‘’《》、。，；：？！（）【】￥％")
for hi in range(0xA1, 0xF8):
    for lo in range(0xA1, 0xFF):
        try:
            chars.add(bytes([hi, lo]).decode("gb2312"))
        except UnicodeDecodeError:
            pass
f = TTFont(src)
f = instancer.instantiateVariableFont(f, {"wght": 400})
opts = subset.Options()
opts.layout_features = []
opts.name_IDs = ["*"]
opts.notdef_outline = True
opts.hinting = False
sub = subset.Subsetter(opts)
sub.populate(text="".join(chars))
sub.subset(f)
f.save(out)
print(out, os.path.getsize(out), "bytes,", len(chars), "chars")
