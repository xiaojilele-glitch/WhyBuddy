# -*- coding: utf-8 -*-
"""请求域上下文搬进叶子 services.turn_context（2026-08-29）。

## 搬了什么、为什么

`spec_tree.build_spec_prompt` 要往 prompt 里拼三块东西：产品宪章、连接器实体
声明、（体验层还要）已安装技能。这三块原本分别长在 `product_charter`（drive 组）
和 `v5_llm_generate`（model_core 组）里，而那两个模块本身**都在被 spec-first
这条链调用的一侧**。于是拼一块 prompt 就得反过来 import 上层：

    spec_first -> drive        （spec_tree -> product_charter）
    spec_first -> model_core   （spec_tree -> v5_llm_generate）

这两条边一共把四个组间环连在一起。抄 grok 的共用叶子：**共用件切成叶子，
方向就被焊死**。清洗那一半留在原处（要查连接器注册表 / identity_store），
只把「请求域存储 + 读侧」搬进叶子——即 grok 的 `-types` / `-api` 拆法。

## ⚠ 这个文件真正在防的事

搬 ContextVar 的失败方式是**静默的**。只要哪天有人在 `v5_llm_generate` 或
`product_charter` 里"顺手"重新定义一个同名 ContextVar，就会变成
**setter 写 A、getter 读 B**：

- 技能注入不生效（`installed_skills_for_channel()` 永远空）
- 连接器实体没进 prompt → 生成期取回的真数据填不进孔，页面每格「—」
- 用户勾了「下一场沿用」，宪章却不进 prompt

三个都**不报错、不告警、判据全绿**。所以这里的主判据不是「函数在不在」，
是 **「从老入口 set、从叶子 get，读到同一份」**——只有它能咬住重复定义。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import turn_context as tc  # noqa: E402


class Test两个入口读写的是同一个ContextVar:
    """⚠ 主判据。重复定义 ContextVar 是这次搬家唯一的静默失败模式。"""

    def test_技能_从生成层set_从叶子get(self):
        from services import v5_llm_generate as gen

        gen.set_installed_skills(
            [{"name": "配色指导", "description": "d", "channel": "experience"}]
        )
        try:
            got = tc.installed_skills_for_channel("experience")
            assert [s["name"] for s in got] == ["配色指导"], (
                "从 v5_llm_generate 写、从 turn_context 读，读不到——"
                "两边各有一个 ContextVar 了（技能注入会安静地不生效）"
            )
        finally:
            gen.set_installed_skills(None)

    def test_连接器_从生成层set_从叶子get(self, monkeypatch):
        from services import v5_llm_generate as gen

        class _Spec:
            id = "weather"
            name = "天气"
            source = "test"

            def available(self):
                return True

            def entity_declaration(self):
                return {
                    "id": "weather_daily",
                    "name": "日天气",
                    "fields": [{"id": "temp_max", "type": "number"}],
                }

        monkeypatch.setattr(
            "services.connectors.get_connector", lambda cid: _Spec() if cid == "weather" else None
        )
        gen.set_active_connectors(["weather"])
        try:
            assert [c["id"] for c in tc.active_connectors()] == ["weather"]
            block = tc.connector_prompt_block()
            assert "temp_max" in block, "字段 id 没逐字进 prompt，真数据就填不进孔"
        finally:
            gen.set_active_connectors(None)

    def test_生成层读到的也是同一份(self):
        """⚠ 反向：叶子写、老入口读。只测一个方向的话，
        「生成层留了个自己的读函数」这种半吊子改法照样绿。"""
        from services import v5_llm_generate as gen

        tc.set_installed_skills_cleaned(
            [{"name": "x", "description": "", "channel": "aigc"}]
        )
        try:
            assert [s["name"] for s in gen.installed_skills_for_channel("aigc")] == ["x"]
        finally:
            tc.set_installed_skills_cleaned(None)


class Test宪章读写的是同一个ContextVar:
    def test_从product_charter_set_从叶子读到prompt块(self):
        from services import product_charter as pc

        pc.set_charter_context({"industry": "社区养老"}, opt_in=True)
        try:
            block = tc.charter_prompt_block()
            assert "社区养老" in block, (
                "从 product_charter 写、从 turn_context 读，宪章没进 prompt——"
                "两边各有一个 ContextVar 了（用户勾了沿用却安静地不生效）"
            )
        finally:
            pc.clear_charter_for_run()

    def test_opt_in关着必须是空串(self):
        """⚠ 三条硬约束的第 1 条，跟着代码一起搬过来的。"""
        from services import product_charter as pc

        pc.set_charter_context({"industry": "社区养老"}, opt_in=False)
        try:
            assert tc.charter_prompt_block() == "", "没勾沿用却灌了宪章"
        finally:
            pc.clear_charter_for_run()

    def test_白名单还在_五系统键进不来(self):
        """⚠ 第 2 条。搬家最容易掉的就是这种「顺带的」清洗。

        变异实测：把白名单循环换成照单全收 → 红；删掉 `_FIVE_SYSTEM_KEYS`
        常量 → NameError 红。但**单删那一行 stripped 推导式不会红**，因为
        五系统键本来就不在 `CHARTER_FIELDS` 里——那一行是原作者故意留的
        第二道（原注释：「比『定义了不用』更能被变异咬住」），不是漏筛。
        """
        out = tc.normalize_charter(
            {"industry": "医疗", "datamodel": {"entities": []}, "rbac": {"roles": []}}
        )
        assert out == {"industry": "医疗"}


class Test活路径真的取自叶子:
    """⚠ CLAUDE.md 第一条：搬完了但调用点没跟着改，等于没搬——
    环还在，而且判据（上面那些）照样全绿，因为它们直接调函数。"""

    def test_spec_tree拼prompt时取自叶子(self):
        import inspect

        from services import spec_tree

        src = inspect.getsource(spec_tree.build_spec_prompt)
        assert "from services.turn_context import" in src, (
            "spec_tree 又回去 import product_charter / v5_llm_generate 了——组间环会长回来"
        )
        assert "from services.product_charter import charter_prompt_block" not in src
        assert "from services.v5_llm_generate import connector_prompt_block" not in src

    def test_identity_theme_gen取自叶子(self):
        import pathlib
        import re

        from services import identity_theme_gen as itg

        code = re.sub(r'"""[\s\S]*?"""', "", pathlib.Path(itg.__file__).read_text(encoding="utf-8"))
        code = "\n".join(l for l in code.splitlines() if not l.lstrip().startswith("#"))
        assert "from .turn_context import installed_skills_for_channel" in code
        assert "v5_llm_generate" not in code, "又反过来 import 生成层了"

    def test_宪章块还在prompt里_不是搬没了(self):
        """⚠ 正反两条里的反向那条（第三条纪律）：上面只证明「取自叶子」，
        这条证明**东西还在**。搬家把一整块 prompt 弄丢是静默的。"""
        from services import product_charter as pc
        from services.spec_tree import build_spec_prompt

        pc.set_charter_context({"industry": "社区养老"}, opt_in=True)
        try:
            # build_spec_prompt 返回的是 messages 列表，不是字符串——
            # 第一版这条写成 `in build_spec_prompt(...)`，判据当场打空（第二条）。
            msgs = build_spec_prompt("给养老站做个调度平台")
            blob = "\n".join(str(m.get("content") or "") for m in msgs)
            assert "社区养老" in blob, "宪章块没进 prompt——搬家把它弄丢了"
        finally:
            pc.clear_charter_for_run()


class Test叶子还是叶子:
    def test_不依赖services里任何其它模块(self):
        import pathlib
        import re

        code = re.sub(r'"""[\s\S]*?"""', "", pathlib.Path(tc.__file__).read_text(encoding="utf-8"))
        code = "\n".join(l for l in code.splitlines() if not l.lstrip().startswith("#"))
        assert not re.search(r"^\s*from\s+\.\w", code, re.M), (
            "叶子开始依赖 services 里别的模块了——它能被所有人安全 import 的全部理由就没了"
        )

    def test_上层不许再定义同名ContextVar(self):
        """⚠ 源码级的第二道。行为判据（本文件第一组）已经能咬住，
        这条是为了让**下一个人在写的时候就看见**，而不是等判据红。"""
        import pathlib
        import re

        from services import product_charter as pc
        from services import v5_llm_generate as gen

        for mod, names in (
            (gen, ("sliderule_installed_skills", "sliderule_active_connectors")),
            (pc, ("sliderule_product_charter", "sliderule_charter_opt_in")),
        ):
            code = re.sub(
                r'"""[\s\S]*?"""', "", pathlib.Path(mod.__file__).read_text(encoding="utf-8")
            )
            code = "\n".join(l for l in code.splitlines() if not l.lstrip().startswith("#"))
            for n in names:
                assert f'ContextVar(\n    "{n}"' not in code and f'ContextVar("{n}"' not in code, (
                    f"{mod.__name__} 里又出现了 {n} 的 ContextVar 定义——"
                    "set 和 get 会落到两个变量上，而且完全静默"
                )
