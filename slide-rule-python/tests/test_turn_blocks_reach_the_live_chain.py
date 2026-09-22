# -*- coding: utf-8 -*-
"""每一块"本轮上下文"，到底接在哪条链上（2026-08-29）。

## 为什么要有这张表

这一天里同一个 bug 抓到了**三次**，形状一模一样：

    连接器实体   块接在写需求的第 2 步，而 datamodel 是第 4 步反推的  → §24
    已安装技能   块只接在老生成器 _build_user_content 上              → 本文件
    开工前澄清   同上，而它自己的注释写着「少了它就只是让用户多点几下」→ 本文件

`product_charter` 的模块头 2026-08 就点名过这个坑：

> 注入点必须是 spec-first / scope_card 真正读上下文的地方。
> 只接在 `v5_llm_generate._build_user_content` 上等于接在不通电的插座——
> **默认生成路径是 spec-first**。

宪章按这句话接对了，连接器后来也接对了，剩下的没跟上——而且**没有任何一道闸
在看这件事**。每块自己的单测都绿：它们直接调那个函数，从不问"谁在调它"。

## 这张表就是那道闸

一块"本轮上下文"只有两种合法状态，都得写在这里：

    LIVE      产品路（spec-first 第 2 步 build_spec_prompt）真的拼了它
              → 判据：塞进去，然后在**真实 prompt** 里找得到
    STRANDED  只接在老生成器/已摘除的模块上，**当前不生效**
              → 判据：在真实 prompt 里找不到，且这里写清为什么

两个方向都验。只验 LIVE 的话，"某块被接上了但没人知道"照样绿；只验 STRANDED
的话，"某块被悄悄摘掉"照样绿。

⚠ **STRANDED 不是"就该这样"，是"目前如此，且我知道"。** 接上它是产品判断
（会改变每一轮的生成结果），不是重构能顺手带的事——所以这里只钉事实，
不替产品做决定。要接上就把它挪到 LIVE，判据会逼你当场验证。
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from services import turn_context as tc  # noqa: E402
from services.spec_tree import build_spec_prompt  # noqa: E402
from services.v5_llm_generate import (  # noqa: E402
    set_active_connectors,
    set_clarifications,
    set_installed_skills,
)

GOAL = "连锁烘焙门店的订货与损耗管控台"

#: 每块怎么塞进去、塞完该在 prompt 里看到什么特征串。
_MARK = "zz9probe"


def _live_prompt() -> str:
    return "\n".join(str(m.get("content") or "") for m in build_spec_prompt(GOAL))


def _set_charter():
    from services.product_charter import set_charter_context

    set_charter_context({"industry": f"{_MARK}行业"}, opt_in=True)


def _set_connector():
    tc.set_active_connectors_cleaned([
        {"id": "zz", "name": "探针", "source": "t", "entity": {
            "id": _MARK, "name": "探针表", "fields": [{"id": "a", "name": "a", "type": "string"}]}}
    ])


def _set_clarification():
    set_clarifications([{"q": "审批由谁做", "a": f"{_MARK}主管"}])


def _set_skill(channel):
    def _f():
        set_installed_skills([{"name": f"{_MARK}技能", "description": "d", "channel": channel}])
    return _f


# 块名 → (怎么塞, 现在接在哪条链上, 为什么)
LIVE = "live"
STRANDED = "stranded"

BLOCKS = {
    "产品宪章": (_set_charter, LIVE, "spec_tree.build_spec_prompt 直接拼"),
    "连接器实体": (_set_connector, LIVE, "同上；另有第 6 步确定性补录（§24）"),
    "开工前澄清": (_set_clarification, LIVE, "2026-08-29 接上，此前只在老生成器上"),
    "已安装技能.aigc": (
        _set_skill("aigc"), STRANDED,
        "只被 v5_llm_generate._build_user_content 读，而那是 spec-first 失败时的"
        "回落生成器（v5_capability_executor: `if model is None and not _block_gen5`）。"
        "接上它等于给每一轮加一条「必须产出对应能力卡」的硬要求，会改变生成结果——"
        "是产品判断，留给用户拍板。",
    ),
    "已安装技能.unbound": (
        _set_skill("unbound"), STRANDED,
        "同上，只被 v5_llm_generate._build_user_content 读。它是软参考版"
        "（明写「不要为它硬造能力卡」），接上的影响比 aigc 那条小，"
        "但一样会改变每一轮的 prompt，同样是产品判断。",
    ),
    "已安装技能.experience": (
        _set_skill("experience"), STRANDED,
        "identity_theme_gen.experience_skill_guidance_block 已在 2026-08-03 "
        "整段从 v5_capability_executor 摘掉（用户裁决：全站一个颜色）。"
        "spec-first 第 2 步仍不读它。活路径改接到风格段 "
        "design_language.experience_skill_constraint（排版/参照，不当种子色）。",
    ),
}


@pytest.fixture(autouse=True)
def _clean():
    from services.product_charter import clear_charter_for_run

    def _reset():
        set_installed_skills(None)
        set_active_connectors(None)
        set_clarifications(None)
        tc.set_active_connectors_cleaned(None)
        clear_charter_for_run()

    _reset()
    yield
    _reset()


class Test表和现实必须一致:
    @pytest.mark.parametrize("name", [n for n, v in BLOCKS.items() if v[1] == LIVE])
    def test_LIVE的块真的进了产品路prompt(self, name):
        setter, _, why = BLOCKS[name]
        setter()
        assert _MARK in _live_prompt(), (
            f"「{name}」标成 LIVE（{why}），但 spec-first 第 2 步的 prompt 里找不到它——"
            f"要么它被摘了，要么这张表写错了"
        )

    @pytest.mark.parametrize("name", [n for n, v in BLOCKS.items() if v[1] == STRANDED])
    def test_STRANDED的块确实还没接上(self, name):
        """⚠ 反向。有人把它接上了是**好事**，但必须同时把这张表改掉——
        否则下一个人读到的仍是"这块不生效"，而实际已经在改变每一轮的生成了。"""
        setter, _, why = BLOCKS[name]
        setter()
        assert _MARK not in _live_prompt(), (
            f"「{name}」已经进了产品路 prompt，但这张表还写着 STRANDED。"
            f"把它挪到 LIVE（原记录：{why}）"
        )

    def test_每条STRANDED都写清了为什么(self):
        for name, (_s, state, why) in BLOCKS.items():
            if state != STRANDED:
                continue
            # ⚠ 40 不是凑数门槛：要说清「谁读它」和「为什么不接」两件事，
            #   一句话写不下。⚠ 但也别为了过这条去加水——本仓在 component 的
            #   why 上踩过一次，当时的处理是把门槛降下来 + 加一条「理由必须互不相同」，
            #   不是把文案注水。这里同理：下面那条 in-check 才是真判据。
            assert len(why) >= 40, f"「{name}」没写清为什么不生效——不写理由就是默认忘了"
            assert "_build_user_content" in why or "摘掉" in why or "同上" in why, (
                f"「{name}」的理由没说清它接在哪儿"
            )

    def test_没塞任何东西时prompt里没有探针串(self):
        """⚠ 判据自己的自检：探针串必须来自被塞进去的那一块，
        不能是碰巧出现在 prompt 里的字面量——否则上面每条 LIVE 都是空过。"""
        assert _MARK not in _live_prompt()


class Test有人在活路径上把它们塞进去:
    """⚠ 上面那张表验的是「塞进去之后到得了 prompt」。**塞进去这一半没验。**
    没人调 setter 的话，每块永远是空串，上面每条 LIVE 判据都会空过——
    第三条：正向配反向，两半都得有。"""

    def test_信封helper三块都设了也都清了(self):
        import inspect

        from services import drive_full_factory as f

        src = inspect.getsource(f)
        src = "\n".join(l for l in src.splitlines() if not l.lstrip().startswith("#"))
        import re

        for setter in ("set_installed_skills", "set_active_connectors", "set_clarifications"):
            calls = re.findall(rf"{setter}\(([^)]*)\)", src)
            # ⚠ 只查 `setter(` 在不在**不够**：把设值那行删掉、只留 finally 里的
            #   `setter(None)`，判据照样绿——变异实测漏过一次。要分别咬住
            #   「设了非 None」和「清了 None」两件事。
            assert any(a.strip() and a.strip() != "None" for a in calls), (
                f"流式信封没有真正设过 {setter}（只剩清空那次）——那一块在产品路上永远是空的"
            )
            assert any(a.strip() == "None" for a in calls), (
                f"流式信封没清 {setter}——会串到下一轮"
            )
        assert "activate_charter_for_run" in src and "clear_charter_for_run" in src

    def test_澄清取自持久化状态_不取自HTTP载荷(self):
        """⚠ 同一件事两处来源必然对不上（第四条）。答案是控制面写在
        coverageGaps 上的，客户端再传一遍就是第二个真相源。"""
        import inspect

        from services import drive_full_factory as f

        src = inspect.getsource(f)
        assert "set_clarifications(clarifications_from_state(state))" in src, (
            "澄清不是从持久化状态取的——改成从载荷取会引入第二个真相源"
        )

    def test_只认答过的澄清(self):
        """⚠ 光把缺口置 resolved 不留答案 = 闸绿了模型什么也没多知道。"""
        from services.v5_llm_generate import clarifications_from_state

        class _S:
            coverageGaps = [
                {"kind": "open_question", "status": "resolved", "label": "问A", "answer": "答A"},
                {"kind": "open_question", "status": "resolved", "label": "问B", "answer": ""},
                {"kind": "open_question", "status": "open", "label": "问C", "answer": "答C"},
                {"kind": "missing_artifact", "status": "resolved", "label": "问D", "answer": "答D"},
            ]

        assert clarifications_from_state(_S()) == [{"q": "问A", "a": "答A"}]


class Test老生成器不是产品路:
    """⚠ 这一组钉的是上面那张表的**前提**。前提塌了，整张表的判定就反了。"""

    def test_老生成器只在spec_first失败时才跑(self):
        import inspect
        import re

        from services import v5_capability_executor as ex

        src = inspect.getsource(ex)
        src = "\n".join(l for l in src.splitlines() if not l.lstrip().startswith("#"))
        assert re.search(r"if model is None and not _block_gen5:", src), (
            "老生成器的回落条件变了——这张表把 _build_user_content 当「不通电」的前提"
            "得重新验一遍"
        )

    def test_spec_first七步没有一处读技能(self):
        """⚠ 反向判据。哪天有人在别的步骤里接上了技能，
        上面 STRANDED 那几条会红，但红在"哪儿接的"上说不清——这条直接点名。

        2026-08-31：experience 接到风格段（design_language.experience_skill_constraint），
        排版/参照不当种子色。那是第 2.5 步，不是第 2 步 spec_tree——BLOCKS 表里
        experience 仍标 STRANDED（LIVE 的定义是 build_spec_prompt）。
        aigc / unbound 仍不得进这几步。
        """
        import pathlib
        import re

        root = pathlib.Path(__file__).resolve().parents[1] / "services"
        steps = [
            "spec_tree.py", "spec_page_html.py", "page_shell.py", "html_structure.py",
            "spec_semantics.py", "model_assembly.py", "design_language.py",
            "spec_first_pipeline.py",
        ]
        hit = []
        for name in steps:
            code = re.sub(r'"""[\s\S]*?"""', "", (root / name).read_text(encoding="utf-8"))
            code = "\n".join(l for l in code.splitlines() if not l.lstrip().startswith("#"))
            if "installed_skills" in code:
                hit.append(name)
        # 正向：风格段确实读了。把调用删掉、只留允许名单，本条必须红。
        assert "design_language.py" in hit, (
            "风格段不再读 installed_skills——experience 活路径断了，"
            "要么接回去要么把这条允许名单拿掉"
        )
        dl = re.sub(
            r'"""[\s\S]*?"""', "", (root / "design_language.py").read_text(encoding="utf-8")
        )
        dl = "\n".join(l for l in dl.splitlines() if not l.lstrip().startswith("#"))
        assert 'installed_skills_for_channel("experience")' in dl
        assert 'installed_skills_for_channel("aigc")' not in dl
        assert 'installed_skills_for_channel("unbound")' not in dl
        leak = [n for n in hit if n != "design_language.py"]
        assert not leak, (
            f"这几步读了已安装技能，把 BLOCKS 表里对应项挪到 LIVE：{leak}"
        )
