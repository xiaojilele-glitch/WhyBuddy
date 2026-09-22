# -*- coding: utf-8 -*-
"""首轮的数据模型 / 权限工作流 / 绑定是**边界**，不是模型的可选项（2026-09-04）。

## 事故

`FIRST_PASS_TOOLS` 上面钉着一条用户裁决：

    2026-09-03 用户（团子）：一跳一停手点 structure/bind，画布块之间的
    关联关系看不见。**首轮必须把数据模型、权限工作流、绑定做完。**

节点内 ReAct 通电（去掉 v5_full_driver 那个剖面排除）之后，真机
sr-20260904041125 第 2 跳模型当场就把它摘了，账本原文：

    规则给的: ["factory.pages","factory.structure","factory.bind"]
    模型选的: ["pages"]
    理由:     用户意图为聚焦页面绘制与视觉原型，跳过数据实体建模与权限
              工作流打孔，优先生成完整页面原型以完成收口交付

那一趟终态没坏（spec 19 节点、boundPages=6、6 页全 bound），但**不是因为
有护栏**——是后面又跳了两次、控制面 LLM 恰好把 structure 捡了回来。
用户在页面出来那一刻收手，拿到的就是没绑定的原型，正是团子那条抱怨。

⚠ 病根不只是「少做一件」，是**减菜会把首轮链的身份抹掉**：
  stamp 成 `['pages']` 之后 `is_first_pass_chain` 变 False（len < 2），
  「首轮必须做完」这条不变量连载体都没了，之后全靠运气。

## 修法（阶段 1）

阶段 0 把裁决焊成「floor ∩ legal 一件都不许少」——首轮链上模型零自由。
阶段 1 放宽：clip 按提案走，摘掉的进待办。账不清空就不算首轮做完。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from services.capability_plan import (
    FIRST_PASS_TOOLS,
    clip_factory_tools,
    deferred_factory_tools,
    first_pass_still_open,
    merge_factory_todo,
)

_DRV = Path(__file__).resolve().parents[1] / "services" / "v5_full_driver.py"

#: 真机 sr-20260904041125 第 2 跳的原样载荷（账本抄来的，不是自己拼的）。
_REAL_LEGAL = ("pages", "structure", "bind")
_REAL_PROPOSAL = [{"capabilityId": "pages", "roleId": "工程"}]


class Test真机那一刀现在记在待办上:
    def test_模型只选pages这一跳就只跑pages(self):
        """阶段 1：可以延后，不许把这一跳强行补回 structure/bind。"""
        out = clip_factory_tools(
            _REAL_PROPOSAL, _REAL_LEGAL, floor=_REAL_LEGAL, has_spec=True
        )
        assert out == ("pages",), f"不许摘被改回去了：{out}"

    def test_摘掉的structure和bind进待办(self):
        """这条红 = 团子那条抱怨原样回来（延后的活丢了）。"""
        chosen = clip_factory_tools(
            _REAL_PROPOSAL, _REAL_LEGAL, floor=_REAL_LEGAL, has_spec=True
        )
        todo = deferred_factory_tools(chosen, floor=_REAL_LEGAL, legal=_REAL_LEGAL)
        assert "structure" in todo and "bind" in todo, f"裁决被摘掉且没进账：{todo}"
        assert "pages" not in todo

    def test_首轮链的身份挂在待办上(self):
        """⚠ 真正的病根：减到一件，`is_first_pass_chain` 变 False，
        「首轮必须做完」这条不变量连载体都没了。"""
        from services.capability_plan import is_first_pass_chain

        assert not is_first_pass_chain(("pages",)), "前提变了：单件本来就不算首轮链"
        chosen = clip_factory_tools(
            _REAL_PROPOSAL, _REAL_LEGAL, floor=_REAL_LEGAL, has_spec=True
        )
        todo = deferred_factory_tools(chosen, floor=_REAL_LEGAL, legal=_REAL_LEGAL)
        assert first_pass_still_open(chosen, todo), (
            f"首轮链身份没保住：tools={chosen} todo={todo}"
        )

    def test_范围卡取消的不许被待办塞回来(self):
        """⚠ 反向：用户在范围卡上取消了 bind，legal 里就没有 bind。"""
        chosen = clip_factory_tools(
            [{"capabilityId": "pages"}],
            ("pages", "structure"),
            floor=("pages", "structure"),
            has_spec=True,
        )
        todo = deferred_factory_tools(
            chosen, floor=("pages", "structure"), legal=("pages", "structure")
        )
        assert "bind" not in todo, f"把用户取消掉的 bind 塞回来了：{todo}"
        assert "structure" in todo
        merged = merge_factory_todo((), ran=chosen, deferred=todo, legal=("pages", "structure"))
        assert "bind" not in merged


class Test模型的自由没被没收:
    def test_没有地板时照旧可以减菜(self):
        """一跳一件 / 别的配方 / 精修轮走的是这条：floor=None，行为一个字没变。"""
        out = clip_factory_tools(_REAL_PROPOSAL, _REAL_LEGAL)
        assert out == ("pages",), f"没传 floor 却被垫了地板：{out}"

    def test_空地板等于没传(self):
        assert clip_factory_tools(_REAL_PROPOSAL, _REAL_LEGAL, floor=()) == ("pages",)

    def test_提案全不合法仍然拒绝而不是回落(self):
        """⚠ 反向：2026-09-02 那条不许被地板改掉。"""
        from services.capability_plan import FactoryToolsRefused

        with pytest.raises(FactoryToolsRefused):
            clip_factory_tools(
                [{"capabilityId": "report.write"}], _REAL_LEGAL, floor=_REAL_LEGAL
            )

    def test_没提案时地板不改变行为(self):
        """没提案 → 回落 legal 再补根（既有行为，与地板无关）。

        ⚠ 这里断言的是「传不传 floor 结果一样」，不是某个字面清单：
          `clip_factory_tools(None, ('pages','structure','bind'))` 本来就
          返回 `('spec','pages','structure','bind')`（多件菜单补根，:145），
          剩余链那份 spec 由 spec_first_pipeline 的沿用分支剥掉（b6e0ab3）。
          第一版判据把补根当成了地板的副作用，写成 == _REAL_LEGAL 直接红。
        """
        assert clip_factory_tools(None, _REAL_LEGAL, floor=_REAL_LEGAL) == (
            clip_factory_tools(None, _REAL_LEGAL)
        )


class Test地板不许把补根变成重起草SPEC:
    """⚠ 2026-09-04 真机 sr-20260904050038（洗衣店）：地板的第一版当场闯祸。

    剩余链从 ('pages',) 变成 ('pages','structure','bind') → len != 1 → 补根塞进
    spec → spec_first_pipeline:1436 的去根判据是「spec 不在 _requested 里」，
    一带上就不去根 → 整跳预算烧在重起草一份**不一样的** SPEC 上
    （5 页 16 节点 → 4 页 13 节点），落库 0 份，25 分钟白跑、页面一张没有。

    那正是 b6e0ab3 修过的事故原样复发。上一版之所以没犯，是靠模型减到单件、
    len==1 侥幸绕开补根——**不是真的挡住了**。地板把侥幸拿掉，病就露出来。
    """

    def test_有SPEC时地板不许招来重起草(self):
        """这条红 = 洗衣店那 25 分钟白跑原样回来。"""
        out = clip_factory_tools(
            _REAL_PROPOSAL, _REAL_LEGAL, floor=_REAL_LEGAL, has_spec=True
        )
        assert "spec" not in out, f"已经有 SPEC 还补根，流水线会重起草：{out}"
        assert out == ("pages",)

    def test_没有SPEC时首轮不许把spec延后(self):
        """⚠ 反向：空会话 pages 没根，run_spec_first 会直接抛（建设单 O-4）。

        阶段 1 不再并 floor，pages 单跳会走到 len==1 那条侥幸。
        首轮 floor 在、还没 SPEC 时必须把 spec 留在这一跳。
        """
        out = clip_factory_tools(
            [{"capabilityId": "pages"}],
            ("spec", "pages", "structure"),
            floor=("spec", "pages", "structure"),
        )
        assert out[0] == "spec", f"首轮没 SPEC 却把根延后了：{out}"
        assert "pages" in out
        todo = deferred_factory_tools(
            out,
            floor=("spec", "pages", "structure"),
            legal=("spec", "pages", "structure"),
        )
        assert "spec" not in todo, f"spec 进了待办：{todo}"

    def test_单跳仍然不塞spec(self):
        out = clip_factory_tools([{"capabilityId": "bind"}], ("bind",))
        assert out == ("bind",), f"单跳被塞了 spec：{out}"

    def test_精修轮不补根(self):
        out = clip_factory_tools(
            [{"capabilityId": "pages"}, {"capabilityId": "structure"}],
            ("pages", "structure"),
            refine=True,
        )
        assert "spec" not in out


class Test接在真跑的那条路上:
    """CLAUDE.md §1：待办只有传下去才算数。"""

    def test_调用点把摘掉的记进待办(self):
        src = _DRV.read_text(encoding="utf-8")
        assert "deferred_factory_tools" in src, "摘了没进待办，等于没装"
        assert "_record_factory_todo" in src, "待办没写进 state"
        assert "floor=_floor" in src, "地板没传进 deferred_factory_tools"

    def test_地板只在首轮链上垫(self):
        """⚠ 反向：一跳一件是用户自己点的，垫地板等于替他改主意。"""
        src = _DRV.read_text(encoding="utf-8")
        fn = src.split("def _first_pass_floor")[1].split("\ndef ")[0]
        assert "_first_pass_chain(state)" in fn, (
            f"地板没按首轮链设条件，一跳一件会被强行补菜：{fn[:400]}"
        )
        assign_src = ast.unparse(
            [
                n
                for n in ast.walk(ast.parse(src))
                if isinstance(n, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == "_floor" for t in n.targets)
            ][0]
        )
        assert "_first_pass_floor" in assign_src
        assert "profile == 'app'" in assign_src or 'profile == "app"' in assign_src

    def test_裁决的原文还在(self):
        """⚠ 这条钉的是「别把注释改回去」：地板的理由写在 FIRST_PASS_TOOLS 头上。"""
        cp = (
            Path(__file__).resolve().parents[1] / "services" / "capability_plan.py"
        ).read_text(encoding="utf-8")
        assert "首轮必须把数据模型、权限工作流、绑定做完" in cp
        assert "摘了进待办" in cp
        assert set(FIRST_PASS_TOOLS) == {"spec", "pages", "structure", "bind"}
