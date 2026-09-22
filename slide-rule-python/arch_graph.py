# -*- coding: utf-8 -*-
"""架构图不许手画：从**真代码**里把依赖图算出来，并按清单强制边界。

## 为什么有这个文件

2026-08-29 对照 grok-build 数出来的差距（见
`docs/欠缺模块清单-对照Claude与Grok-build.md` §16）：

    grok-build   架构图 **0 张**。91 个 crate 在各自 Cargo.toml 里显式声明
                 依赖（边上还写着为什么依赖），347 条边全由编译器强制；
                 循环依赖在 Rust 里根本编译不出来。根 Cargo.toml 是**生成的**，
                 README 里标着 treat it as read-only。
    WhyBuddy     架构图 17 张，全手画。265 个模块 394 条内部依赖边，**零强制**。

手画的后果已经量到过：已知缺口图六条里四条早就不成立、V6.0 的 19 个模块块有
12 个从没画过。而代码这边同样在飘——内部 import 有 62% 写在**函数体里**
（Python 里绕循环依赖的标准手法），顶层 import 图里有 5 个真的环，包括最核心
的那一对 `v5_full_driver ⇄ v5_capability_executor`。

**他们的架构图是编译器画的，我们的是人画的。** 这个文件补的就是那个编译器。

## 三件事，对应 grok 的三条

| grok | 这里 |
|---|---|
| 每个 crate 在 Cargo.toml 显式声明依赖 | `architecture.toml` 显式声明分层与允许的边 |
| 没声明就编译不过 / 循环编译不出来 | `tests/test_architecture.py` 是我们的编译器：未声明的边红、新增的环红 |
| 根 Cargo.toml 是**生成的**，read-only | `docs/SlideRule V6.2 架构图（自动生成）.md` 由本文件生成，判据保证它与代码同步 |

## ⚠ 三个非做不可的细节（少一个这道闸就是摆设）

**① 函数体里的 import 必须算数。**
全仓 62% 的内部 import 在函数体里。只数顶层 import 等于**默认放行三分之二的
依赖**，而且给了一个一句话就能绕过闸的办法：把 import 挪进函数。
本文件对两种一视同仁，只在报告里标出 `deferred`。

**② 存量违规用棘轮，不用一次大修。**
现存的违规和环冻进 `architecture.toml` 的 `[baseline]`，判据只比「有没有变多」。
想清哪条清哪条，清完从基线里删掉——**基线只许变短**。
一次性大改核心依赖的风险，远大于它能换来的整洁。

**③ 生成必须是确定性的。**
一切排序固定。否则两台电脑生成的文件不一样，就回到了「多台电脑架构不一致」
那个病——而那正是要治的东西。

## 用法

    python arch_graph.py --check     # 闸：违规/环有没有变多
    python arch_graph.py --emit      # 重新生成架构图（写 docs/）
    python arch_graph.py --freeze    # 把当前违规/环写进基线（**慎用**，只在有意接受时）
    python arch_graph.py --report    # 人看的摘要
"""

from __future__ import annotations

import argparse
import ast
import fnmatch
import json
import pathlib
import re
import subprocess
import sys
import tomllib
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parent
MANIFEST = ROOT / "architecture.toml"
DIAGRAM = REPO / "docs" / "SlideRule V6.2 架构图（自动生成）.md"
REPO_DIAGRAM = REPO / "docs" / "WhyBuddy 全仓架构图（自动生成）.md"
HISTORIC_MARK = "非权威 / 历史实验室笔记"

#: 对照 grok 可以画，WhyBuddy 产品图不许当目标节点。
#: 子代理改五系统 = 第二生成器；Bash/MCP 会把本仓收成编码代理。
FORBIDDEN_GROK_COPY = (
    "xai-grok-pager",
    "xai-grok-mcp",
    "xai-grok-subagent",
    "xai-grok-sandbox",
    "xai-grok-agent",
)

#: 顶层包 = 分层单位。对应 grok 的 crate。
#: ⚠ 2026-08-29：这份名单原来是**手写**的，而它同时被当成「哪些 import 算内部边」
#:   的筛子——于是任何不在名单里的顶层模块**结构上不可能有入边**。
#:   实测漏的是 `stdio_utf8`：`app.py` 第 24 行顶层 `from stdio_utf8 import
#:   configure_stdio_utf8`，图里那条边根本不存在，它在零入度名单里显示成"没人用"。
#:   同样漏的还有 `complete_migration`、`arch_graph`。
#:
#:   手写名单是这仓一路在拆的那种东西（合法域四本账、闸的常量拷贝）。现在改成
#:   **从真实模块集合派生**（`_package_roots`），加一个顶层 .py 或一个新包都不用
#:   再来改这里。下面这份只留作**兜底 + 判据的对照物**：
#:   `test_扫描器_包名单是从代码派生的` 会拿派生结果跟它比，少了就红。
_SEED_PACKAGES: Tuple[str, ...] = (
    "models",
    "config",
    "sliderule_llm",
    "services",
    "routes",
    "middlewares",
    "scripts",
    "app",
)

PACKAGES: Tuple[str, ...] = _SEED_PACKAGES

#: 不参与架构判定的目录。
#: ⚠ 判断用 `parts[0]`，不是 `"tests/" in str(p)`——写这个文件的第一版就是后者，
#:   而路径长这样：`tests/foo.py`（**没有前导斜杠**），于是 472 个测试文件全被
#:   算进了依赖图，"其它 → services" 1268 条噪音压过了真信号。
#:   判据 `test_architecture.py::Test扫描器自己没瞎` 钉的就是这一条。
_SKIP_DIRS = frozenset({"tests", ".venv", "__pycache__", "data", "static", "tmp", "node_modules"})


@dataclass(frozen=True)
class Edge:
    """一条依赖边。`deferred` = 写在函数体里的 import。"""

    src: str          # 源模块，如 services.v5_full_driver
    dst: str          # 目标模块
    src_pkg: str
    dst_pkg: str
    deferred: bool
    line: int
    column: int = 0

    def key(self) -> str:
        return f"{self.src} -> {self.dst}"


@dataclass
class Graph:
    modules: Set[str] = field(default_factory=set)
    edges: List[Edge] = field(default_factory=list)
    files_scanned: int = 0

    def pkg_edges(self) -> Set[Tuple[str, str]]:
        return {(e.src_pkg, e.dst_pkg) for e in self.edges if e.src_pkg != e.dst_pkg}

    def module_graph(self) -> Dict[str, Set[str]]:
        g: Dict[str, Set[str]] = {}
        for e in self.edges:
            g.setdefault(e.src, set()).add(e.dst)
        return g


def _module_name(path: pathlib.Path, root: pathlib.Path = ROOT) -> str:
    rel = path.relative_to(root)
    return rel.with_suffix("").as_posix().replace("/", ".")


def _pkg_of(module: str) -> str:
    """模块名的第一段就是它的包；顶层单文件模块自己就是一个包。

    ⚠ 2026-08-29 之前这里写的是
    `head if head in PACKAGES else "app" if module == "app" else "?"`，
    而 `layer_violations` 会把带 `"?"` 的边**整条跳过**。于是手写 PACKAGES
    漏掉的那几个顶层模块（`stdio_utf8` / `arch_graph` / `complete_migration`）
    造出了**第二个盲区**：就算边扫出来了，闸也当没看见。
    一份手写名单同时当筛子和分类器用，漏一项漏两次。
    """
    return module.split(".")[0]


def _resolve(node: ast.AST, here: str, roots: Optional[Set[str]] = None) -> List[str]:
    """把一条 import 语句解析成**候选**内部模块名（外部依赖丢掉）。

    ⚠ `from . import x` 的目标是 `当前包.x`，**不是当前包**。
      第一版漏了这一条：`from . import spec_first_pipeline` 被解析成 `services`，
      于是 `page_id_freeze ⇄ spec_first_pipeline` 这个环**扫不出来**。
      是变异测试逼出来的（故意造一个环，闸没红）——不做变异就会把一道
      漏筛的闸当成装好了。

    ⚠ `from .foo import bar` 里的 `bar` 可能是模块也可能是函数，AST 分不清。
      这里两个候选都吐出来（`包.foo` 与 `包.foo.bar`），由 `build_graph`
      拿真实模块集合去筛——**存在的才算边**。

    ⚠ `roots` 必须由调用方从真实文件派生，别退回硬编码的 `PACKAGES`。
      2026-08-29 实测：名单里漏了顶层的 `stdio_utf8`，于是 `app.py` 第 24 行
      那句顶层 import **在图里根本不存在**——它反而以"零入度、没人用"的样子
      出现在孤儿名单里。一份手写名单同时当筛子用，漏一项就是**静默漏边**，
      而漏边的闸看着是绿的。
    """
    out: List[str] = []
    if isinstance(node, ast.ImportFrom):
        if node.level:
            parts = here.split(".")[:-1]          # 去掉自身模块名 → 当前包路径
            up = node.level - 1
            base = parts[: len(parts) - up] if up else parts
            stem = [*base, node.module] if node.module else base
            out.append(".".join(stem))
            for a in node.names:                  # from . import <模块>
                out.append(".".join([*stem, a.name]))
        elif node.module:
            out.append(node.module)
            for a in node.names:
                out.append(f"{node.module}.{a.name}")
    elif isinstance(node, ast.Import):
        out.extend(a.name for a in node.names)
    return [m for m in out if m.split(".")[0] in (roots or PACKAGES)]


def _deferred_lines(tree: ast.AST) -> Set[int]:
    """函数体覆盖的行号。见模块头 ⚠① —— 这些 import 一样算数。"""
    lines: Set[int] = set()
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            lines.update(range(n.lineno, (n.end_lineno or n.lineno) + 1))
    return lines


def _sources(root: pathlib.Path) -> List[pathlib.Path]:
    out = []
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root)
        if any(part in _SKIP_DIRS for part in rel.parts):
            continue
        out.append(path)
    return out


class GraphScanError(ValueError):
    """A partial dependency graph must never be published or accepted."""


def _read_tree(path: pathlib.Path) -> ast.Module:
    try:
        return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except (SyntaxError, UnicodeError) as exc:
        raise GraphScanError(f"Cannot parse {path}: {exc}") from exc


def _import_targets(node: ast.AST, here: str, modules: Set[str]) -> Set[str]:
    roots = {m.split(".")[0] for m in modules}
    targets: Set[str] = set()
    for candidate in _resolve(node, here, roots):
        target = candidate if candidate in modules else candidate + ".__init__"
        if target in modules:
            targets.add(target)
            # Importing a child from outside its package executes each initializer.
            # Sibling imports do not restart the already active parent initializer.
            parts = target.split(".")
            for i in range(1, len(parts)):
                package = ".".join(parts[:i])
                initializer = package + ".__init__"
                if initializer in modules and not here.startswith(package + "."):
                    targets.add(initializer)
    return targets - {here}


def build_graph(root: pathlib.Path = ROOT) -> Graph:
    """两趟：先把模块集合收齐，再拿它筛 import 候选。

    ⚠ 必须两趟。`from .foo import bar` 里 `bar` 是模块还是函数，AST 分不清，
      只有对着**真实存在的模块集合**才能判——一趟走完就只能猜，而猜错的方向
      正好是漏边（把 `包.模块` 记成 `包`），漏边的闸看着是绿的。
    """
    g = Graph()
    files = _sources(root)
    for path in files:
        g.modules.add(_module_name(path, root))
    # 包名单从真实模块集合派生，不用手写的 PACKAGES 当筛子（见 _resolve ⚠）。
    for path in files:
        here = _module_name(path, root)
        g.files_scanned += 1
        tree = _read_tree(path)
        deferred = _deferred_lines(tree)
        for node in ast.walk(tree):
            if not isinstance(node, (ast.Import, ast.ImportFrom)):
                continue
            for target in sorted(_import_targets(node, here, g.modules)):
                g.edges.append(
                    Edge(
                        src=here,
                        dst=target,
                        src_pkg=_pkg_of(here),
                        dst_pkg=_pkg_of(target),
                        deferred=node.lineno in deferred,
                        line=node.lineno,
                        column=node.col_offset,
                    )
                )
    g.edges.sort(key=lambda e: (e.src, e.dst, e.line))
    return g


# ── component：同一个「crate」内部允许互相引用 ──────────────────────────────
#
# ⚠ 这不是给环开的后门，是把 grok 的模型补全。
#
#   Rust 里禁止的是 **crate 之间**成环；**同一个 crate 内部的模块可以互相引用**。
#   实测 grok-build：`xai-grok-tools` 内有 8 组互相引用的模块对、`xai-grok-shell`
#   内有 15 组，其中 `implementations ⇄ registry` 与我们
#   `capability_maps ⇄ slide_rule_executor` 形状完全一样（注册表与实现互指）。
#
#   我们的模块粒度比 crate 细，所以要显式声明「哪几个模块其实是同一个 crate」。
#   声明要写理由，而且**跨 component 的环照样红**——闸没有变松，只是量对了东西。
def component_of(manifest: dict) -> Dict[str, str]:
    owner: Dict[str, str] = {}
    for name, spec in manifest.get("component", {}).items():
        for m in spec.get("modules", []):
            owner[m] = name
    return owner


def component_violations(g: "Graph", manifest: dict) -> List[str]:
    """component 之间**没有声明过**的依赖边。对应 grok 的 Cargo.toml：
    没写在 `[dependencies]` 里的 crate，`use` 它就编译不过。

    ⚠ 这是 component 归组真正的价值所在。只归组不查依赖，那只是给模块贴标签。
    """
    spec = manifest.get("component", {})
    if not spec:
        return []
    owner = component_of(manifest)
    allowed = {n: set(c.get("may_depend_on", [])) for n, c in spec.items()}
    bad: Set[str] = set()
    for e in g.edges:
        a, b = owner.get(e.src), owner.get(e.dst)
        if a is None or b is None or a == b:
            continue
        if b not in allowed.get(a, set()):
            bad.add(f"{a} -> {b} :: {e.src} -> {e.dst}")
    return sorted(bad)


def _comp_map(manifest: dict) -> Dict[str, str]:
    return component_of(manifest)


def satellite_components(g: Graph, manifest: dict) -> List[str]:
    """**唯一的消费者正是它自己依赖的那个组** —— 那不是两个 crate，是一个。

    ## 为什么要有这条（2026-08-29 我自己栽进去了）

    `refine` 组三个模块（精修的范围计算器），唯一 import 它们的是
    `spec_first_pipeline`，而它们又回读 spec-first 自己的校验器
    （html_structure / spec_tree / app_graph）——`refine ⇄ spec_first` 这个组间环
    的全部内容。

    我在 §22.3 拒绝过合并，理由写的是「refine_page_scope 有 8 个消费者，散在三个组，
    不是流水线的私有卫星」。**那个 8 是裸 grep 数出来的**——命中的是注释和文档字符串。
    依赖图里真正的 import 方只有 1 个。

    也就是说：我拿一个错的测量去论证「不该做这件事」。⚠ **用 grep 数依赖，错的方向
    刚好是「看起来更耦合」，于是它会替你把该做的事挡下来**，而且看着像审慎。

    按 grok 的口径，同一个 crate 内部的模块互指是合法的（xai-grok-tools 8 对、
    xai-grok-shell 15 对，含 `implementations ⇄ registry`）。这种形状的正解是
    **合并**，不是给环开例外。

    这条判据把「数消费者」从人手里拿走：条件是
    「被且只被一个组依赖 ∧ 那个组正是它 may_depend_on 里的」。
    """
    users: Dict[str, Set[str]] = {}
    comp = _comp_map(manifest)
    for e in g.edges:
        a, b = comp.get(e.src), comp.get(e.dst)
        if a and b and a != b:
            users.setdefault(b, set()).add(a)
    out = []
    for name, spec in sorted((manifest.get("component") or {}).items()):
        seen = users.get(name) or set()
        if len(seen) == 1:
            only = next(iter(seen))
            if only in (spec.get("may_depend_on") or []):
                out.append(f"{name} 只被 {only} 依赖，而它自己又依赖 {only}")
    return out


def deferred_count(g: Graph) -> int:
    """函数体里的内部 import 语句数；多 alias 和隐式初始化不重复计数。"""
    return len({(e.src, e.line, e.column) for e in g.edges if e.deferred})


#: 一条 blocker code 长什么样：全大写下划线，至少两段。
#: 收窄到这个形状是为了别把 HTTP 头、环境变量名之类也当成闸的产物。
_BLOCKER_CODE_RE = re.compile(r"^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$")

#: 体检入口的名字。`record_verdict` 是本名，`_gate_record` 是调用侧的别名
#: （v5_capability_executor 顶层 import 时改的名）——两个都认，否则改个别名
#: 就等于悄悄退出体检。
_GATE_HEALTH_CALLS = ("record_verdict", "_gate_record")

#: 模块级 blocker code 声明的名字。
#:
#: ⚠ 2026-09-06 补的第二条入口。原来只认字面量 `{"code": "XXX_YYY"}` 字典，
#:   于是把 code 收在**查表**里的模块整个漏掉：
#:
#:       _CODE = {SurfaceReason.SUBMIT_INTENT_UNSERVED: "CLOSURE_SUBMIT_INTENT_UNSERVED", …}
#:       …
#:       {"code": _CODE[reason], …}          # ← 值是下标表达式，不是常量
#:
#:   `services/deliverable_surface.py` 就是这个形状：新加了 5 条拦截理由，
#:   `--check` 却是绿的。**一道漏筛的闸看着跟装好了一模一样**（本仓 §14 原话）。
#:
#: ⚠ 为什么是"认一个约定的名字"而不是"扫所有模块级常量"：
#:   泛化扫描会把环境变量名（`"SLIDERULE_GRAPH_SCOPE_SHADOW"` 这类）也当成
#:   blocker code——它们同样匹配 `_BLOCKER_CODE_RE`。而
#:   `undeclared_gate_codes` 的头注已经写清楚了教训：**一份 3/4 是误报的名单，
#:   下一个人会直接把它关掉。** 所以宁可要一条需要显式 opt-in 的窄入口。
#:
#:   新模块要让自己的 code 进清单，就在模块级写一行：
#:       BLOCKER_CODES = ("CLOSURE_XXX", "CLOSURE_YYY")
#:   并且用一条判据钉住它跟真正发出去的那份一致（见
#:   tests/test_deliverable_surface_gate.py::test_声明的code跟真正发出的一致）。
_BLOCKER_CODE_DECLS = ("BLOCKER_CODES",)


def gate_inventory(root: pathlib.Path = ROOT) -> List[Dict[str, Any]]:
    """**闸清单**：谁在发拦截理由、谁被体检看着。由 AST 算出来，不许手写。

    ## 为什么要有它（2026-09-05）

    「为什么几个月没审查出来」的答案里有一条是：**没人知道这个系统里到底有
    几道闸**。相关性闸、证据闸、待办闸、孤岛体检、降级闸……散在四五个模块里，
    各自发各自的 blocker code，没有任何一处把它们摆在一起。于是
    「15 个会话全被同一道闸按同一个理由拦下」这种事，没有观察它的位置。

    依赖图回答「谁 import 谁」，回答不了「这个系统有哪些判定、各自装在哪」。
    这份清单补的是后者，同样**由代码算出**（§「依赖图不许手画」同一条纪律）。

    ## 判据

    每个模块两个数：
      · `codes`  —— 它字面量里出现的 blocker code（`{"code": "XXX_YYY"}`）
      · `gates`  —— 它调 `record_verdict("...")` 报进体检的闸名

    交叉出一条真问题：**发 blocker 却一次都没进体检的模块**。那种闸坏成
    「一直响」时没有任何人会发现——今天 0/6 躲了几个月就是这个形状。
    """
    out: List[Dict[str, Any]] = []
    for path in sorted(_sources(root)):
        module = _module_name(path, root)
        # ⚠ 2026-09-05：第一版只扫 `services.`，于是 `routes/` 里那道
        #   `pageEdit`（点选编辑 / 画布存回页面前的体检）**根本不在清单上**——
        #   而它恰恰是当天抓到「交付页的 Tailwind 被摘掉」的那一道。
        #   清单要是只盖住一半的仓，它回答不了自己声称回答的那个问题。
        if not (module.startswith("services.") or module.startswith("routes.")):
            continue
        tree = _read_tree(path)
        codes: Set[str] = set()
        gates: Set[str] = set()
        for node in ast.walk(tree):
            # BLOCKER_CODES = ("CLOSURE_XXX", …)  —— 见 _BLOCKER_CODE_DECLS 头注
            if isinstance(node, (ast.Assign, ast.AnnAssign)):
                _targets = (
                    node.targets if isinstance(node, ast.Assign) else [node.target]
                )
                if any(
                    isinstance(t, ast.Name) and t.id in _BLOCKER_CODE_DECLS
                    for t in _targets
                ) and isinstance(node.value, (ast.Tuple, ast.List, ast.Set)):
                    for elt in node.value.elts:
                        if (
                            isinstance(elt, ast.Constant)
                            and isinstance(elt.value, str)
                            and _BLOCKER_CODE_RE.match(elt.value)
                        ):
                            codes.add(elt.value)
            # {"code": "CLOSURE_GOAL_RELEVANCE_FAILED", ...}
            if isinstance(node, ast.Dict):
                for k, v in zip(node.keys, node.values):
                    if (
                        isinstance(k, ast.Constant) and k.value == "code"
                        and isinstance(v, ast.Constant)
                        and isinstance(v.value, str)
                        and _BLOCKER_CODE_RE.match(v.value)
                    ):
                        codes.add(v.value)
            # record_verdict("evidence", ...) / _gate_record("relevance", ...)
            if isinstance(node, ast.Call):
                name = getattr(node.func, "id", getattr(node.func, "attr", ""))
                if name in _GATE_HEALTH_CALLS and node.args:
                    first = node.args[0]
                    if isinstance(first, ast.Constant) and isinstance(first.value, str):
                        gates.add(first.value)
        if codes or gates:
            out.append({
                "module": module,
                "codes": sorted(codes),
                "gates": sorted(gates),
            })
    return out


def all_blocker_codes(root: pathlib.Path = ROOT) -> List[str]:
    """代码里出现过的全部 blocker code。"""
    return sorted({c for row in gate_inventory(root) for c in row["codes"]})


def undeclared_gate_codes(
    manifest: dict, root: pathlib.Path = ROOT
) -> List[str]:
    """新增了拦截理由、却没在 `[gate_codes]` 里说清谁体检它。**一条都不许有。**

    ## 为什么做成"必须声明"而不是自动推断

    第一版想自动推断——「发 blocker 却没调体检的模块」。跑出来 4 条，
    其中 3 条是误报：`capability_plan` 发 `CLOSURE_FACTORY_TODO_OPEN`，
    而 `factoryTodo` 那道闸的体检记在 `v5_capability_executor`（算的地方和
    落的地方本来就常常分家）；`llm_channel` 的 `LLM_TEST_*` 压根不是闭环闸。
    **一份 3/4 是误报的名单，下一个人会直接把它关掉。**

    所以改成本仓既有的那条路子：像 `may_depend_on` / `orphan_reasons` 一样
    **先声明再放行**。新增一条 blocker code 就必须回答一句「它归哪道被体检的
    闸；如果不体检，为什么」。答不上来的那些，恰恰就是几个月没人发现的那种。
    """
    declared = set((manifest.get("gate_codes") or {}).keys())
    return [c for c in all_blocker_codes(root) if c not in declared]


def gate_codes_without_health(manifest: dict, root: pathlib.Path = ROOT) -> List[str]:
    """声明了、但明说不进体检的 code。**只许变少**，是一本欠账。"""
    table = manifest.get("gate_codes") or {}
    present = set(all_blocker_codes(root))
    return sorted(
        c for c, gate in table.items()
        if c in present and not str(gate or "").strip()
    )


def orphans(g: Graph, manifest: dict) -> List[str]:
    """**没有任何模块 import 它**的模块，扣掉声明过的入口。

    ## 抄的是什么

    grok 那边 90 个 crate 全在 workspace 里，被依赖数为 0 的只有装配根
    `xai-grok-pager-bin` 一个——**因为它是 binary**。一个既不是入口、又没人依赖的
    crate，在那套体系里是明显的死重量。Python 没有编译器替我们数，所以自己数。

    ## ⚠ 零入度 ≠ 死代码，别照着这个名单删

    实测这 55 个里绝大多数**不是忘了删**，是三类各有各的理由：

      · **Node 边界镜像**（web_aigc_* / task_*_closure / blueprint_*_takeover / a2a_*）
        Node 拥有运行时，Python 这边把契约镜像下来、用测试钉住。删了等于丢掉那份记录。
      · **脚本/评测插座**（v5_session_driver）模块头明写「产品路由调用点零，
        禁止再 import 进来当驱动器」——它是**故意**不在产品链上的。
      · **未挂载的基线面**（routes.sliderule）docstring 自己写着
        「Primary mounted surface in app.py is sliderule_full.py」。

    所以这里给的是**棘轮**，不是待删清单：今天这些冻在基线里，**只许变少**；
    新长出来的孤儿必须当场解释——要么接上，要么写进 `[entrypoints]` 说清为什么。
    """
    indeg: Dict[str, int] = {m: 0 for m in g.modules}
    for e in g.edges:
        indeg[e.dst] = indeg.get(e.dst, 0) + 1
    pats = list((manifest.get("entrypoints") or {}).get("patterns") or [])
    out = []
    for m in sorted(g.modules):
        if indeg.get(m, 0):
            continue
        if any(fnmatch.fnmatch(m, p) for p in pats):
            continue
        out.append(m)
    return out


def component_cycles(manifest: dict, g: "Graph") -> List[str]:
    """component DFS 见证环路径，仅用于诊断；完整棘轮使用 component_cyclic_edges。

    ⚠ 模块级的环已经清零，但**组级的环有 17 个**（2026-08-29 实测）。
      这不是矛盾：粒度不同看到的东西不同，crate 粒度下的缠绕以前根本没人量过。
    """
    owner = component_of(manifest)
    out_edges: Dict[str, Set[str]] = {}
    for e in g.edges:
        a, b = owner.get(e.src), owner.get(e.dst)
        if a and b and a != b:
            out_edges.setdefault(a, set()).add(b)
    color: Dict[str, int] = {}
    found: Set[str] = set()

    def walk(u: str, stack: List[str]) -> None:
        color[u] = 1
        stack.append(u)
        for v in sorted(out_edges.get(u, ())):
            c = color.get(v, 0)
            if c == 1:
                cyc = stack[stack.index(v):]
                i = cyc.index(min(cyc))
                rot = cyc[i:] + cyc[:i]
                found.add(" -> ".join([*rot, rot[0]]))
            elif c == 0:
                walk(v, stack)
        stack.pop()
        color[u] = 2

    for n in sorted(out_edges):
        if color.get(n, 0) == 0:
            walk(n, [])
    return sorted(found)


def strongly_connected_components(graph: Dict[str, Set[str]]) -> List[Set[str]]:
    """Tarjan SCCs; unlike DFS back-edge witnesses these cover every cyclic edge."""
    index: Dict[str, int] = {}
    low: Dict[str, int] = {}
    stack: List[str] = []
    active: Set[str] = set()
    groups: List[Set[str]] = []

    def visit(node: str) -> None:
        index[node] = low[node] = len(index)
        stack.append(node)
        active.add(node)
        for target in sorted(graph.get(node, ())):
            if target not in index:
                visit(target)
                low[node] = min(low[node], low[target])
            elif target in active:
                low[node] = min(low[node], index[target])
        if low[node] == index[node]:
            group: Set[str] = set()
            while True:
                member = stack.pop()
                active.remove(member)
                group.add(member)
                if member == node:
                    break
            groups.append(group)

    nodes = set(graph) | {v for targets in graph.values() for v in targets}
    sys.setrecursionlimit(max(sys.getrecursionlimit(), len(nodes) * 2 + 100))
    for node in sorted(nodes):
        if node not in index:
            visit(node)
    return groups


def _cyclic_pairs(graph: Dict[str, Set[str]]) -> Set[Tuple[str, str]]:
    owner = {node: i for i, group in enumerate(strongly_connected_components(graph))
             for node in group}
    return {(src, dst) for src, targets in graph.items() for dst in targets
            if owner[src] == owner[dst]}


def cyclic_edges(g: Graph, manifest: Optional[dict] = None) -> List[str]:
    """Complete cyclic module edges, excluding explicitly allowed internal SCCs."""
    graph = g.module_graph()
    spec = (manifest or {}).get("component", {})
    owners = component_of(manifest or {})
    allowed: Set[str] = set()
    for group in strongly_connected_components(graph):
        components = {owners.get(module) for module in group}
        if len(components) == 1:
            component = next(iter(components))
            if component is not None and spec[component].get("allow_internal_cycles"):
                allowed.update(group)
    return sorted(f"{src} -> {dst}" for src, dst in _cyclic_pairs(graph)
                  if not (src in allowed and dst in allowed))


def component_cyclic_edges(g: Graph, manifest: dict) -> List[str]:
    owners = component_of(manifest)
    graph: Dict[str, Set[str]] = {}
    for edge in g.edges:
        src, dst = owners.get(edge.src), owners.get(edge.dst)
        if src and dst and src != dst:
            graph.setdefault(src, set()).add(dst)
    return sorted(f"{src} -> {dst}" for src, dst in _cyclic_pairs(graph))


def cross_component_cycles(g: "Graph", manifest: dict) -> List[str]:
    """未豁免的 DFS 见证路径，仅用于诊断；完整棘轮使用 cyclic_edges。

    放行的**唯一**条件：环整个落在同一个 component 里，**而且那个 component
    明写了 `allow_internal_cycles = true`**。

    ⚠ 为什么要单独 opt-in，而不是「同一个 component 就放行」：
      2026-08-29 把 270 个模块全部归进 component 之后，「同组即放行」会让环判据
      **当场废掉一大半**——归组的目的是声明依赖，不是给环发通行证。
      默认严：即使在同一个 component 里，成环也红；确实是有意互指的（注册表与
      实现那种），单独在清单里写一行并说明理由。
    """
    spec = manifest.get("component", {})
    owner = component_of(manifest)
    opted = {name for name, c in spec.items() if c.get("allow_internal_cycles")}
    out = []
    for c in find_cycles(g):
        members = c.split(" -> ")[:-1]
        owners = {owner.get(m) for m in members}
        if len(owners) == 1 and None not in owners and owners.pop() in opted:
            continue
        out.append(c)
    return out


# ── 清单 ────────────────────────────────────────────────────────────────────
def load_manifest(path: pathlib.Path = MANIFEST) -> dict:
    with open(path, "rb") as fh:
        return tomllib.load(fh)


def accepted_edges(manifest: dict) -> Dict[str, str]:
    """显式例外：`模块 -> 模块` → 为什么接受。

    ⚠ 这是「有意为之、并且写清了理由」，跟 `[baseline]`（欠账、只许变少）
      是**两件事**。grok 的对应物是 Cargo.toml 依赖行上那句注释
      （`# CompactionDetail, embedded in CompactionMode::Segments.`）——
      依赖存在是事实，为什么存在得写下来。

    ⚠ 门槛：必须写 why，而且判据盯着总量。拿它消违规等于把闸关掉。
    """
    return {
        str(item.get("edge", "")).strip(): str(item.get("why", "")).strip()
        for item in manifest.get("accepted", [])
        if item.get("edge")
    }


def layer_violations(g: Graph, manifest: dict) -> List[str]:
    """包与包之间**没有声明过**的依赖边。对应 grok「没声明就编译不过」。

    ⚠ 一个包对只有在它背后**每一条**具体边都被显式接受时才消失。
      漏掉这一条的话，一个例外会顺手把同一对包上的其它边一起放行。
    """
    allowed = {
        name: set(spec.get("may_depend_on", []))
        for name, spec in manifest.get("layer", {}).items()
    }
    ok_edges = set(accepted_edges(manifest))
    concrete: Dict[Tuple[str, str], List[str]] = {}
    for e in g.edges:
        if e.src_pkg == e.dst_pkg or "?" in (e.src_pkg, e.dst_pkg):
            continue
        if e.dst_pkg in allowed.get(e.src_pkg, set()):
            continue
        concrete.setdefault((e.src_pkg, e.dst_pkg), []).append(f"{e.src} -> {e.dst}")
    bad: Set[str] = set()
    for (src, dst), edges in concrete.items():
        if all(x in ok_edges for x in edges):
            continue
        bad.add(f"{src} -> {dst}")
    return sorted(bad)


def find_cycles(g: Graph) -> List[str]:
    """模块级 DFS 见证环路径，不枚举全部环，也不用于新增环棘轮。

    返回**规范化**的环签名（从字典序最小的成员起转），否则同一个环换个起点
    就成了「新环」，棘轮基线会被自己搅乱。
    """
    graph = g.module_graph()
    known = g.modules
    color: Dict[str, int] = {}
    found: Set[str] = set()

    def norm(cycle: List[str]) -> str:
        # 从字典序最小的成员起转，并**补上闭合边**——不补的话 A⇄B 显示成
        # "A -> B"，看着像一条普通依赖，读的人不知道它是个环。
        i = cycle.index(min(cycle))
        rotated = cycle[i:] + cycle[:i]
        return " -> ".join([*rotated, rotated[0]])

    def walk(u: str, stack: List[str]) -> None:
        color[u] = 1
        stack.append(u)
        for v in sorted(graph.get(u, ())):
            if v not in known:
                continue
            c = color.get(v, 0)
            if c == 1:
                found.add(norm(stack[stack.index(v):]))
            elif c == 0:
                walk(v, stack)
        stack.pop()
        color[u] = 2

    sys.setrecursionlimit(10000)
    for m in sorted(graph):
        if color.get(m, 0) == 0:
            walk(m, [])
    return sorted(found)


# ── 生成架构图 ──────────────────────────────────────────────────────────────
def emit_mermaid(g: Graph, manifest: dict) -> str:
    """从真代码生成架构图。**确定性**：一切排序固定（见模块头 ⚠③）。"""
    layers = manifest.get("layer", {})
    order = sorted(layers, key=lambda n: (layers[n].get("rank", 99), n))
    counts: Dict[Tuple[str, str], int] = {}
    deferred_counts: Dict[Tuple[str, str], int] = {}
    for e in g.edges:
        if e.src_pkg == e.dst_pkg or "?" in (e.src_pkg, e.dst_pkg):
            continue
        counts[(e.src_pkg, e.dst_pkg)] = counts.get((e.src_pkg, e.dst_pkg), 0) + 1
        if e.deferred:
            deferred_counts[(e.src_pkg, e.dst_pkg)] = (
                deferred_counts.get((e.src_pkg, e.dst_pkg), 0) + 1
            )

    per_pkg: Dict[str, int] = {}
    for m in g.modules:
        per_pkg[_pkg_of(m)] = per_pkg.get(_pkg_of(m), 0) + 1

    violations = set(layer_violations(g, manifest))
    lines = ["flowchart TB"]
    for name in order:
        spec = layers[name]
        why = spec.get("what", "")
        lines.append(f'  {name}["{name}<br/>{per_pkg.get(name, 0)} 个模块<br/>{why}"]')
    for (a, b), n in sorted(counts.items()):
        d = deferred_counts.get((a, b), 0)
        label = f"{n}" + (f" · 其中 {d} 条边来自函数体 import" if d else "")
        arrow = "-.->" if f"{a} -> {b}" in violations else "-->"
        lines.append(f"  {a} {arrow}|{label}| {b}")
    return "\n".join(lines)


def emit_services_layer_mermaid(g: Graph, manifest: dict) -> str:
    """services 的 util/core/flow。抄 import-linter 的 layers contract：
    节点是层，边是层间真实 import 条数。表不够，必须进 mermaid。"""
    spec = manifest.get("services_layer", {})
    owner: Dict[str, str] = {}
    for layer, cfg in spec.items():
        for m in cfg.get("modules", []):
            owner[m] = layer
    counts: Dict[Tuple[str, str], int] = {}
    for e in g.edges:
        a, b = owner.get(e.src), owner.get(e.dst)
        if a and b and a != b:
            counts[(a, b)] = counts.get((a, b), 0) + 1
    upward = set()
    for v in services_violations(g, manifest):
        pair = v.split(" :: ", 1)[0]
        if " -> " in pair:
            src, dst = pair.split(" -> ", 1)
            upward.add((src, dst))
    lines = ["flowchart TB"]
    for name, cfg in sorted(spec.items(), key=lambda kv: kv[1].get("rank", 99)):
        what = cfg.get("what", "")
        n = len(cfg.get("modules", []))
        lines.append(f'  {name}["{name}<br/>{n} 个模块<br/>{what}"]')
    for (a, b), n in sorted(counts.items()):
        arrow = "-.->" if (a, b) in upward else "-->"
        lines.append(f"  {a} {arrow}|{n}| {b}")
    return "\n".join(lines)


def _module_path(module: str) -> pathlib.Path:
    return ROOT / (module.replace(".", "/") + ".py")


def handoff_is_live_from(path: pathlib.Path, via: str, calls: str) -> bool:
    """from 文件里有 `def via`，且自身函数体含对 `calls` 的 ast.Call。"""
    if not path.is_file():
        return False
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"))
    except SyntaxError:
        return False
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == via:
            pending: List[ast.AST] = list(n.body)
            while pending:
                child = pending.pop()
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                    continue
                if isinstance(child, ast.Call) and (
                    isinstance(child.func, ast.Name) and child.func.id == calls
                    or isinstance(child.func, ast.Attribute) and child.func.attr == calls
                ):
                    return True
                pending.extend(ast.iter_child_nodes(child))
    return False


def handoff_is_live(manifest: dict) -> bool:
    spec = (manifest.get("spine") or {}).get("handoff") or {}
    via = spec.get("via") or ""
    calls = spec.get("calls") or ""
    src = spec.get("from_module") or ""
    if not (via and calls and src):
        return False
    return handoff_is_live_from(_module_path(src), via, calls)


def emit_spine_mermaid(g: Graph, manifest: dict) -> str:
    """编排环。边来自这些模块之间的真 import；handoff 是活路径上的那一条。"""
    nodes = (manifest.get("spine") or {}).get("nodes") or {}
    by_mod = {cfg["module"]: (name, cfg) for name, cfg in nodes.items() if cfg.get("module")}
    mods = set(by_mod)
    edges: Dict[Tuple[str, str], int] = {}
    for e in g.edges:
        if e.src in mods and e.dst in mods and e.src != e.dst:
            edges[(e.src, e.dst)] = edges.get((e.src, e.dst), 0) + 1
    handoff = (manifest.get("spine") or {}).get("handoff") or {}
    h_from = handoff.get("from_module") or ""
    h_to = handoff.get("to_module") or ""
    live = handoff_is_live(manifest)
    lines = ["flowchart LR"]
    for name, cfg in sorted(nodes.items(), key=lambda kv: kv[1].get("rank", 99)):
        mod = cfg.get("module") or name
        mid = mod.replace(".", "_")
        what = cfg.get("what") or mod
        lines.append(f'  {mid}["{mod}<br/>{what}"]')
    for (a, b), n in sorted(edges.items()):
        la, lb = a.replace(".", "_"), b.replace(".", "_")
        if live and a == h_from and b == h_to:
            lines.append(f"  {la} -->|handoff {n}| {lb}")
        else:
            lines.append(f"  {la} -->|{n}| {lb}")
    return "\n".join(lines)


def live_cross_language_adapters(repo: pathlib.Path = REPO) -> Set[str]:
    text = (repo / "server" / "index.ts").read_text(encoding="utf-8")
    return set(re.findall(r'createPythonWebAigcAdapter\("([a-z0-9_]+)"\)', text))


def declared_cross_language_edges(manifest: dict) -> List[dict]:
    return list(manifest.get("cross_language_edge") or [])


def cross_language_gaps(manifest: dict, repo: pathlib.Path = REPO) -> Tuple[List[str], List[str]]:
    """声明的 adapter 与 server/index.ts 接线的差。两边都要空。"""
    declared = {str(e.get("adapter") or "") for e in declared_cross_language_edges(manifest)}
    declared.discard("")
    live = live_cross_language_adapters(repo)
    missing = sorted(live - declared)
    stale = sorted(declared - live)
    return missing, stale


def ts_package_graph() -> Tuple[Dict[str, int], Dict[Tuple[str, str], int]]:
    """TS 包级实际边。抄 Nx project graph：另一门语言的图由它自己的编译器吐 JSON。"""
    script = REPO / "scripts" / "arch-graph-ts.mjs"
    r = subprocess.run(
        ["node", str(script), "--json-packages"],
        cwd=str(REPO),
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if r.returncode != 0:
        raise RuntimeError(f"arch-graph-ts --json-packages 失败：{r.stderr or r.stdout}")
    data = json.loads(r.stdout)
    pkgs = {str(k): int(v) for k, v in (data.get("packages") or {}).items()}
    edges: Dict[Tuple[str, str], int] = {}
    for item in data.get("edges") or []:
        a, b = item.get("from"), item.get("to")
        if a and b and a != b:
            edges[(str(a), str(b))] = int(item.get("n") or 0)
    return pkgs, edges


def emit_repo_mermaid(
    g: Graph,
    manifest: dict,
    ts_pkgs: Dict[str, int],
    ts_edges: Dict[Tuple[str, str], int],
) -> str:
    """全仓一张图：TS 包 + Python 包 + 跨语言边。"""
    lines = ["flowchart TB"]
    lines.append("  subgraph ts [TypeScript]")
    for name in sorted(ts_pkgs):
        mid = "ts_" + name.replace("-", "_")
        lines.append(f'    {mid}["ts/{name}<br/>{ts_pkgs[name]} 个模块"]')
    lines.append("  end")
    py_count: Dict[str, int] = {}
    for m in g.modules:
        py_count[_pkg_of(m)] = py_count.get(_pkg_of(m), 0) + 1
    lines.append("  subgraph py [Python]")
    for name in sorted(py_count):
        lines.append(f'    py_{name}["py/{name}<br/>{py_count[name]} 个模块"]')
    for e in declared_cross_language_edges(manifest):
        to = str(e.get("to") or "")
        if to:
            mid = "py_" + to.replace(".", "_")
            lines.append(f'    {mid}["{to}"]')
    lines.append("  end")
    for (a, b), n in sorted(ts_edges.items()):
        lines.append(
            f"  ts_{a.replace('-', '_')} -->|{n}| ts_{b.replace('-', '_')}"
        )
    py_pkg_edges: Dict[Tuple[str, str], int] = {}
    for e in g.edges:
        if e.src_pkg != e.dst_pkg and "?" not in (e.src_pkg, e.dst_pkg):
            py_pkg_edges[(e.src_pkg, e.dst_pkg)] = (
                py_pkg_edges.get((e.src_pkg, e.dst_pkg), 0) + 1
            )
    for (a, b), n in sorted(py_pkg_edges.items()):
        lines.append(f"  py_{a} -->|{n}| py_{b}")
    for e in declared_cross_language_edges(manifest):
        adapter = e.get("adapter") or "?"
        to = str(e.get("to") or "")
        src = "ts_" + str(e.get("from_pkg") or "server").replace("-", "_")
        dst = "py_" + to.replace(".", "_")
        lines.append(f"  {src} -.->|{adapter}| {dst}")
    return "\n".join(lines)


def render_repo_doc(
    g: Graph,
    manifest: dict,
    ts_pkgs: Optional[Dict[str, int]] = None,
    ts_edges: Optional[Dict[Tuple[str, str], int]] = None,
) -> str:
    if ts_pkgs is None or ts_edges is None:
        ts_pkgs, ts_edges = ts_package_graph()
    xedges = declared_cross_language_edges(manifest)
    body = [
        "# WhyBuddy 全仓架构图（自动生成）",
        "",
        "> ⚠ **这份文件是 `arch_graph.py --emit` 生成的，不要手改。**",
        "> Python 包边来自 `arch_graph.py`，TS 包边来自 `arch-graph-ts.mjs --json-packages`，",
        "> 跨语言边来自 `architecture.toml` 的 `[[cross_language_edge]]`（Nx implicitDependencies）。",
        "",
        f"- TS 包 **{len(ts_pkgs)}**，包间边 **{len(ts_edges)}**",
        f"- Python 包 **{len({_pkg_of(m) for m in g.modules})}**",
        f"- 跨语言边 **{len(xedges)}**（server/index.ts 拼字符串加载 Python adapter）",
        "",
        "四个 adapter 在 Python 依赖图里入度为 0，看起来像孤儿；",
        "它们是产线代码，接线在另一门语言里。这张图把那四条边画出来。",
        "",
        "```mermaid",
        emit_repo_mermaid(g, manifest, ts_pkgs, ts_edges),
        "```",
        "",
        "## 跨语言边",
        "",
        "| 从 | adapter | 到 | 为什么 |",
        "|---|---|---|---|",
    ]
    for e in xedges:
        body.append(
            f"| `{e.get('from')}` | `{e.get('adapter')}` | `{e.get('to')}` | {e.get('why', '')} |"
        )
    body.append("")
    return "\n".join(body)


def render_doc(g: Graph, manifest: dict) -> str:
    cycles = cyclic_edges(g, manifest)
    violations = layer_violations(g, manifest)
    svc_v = services_violations(g, manifest)
    orph = orphans(g, manifest)
    base = manifest.get("baseline", {})
    deferred = deferred_count(g)
    body = [
        "# SlideRule V6.2 架构图（自动生成）",
        "",
        "> ⚠ **这个文件是生成的，不要手改。** 改了下次 `--emit` 会覆盖，而且",
        "> `tests/test_architecture.py::Test图与代码同步` 会当场变红。",
        "> 要改架构，改代码或改 `slide-rule-python/architecture.toml`，然后重新生成：",
        "> ",
        "> ```bash",
        "> slide-rule-python/.venv/bin/python slide-rule-python/arch_graph.py --emit",
        "> ```",
        "",
        "抄的是 grok-build 的做法：他们**一张架构图都没有**，边写在各 crate 的",
        "`Cargo.toml` 里由 cargo 强制。对照物的现算数字见",
        "`docs/grok-build 架构图（自动生成）.md`（`scripts/arch-graph-grok.py --emit`）。",
        "我们没有那个编译器，所以自己写一个——见 `slide-rule-python/arch_graph.py` 模块头。",
        "",
        "## 此刻的事实（由代码算出，不是手写）",
        "",
        f"- 扫描文件 **{g.files_scanned}** 个，模块 **{len(g.modules)}** 个",
        f"- 内部依赖边 **{len(g.edges)}** 条（包含普通包初始化依赖）",
        f"- 内部 import 语句 **{len({(e.src, e.line, e.column) for e in g.edges})}** 条，"
        f"其中函数体内 **{deferred}** 条语句（基线 {base.get('deferred', deferred)}，只许变少）",
        f"- 未声明的跨包依赖 **{len(violations)}** 条（基线 {len(base.get('violations', []))} 条）",
        f"- 未豁免的模块级成环边 **{len(cycles)}** 条（完整 SCC，"
        f"基线 {len(base.get('cyclic_edges', []))} 条）",
        f"- component 级成环边 **{len(component_cyclic_edges(g, manifest))}** 条"
        f"（完整 SCC，基线 {len(base.get('component_cyclic_edges', []))} 条）",
        f"- services 内部越层依赖 **{len(svc_v)}** 条"
        f"（基线 {len(base.get('services_violations', []))} 条）",
        f"- 没人 import 的模块 **{len(orph)}** 个"
        f"（基线 {len(base.get('orphans', []))} 个）—— ⚠ **不是待删清单**，"
        f"其中 {sum(1 for m in orph if (manifest.get('orphan_reasons') or {}).get(m) == 'cross_language_entry')} "
        f"个是跨语言入口（见全仓图，不是没人用）",
        "",
        "权威图只留自动生成的：本文件、`docs/WhyBuddy TS 架构图（自动生成）.md`、",
        "`docs/WhyBuddy 全仓架构图（自动生成）.md`、`docs/grok-build 架构图（自动生成）.md`。",
        "V5.x～V6.0 手画是历史实验室笔记，禁止再打新 ⚑。",
        "",
        "目标形状是**两个大块 + 一批叶子**（util 叶子多于 flow 编排），",
        "不是把 services 切成 90 个平均文件。",
        "产品图**不搬**：`" + "`、`".join(FORBIDDEN_GROK_COPY) + "`",
        "（pager / MCP / 子代理 / sandbox / grok-agent 提示词）。",
        "",
        "### services 内部分层（抄 grok 的叶子 crate）",
        "",
        f"| 层 | 模块数 | 可以依赖 | 是什么 |",
        f"|---|---|---|---|",
    ] + [
        f"| `{name}` | {len(spec.get('modules', []))} | "
        f"{'、'.join(spec.get('may_depend_on', [])) or '（谁都不依赖）'} | {spec.get('what', '')} |"
        for name, spec in sorted(
            manifest.get("services_layer", {}).items(),
            key=lambda kv: kv[1].get("rank", 99),
        )
    ] + [
        "",
        "叶子层 `util` 不依赖 services 里任何其它模块——这是它能被所有人安全 import "
        "的全部理由，也是 `import` 不必躲进函数体的前提。",
        "",
        "### services 三层（从 import 算出，不是表）",
        "",
        "表只报数。这张 mermaid 才是层间真实边。虚线 = 越层（欠账，只许变少）。",
        "",
        "```mermaid",
        emit_services_layer_mermaid(g, manifest),
        "```",
        "",
        "虚线 = 未在 `architecture.toml` 里声明的边（欠账，只许变少）。",
        "",
        "```mermaid",
        emit_mermaid(g, manifest),
        "```",
        "",
        "## 编排环（从活路径生成）",
        "",
        "对照 grok-build 的 spine（shell → agent → tools，`xai-workflow` 是叶子）。",
        "我们的活路径是 `rehearsal_control._handoff_factory` → `drive_full_factory` →",
        "`v5_full_driver` → `v5_capability_executor` → `run_spec_first`。",
        "⚠ `component.run_control` 是 pause/cancel 叶子，不是这张图。",
        "handoff 标在边上，当且仅当 `_handoff_factory` 函数体里真的调用了",
        "`start_drive_full_factory_run`（import 在不算数）。",
        "",
        "```mermaid",
        emit_spine_mermaid(g, manifest),
        "```",
        "",
        "## 循环依赖",
        "",
        "下面列出完整 SCC 中每一条成环边，扣除清单明确允许的组件内部 SCC。"
        "**只许变少。** DFS 见证路径不作为基线。",
        "",
    ]
    if cycles:
        for c in cycles:
            body.append(f"- `{c}`")
    else:
        body.append("（当前没有未豁免的成环边）")
    body += [
        "",
        "## 未声明的跨包依赖",
        "",
    ]
    if violations:
        for v in violations:
            body.append(f"- `{v}`")
    else:
        body.append("（当前没有）")
    comps = manifest.get("component", {})
    if comps:
        owner = component_of(manifest)
        cedges: Dict[Tuple[str, str], int] = {}
        for e in g.edges:
            a, b = owner.get(e.src), owner.get(e.dst)
            if a and b and a != b:
                cedges[(a, b)] = cedges.get((a, b), 0) + 1
        cyc = {tuple(edge.split(" -> ")) for edge in component_cyclic_edges(g, manifest)}
        body += [
            "",
            "## crate 级：component 依赖图",
            "",
            "抄 grok 的 Cargo.toml——边写在 crate 上，由编译器焊死。",
            "现算数字见 `docs/grok-build 架构图（自动生成）.md`。",
            f"我们 {len(comps)} 个 component、{len(cedges)} 条边，由 `architecture.toml` 声明、判据强制。",
            "**红色虚线 = 参与组间成环的边**（模块级已清零，组级还欠着，见下）。",
            "",
            "```mermaid",
            "flowchart LR",
        ]
        for name in sorted(comps):
            n = len(comps[name].get("modules", []))
            body.append(f'  {name}["{name}<br/>{n}"]')
        for (a, b), n in sorted(cedges.items()):
            if a == "control" and b == "drive":
                body.append(f"  {a} -->|handoff {n}| {b}")
            else:
                body.append(f"  {a} {'-.->' if (a, b) in cyc else '-->'}|{n}| {b}")
        body += ["```", ""]

    body += ["", "## services 内部越层依赖", "",
             "叶子碰了上层，或 core 碰了 flow。**只许变少。**", ""]
    if svc_v:
        for v in svc_v:
            body.append(f"- `{v}`")
    else:
        body.append("（当前没有）")

    # ── 闸清单（2026-09-05）─────────────────────────────────────────
    inv = gate_inventory()
    codes = all_blocker_codes()
    table = manifest.get("gate_codes") or {}
    watched = sorted({c for c, gv in table.items() if str(gv or "").strip() and c in set(codes)})
    unwatched = gate_codes_without_health(manifest)
    body += [
        "", "## 闸清单（谁在拦，谁看着它）", "",
        "> 依赖图回答「谁 import 谁」，回答不了「这个系统有哪些判定、各自装在哪、",
        "> 坏成一直响的时候谁会发现」。2026-09-05 补的就是后者——",
        "> 「为什么几个月没审查出来」的答案里有一条是**没人知道这里到底有几道闸**：",
        "> 15 个会话全被同一道闸按同一个理由拦下，而没有观察它的位置。",
        "",
        f"- 拦截理由（blocker code）共 **{len(codes)}** 条，"
        f"其中 **{len(watched)}** 条进了体检（`services/gate_health.py`），"
        f"**{len(unwatched)}** 条没进（欠账，只许变少）",
        f"- 新增一条 code 必须在 `architecture.toml` 的 `[gate_codes]` 里声明归属，"
        f"否则 `--check` 变红",
        "",
        "| 拦截理由 | 体检的闸 | 发它的模块 |",
        "|---|---|---|",
    ]
    for code in codes:
        gate = str(table.get(code, "") or "").strip()
        where = "、".join(
            f"`{r['module'].split('.')[-1]}`" for r in inv if code in r["codes"]
        )
        body.append(f"| `{code}` | {('`' + gate + '`') if gate else '—'} | {where} |")
    body += [
        "",
        "「—」是明说不体检的：诊断类（只在真失败时出现，没有「一直说同一句话」的",
        "退化形态），以及压根不是闭环闸的连通性自检。理由逐条写在 `[gate_codes]` 里。",
        "",
    ]

    # ── 第二张表：体检在看的闸 ────────────────────────────────────────
    #
    # ⚠ 2026-09-05 下半场补的。上面那张表是**按 blocker code 排**的，于是
    #   「拦下来只报不拦、没有 code」的闸整个不在清单上——`pageEdit`
    #   （点选编辑 / 画布存回页面前数脚本、数据孔、表单控件）就是这样一道，
    #   而它恰恰是当天抓到「交付页的 Tailwind 被摘掉」的那一道。
    #
    #   只报不拦不等于不重要：§7 说得清楚，增强类本来就该 fail-open。
    #   一份「只认会拦人的闸」的清单，看不见的正是这一类。
    gate_rows: Dict[str, Set[str]] = {}
    for row in inv:
        for gate in row["gates"]:
            gate_rows.setdefault(gate, set()).add(row["module"].split(".")[-1])
    if gate_rows:
        body += [
            "### 体检在看的闸（按闸名，含只报不拦的）",
            "",
            "> 上面那张表按 blocker code 排，**只报不拦的闸没有 code，会整个漏掉**。",
            "> 这张按闸名排，`gate_health` 记了谁就有谁。",
            "",
            "| 闸 | 记在哪 | 拦人吗 |",
            "|---|---|---|",
        ]
        code_of_gate = {str(v).strip(): k for k, v in table.items() if str(v or "").strip()}
        for gate in sorted(gate_rows):
            where = "、".join(f"`{m}`" for m in sorted(gate_rows[gate]))
            code = code_of_gate.get(gate, "")
            blocks = f"拦，`{code}`" if code else "只报不拦（§7 增强类）"
            body.append(f"| `{gate}` | {where} | {blocks} |")
        body.append("")
    return "\n".join(body)


def ownership_errors(g: Graph, manifest: dict) -> List[str]:
    errors: List[str] = []
    for section, actual in (
        ("component", g.modules),
        ("services_layer", {m for m in g.modules if m.startswith("services.")}),
    ):
        owners: Dict[str, List[str]] = {}
        for name, spec in manifest.get(section, {}).items():
            for module in spec.get("modules", []):
                owners.setdefault(module, []).append(name)
        for module in sorted(actual - set(owners)):
            errors.append(f"{section}: unassigned module {module}")
        for module in sorted(set(owners) - actual):
            errors.append(f"{section}: stale module {module}")
        for module, names in sorted(owners.items()):
            if len(names) != 1:
                errors.append(f"{section}: duplicate ownership {module}: {names}")
    return errors


def _ratchet_errors(name: str, actual: Iterable[str], baseline: dict) -> List[str]:
    if name not in baseline:
        return [f"baseline.{name}: missing baseline"]
    now, previous = set(actual), set(baseline[name])
    return ([f"baseline.{name}: new {item}" for item in sorted(now - previous)]
            + [f"baseline.{name}: stale {item}" for item in sorted(previous - now)])


def document_errors(g: Graph, manifest: dict) -> List[str]:
    errors: List[str] = []
    for path, render in (
        (DIAGRAM, lambda: render_doc(g, manifest)),
        (REPO_DIAGRAM, lambda: render_repo_doc(g, manifest)),
    ):
        if not path.is_file():
            errors.append(f"Missing generated diagram: {path}")
        elif path.read_text(encoding="utf-8").replace("\r\n", "\n") != render():
            errors.append(f"Generated diagram is stale: {path}; run arch:emit")
    return errors


def validate_graph(g: Graph, manifest: dict, *, check_documents: bool = True) -> List[str]:
    """The shared CLI/pytest gate. Diagnostic DFS witnesses are not ratchets."""
    errors = ownership_errors(g, manifest)
    layers = manifest.get("layer", {})
    roots = {_pkg_of(module) for module in g.modules}
    for name in sorted(roots - set(layers)):
        errors.append(f"layer: undeclared package {name}")
    for name in sorted(set(layers) - roots):
        errors.append(f"layer: stale package {name}")
    for section in ("layer", "services_layer", "component"):
        specs = manifest.get(section, {})
        if not specs:
            errors.append(f"{section}: empty declarations")
        for name, spec in specs.items():
            for dependency in spec.get("may_depend_on", []):
                if dependency not in specs or dependency == name:
                    errors.append(f"{section}: invalid dependency {name} -> {dependency}")
                elif section == "services_layer" and (
                    specs[dependency].get("rank", 99) >= spec.get("rank", 99)
                ):
                    errors.append(f"{section}: upward declaration {name} -> {dependency}")

    components = manifest.get("component", {})
    owner = component_of(manifest)
    real_pairs = {(owner.get(e.src), owner.get(e.dst)) for e in g.edges}
    whys: Set[str] = set()
    opted = []
    for name, spec in components.items():
        why = str(spec.get("why") or "").strip()
        if len(why) < 15 or why in whys:
            errors.append(f"component.{name}: missing or repeated rationale")
        whys.add(why)
        members = spec.get("modules", [])
        if not members or len(members) > max(1, len(g.modules) // 4):
            errors.append(f"component.{name}: invalid component size {len(members)}")
        if spec.get("allow_internal_cycles"):
            opted.append(name)
            if len(members) > 6:
                errors.append(f"component.{name}: cyclic component exceeds six modules")
        for dependency in spec.get("may_depend_on", []):
            if (name, dependency) not in real_pairs:
                errors.append(f"component: stale dependency {name} -> {dependency}")
    if len(opted) > 2:
        errors.append(f"component: too many cycle exemptions {opted}")
    errors.extend(f"component: satellite {item}" for item in satellite_components(g, manifest))

    util = set(manifest.get("services_layer", {}).get("util", {}).get("modules", []))
    errors.extend(f"services_layer.util: non-leaf {e.key()}" for e in g.edges
                  if e.src in util and e.dst.startswith("services.") and e.src != e.dst)
    baseline = manifest.get("baseline", {})
    for name, actual in (
        ("violations", layer_violations(g, manifest)),
        ("services_violations", services_violations(g, manifest)),
        ("component_violations", component_violations(g, manifest)),
        ("cyclic_edges", cyclic_edges(g, manifest)),
        ("component_cyclic_edges", component_cyclic_edges(g, manifest)),
        ("orphans", orphans(g, manifest)),
    ):
        errors.extend(_ratchet_errors(name, actual, baseline))
    if baseline.get("deferred") != deferred_count(g):
        errors.append(f"baseline.deferred: expected {baseline.get('deferred')}, actual {deferred_count(g)}")

    reasons = orphan_reason_gaps(g, manifest)
    for kind, items in zip(("missing", "stale", "unknown"), reasons):
        errors.extend(f"orphan_reasons: {kind} {item}" for item in items)
    patterns = manifest.get("entrypoints", {}).get("patterns", [])
    if not patterns:
        errors.append("entrypoints: empty declarations")
    incoming = {edge.dst for edge in g.edges}
    for pattern in patterns:
        covered = {m for m in g.modules if fnmatch.fnmatch(m, pattern)}
        if not covered or pattern in {f"{root}.*" for root in roots if root != "scripts"}:
            errors.append(f"entrypoints: invalid pattern {pattern}")
        if not pattern.startswith("scripts."):
            errors.extend(f"entrypoints: imported module {m}" for m in sorted(covered & incoming - {"app"}))
    accepted = accepted_edges(manifest)
    if len(accepted) > 5:
        errors.append("accepted: more than five exceptions")
    for edge, why in accepted.items():
        if len(why) < 30 or edge not in {e.key() for e in g.edges}:
            errors.append(f"accepted: invalid or stale exception {edge}")

    inventory = gate_inventory()
    codes = {code for row in inventory for code in row["codes"]}
    table = manifest.get("gate_codes", {})
    errors.extend(f"gate_codes: undeclared {code}" for code in sorted(codes - set(table)))
    errors.extend(f"gate_codes: stale {code}" for code in sorted(set(table) - codes))
    watched = {str(value).strip() for value in table.values() if str(value or "").strip()}
    recorded = {gate for row in inventory for gate in row["gates"]}
    errors.extend(f"gate_codes: unrecorded gate {gate}" for gate in sorted(watched - recorded))
    unwatched = len([code for code in codes if code in table and not str(table[code] or "").strip()])
    if baseline.get("gate_codes_without_health") != unwatched:
        errors.append(f"baseline.gate_codes_without_health: expected {baseline.get('gate_codes_without_health')}, actual {unwatched}")

    missing, stale = cross_language_gaps(manifest)
    errors.extend(f"cross_language_edge: missing adapter {name}" for name in missing)
    errors.extend(f"cross_language_edge: stale adapter {name}" for name in stale)
    for edge in declared_cross_language_edges(manifest):
        expected = f"services.web_aigc_{str(edge.get('adapter', '')).replace('-', '_')}_adapter"
        if edge.get("to") != expected or expected not in g.modules:
            errors.append(f"cross_language_edge: invalid destination {edge.get('to')}")
    if not handoff_is_live(manifest):
        errors.append("spine.handoff: no actual factory call")
    if check_documents:
        errors.extend(document_errors(g, manifest))
    return sorted(set(errors))


# ── CLI ─────────────────────────────────────────────────────────────────────
def _freeze(g: Graph, manifest: dict) -> None:

    text = MANIFEST.read_text(encoding="utf-8")
    v = layer_violations(g, manifest)
    c = cross_component_cycles(g, manifest)
    sv = services_violations(g, manifest)

    def block(name: str, items: Iterable[str]) -> str:
        rows = "".join(f"  {json.dumps(item, ensure_ascii=False)},\n" for item in items)
        return f"{name} = [\n{rows}]"

    parsed = tomllib.loads(text)
    section = re.search(r"(?m)^\[baseline\][ \t]*(?:#[^\n]*)?\n", text)
    if section is None or not isinstance(parsed.get("baseline"), dict):
        raise ValueError("Cannot freeze: missing [baseline] table")
    following = re.search(r"(?m)^\[", text[section.end():])
    end = section.end() + following.start() if following else len(text)
    body = text[section.end():end]
    updates = {"violations": v, "cycles": c, "services_violations": sv,
               "cyclic_edges": cyclic_edges(g, manifest)}
    for key, values in updates.items():
        if key not in parsed["baseline"] or not isinstance(parsed["baseline"][key], list):
            raise ValueError(f"Cannot freeze: baseline.{key} must be an existing array")
        body, count = re.subn(
            rf"(?m)^{re.escape(key)}[ \t]*=[ \t]*\[[^\]]*\]",
            lambda _match: block(key, values), body,
        )
        if count != 1:
            raise ValueError(f"Cannot freeze: ambiguous baseline.{key}")
    text = text[:section.end()] + body + text[end:]
    rewritten = tomllib.loads(text)
    expected = {**parsed, "baseline": {**parsed["baseline"], **updates}}
    if rewritten != expected:
        raise ValueError("Cannot freeze: unrelated TOML values changed")
    MANIFEST.write_text(text, encoding="utf-8")
    print(f"基线已写入：违规 {len(v)} 条，成环边 {len(updates['cyclic_edges'])} 条，"
          f"DFS 诊断路径 {len(c)} 条，services 越层 {len(sv)} 条")
    # ⚠ 说清它**没**覆盖什么。默认全覆盖会让"往基线里加东西"变得太顺手，
    #   而那正是仓里明写着不该出现在日常流程里的动作（架构边界那一节）。
    #   不说清则更糟：下一个人以为 --freeze 是全量的，剩下三条棘轮悄悄没跟上。
    print(
        "⚠ 未覆盖：component_violations / component_cycles / component_cyclic_edges / orphans —— "
        "这些条目要手改 architecture.toml，逼你逐条写清为什么接受这笔欠账"
    )


def main(argv: Optional[List[str]] = None) -> int:
    # pytest 把 stdout 收成 pipe：Windows 用 GBK，print("✅") 会 UnicodeEncodeError
    # 把 --check 成功打成 exit 1。跟 stdio_utf8 同一条，这里不 import 以免多一条边。
    for _stream in (sys.stdout, sys.stderr):
        _fn = getattr(_stream, "reconfigure", None)
        if callable(_fn):
            try:
                _fn(encoding="utf-8", errors="replace")
            except Exception:
                pass
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="闸：违规/环有没有变多")
    ap.add_argument("--emit", action="store_true", help="重新生成架构图")
    ap.add_argument("--freeze", action="store_true", help="把当前状态写进基线（慎用）")
    ap.add_argument("--report", action="store_true", help="人看的摘要")
    args = ap.parse_args(argv)

    try:
        g = build_graph()
    except GraphScanError as exc:
        print(f"[arch_graph] {exc}", file=sys.stderr)
        return 1
    manifest = load_manifest()
    ownership = ownership_errors(g, manifest)
    if ownership:
        for error in ownership:
            print(f"[arch_graph] {error}", file=sys.stderr)
        return 1
    v, c = layer_violations(g, manifest), cyclic_edges(g, manifest)
    sv = services_violations(g, manifest)
    cv = component_violations(g, manifest)
    cc = component_cyclic_edges(g, manifest)
    orph = orphans(g, manifest)
    sat = satellite_components(g, manifest)
    base = manifest.get("baseline", {})

    if args.emit:
        # Render both first: a failing TS scan must not leave half a generation.
        python_doc = render_doc(g, manifest)
        repo_doc = render_repo_doc(g, manifest)
        DIAGRAM.parent.mkdir(parents=True, exist_ok=True)
        DIAGRAM.write_text(python_doc, encoding="utf-8")
        print(f"已生成 {DIAGRAM.relative_to(REPO)}")
        REPO_DIAGRAM.write_text(repo_doc, encoding="utf-8")
        print(f"已生成 {REPO_DIAGRAM.relative_to(REPO)}")
        return 0
    if args.freeze:
        _freeze(g, manifest)
        return 0
    if args.report or not args.check:
        print(f"模块 {len(g.modules)}  边 {len(g.edges)}  "
              f"函数体 import 语句 {deferred_count(g)} 条（基线 {base.get('deferred', '?')}）")
        print(f"未声明跨包依赖 {len(v)}（基线 {len(base.get('violations', []))}）")
        for x in v:
            print(f"   {x}")
        print(f"未豁免的模块级 SCC 成环边 {len(c)} 条（基线 {len(base.get('cyclic_edges', []))}）")
        for x in c:
            print(f"   {x}")
        _inside = sorted(set(find_cycles(g)) - set(cross_component_cycles(g, manifest)))
        if _inside:
            print(f"已豁免的组件内部 DFS 见证路径 {len(_inside)} 条（仅作诊断）")
            for x in _inside:
                print(f"   {x}")
        print(f"services 内部越层 {len(sv)}（基线 {len(base.get('services_violations', []))}）")
        for x in sv:
            print(f"   {x}")
        print(f"未声明的组间依赖 {len(cv)}（基线 {len(base.get('component_violations', []))}）")
        for x in cv[:10]:
            print(f"   {x}")
        print(f"component 级 SCC 成环边 {len(cc)} 条（基线 {len(base.get('component_cyclic_edges', []))}）")
        for x in cc[:10]:
            print(f"   {x}")
        print(f"没人 import 的模块 {len(orph)}（基线 {len(base.get('orphans', []))}）"
              f" —— ⚠ 不是待删清单，见 orphans() 文档")
        print(f"卫星组（唯一消费者正是它依赖的那个组）{len(sat)}")
        for x in sat:
            print(f"   {x}")
        if not args.check:
            return 0

    try:
        errors = validate_graph(g, manifest)
    except (GraphScanError, OSError, RuntimeError, ValueError) as exc:
        print(f"[arch_graph] validation failed: {exc}", file=sys.stderr)
        return 1
    for error in errors:
        print(f"[arch_graph] {error}")
    if not errors:
        print("Architecture declarations, ratchets and generated diagrams are synchronized.")
    return int(bool(errors))



# ── services 内部分层（抄 grok 的叶子 crate）────────────────────────────────
#
# grok 把 51 个共用叶子（token 估算、路径、文件工具…）切成独立 crate，
# 依赖方向由编译器焊死：大块能用叶子，叶子永远碰不到大块。
# 我们 195 个 services 模块平铺在一个命名空间里，谁都能 import 谁——
# 这正是「463 条 import 藏在函数体里」的根。
#
# ⚠ 分层是**从今天的真实依赖深度算出来的**，不是重新设计。它是一条棘轮基线：
#   先把现状固定成契约，此后只许变好。别把它读成"架构本该如此"。
SERVICES_LAYERS = ("util", "core", "flow")


def services_depth(g: "Graph") -> Dict[str, int]:
    """services 内部的依赖深度。0 = 不依赖 services 里任何其它模块。

    环上就地截断——环的存在本身由 find_cycles 单独管，这里只要一个稳定的分层。
    """
    inside = {m for m in g.modules if m.startswith("services.")}
    out: Dict[str, Set[str]] = {}
    for e in g.edges:
        if e.src in inside and e.dst in inside and e.src != e.dst:
            out.setdefault(e.src, set()).add(e.dst)
    depth: Dict[str, int] = {}

    def walk(m: str, seen: Tuple[str, ...]) -> int:
        if m in depth:
            return depth[m]
        if m in seen:
            return 0
        vals = [walk(x, seen + (m,)) + 1 for x in out.get(m, ())]
        depth[m] = max(vals) if vals else 0
        return depth[m]

    sys.setrecursionlimit(10000)
    for m in sorted(inside):
        walk(m, ())
    return depth


def suggest_services_layers(g: "Graph") -> Dict[str, List[str]]:
    """按深度分三档。分界线是数出来的，不是拍的：

        深度 0      117 个  纯叶子 → util
        深度 1..2    52 个  → core
        深度 >=3     26 个  编排（驱动器 / 流水线 / 控制面）→ flow
    """
    depth = services_depth(g)
    buckets: Dict[str, List[str]] = {k: [] for k in SERVICES_LAYERS}
    for m, d in depth.items():
        buckets["util" if d == 0 else "core" if d <= 2 else "flow"].append(m)
    return {k: sorted(v) for k, v in buckets.items()}


def services_violations(g: "Graph", manifest: dict) -> List[str]:
    """services 内部越层依赖：叶子碰了上层、core 碰了 flow。"""
    spec = manifest.get("services_layer", {})
    if not spec:
        return []
    owner: Dict[str, str] = {}
    for layer, cfg in spec.items():
        for m in cfg.get("modules", []):
            owner[m] = layer
    allowed = {k: set(v.get("may_depend_on", [])) | {k} for k, v in spec.items()}
    bad: Set[str] = set()
    for e in g.edges:
        a, b = owner.get(e.src), owner.get(e.dst)
        if a is None or b is None:
            continue
        if b not in allowed.get(a, set()):
            bad.add(f"{a} -> {b} :: {e.src} -> {e.dst}")
    return sorted(bad)


#: 孤儿归类的合法取值。新增一类要同时在 `architecture.toml` 的 `[orphan_reasons]`
#: 注释里写清含义——一个没有定义的类别名等于没归类。
ORPHAN_CATEGORIES = frozenset({
    "cross_language_entry",
    "migration_ledger",
    "contract_mirror",
    "superseded",
    "unwired",
})


def orphan_reason_gaps(g: "Graph", manifest: dict) -> Tuple[List[str], List[str], List[str]]:
    """孤儿归类的三种病，一次算清。

    ⚠ 为什么要三个而不是一个：这三种病的**修法完全不同**，合成一条错误信息
      会逼下一个人自己去分辨。

        missing  孤儿没归类           → 读它的模块头，归一类
        stale    归类指向的不是孤儿了  → 它被接上了（好事），从这节删掉
        unknown  归类名不在词表里      → 拼错了，或者新立了一类却没写定义

      第三条挡的是本仓踩过的形状：环境开关手抄 28 份，其中两份的默认与词表对不上
      （§14.6）。**一个拼错的类别名不会报错，只会静静地把这条记录变成不算数的。**
    """
    reasons = manifest.get("orphan_reasons", {}) or {}
    now = set(orphans(g, manifest))
    missing = sorted(now - set(reasons))
    stale = sorted(set(reasons) - now)
    unknown = sorted(
        f"{m} = {c}" for m, c in reasons.items() if c not in ORPHAN_CATEGORIES
    )
    return missing, stale, unknown


if __name__ == "__main__":
    raise SystemExit(main())
