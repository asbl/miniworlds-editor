"""Native tests of src/runtime/livepatch.py (no browser): python -m pytest test/py  (any Python 3.11+ without pygame)."""
import importlib.util, os, sys, tempfile, textwrap

HERE = os.path.dirname(__file__)
spec = importlib.util.spec_from_file_location("livepatch", os.path.join(HERE, "..", "..", "src", "runtime", "livepatch.py"))
live = importlib.util.module_from_spec(spec)
sys.modules["livepatch"] = live
spec.loader.exec_module(live)

SRC = textwrap.dedent('''
    SPEED = 3

    class Figur:
        def __init__(self):
            self.x = 10

        def act(self, step=2):
            # moves
            self.x += 5
            return self.x

    def helper():
        return (200, 150)
''')


def load(source, name="proj"):
    """Compile `source` as a file under a temp root and exec it, like the program run."""
    root = tempfile.mkdtemp()
    path = os.path.join(root, f"{name}.py")
    with open(path, "w") as handle:
        handle.write(source)
    ns = {}
    exec(compile(source, path, "exec", dont_inherit=True), ns)
    return root, ns


def prepare(source):
    root, ns = load(source)
    live.start({"proj.py": source}, root)
    return ns


def test_numbers_in_a_method_are_patched_live():
    ns = prepare(SRC)
    figur = ns["Figur"]()
    assert figur.act() == 15
    result = live.apply({"proj.py": SRC.replace("self.x += 5", "self.x += 7")})
    assert result["reload"] is False and result["patched"] >= 1, result
    assert figur.act() == 15 + 7  # the same object, new number
    assert figur.x == 22


def test_a_comment_or_blank_line_is_not_a_reload():
    ns = prepare(SRC)
    figur = ns["Figur"]()
    edited = SRC.replace("# moves", "# moves a lot\n\n")
    result = live.apply({"proj.py": edited})
    assert result["reload"] is False
    assert figur.act() == 15
    # line numbers moved: the live code must carry them (tracebacks, jump targets)
    assert ns["Figur"].act.__code__.co_firstlineno == [i + 1 for i, l in enumerate(edited.split("\n")) if "def act" in l][0]


def test_tuple_constants_and_floats():
    ns = prepare(SRC)
    assert ns["helper"]() == (200, 150)
    result = live.apply({"proj.py": SRC.replace("(200, 150)", "(10, 20.5)")})
    assert result["reload"] is False
    assert ns["helper"]() == (10, 20.5)


def test_a_module_level_number_needs_a_reload():
    ns = prepare(SRC)
    result = live.apply({"proj.py": SRC.replace("SPEED = 3", "SPEED = 4")})
    assert result["reload"] is True and "module" in result["reasons"][0]
    assert ns["SPEED"] == 3  # untouched


def test_a_default_value_is_not_a_live_change():
    ns = prepare(SRC)
    result = live.apply({"proj.py": SRC.replace("step=2", "step=9")})
    assert result["reload"] is True
    assert ns["Figur"].act.__defaults__ == (2,)


def test_a_different_statement_needs_a_reload_and_changes_nothing():
    ns = prepare(SRC)
    figur = ns["Figur"]()
    result = live.apply({"proj.py": SRC.replace("self.x += 5", "self.x -= 5")})
    assert result["reload"] is True
    assert figur.act() == 15


def test_two_consecutive_changes_use_the_new_baseline():
    ns = prepare(SRC)
    figur = ns["Figur"]()
    live.apply({"proj.py": SRC.replace("self.x += 5", "self.x += 6")})
    second = live.apply({"proj.py": SRC.replace("self.x += 5", "self.x += 8")})
    assert second["reload"] is False
    assert figur.act() == 18


def test_a_syntax_error_asks_for_a_reload_but_does_not_crash():
    prepare(SRC)
    result = live.apply({"proj.py": SRC.replace("def act", "def act(")})
    assert result["reload"] is True


def test_a_new_file_is_not_a_reload():
    prepare(SRC)
    result = live.apply({"proj.py": SRC, "other.py": "x = 1\n"})
    assert result["reload"] is False


def test_negative_numbers_and_shared_constants():
    source = "class A:\n    def go(self):\n        return (5, 5)\n"
    ns = prepare(source)
    a = ns["A"]()
    result = live.apply({"proj.py": source.replace("(5, 5)", "(5, -3)")})
    assert result["reload"] is False
    assert a.go() == (5, -3)


def test_decorated_registered_function():
    source = textwrap.dedent('''
        class World:
            def register(self, fn):
                self.fn = fn
                return fn

        world = World()

        @world.register
        def act():
            return 4
    ''')
    ns = prepare(source)
    result = live.apply({"proj.py": source.replace("return 4", "return 9")})
    assert result["reload"] is False
    assert ns["world"].fn() == 9
