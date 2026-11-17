#!/usr/bin/env python3
"""One-off conversion of the Greenfoot web client's single-file scenarios into the editor's project format.

    python3 scripts/split_scenarios.py <path-to>/greenfoot/scenarios

Every top-level class becomes classes/<Name>.py (with the imports it needs); main.py keeps the remaining statements and
imports every class (the Greenfoot view only sees classes whose module has been loaded). Refuses scenarios whose classes import each other in a cycle. scenario.json is copied as scenario.de.json; scenario.en.json (hand-written) is kept.
The result is committed under src/templates/; this script documents how it was made.
"""
import ast
import json
import shutil
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "templates"


def convert(folder: Path) -> None:
    source = (folder / "main.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    lines = source.split("\n")
    imports = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom))]
    classes = [n for n in tree.body if isinstance(n, ast.ClassDef)]
    rest = [n for n in tree.body if n not in imports and n not in classes]
    names = {c.name for c in classes}

    def text(node):
        return "\n".join(lines[node.lineno - 1 : node.end_lineno])

    def used_names(node):
        return {n.id for n in ast.walk(node) if isinstance(n, ast.Name)}

    def import_aliases(imp):
        return [(a.asname or a.name.split(".")[0]) for a in imp.names]

    deps = {c.name: (used_names(c) & names) - {c.name} for c in classes}
    # cycle check (depth-first)
    state = {}

    def visit(n, path):
        if state.get(n) == 1:
            raise SystemExit(f"{folder.name}: import cycle {' -> '.join(path + [n])}")
        if state.get(n) == 2:
            return
        state[n] = 1
        for d in deps[n]:
            visit(d, path + [n])
        state[n] = 2

    for n in names:
        visit(n, [])

    target = OUT / folder.name
    # scenario.en.json is written by hand: keep it across regeneration
    english = (target / "scenario.en.json").read_text(encoding="utf-8") if (target / "scenario.en.json").exists() else None
    shutil.rmtree(target, ignore_errors=True)
    (target / "classes").mkdir(parents=True)

    for c in classes:
        used = used_names(c)
        head = [text(i) for i in imports if any(a in used for a in import_aliases(i))]
        head += [f"from classes.{d} import {d}" for d in sorted(deps[c.name])]
        body = text(c)
        (target / "classes" / f"{c.name}.py").write_text(("\n".join(head) + "\n\n\n" if head else "") + body + "\n", encoding="utf-8")

    main_used = set().union(*(used_names(n) for n in rest)) if rest else set()
    head = [text(i) for i in imports if any(a in main_used for a in import_aliases(i))]
    # import every class, used in main.py or not: the Greenfoot view only sees classes whose module has been loaded
    head += [f"from classes.{n} import {n}" for n in sorted(names)]
    (target / "main.py").write_text("\n".join(head) + "\n\n" + "\n".join(text(n) for n in rest) + "\n", encoding="utf-8")
    meta = json.loads((folder / "scenario.json").read_text(encoding="utf-8"))
    (target / "scenario.de.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if english is not None:
        (target / "scenario.en.json").write_text(english, encoding="utf-8")
    print(f"{folder.name}: {len(classes)} classes, deps {({k: sorted(v) for k, v in deps.items()})}")


if __name__ == "__main__":
    root = Path(sys.argv[1])
    for folder in sorted(p for p in root.iterdir() if (p / "main.py").exists()):
        convert(folder)
