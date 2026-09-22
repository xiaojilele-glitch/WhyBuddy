# -*- coding: utf-8 -*-
"""跑完一跳要说实话：没产出就不许报 ok（2026-09-03 真机）。

## 事故

宠物寄养 `sr-20260903025400-EBCW1P6FYT`。`forcedTool=pages` 带精修指令，
SSE 里一路正常：

    control_handoff_factory → run_started → phase_change:orchestrating
    → factory_plan → reasoning_step{label:"refine"} → factory_complete
    → control_tool_result tool=pages ok=true
    → control_ask_user「宠物建档页的疫苗到期红色角标已更新，数据结构已同步。」

而同一条精修连发两次，**五页哈希逐字节没变**：

    checkout_cashier 8d15bae3729f1c57 → 8d15bae3729f1c57
    daily_inspection ccca8622837b1a20 → ccca8622837b1a20
    order_workbench  73077e3cf0c8bdaf → 73077e3cf0c8bdaf
    pet_management   1e8ac2786ec67a49 → 1e8ac2786ec67a49
    room_calendar    0c63954e6f44fa01 → 0c63954e6f44fa01

成功、什么都没做、还具体描述了一件没发生的事。

## 两段拼起来的

**① 执行被整段跳掉**：`skip_planning_loop_for_refine` 返回 True →
调用点 `break` 跳出 `while loop < max_loops`，而能力执行就在那个循环里
（`_host_hop_picks` → `factory.pages` → run_spec_first）。日志里连
`capabilityPlan=` 行都没有。它的本意是跳过**规划**（2026-08-18 agentic pick
空转两圈），host 已点名 hop 时根本没有规划可跳。

**② 回执说不出实话**：`_factory_tool_body` 的 `ok` 被焊成恒 True。那是
2026-09-02 为修「干了活却报 pageCount=0」焊的——代价是从此表达不了
「这一跳真的什么都没干」，控制面拿着 ok=true 就编出了完成话术。

这两条各自都不报错，叠起来就是 CLAUDE.md §3「接口返回 ok ≠ 它真的做了事」。
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

from services.rehearsal_control import (
    _PRODUCING_HOPS,
    _factory_tool_body,
    factory_deliverable_fingerprint,
)
from services.v5_full_driver import skip_planning_loop_for_refine

import pytest


@pytest.fixture(autouse=True)
def _no_refine_context_leak():
    """⚠ 精修上下文是 ContextVar，设完不清会漏给同进程后面的测试。

    2026-09-03 就是这么栽的：本文件按文件名排在 `test_llm_round_caps_stream`
    与 `test_model_section_priority` 前面，`set_refine_context` 一直留着，
    那四条在全量里被当成精修轮而红——**单跑却全绿**。
    顺序依赖的污染比断言写错更难查，装个 autouse 兜底。
    """
    from services.v5_llm_generate import set_refine_context

    set_refine_context(None, "")
    try:
        yield
    finally:
        set_refine_context(None, "")

_CTRL = Path(__file__).resolve().parents[1] / "services" / "rehearsal_control.py"
_DRIVER = Path(__file__).resolve().parents[1] / "services" / "v5_full_driver.py"


class _S:
    """够用的假 state：只带指纹和回执读的那几块。"""

    def __init__(self, spec=None, pages=None, version="mv-1"):
        self.specFirstPages = {"spec": spec or {"pages": ["p1"]}, "pages": pages or {}}
        self.currentModelVersionId = version
        self.publishClosure = None
        self.modelVersions = [{"id": version}]


class Test指纹只盯交付物:
    def test_页面变了指纹就变(self):
        a = _S(pages={"p1": "<div>旧</div>"})
        b = _S(pages={"p1": "<div>新</div>"})
        assert factory_deliverable_fingerprint(a) != factory_deliverable_fingerprint(b)

    def test_一个字节都没变就同指纹(self):
        a = _S(pages={"p1": "<div>同</div>"})
        b = _S(pages={"p1": "<div>同</div>"})
        assert factory_deliverable_fingerprint(a) == factory_deliverable_fingerprint(b)

    def test_不把每轮必变的字段算进来(self):
        """⚠ 取整个 state 会把 lastActive / 台账算进去，指纹永远"变了"=没判据。"""
        a = _S(pages={"p1": "<div>同</div>"})
        b = _S(pages={"p1": "<div>同</div>"})
        b.lastActive = "2026-09-03T04:00:00Z"      # 无关字段
        b.decisionLedger = [{"id": "dec-1"}]
        assert factory_deliverable_fingerprint(a) == factory_deliverable_fingerprint(b)


class Test没产出就不许报ok:
    def test_指纹没变_ok为False(self):
        st = _S(pages={"p1": "<div>同</div>"})
        fp = factory_deliverable_fingerprint(st)
        body = _factory_tool_body(st, "pages", before_fingerprint=fp)
        assert body["ok"] is False, "这一跳什么都没干，不许报 ok"
        assert body["changed"] is False
        assert "没有产出" in body["human"], f"human 要直说，实际：{body['human']}"

    def test_指纹变了_ok为True(self):
        before = factory_deliverable_fingerprint(_S(pages={"p1": "<div>旧</div>"}))
        after = _S(pages={"p1": "<div>新</div>"})
        body = _factory_tool_body(after, "pages", before_fingerprint=before)
        assert body["ok"] is True
        assert body["changed"] is True

    def test_closure不是产出型_不受指纹判定(self):
        """判定类 hop 本来就不改交付物，拿指纹卡它等于永远红。"""
        st = _S(pages={"p1": "<div>同</div>"})
        fp = factory_deliverable_fingerprint(st)
        assert "closure" not in _PRODUCING_HOPS
        assert _factory_tool_body(st, "closure", before_fingerprint=fp)["ok"] is True

    def test_没传指纹时保持恒真(self):
        """老调用点不传就是不判定——放宽只针对传了指纹的那些。"""
        st = _S(pages={"p1": "<div>x</div>"})
        assert _factory_tool_body(st, "pages")["ok"] is True

    def test_不许退回按页数判定(self):
        """⚠ 反向：2026-09-02 那条老坑是「页数没变就报 0」。

        页数一样但内容改了，必须算产出。
        """
        before = factory_deliverable_fingerprint(_S(pages={"p1": "<div>旧</div>"}))
        after = _S(pages={"p1": "<div>新</div>"})   # 页数同为 1
        body = _factory_tool_body(after, "pages", before_fingerprint=before)
        assert body["ok"] is True, "页数没变但内容变了，不许当成没产出"
        assert body["pageCount"] == 1


class Test短路不许跳掉执行:
    def _with_refine_context(self):
        """⚠ 必须先真的把精修上下文装上，这条判据才有意义。

        第一版直接断言 `host_picked_hop=True → False`——**因为错误的原因通过**：
        测试环境里本来就没有精修上下文，拿掉边界后函数照样走到
        `get_refine_context()` 返回空、照样 False。变异验证当场抓到：
        删掉边界 13 条全绿。判据要咬住，就得先让「不加边界会返回 True」成立。
        """
        from services.v5_llm_generate import set_refine_context

        set_refine_context({"page": {"pages": [{"id": "p1"}]}}, "把角标改成红色")

    def test_没有边界时精修确实会短路(self):
        """先证明这条路真的通电（§1）：不给 host_picked_hop 就是 True。"""
        self._with_refine_context()
        assert skip_planning_loop_for_refine() is True

    def test_host选定hop时不短路(self):
        """host 已点名这一跳 → picks 是现成的，没有规划要跳。

        这条红 = 精修轮又会把整个执行循环 break 掉，一件活不干还报成功。
        """
        self._with_refine_context()
        assert skip_planning_loop_for_refine(host_picked_hop=True) is False

    def test_repair仍然不短路(self):
        self._with_refine_context()
        assert skip_planning_loop_for_refine(repair=True) is False

    def test_两条驱动都传了这个边界(self):
        """⚠ 同步 / 流式是成对物（§4）。只改一条 = 一半不生效。

        用 AST 数 `break` 前那个调用的实参，不 grep 字符串——
        文档字符串里就写着这个函数名。
        """
        tree = ast.parse(_DRIVER.read_text(encoding="utf-8"))
        calls = [
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name)
            and n.func.id == "skip_planning_loop_for_refine"
        ]
        withhop = [c for c in calls if any(k.arg == "host_picked_hop" for k in c.keywords)]
        assert len(withhop) >= 2, (
            f"只有 {len(withhop)} 处传了 host_picked_hop。"
            "同步与流式两条循环都要传，否则脚本入口那条照样跳掉执行。"
        )


class Test接线真的接上了:
    """反向判据：光有指纹函数不算数，得确认调用点真的取了、真的传了（§3）。"""

    def _src(self) -> str:
        # ⚠ 剥注释再比对（§2）：本文件和被测文件的注释里都写着这些标识符。
        return re.sub(r"(?m)^\s*#.*$", "", _CTRL.read_text(encoding="utf-8"))

    def test_每个handoff前都取了指纹(self):
        src = self._src()
        assert src.count("_fp_before = factory_deliverable_fingerprint(state)") >= 3, (
            "单跳 / 精修（模型挑）/ 精修（按钮）三条路都要取指纹"
        )

    def test_回执都把指纹传下去(self):
        src = self._src()
        assert src.count("before_fingerprint=_fp_before") >= 3, (
            "取了不传等于没接线——回执照样恒 ok"
        )
