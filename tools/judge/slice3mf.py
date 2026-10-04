# 判卷工具（冻结）：用本机 Bambu Studio 命令行把网站导出的 3MF 按 A1 0.4 / PLA / 0.20mm 切片，输出 JSON。
# 配方来自 D:\blender\PrintLapse\tools\make_fixtures.py（inherits 链必须自己展平，否则热床/机型不对或 return_code=-17）。
import json, os, subprocess, sys, tempfile

EXE = r"D:\3D PRINT\Bambu Studio\bambu-studio.exe"
PROFILES = r"D:\3D PRINT\Bambu Studio\resources\profiles\BBL"
MACHINE = "Bambu Lab A1 0.4 nozzle"
PROCESS = "0.20mm Standard @BBL A1"
FILAMENT = "Bambu PLA Basic @BBL A1"


def find_profile(kind, name):
    base = os.path.join(PROFILES, kind)
    for root, _, files in os.walk(base):
        if name + ".json" in files:
            return os.path.join(root, name + ".json")
    raise FileNotFoundError(kind + "/" + name)


def load_flat(kind, name):
    with open(find_profile(kind, name), encoding="utf-8") as f:
        d = json.load(f)
    merged = load_flat(kind, d["inherits"]) if d.get("inherits") else {}
    for inc in d.get("include", []):
        part = load_flat(kind, inc)
        merged.update({k: v for k, v in part.items() if k not in ("name", "type", "from", "instantiation")})
    merged.update(d)
    merged.pop("inherits", None)
    merged.pop("include", None)
    return merged


def main(model):
    if not os.path.exists(EXE):
        return {"ok": False, "error": "找不到 Bambu Studio: " + EXE}
    work = tempfile.mkdtemp(prefix="gc-slice-")
    machine = load_flat("machine", MACHINE)
    process = load_flat("process", PROCESS)
    process["compatible_printers"] = [MACHINE]
    process.pop("compatible_printers_condition", None)
    fil = load_flat("filament", FILAMENT)
    paths = []
    for n, d in (("machine", machine), ("process", process), ("filament", fil)):
        p = os.path.join(work, n + ".json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(d, f)
        paths.append(p)
    out = os.path.join(work, "out.gcode.3mf")
    cmd = [EXE, "--slice", "0", "--arrange", "1", "--export-3mf", out,
           "--load-settings", paths[0] + ";" + paths[1], "--load-filaments", paths[2], os.path.abspath(model)]
    try:
        subprocess.run(cmd, cwd=work, timeout=300, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "切片超时 300s"}
    res = os.path.join(work, "result.json")
    if not os.path.exists(res):
        return {"ok": False, "error": "没有 result.json"}
    with open(res, encoding="utf-8") as f:
        r = json.load(f)
    objs = []
    for pl in r.get("sliced_plates", []):
        for o in pl.get("objects", []):
            b = o.get("bbox", {})
            objs.append([b.get("width"), b.get("depth"), b.get("height")])
    return {"ok": r.get("return_code") == 0, "return_code": r.get("return_code"), "error": r.get("error_string"),
            "objects": objs, "gcodeBytes": os.path.getsize(out) if os.path.exists(out) else 0}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(main(sys.argv[1])))
