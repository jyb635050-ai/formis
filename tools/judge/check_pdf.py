# 判卷工具（冻结）：用 pypdf 独立解析网站导出的 PDF，输出 JSON 摘要给 tools/accept.mjs 判。
# 矢量判据：页面及其嵌套 Form XObject 里的画线指令（m/l/c/re）计数；图片判据：嵌套 XObject 里 Image 的个数。
import json, re, sys
from pypdf import PdfReader

OPS = re.compile(rb"(?<![A-Za-z])(l|c|re|m)(?=\s)")


def walk(res, seen, acc):
    try:
        xo = res.get_object().get("/XObject") if res else None
    except Exception:
        xo = None
    if not xo:
        return
    xo = xo.get_object()
    for k in xo:
        o = xo[k].get_object()
        if id(o) in seen:
            continue
        seen.add(id(o))
        st = o.get("/Subtype")
        if st == "/Image":
            acc["images"] += 1
        elif st == "/Form":
            try:
                acc["ops"] += len(OPS.findall(o.get_data()))
            except Exception:
                pass
            walk(o.get("/Resources"), seen, acc)


def main(path):
    try:
        r = PdfReader(path)
    except Exception as e:
        return {"ok": False, "error": "打不开: %s" % e}
    pages = []
    for p in r.pages:
        acc = {"images": 0, "ops": 0}
        try:
            c = p.get_contents()
            if c is not None:
                acc["ops"] += len(OPS.findall(c.get_data()))
        except Exception:
            pass
        walk(p.get("/Resources"), set(), acc)
        box = p.mediabox
        pages.append({"w": float(box.width), "h": float(box.height), "images": acc["images"], "pathOps": acc["ops"],
                      "text": p.extract_text() or ""})
    return {"ok": True, "pages": pages}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(main(sys.argv[1])))
