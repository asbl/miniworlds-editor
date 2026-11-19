"""Change a running program's numbers (and nothing else) without restarting it.

The page sends the current text of the project's files. For each file this module compares it with the text the
running code was compiled from:

* only comments, blank lines or the *numbers inside function bodies* differ -> the new code is put into the live
  function objects (``function.__code__ = ...``): the very next call uses it, objects and their state stay;
* anything else differs (other statements, names, module- or class-level values such as ``speed = 3`` or the start
  position in ``Figur((200, 150))``) -> nothing is touched and the answer says ``reload``: those values only take effect
  when the program starts again.

Pure Python, no pygame: ``apply`` works on any program, ``diff`` is testable without a browser.
"""
from __future__ import annotations

import ast
import copy
import gc
import types

# text the live code corresponds to, per path ("classes/Figur.py"); filled when a program starts, updated by `apply`
_baseline: dict[str, str] = {}
_root = "/project"


def start(files: dict[str, str], root: str = "/project") -> None:
    """A program is starting: remember the text it is compiled from."""
    global _root
    _root = root
    _baseline.clear()
    _baseline.update(files)


def _is_number(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and isinstance(node.value, (int, float, complex)) and not isinstance(node.value, bool)


class _Zero(ast.NodeTransformer):
    """Numbers become 0: two functions that differ only in their numbers then have the same dump."""

    def visit_Constant(self, node: ast.Constant):
        return ast.copy_location(ast.Constant(0), node) if _is_number(node) else node

    def visit_UnaryOp(self, node: ast.UnaryOp):
        # "-3" is a minus applied to 3 in the tree, but one constant in the code: both spellings are "a number"
        if isinstance(node.op, (ast.USub, ast.UAdd)) and _is_number(node.operand):
            return ast.copy_location(ast.Constant(0), node)
        return self.generic_visit(node)


class _Units(ast.NodeVisitor):
    """The function definitions of a module by qualified name (as ``co_qualname`` spells it)."""

    def __init__(self):
        self.units: dict[str, ast.AST] = {}
        self.duplicates: set[str] = set()
        self._scope: list[str] = []

    def _add(self, node, name):
        qualified = ".".join(self._scope + [name])
        if qualified in self.units:
            self.duplicates.add(qualified)
        self.units[qualified] = node

    def visit_ClassDef(self, node):
        self._scope.append(node.name)
        self.generic_visit(node)
        self._scope.pop()

    def _function(self, node):
        self._add(node, node.name)
        self._scope.extend([node.name, "<locals>"])
        self.generic_visit(node)
        del self._scope[-2:]

    visit_FunctionDef = _function
    visit_AsyncFunctionDef = _function


class _Hollow(ast.NodeTransformer):
    """The module without function bodies: what is left is code that runs once, when the program starts."""

    def _function(self, node):
        node.body = [ast.Pass()]
        return node  # decorators, defaults and annotations stay: they run at definition time

    visit_FunctionDef = _function
    visit_AsyncFunctionDef = _function


def _dump(node: ast.AST) -> str:
    return ast.dump(node, annotate_fields=False, include_attributes=False)


def _skeleton(node: ast.AST) -> str:
    return _dump(_Zero().visit(copy.deepcopy(node)))


def _header(node: ast.AST) -> str:
    """Decorators, parameters (with defaults) and annotations: all of it must stay exactly the same."""
    shell = copy.copy(node)
    shell.body = [ast.Pass()]
    return _dump(shell)


def _codes(code: types.CodeType, found: dict[str, list[types.CodeType]]) -> None:
    for const in code.co_consts:
        if isinstance(const, types.CodeType):
            found.setdefault(const.co_qualname, []).append(const)
            _codes(const, found)


class Plan:
    """What `diff` found: which functions get new code, or why the program has to start again."""

    def __init__(self):
        self.reload: str | None = None  # reason, or None when the change can be applied live
        self.swaps: list[tuple[types.CodeType, types.CodeType]] = []  # (old code, new code)

    def __repr__(self):  # pragma: no cover - debugging aid
        return f"Plan(reload={self.reload!r}, swaps={[n.co_qualname for _, n in self.swaps]})"


def diff(path: str, old: str, new: str) -> Plan:
    plan = Plan()
    if old == new:
        return plan
    try:
        old_tree, new_tree = ast.parse(old, path), ast.parse(new, path)
    except SyntaxError:
        plan.reload = "syntax"
        return plan
    if _dump(_Hollow().visit(copy.deepcopy(old_tree))) != _dump(_Hollow().visit(copy.deepcopy(new_tree))):
        plan.reload = "module"  # code that only runs at the start changed (including its numbers)
        return plan
    old_units, new_units = _Units(), _Units()
    old_units.visit(old_tree)
    new_units.visit(new_tree)
    if old_units.duplicates or new_units.duplicates:
        plan.reload = "ambiguous"
        return plan
    if old_units.units.keys() != new_units.units.keys():
        plan.reload = "functions"
        return plan
    changed = [q for q in new_units.units if _dump(old_units.units[q]) != _dump(new_units.units[q])]
    for q in changed:
        # a default value or decorator argument lives outside the function's code: only the body may differ in numbers
        if _header(old_units.units[q]) != _header(new_units.units[q]) or _skeleton(old_units.units[q]) != _skeleton(new_units.units[q]):
            plan.reload = f"structure:{q}"
            return plan
    old_codes: dict[str, list[types.CodeType]] = {}
    new_codes: dict[str, list[types.CodeType]] = {}
    _codes(compile(old, path, "exec", dont_inherit=True), old_codes)
    _codes(compile(new, path, "exec", dont_inherit=True), new_codes)
    # every function gets the new code, not only those with other numbers: a comment or blank line moves the line numbers
    for qualified in new_units.units:
        olds, news = old_codes.get(qualified, []), new_codes.get(qualified, [])
        if len(olds) != 1 or len(news) != 1:
            plan.reload = f"ambiguous:{qualified}"
            return plan
        if olds[0].co_freevars != news[0].co_freevars or olds[0].co_varnames[: olds[0].co_argcount] != news[0].co_varnames[: news[0].co_argcount]:
            plan.reload = f"signature:{qualified}"
            return plan
        if olds[0] != news[0]:
            plan.swaps.append((olds[0], news[0]))
    return plan


def _live_functions(wanted: set[tuple[str, str, int]]) -> dict[tuple[str, str, int], list[types.FunctionType]]:
    """Function objects that run the given (file, qualified name, first line): found among everything the program holds."""
    found: dict[tuple[str, str, int], list[types.FunctionType]] = {}
    for obj in gc.get_objects():
        if type(obj) is types.FunctionType:
            key = (obj.__code__.co_filename, obj.__code__.co_qualname, obj.__code__.co_firstlineno)
            if key in wanted:
                found.setdefault(key, []).append(obj)
    return found


def apply(files: dict[str, str]) -> dict:
    """Bring the running program up to the texts in `files`.

    Answers ``{"reload": bool, "patched": n, "reasons": [...]}``: `reload` is true when something changed that only a
    restart can apply. Files that can be applied live are applied even when another one needs a restart, so the world
    is as current as it can be until it restarts.
    """
    plans: dict[str, Plan] = {}
    for path, text in files.items():
        if not path.endswith(".py"):
            continue
        old = _baseline.get(path)
        if old is None:
            _baseline[path] = text  # a new file: nothing runs from it yet (an import of it is a change elsewhere)
            continue
        plans[path] = diff(f"{_root}/{path}", old, text)
    wanted = {(f"{_root}/{path}", old.co_qualname, old.co_firstlineno) for path, plan in plans.items() if plan.reload is None for old, _ in plan.swaps}
    live = _live_functions(wanted) if wanted else {}
    patched = 0
    reasons = []
    for path, plan in plans.items():
        if plan.reload is not None:
            reasons.append(f"{path}: {plan.reload}")
            continue
        for old, new in plan.swaps:
            for function in live.get((f"{_root}/{path}", old.co_qualname, old.co_firstlineno), []):
                try:
                    function.__code__ = new
                    patched += 1
                except ValueError:  # a different number of free variables: cannot happen after `diff`, but never crash the program
                    reasons.append(f"{path}: closure")
        _baseline[path] = files[path]
    return {"reload": bool(reasons), "patched": patched, "reasons": reasons}
