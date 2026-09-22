# -*- coding: utf-8 -*-
"""精修一页不许把整个应用的配色换掉（2026-09-04 真机）。

## 事故

两个会话各复现一次，规律干净：

    共享工具房  首轮 design=llm → shell themePrimary=#244b3e
                精修 单跳       → shell themePrimary=#2563eb
    慢病随访    首轮 design=llm → shell themePrimary=#1a535c（医疗青绿）
                精修 单跳       → shell themePrimary=#2563eb（缺省蓝）

用户只说「把随访任务列表页的表格改成看板视图」，**整个应用的主色被换掉**。
而且 `unify_shell` 会拿新主色重刷每一页，于是：

    [spec_page_html] 按需重画：3/4 页原样沿用上一版（…），只重画 1 页
    判定：变了的页 = 全部 4 页

日志说「原样沿用」，交付物却全变——CLAUDE.md §3 那条「闸全绿但东西没了」的
镜像：**日志说没动，东西却动了**。

## 机制

「一跳一件」的精修是 `capabilityPlan tools=pages`，展开里没有 design。
第 2.5 步的分支第一版写成：

    if not _do_design:      pass          ← 精修走这里，什么都不做
    elif design_system:     pass
    elif reuse_style_brief: style_brief = reuse_style_brief   ← 够不着
    elif reuse_language:    …                                  ← 够不着
    else:                   <现生成>

`reuse_style_brief` / `reuse_language` 明明由执行器传了进来（执行器日志
「精修沿用上一版风格段」是**执行器**打的），流水线却因为 `_do_design=False`
直接 pass，于是 `style_brief`、`design_language` 一路 None，第 3.5 步
`resolve_theme_language(None, None, "")` 退回缺省蓝。

流水线自己那句「复用上一版风格段，不重新生成」在真机日志里**一次都没出现过**，
正是它够不着的证据。

## 修法

`_do_design` 管的是「要不要现生成」（那才费 LLM）；复用是零 LLM 的赋值，
只要上游给了就该认。两件事分开：复用分支提到 `_do_design` 之前。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

_PIPE = Path(__file__).resolve().parents[1] / "services" / "spec_first_pipeline.py"

PREV_STYLE = {"pages": {"p1": {"tone": "医疗青绿"}}}
PREV_LANG = {"palette": {"primary": "#1a535c"}}


def _design_block():
    """把产线第 2.5 步那段分支原样取出来编译。不重抄逻辑。"""
    src = _PIPE.read_text(encoding="utf-8")
    tree = ast.parse(src)
    fn = next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.FunctionDef) and n.name == "run_spec_first"
    )
    seg = ast.get_source_segment(src, fn)
    start = seg.index('    if (design_system or "").strip():')
    end = seg.index("raise_if_cancelled(\"第2.5步 定设计语言\")", start)
    # 取到 else 分支的头一行之前；else 里是现生成（费 LLM），
    # 判据只关心"走没走进去"，用一个替身代替。
    end = seg.rindex("    else:", start, end)
    body = seg[start:end]
    # 去掉函数体那层缩进，块本身就是一条完整的 if/elif 链
    body = "\n".join(l[4:] if l.startswith("    ") else l for l in body.split("\n"))
    body = body.rstrip() + "\nelse:\n    _generated = True\n"
    return compile(body, "<design>", "exec")


def _run(*, do_design, reuse_style=None, reuse_lang=None, design_system=""):
    ns = {
        "_do_design": do_design,
        "design_system": design_system,
        "reuse_style_brief": reuse_style,
        "reuse_language": reuse_lang,
        "design_override": None,
        "style_brief": None,
        "design_language": None,
        "spec_pages_declared_objs": [{"id": "p1"}],
        "style_brief_ok": lambda sb, ids: True,
        "merge_override": lambda a, b: a,
        "normalize_design_language": lambda x: x,
        "render_design_language": lambda dl, **kw: "散文风格段",
        "device": "desktop",
        "arch": "business_app",
        "print": lambda *a, **k: None,
        "raise_if_cancelled": lambda *a, **k: None,
        "_generated": False,
    }
    exec(_design_block(), ns)
    return ns


class Test精修没有design那一步时也要复用:
    def test_单跳精修复用风格段(self):
        """真机那一发：tools=pages，展开里没 design，但上游给了风格段。

        这条红 = 精修一页，整个应用配色退回缺省蓝。
        """
        ns = _run(do_design=False, reuse_style=PREV_STYLE)
        assert ns["style_brief"] == PREV_STYLE, "复用没接上，主题会退回缺省"
        assert ns["_generated"] is False, "复用是零 LLM，不该触发现生成"

    def test_单跳精修复用设计语言(self):
        ns = _run(do_design=False, reuse_lang=PREV_LANG)
        assert ns["design_language"] == PREV_LANG
        assert ns["design_system"] == "散文风格段"
        assert ns["_generated"] is False


class Test别的情形一律不变:
    """反向判据成组：只把复用从 `_do_design` 门后面提出来，别的都不动。"""

    def test_人给了散文最高优先(self):
        ns = _run(do_design=True, reuse_style=PREV_STYLE, design_system="人写的")
        assert ns["style_brief"] is None, "人写的永远赢，连复用都跳过"
        assert ns["_generated"] is False

    def test_首轮没有复用就现生成(self):
        ns = _run(do_design=True)
        assert ns["_generated"] is True

    def test_既没复用也不该生成时什么都不做(self):
        """精修但上游一份都没给 → 保持原样，不许凭空生成（那会费一次 LLM）。"""
        ns = _run(do_design=False)
        assert ns["_generated"] is False
        assert ns["style_brief"] is None and ns["design_language"] is None

    def test_有复用时不生成_即使do_design为真(self):
        """复用优先于生成，这条本来就成立，钉住别被改坏。"""
        ns = _run(do_design=True, reuse_style=PREV_STYLE)
        assert ns["style_brief"] == PREV_STYLE
        assert ns["_generated"] is False


class Test分支顺序钉在源码里:
    """⚠ §3：行为对了还不够，得确认复用**排在** `_do_design` 之前。

    写成 `if not _do_design: pass` 打头，上面几条会全红——但万一有人
    用别的写法绕回去（比如在复用分支里再加一个 `_do_design` 条件），
    这条源码判据兜住。
    """

    def test_复用分支在do_design之前(self):
        src = _PIPE.read_text(encoding="utf-8")
        seg = src[src.index('if (design_system or "").strip():'):]
        seg = seg[: seg.index("raise_if_cancelled(\"第2.5步 定设计语言\")")]
        i_reuse = seg.index("elif reuse_style_brief")
        i_gate = seg.index("elif not _do_design")
        assert i_reuse < i_gate, (
            "复用又被挪到 _do_design 后面了——精修会再一次丢主题色"
        )

    @pytest.mark.parametrize("needle", ["reuse_style_brief", "reuse_language"])
    def test_两条复用路都在门前(self, needle):
        src = _PIPE.read_text(encoding="utf-8")
        seg = src[src.index('if (design_system or "").strip():'):]
        seg = seg[: seg.index("elif not _do_design")]
        assert f"elif {needle}" in seg, f"{needle} 那条复用不在门前"
