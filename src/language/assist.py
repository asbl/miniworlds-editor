"""Runs inside the *light* Pyodide of the language worker: jedi (completion, hover) and miniworlds' beginner hints.

No pygame/numpy here (a hard crash must never take the world down, and the second interpreter stays small).
miniworlds is installed without dependencies; `miniworlds/__init__` imports pygame, so `import miniworlds` is replaced by a
stub package that only knows its path. jedi reads the real package files statically; `miniworlds.tools.code_hints` runs
with the API index that the world worker computed (the index needs the real package).
"""
import json
import os
import sys
import types

ROOT = "/project"
_api = None
_mirror = {}  # path -> text last written
_tools_ok = False


def setup():
    """Stub miniworlds' __init__ and import its pygame-free tools. Returns what is available."""
    global _tools_ok
    pkg = next((os.path.join(p, "miniworlds") for p in sys.path if os.path.isdir(os.path.join(p, "miniworlds"))), None)
    if pkg is None:
        return json.dumps({"hints": False})
    stub = types.ModuleType("miniworlds")
    stub.__path__ = [pkg]
    sys.modules["miniworlds"] = stub
    try:
        from miniworlds.tools import code_hints  # noqa: F401 - checks that the module exists in this version

        _tools_ok = True
    except Exception:  # versions before 4.4.0.15 have no code_hints
        _tools_ok = False
    os.makedirs(ROOT, exist_ok=True)
    return json.dumps({"hints": _tools_ok})


def set_api(index_json):
    global _api
    _api = json.loads(index_json)


def _safe(path):
    """Project paths are relative and stay inside ROOT (an imported ZIP is not trusted)."""
    parts = path.split("/")
    return bool(path) and not path.startswith("/") and ".." not in parts and "\\" not in path and path.endswith(".py")


def sync(files_json):
    """Mirror the project's .py files so jedi can resolve `from classes.X import X`."""
    files = {p: t for p, t in json.loads(files_json).items() if _safe(p)}
    for dirpath, _dirs, names in os.walk(ROOT):
        for name in names:
            rel = os.path.relpath(os.path.join(dirpath, name), ROOT).replace(os.sep, "/")
            if rel not in files:
                try:
                    _mirror.pop(rel, None)
                    os.remove(os.path.join(dirpath, name))
                except OSError:
                    pass
    for path, text in files.items():
        if _mirror.get(path) == text and os.path.exists(os.path.join(ROOT, path)):
            continue  # unchanged: keep the file (and its mtime, which jedi's caches depend on)
        full = os.path.join(ROOT, path)
        try:
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8", errors="replace") as f:
                f.write(text)
            _mirror[path] = text
        except OSError:  # one unwritable file (e.g. a folder of the same name) must not stop the mirror
            continue


def _script(path, source):
    import jedi

    return jedi.Script(source, path=os.path.join(ROOT, path), project=jedi.Project(ROOT))


def _doc_line(completion):
    try:
        text = completion.docstring(raw=True, fast=True) or ""
    except Exception:
        return ""
    return text.strip().split("\n")[0][:140]


def _api_members(chain_class):
    """Members of a miniworlds class (own and inherited) from the API index, for chains jedi cannot follow."""
    out, seen, name = [], set(), chain_class
    while name and _api and name in _api.get("classes", {}):
        entry = _api["classes"][name]
        for m in entry["members"]:
            if m["name"] not in seen:
                seen.add(m["name"])
                out.append(m)
        name = entry.get("base")
    return out


def _world_class_name(source):
    import ast

    try:
        tree = ast.parse(source)
    except SyntaxError:
        return "World"
    lib = _api.get("classes", {}) if _api else {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for base in node.bases:
                n = base.attr if isinstance(base, ast.Attribute) else getattr(base, "id", None)
                if n in lib and lib[n]["kind"] == "world":
                    return n
    return "World"


def complete(path, source, line, col):
    """Completions at (line 1-based, col 0-based) as JSON: [{name, type, doc}]."""
    script = _script(path, source)
    items = [{"name": c.name, "type": c.type, "doc": _doc_line(c)} for c in script.complete(line, col)]
    # jedi cannot infer `self.world` (a property): fill it from the API index, like the old client did
    before = source.split("\n")[line - 1][:col] if line - 1 < len(source.split("\n")) else ""
    if before.rstrip().endswith(("self.world.",)) or before.split(" ")[-1].startswith("self.world."):
        have = {i["name"] for i in items}
        prefix = before.split("self.world.")[-1]
        for m in _api_members(_world_class_name(source)):
            if m["name"].startswith(prefix) and m["name"] not in have:
                items.append({"name": m["name"], "type": "function" if m["kind"] == "method" else "property", "doc": m.get("doc", "")})
    return json.dumps(items)


def hover(path, source, line, col):
    """Documentation for the name at the position: JSON {name, type, doc} or null."""
    helped = _script(path, source).help(line, col)
    if not helped:
        return "null"
    n = helped[0]
    doc = (n.docstring() or "").strip()
    return json.dumps({"name": n.name, "type": n.type, "doc": doc[:1200]})


def signature(path, source, line, col):
    """The call around the cursor: JSON {name, params, index} (index = parameter being typed) or null."""
    try:
        signatures = _script(path, source).get_signatures(line, col)
    except Exception:  # jedi can fail on half-typed code; no tooltip is fine
        return "null"
    if not signatures:
        return "null"
    s = signatures[0]
    params = []
    for p in s.params:
        text = p.to_string().strip()
        params.append(text[len("param "):] if text.startswith("param ") else text)
    return json.dumps({"name": s.name, "params": params, "index": s.index})


def hints(files_json):
    """Beginner hints from miniworlds.tools.code_hints (empty list when the engine version has none)."""
    if not _tools_ok or _api is None:
        return "[]"
    from miniworlds.tools import code_hints

    return json.dumps(code_hints.check(json.loads(files_json), _api))
