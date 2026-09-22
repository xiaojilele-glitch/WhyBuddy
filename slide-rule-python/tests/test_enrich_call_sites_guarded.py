"""services/ 里 enrich_* 的**每一个**调用点都必须被 from_spec_first 守着。

## 跟 test_enrich_skipped_on_spec_first 的分工

那份是**行为判据**：真跑一趟 `_try_llm_generate_evidence`，把两个 enrich 换成
计数器，验新链路上它们没被调用。那是更强的判据——改法怎么变它都成立。

但它只能覆盖**它跑过的那条路**。如果哪天 services/ 里冒出第二个调用点
（另一个入口、另一条修复链、某个新的重生成路径），行为判据一个字都不会说，
因为那条路它压根没跑。

这份补的正是那一半：**范围性断言**——"全仓没有第二个没守卫的调用点"。
两份缺一不可，跟 test_enrich_skipped_on_spec_first 里正反两条是同一个道理：
只查"该没的没了"，不查"别处有没有偷偷长出来一个"。

## 为什么走 AST 而不是 grep

这仓库为这件事付过两次学费：

  ① 第 3 步那条「不许引 tenacity」头一版写成 `"tenacity" not in src`，
     被模块里那句**注释**「不引 tenacity」判红。
  ② 2026-08-14 复核时用 grep 数 `run_spec_first` 的调用点，数出 4 处；
     AST 一看只有 1 处是真调用——另外两处在注释和 docstring 里、一处是 import。
     **同一天里，grep 让同一个人对同一件事得出两个不同的数。**

AST 里没有注释、没有字符串、没有 import 伪装成调用。判据要断言"某段代码
在不在、被什么守着"，就必须问语法树，不能问文本。

## 不查 scripts/

scripts/ 下那些（fresh_topic_shot / enrich_builtin_domain_models）是**老链路
专用的工具**：一个是给老路落参考图做对比，一个是重生成冻结夹具。它们本来就
该无条件跑 enrich——那是它们存在的理由。把它们一起管起来会逼出一堆假红。
"""

import ast
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SERVICES = Path(__file__).resolve().parent.parent / "services"

#: 这两个是「让 AI 重新发明版式」的入口。新链路上版式来自第 3 步的真 HTML，
#: 再跑一遍等于把已经画好的页面重做一次（架构图 ⚑⚑B / ⚑⚑F）。
ENRICH_FUNCS = {"enrich_freeform_blocks", "enrich_monitor_page_overviews"}

#: 守卫里必须出现的标志名。不比对整个表达式——`not from_spec_first`、
#: `from_spec_first is False`、将来可能的 `not ctx.from_spec_first` 都算数，
#: 判据钉在「这个决定有没有参考它」，不钉在写法上。
GUARD_TOKEN = "from_spec_first"


def _callee(node: ast.Call) -> str | None:
    f = node.func
    if isinstance(f, ast.Name):
        return f.id
    if isinstance(f, ast.Attribute):
        return f.attr
    return None


def _unguarded_enrich_calls() -> list[str]:
    """返回 services/ 下所有**没被 from_spec_first 守着**的 enrich 调用点。"""
    bad: list[str] = []
    for path in sorted(SERVICES.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:  # pragma: no cover — 语法坏了自有别的判据管
            continue
        for parent in ast.walk(tree):
            for child in ast.iter_child_nodes(parent):
                child.parent = parent  # type: ignore[attr-defined]
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or _callee(node) not in ENRICH_FUNCS:
                continue
            # 定义处本身不算调用点：enrich_* 定义在 freeform_block.py 里，
            # 它内部的递归/自调用不是"主轴上又跑了一次"。
            guarded = False
            cur = getattr(node, "parent", None)
            while cur is not None:
                if isinstance(cur, ast.If) and GUARD_TOKEN in ast.unparse(cur.test):
                    guarded = True
                    break
                cur = getattr(cur, "parent", None)
            if not guarded:
                rel = path.relative_to(SERVICES.parent)
                bad.append(f"{rel}:{node.lineno} {_callee(node)}()")
    return bad


def test_services_里没有未守卫的_enrich_调用点():
    """新增一个没守卫的调用点 = 新链路又开始重做木偶，而且行为判据抓不到。

    修法不是把它加进豁免名单，是**给它加上同一个守卫**——如果那个调用点
    确实只该在老链路上跑（多数情况如此），守卫本来就是对的。
    """
    bad = _unguarded_enrich_calls()
    assert bad == [], (
        "这些 enrich_* 调用点没有被 from_spec_first 守着，"
        "新链路会在它们那里重新发明一遍版式：\n  " + "\n  ".join(bad)
    )


def test_判据自己不是空转():
    """⚠ 这条防的是判据"看起来在守着、其实什么都没扫到"。

    如果哪天 enrich_* 改了名、或者 services/ 路径变了，上面那条会因为
    **一个调用点都没找到**而恒绿——绿得毫无意义。所以这里正面断言：
    确实存在被守卫的调用点。

    这正是今天反复出现的那个形状的判据版：空数组里没有错误，
    于是"没有错误"证明不了任何事。
    """
    found = 0
    for path in SERVICES.rglob("*.py"):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:  # pragma: no cover
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and _callee(node) in ENRICH_FUNCS:
                found += 1
    assert found >= 2, (
        f"services/ 下只找到 {found} 个 enrich_* 调用点——"
        "函数是不是改名了或挪走了？上面那条判据现在是空转的。"
    )
