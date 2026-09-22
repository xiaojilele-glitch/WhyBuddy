"""状态里的封闭词，写进去之前必须先申报（2026-08-28 架构对账补的）。

## 这条挡的是什么：已经发生过两次的静默数据丢失

`models/v5_state.py` 的 `AwaitReason` 头上记着两次事故，形状一模一样：

    第一次  控制面澄清停靠写 `awaitReason = "control_clarify"`，而名单里没有它
    第二次  马拉松内层炸掉写 `awaitReason = "error"`，同样不在名单里

pydantic v2 **默认不校验赋值**，所以写的时候一声不响；等到从库里读回来走
`server_load`，整条会话 `invalid_session` → `_coerce_many` 把它**跳过**
（persistence.py:370）。症状是「停在那一步的会话，重启后从侧栏里消失了」
——没有报错、没有告警。

第二次那条更讽刺：它**恰恰是失败取证路径**，把异常写进 decisionLedger 好让
人事后查，结果整条会话因为这个未申报的值读不回来，取证记录一起没了。

## ⚠ 为什么「Python/TS 两边一致」的判据挡不住

那段注释里写得很清楚：**两边都缺，所以"两边一致"成立**，schema 对齐测试
照样绿。所以闸必须比的是**「申报的词表」vs「代码里真的写过的值」**，
不是两边互比。这条是本文件存在的全部理由。

## ⚠ 扫描必须先剥注释

`v5_state.py` 的注释里**逐字引用了** `"control_clarify"` 和 `"error"`
（就是在讲那两次事故）。不剥注释的话，一个还没申报的值只要在注释里被提过
一次就"通过"了——判据被自己要挡的那段文字骗过去。这跟本仓「判据 grep 到的
词其实在文档字符串里」是同一口。
"""

import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_STATE = os.path.join(_ROOT, "models", "v5_state.py")


def _strip_comments(src: str) -> str:
    """剥行注释与文档字符串。见模块头：注释里逐字引用过要挡的值。"""
    out, in_doc, quote = [], False, ""
    for line in src.splitlines():
        t = line.strip()
        if in_doc:
            if quote in t:
                in_doc = False
            continue
        if t.startswith(('"""', "'''")):
            quote = t[:3]
            if not (len(t) > 3 and t.endswith(quote)):
                in_doc = True
            continue
        if t.startswith("#"):
            continue
        out.append(line.split("  #")[0])
    return "\n".join(out)


def _declared(field: str) -> set:
    """从 v5_state 里取这个字段申报了哪些值。解析不到就 fail，不许空过。"""
    code = _strip_comments(open(_STATE, encoding="utf-8").read())
    # 两种写法都认：具名 Literal 别名，以及字段上内联的 Literal
    m = re.search(rf"{field}\s*=\s*Literal\[(.*?)\n\]", code, re.S)
    if not m:
        m = re.search(rf"{field}\s*:\s*Optional\[Literal\[(.*?)\]\]", code, re.S)
    if not m:
        alias = re.search(rf"{field}\s*:\s*Optional\[([A-Za-z]+)\]", code)
        assert alias, f"{field} 在 v5_state.py 里找不到声明——改名了？判据要跟着改"
        m = re.search(rf"{alias.group(1)}\s*=\s*Literal\[(.*?)\n\]", code, re.S)
    assert m, f"{field} 的 Literal 解析不出来——判据会空过，先修判据"
    vals = set(re.findall(r'"([a-z_]+)"', m.group(1)))
    assert vals, f"{field} 解析出来是空集合——正则失配，判据会空过"
    return vals


def _written(field: str) -> dict:
    """全仓扫这个字段被赋过哪些字面值（跳过测试与 v5_state 自己）。"""
    hits: dict = {}
    for dirpath, dirnames, filenames in os.walk(_ROOT):
        dirnames[:] = [
            d for d in dirnames if d not in ("__pycache__", "tests", ".venv", "static")
        ]
        for fn in filenames:
            if not fn.endswith(".py") or fn == "v5_state.py":
                continue
            p = os.path.join(dirpath, fn)
            try:
                code = _strip_comments(open(p, encoding="utf-8", errors="ignore").read())
            except OSError:
                continue
            for v in re.findall(rf'{field}\s*=\s*"([a-z_]+)"', code):
                hits.setdefault(v, set()).add(fn)
            for v in re.findall(rf'"{field}"\s*:\s*"([a-z_]+)"', code):
                hits.setdefault(v, set()).add(fn)
    return hits


class Test判据自己没打空:
    """⚠ 排第一。词表解析不到 / 正则失配 / 扫描目录写错，都会让下面几条
    **空过**——绿灯，而什么都没验。"""

    @pytest.mark.parametrize("field", ["awaitReason", "runtimePhase"])
    def test_确实量到了东西(self, field):
        assert len(_declared(field)) >= 5
        assert len(_written(field)) >= 3


class Test写进去的值必须先申报:
    @pytest.mark.parametrize("field", ["awaitReason", "runtimePhase"])
    def test_没有未申报的值(self, field):
        declared = _declared(field)
        undeclared = {
            v: sorted(files) for v, files in _written(field).items() if v not in declared
        }
        assert undeclared == {}, (
            f"{field} 有未申报的值：{undeclared}。"
            f"pydantic 写的时候不报错，但从库里读回来整条会话会被跳过"
            f"——症状是「会话从侧栏消失了」。先把它加进 v5_state.py 的词表。"
        )

    def test_两个字段的词表没有互相串味(self):
        """反向判据：两份词表不该有交集。有的话多半是复制粘贴时串了行，
        而那种错误"两边一致"和"都申报了"都挡不住。"""
        both = _declared("awaitReason") & _declared("runtimePhase")
        assert both == set(), f"两份词表重叠：{sorted(both)}"
