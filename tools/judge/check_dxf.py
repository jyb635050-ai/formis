# 判卷工具（冻结）：用 ezdxf 独立解析网站导出的 DXF，输出 JSON 摘要给 tools/accept.mjs 判。
# 用法：python tools/judge/check_dxf.py 文件.dxf      （PYTHONPATH 指向 tools/judge/pylib）
import json, math, sys
import ezdxf
from ezdxf import bbox as ebbox

GEOM = ("LINE", "CIRCLE", "ARC", "LWPOLYLINE", "POLYLINE", "SPLINE", "ELLIPSE")


def main(path):
    out = {"ok": False}
    try:
        doc = ezdxf.readfile(path)
    except Exception as e:
        out["error"] = "严格读取失败: %s" % e
        return out
    aud = doc.audit()
    out.update(ok=True, version=doc.dxfversion, insunits=doc.header.get("$INSUNITS"),
               auditErrors=[str(x.message) for x in aud.errors][:10],
               auditFixes=[str(x.message) for x in aud.fixes][:10])
    msp = doc.modelspace()

    def dashed(e):
        name = e.dxf.get("linetype", "BYLAYER")
        if name.upper() == "BYLAYER":
            try:
                name = doc.layers.get(e.dxf.layer).dxf.linetype
            except Exception:
                name = "CONTINUOUS"
        if name.upper() in ("BYBLOCK", "CONTINUOUS"):
            return False
        try:
            return len(doc.linetypes.get(name).simplified_line_pattern()) > 0
        except Exception:
            return False

    ents, texts, dims = [], [], []
    for e in msp:
        t = e.dxftype()
        if t in ("TEXT", "MTEXT"):
            texts.append(e.plain_text() if t == "MTEXT" else e.dxf.text)
            continue
        if t == "DIMENSION":
            d = {"dimtype": e.dimtype & 7, "block": e.dxf.get("geometry")}
            try:
                d["measurement"] = float(e.get_measurement()) if (e.dimtype & 7) != 2 else math.degrees(float(e.get_measurement()))
            except Exception as ex:
                d["measurement"] = None
                d["err"] = str(ex)
            d["blockOk"] = bool(d["block"]) and d["block"] in doc.blocks and len(doc.blocks.get(d["block"])) > 0
            dims.append(d)
            continue
        if t not in GEOM:
            continue
        r = {"type": t, "layer": e.dxf.layer, "dashed": dashed(e)}
        if t == "LINE":
            r["a"] = list(e.dxf.start)[:2]; r["b"] = list(e.dxf.end)[:2]
        elif t == "CIRCLE":
            r["c"] = list(e.dxf.center)[:2]; r["r"] = e.dxf.radius
        elif t == "ARC":
            r["c"] = list(e.dxf.center)[:2]; r["r"] = e.dxf.radius
            r["a0"] = e.dxf.start_angle; r["a1"] = e.dxf.end_angle
        try:
            b = ebbox.extents([e], fast=False)
            r["bbox"] = [b.extmin.x, b.extmin.y, b.extmax.x, b.extmax.y]
        except Exception:
            r["bbox"] = None
        ents.append(r)

    # 把几何按包围盒相交（间隙 ≤0.5mm）聚成团——工程图里一团＝一个视图；图层名含 FRAME 的（图框、标题栏）不参与
    boxes = [i for i, r in enumerate(ents) if r["bbox"] and "FRAME" not in r["layer"].upper()]
    parent = {i: i for i in boxes}

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    g = 0.5
    for x in range(len(boxes)):
        a = ents[boxes[x]]["bbox"]
        for y in range(x + 1, len(boxes)):
            b = ents[boxes[y]]["bbox"]
            if a[0] - g <= b[2] and b[0] - g <= a[2] and a[1] - g <= b[3] and b[1] - g <= a[3]:
                parent[find(boxes[x])] = find(boxes[y])
    # 团与团的包围盒相交也合并（视图内部的孔、圆不和外框线相交），反复直到稳定
    while True:
        roots = sorted({find(i) for i in boxes})
        bb = {}
        for i in boxes:
            b = ents[i]["bbox"]; k = find(i)
            c = bb.get(k, b)
            bb[k] = [min(c[0], b[0]), min(c[1], b[1]), max(c[2], b[2]), max(c[3], b[3])]
        merged = False
        for x in range(len(roots)):
            for y in range(x + 1, len(roots)):
                a, b = bb[roots[x]], bb[roots[y]]
                if find(roots[x]) != find(roots[y]) and a[0] - g <= b[2] and b[0] - g <= a[2] and a[1] - g <= b[3] and b[1] - g <= a[3]:
                    parent[find(roots[x])] = find(roots[y]); merged = True
        if not merged:
            break
    cl = {}
    for i in boxes:
        k = find(i)
        c = cl.setdefault(k, {"bbox": list(ents[i]["bbox"]), "vbbox": None, "n": 0, "dashed": 0})
        b = ents[i]["bbox"]
        c["bbox"] = [min(c["bbox"][0], b[0]), min(c["bbox"][1], b[1]), max(c["bbox"][2], b[2]), max(c["bbox"][3], b[3])]
        c["n"] += 1
        if ents[i]["dashed"]:
            c["dashed"] += 1
        else:  # vbbox＝只算实线（可见轮廓）的包围盒，中心线、虚线不算
            v = c["vbbox"] or list(b)
            c["vbbox"] = [min(v[0], b[0]), min(v[1], b[1]), max(v[2], b[2]), max(v[3], b[3])]
    out.update(entities=ents, texts=texts, dims=dims, clusters=sorted(cl.values(), key=lambda c: -c["n"]))
    return out


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(main(sys.argv[1])))
