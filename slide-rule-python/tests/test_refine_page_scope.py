# -*- coding: utf-8 -*-
"""精修只重画指令点到的页面，其余原样照搬（2026-08-17）。

## 病灶

用户说「护理员端那一页的列表是空的，加点模拟数据」，第 3 步把全部 5 页重画。
慢（单轮 106~172s，其中 4 页跟指令无关），而且**容易坏**——真机撞到过 p1
因为引了 `images.unsplash.com` 没过校验被整页丢掉，而 p1 根本不是要改的那页。

## 做法取自 Aider 的 ContextCoder

关键不是"求模型自觉"，是**不在作用域里的东西结构上碰不到**（Aider 里没 add
到 chat 的文件模型根本改不了，那是能力边界不是约束）。前四次修复全在求自觉，
实测逐段指纹 0/6。

## 这组判据最要紧的一条

**判不出来时必须退回「全量重画」，不能退成「什么都不改」。** 后者会让用户
说了话而应用一动不动——比多画几页糟得多。纪律七的分类题：判作用域属增强，
fail-open 的方向是回到旧行为，不是回到"不做事"。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.refine_page_scope import (  # noqa: E402
    build_scope_prompt,
    decide_pages_to_regenerate,
    parse_scope,
    split_pages_for_refine,
)

PAGES = [
    {"id": "p1", "name": "运营工作台", "purpose": "看总体情况"},
    {"id": "p2", "name": "护理员端小程序", "purpose": "护理员接单"},
    {"id": "p3", "name": "财务结算大屏", "purpose": "对账"},
]
PREV = {"p1": "<html>1</html>", "p2": "<html>2</html>", "p3": "<html>3</html>"}


class Test判作用域:
    def test_只收清单里的页面id(self):
        assert parse_scope({"pages": ["p2"]}, PAGES) == ["p2"]

    def test_清单外的id直接丢掉(self):
        """反向判据：不做模糊匹配。

        对错人的话会把"改 A 页"变成"重画 B 页"，而这类错在日志里长得跟
        正常一模一样。
        """
        assert parse_scope({"pages": ["p2", "p9", "护理员端"]}, PAGES) == ["p2"]

    def test_形状不对回None(self):
        for bad in (None, [], "p2", {"pages": "p2"}, {}):
            assert parse_scope(bad, PAGES) is None

    def test_提示词不许它产内容(self):
        """对应 Aider ContextPrompts 的 `NEVER RETURN CODE!`。"""
        user = build_scope_prompt("给护理员端加点模拟数据", PAGES)[-1]["content"]
        assert "不要输出任何 HTML" in user
        assert "护理员端小程序" in user and "p2" in user

    def test_提示词说清没列进来的会被保留(self):
        """模型得知道漏列的代价，否则它会倾向于多列（多列 = 多重画）。"""
        user = build_scope_prompt("改点东西", PAGES)[-1]["content"]
        assert "原样保留上一版" in user


class Test判不出来必须退回全量:
    """★ 这组是本文件的核心。fail 的方向错了比不做这个功能还糟。"""

    def test_LLM抛异常时回None(self, capsys):
        def boom(messages):
            raise RuntimeError("网关炸了")

        assert decide_pages_to_regenerate("改点东西", PAGES, llm_json_fn=boom) is None
        assert "退回全量重画" in capsys.readouterr().out

    def test_答非所问时回None(self):
        assert decide_pages_to_regenerate(
            "改点东西", PAGES, llm_json_fn=lambda m: {"随便": "什么"}
        ) is None

    def test_报空清单按判错处理_回None(self, capsys):
        """空清单 ≠ 全部照搬。

        对一条精修指令来说"一页都不用改"多半是判错；当成"全照搬"会让用户的
        要求静默失效。
        """
        assert decide_pages_to_regenerate(
            "给护理员端加点模拟数据", PAGES, llm_json_fn=lambda m: {"pages": []}
        ) is None
        assert "退回全量重画" in capsys.readouterr().out

    def test_全是清单外的id也回None(self):
        assert decide_pages_to_regenerate(
            "改点东西", PAGES, llm_json_fn=lambda m: {"pages": ["p9"]}
        ) is None

    def test_没有指令或没有页面时回None(self):
        assert decide_pages_to_regenerate("", PAGES, llm_json_fn=lambda m: {"pages": ["p1"]}) is None
        assert decide_pages_to_regenerate("改", [], llm_json_fn=lambda m: {"pages": ["p1"]}) is None

    def test_判出来了就如实返回(self):
        assert decide_pages_to_regenerate(
            "给护理员端加点模拟数据", PAGES, llm_json_fn=lambda m: {"pages": ["p2"]}
        ) == ["p2"]


class Test算照搬清单:
    def test_点到的重画_其余照搬(self):
        got = split_pages_for_refine(PAGES, PREV, ["p2"])
        assert set(got) == {"p1", "p3"}
        assert got["p1"] == PREV["p1"]

    def test_判不出来时一页都不照搬(self):
        """反向判据：scope 是 None 就是"退回全量重画"，不是"全部照搬"。"""
        assert split_pages_for_refine(PAGES, PREV, None) == {}

    def test_SPEC不再声明的页面不许被搬回来(self):
        """容易漏的第三个条件。

        只按"不在作用域 + 上一版有"来搬，会把 SPEC 已经拿掉的页面又搬回来，
        表现是「用户让删的页面删不掉」，而且没有任何一处会报错。
        """
        shrunk = [p for p in PAGES if p["id"] != "p3"]
        got = split_pages_for_refine(shrunk, PREV, ["p2"])
        assert "p3" not in got, "SPEC 已经删掉的页面被照搬回来了"
        assert set(got) == {"p1"}

    def test_上一版没有的页面不照搬(self):
        got = split_pages_for_refine(PAGES, {"p1": "<html>1</html>"}, ["p2"])
        assert set(got) == {"p1"}

    def test_空HTML不算数(self):
        got = split_pages_for_refine(PAGES, {"p1": "   ", "p3": "<html>3</html>"}, ["p2"])
        assert set(got) == {"p3"}


class Test照搬的页不进LLM:
    """接线判据：照搬必须真的省掉 LLM 调用，不是"生成完再丢掉"。"""

    SPEC = {"pages": PAGES}

    def _run(self, monkeypatch, reuse_pages):
        from services import spec_page_html as sph

        called = []

        def fake_gen(pg, spec, **kw):
            called.append(str(pg.get("id")))
            return {"html": f"<html>新画的 {pg.get('id')}</html>"}

        monkeypatch.setattr(sph, "generate_page_html", fake_gen)
        seen = []
        out = sph.generate_pages_parallel(
            self.SPEC, on_page=lambda pid, html, d, t: seen.append((pid, d, t)),
            reuse_pages=reuse_pages,
        )
        return out, called, seen

    def test_照搬的页一次都没调生成(self, monkeypatch):
        out, called, _ = self._run(monkeypatch, {"p1": PREV["p1"], "p3": PREV["p3"]})
        assert called == ["p2"], f"照搬的页还是被生成了：{called}"
        assert out["pages"]["p1"] == PREV["p1"], "照搬的页内容变了"
        assert out["pages"]["p2"] == "<html>新画的 p2</html>"
        assert set(out["pages"]) == {"p1", "p2", "p3"}, "交付页数少了——第4步会报缺页"

    def test_照搬的页也推给前端_且分母含它们(self, monkeypatch):
        """反向判据：不推的话用户盯着空位，以为这些页丢了。"""
        _, _, seen = self._run(monkeypatch, {"p1": PREV["p1"], "p3": PREV["p3"]})
        assert {pid for pid, _, _ in seen} == {"p1", "p2", "p3"}
        assert {t for _, _, t in seen} == {3}, "进度分母没含照搬的页，前端会显示 1/1"

    def test_不传照搬清单时行为不变(self, monkeypatch):
        out, called, _ = self._run(monkeypatch, None)
        assert sorted(called) == ["p1", "p2", "p3"]
        assert len(out["pages"]) == 3


class Test端到端接线:
    """★ 纪律一：判据必须跑**真正在跑的那条链**。

    这一串横跨四层：驱动器读 state.specFirstPages → refine 上下文 →
    executor → run_spec_first → generate_pages_parallel。**断哪一节都必红**，
    否则会重演"代码是对的、装在不通电的插座上"。
    """

    SPEC = {
        "rootNodeId": "n0", "version": 3, "appName": "维保云",
        "personas": [{"id": "u1", "name": "维修主管", "goals": ["派工"]}],
        "successCriteria": [{"id": "sc1", "text": "24 小时内派工"}],
        "nodes": [],
        "pages": [{"id": "p1", "name": "工单页"}, {"id": "p2", "name": "报表页"}],
    }

    def test_驱动器把上一版页面放进refine上下文(self, monkeypatch):
        """最上游一节：只有这里拿得到 state。"""
        from models.v5_state import V5SessionState
        from services import v5_full_driver as drv
        from services.v5_llm_generate import get_refine_context, set_refine_context

        state = V5SessionState(sessionId="s1", goal={"text": "做个工单系统"})
        state.modelVersions = [{"model": {"datamodel": {"entities": []}}}]
        state.specFirstPages = {"pages": {"p1": "<html>旧的</html>"}}
        monkeypatch.setattr(drv, "derive_publish_closure_response", lambda s: None)

        set_refine_context(None)
        try:
            assert drv.enter_refine_mode(state, "把报表页改一下") is True
            ctx = get_refine_context()
            assert (ctx or {}).get("pages") == {"p1": "<html>旧的</html>"}, (
                "驱动器没把上一版页面带进上下文——按需重画在生产路径上等于没有"
            )
        finally:
            set_refine_context(None)

    def test_执行器把上一版页面交给spec_first(self, monkeypatch):
        from services import v5_capability_executor as ex
        from services.v5_llm_generate import set_refine_context

        captured: dict = {}

        def fake_run(goal, **kw):
            captured.update(kw)
            raise RuntimeError("捕获即止")

        monkeypatch.setattr("services.spec_first_pipeline.run_spec_first", fake_run)
        monkeypatch.setattr(
            "services.v5_llm_generate.generate_five_system_model", lambda *a, **k: None
        )
        monkeypatch.setenv("SLIDERULE_SPEC_FIRST", "1")

        set_refine_context(
            {"datamodel": {"entities": []}}, "把报表页改一下",
            pages={"p1": "<html>旧的</html>"},
        )
        try:
            ex._try_llm_generate_evidence("原始话题", None)
        finally:
            set_refine_context(None)

        assert captured.get("reuse_pages") == {"p1": "<html>旧的</html>"}, (
            "执行器没把页面传给 spec-first"
        )

    def _drive(self, monkeypatch, *, refine, reuse_pages, scope):
        import services.html_bindings as hb
        import services.html_structure as hs
        import services.model_assembly as ma
        import services.page_shell as ps
        import services.refine_page_scope as rps
        import services.spec_page_html as sph
        import services.spec_semantics as ss
        import services.spec_tree as spec_tree
        from services import spec_first_pipeline as sfp

        seen = {}

        monkeypatch.setattr(spec_tree, "generate_spec_tree", lambda g, **kw: dict(self.SPEC))
        monkeypatch.setattr(rps, "decide_pages_to_regenerate", lambda i, p, **kw: scope)

        def fake_pages(spec, **kw):
            seen["reuse_pages"] = kw.get("reuse_pages")
            return {"pages": {"p1": "<html>x</html>", "p2": "<html>y</html>"}, "failed": {}}

        monkeypatch.setattr(sph, "generate_pages_parallel", fake_pages)
        monkeypatch.setattr(ps, "unify_shell", lambda p, s, **kw: {"pages": dict(p)})
        monkeypatch.setattr(ps, "check_shell_consistency", lambda *a, **kw: [])
        monkeypatch.setattr(ps, "repair_pages_after_bind", lambda p, b, **kw: (dict(p), [], []))
        monkeypatch.setattr(hs, "derive_structure", lambda p, **kw: {"entities": [], "pages": []})
        monkeypatch.setattr(ss, "derive_semantics", lambda st, sp, **kw: {"roles": []})
        monkeypatch.setattr(
            ma, "assemble", lambda *a, **k: {"model": {"datamodel": {}}, "gate": {"passed": True}}
        )
        monkeypatch.setattr(hb, "bind_pages", lambda p, m, **kw: {"pages": dict(p), "failed": {}})

        sfp.run_spec_first(
            "做个工单系统",
            refine=({"instruction": "把报表页改一下", "modelDigest": "d"} if refine else None),
            reuse_pages=reuse_pages,
        )
        return seen

    def test_作用域落到第3步(self, monkeypatch):
        prev = {"p1": "<html>旧1</html>", "p2": "<html>旧2</html>"}
        seen = self._drive(monkeypatch, refine=True, reuse_pages=prev, scope=["p2"])
        assert seen["reuse_pages"] == {"p1": "<html>旧1</html>"}, (
            "作用域没落到第 3 步——照样全量重画"
        )

    def test_非精修轮一页都不照搬(self, monkeypatch):
        """反向判据：新建应用没有上一版，照搬会把上一轮残留带进来。"""
        prev = {"p1": "<html>旧1</html>"}
        seen = self._drive(monkeypatch, refine=False, reuse_pages=prev, scope=["p2"])
        assert not seen["reuse_pages"]

    def test_判不出作用域时一页都不照搬(self, monkeypatch):
        """★ fail-open 的方向：退回全量重画，不是退回"什么都不改"。"""
        prev = {"p1": "<html>旧1</html>", "p2": "<html>旧2</html>"}
        seen = self._drive(monkeypatch, refine=True, reuse_pages=prev, scope=None)
        assert not seen["reuse_pages"]


class Test两个调用点都要带页面:
    """★ 纪律四的现场：`set_refine_context` 有**两个**调用点。

    2026-08-17 真机第一次跑就翻在这儿：只改了 enter_refine_mode 那个，
    wants_refine 分支那个照旧只传 model。两处谁后跑谁覆盖，漏传的那次把
    pages 抹成 None——于是**模型到了、页面没到**，表现是"按需重画完全不生效"，
    而日志里什么都不缺（`精修 id 冻结` 照常打，因为它只依赖 model）。

    源码判据，剥注释后数：注释里就写着这些函数名，不剥必然假绿。
    """

    @staticmethod
    def _setter_windows():
        """取每个"设置"型调用点后面的一小段原文。

        ⚠ 别用 `set_refine_context\\((.*?)\\)` 这种非贪婪正则取实参：实参里
          嵌着 `refine_pages_of(state)`，第一个 `)` 就把它截断了，判据会对着
          半截字符串报错——2026-08-17 写这条判据时当场踩到。按窗口取更稳。
        """
        import inspect
        import re

        from services import v5_full_driver as drv

        src = re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", inspect.getsource(drv)))
        out = []
        for m in re.finditer(r"set_refine_context\(", src):
            win = src[m.end():m.end() + 160]
            if win.lstrip().startswith("None"):
                continue  # 清空用的调用，不是设置
            out.append(win)
        return out

    def test_每个调用点都传了pages(self):
        wins = self._setter_windows()
        assert len(wins) >= 2, f"调用点少于 2 个，链路变了先确认现状：{len(wins)}"
        for w in wins:
            assert "pages=" in w, (
                f"这个 set_refine_context 没带 pages，按需重画会被它悄悄抹掉：{w[:100]}"
            )

    def test_两处用的是同一个取数函数(self):
        """反向判据：两处各写一遍取数逻辑迟早漂移，必须共用同一个入口。

        ⚠ 不能拿"`specFirstPages` 在本文件只出现一次"当判据——版本快照那边
          （record_model_snapshot）也读它，是另一回事。判据要盯**精修这条路**。
        """
        for w in self._setter_windows():
            assert "refine_pages_of(state)" in w, (
                f"没走 refine_pages_of，自己另抄了一遍取数：{w[:100]}"
            )

    def test_取不到页面时回None而不是空壳(self):
        from models.v5_state import V5SessionState
        from services.v5_full_driver import refine_pages_of

        state = V5SessionState(sessionId="s", goal={"text": "x"})
        assert refine_pages_of(state) is None
        state.specFirstPages = {"pages": {}}
        assert refine_pages_of(state) is None
        state.specFirstPages = {"pages": {"p1": "<html>1</html>"}}
        assert refine_pages_of(state) == {"p1": "<html>1</html>"}

    def test_当前页空时回落到版本史带页那一版(self):
        """过夜：首轮 GEN5 无页，mv-2 才带页。当前 specFirstPages 空时
        必须能从版本史拿到旧页，否则按需重画永远全量。"""
        from models.v5_state import V5SessionState
        from services.v5_full_driver import refine_pages_of

        state = V5SessionState(sessionId="s", goal={"text": "x"})
        state.specFirstPages = None
        state.modelVersions = [
            {"id": "mv-1", "specFirstPages": None},
            {"id": "mv-2", "specFirstPages": {"pages": {"p1": "<html>旧</html>"}}},
        ]
        assert refine_pages_of(state) == {"p1": "<html>旧</html>"}
        state.modelVersions = [{"id": "mv-1", "specFirstPages": None}]
        assert refine_pages_of(state) is None, "版本史也没页还返回了东西"


class Test设计段随精修上下文回流:
    """★ 同上一个类的病灶换了个键：extract_model_from_closure 只拼六段，
    styleBrief/designLanguage 是应用级附加键，**天生不在闭环证据里**。
    executor 读的是 model["styleBrief"]，于是设计语言的沿用从出生起没通电——
    2026-08-18 真机三轮 specfirst.design 全是 mode=llm 重新生成，
    「精修沿用上一版风格段」一次没打，每轮白烧 ~10s 还冒配色漂移的风险。

    修法：附加键随 state.specFirstPages 载体走，两个 set_refine_context
    调用点都用 refine_model_of 合回模型。
    """

    @staticmethod
    def _setter_windows():
        import inspect
        import re

        from services import v5_full_driver as drv

        src = re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", inspect.getsource(drv)))
        out = []
        for m in re.finditer(r"set_refine_context\(", src):
            win = src[m.end():m.end() + 200]
            if win.lstrip().startswith("None"):
                continue
            out.append(win)
        return out

    def test_每个调用点都包了refine_model_of(self):
        """两处只包一处必然静默失效（谁后跑谁覆盖）——跟 pages 那次同款。"""
        wins = self._setter_windows()
        assert len(wins) >= 2, f"调用点少于 2 个，链路变了先确认现状：{len(wins)}"
        for w in wins:
            assert "refine_model_of(state," in w, (
                f"这个 set_refine_context 的 model 没包 refine_model_of，"
                f"设计段沿用会被它悄悄抹掉：{w[:120]}"
            )

    def test_合回上一版的设计段(self):
        from models.v5_state import V5SessionState
        from services.v5_full_driver import refine_model_of

        state = V5SessionState(sessionId="s", goal={"text": "x"})
        state.specFirstPages = {
            "pages": {"p1": "<html>1</html>"},
            "styleBrief": {"tone": "克制"},
            "designLanguage": {"palette": "navy"},
        }
        got = refine_model_of(state, {"datamodel": {}})
        assert got["styleBrief"] == {"tone": "克制"}
        assert got["designLanguage"] == {"palette": "navy"}
        assert got["datamodel"] == {}, "合并不许动六段本体"

    def test_载体缺席时模型原样返回(self):
        """fail-open：老会话/老链路轮次没有载体，不许因此报错或造假键。"""
        from models.v5_state import V5SessionState
        from services.v5_full_driver import refine_model_of

        state = V5SessionState(sessionId="s", goal={"text": "x"})
        model = {"datamodel": {}}
        assert refine_model_of(state, model) == model
        state.specFirstPages = {"pages": {"p1": "x"}}  # 有页面但没有设计段
        assert refine_model_of(state, model) == model
        assert refine_model_of(state, None) is None

    def test_模型自带的键不被覆盖(self):
        """反向判据：直调场景模型里真带着 styleBrief 时以模型为准。"""
        from models.v5_state import V5SessionState
        from services.v5_full_driver import refine_model_of

        state = V5SessionState(sessionId="s", goal={"text": "x"})
        state.specFirstPages = {"styleBrief": {"tone": "载体"}}
        got = refine_model_of(state, {"styleBrief": {"tone": "模型"}})
        assert got["styleBrief"] == {"tone": "模型"}

    def test_载体真的捎带了设计段(self, monkeypatch):
        """★ 接线判据：run_spec_first 跑成后，take_last_pages 的载荷里必须有
        designLanguage（本 harness 下 LLM 不可用，风格段回落确定性设计语言，
        所以断的是 designLanguage 非空、styleBrief 键存在）。
        把 _last_pages_var.set 里那两行删掉，这条当场红。
        """
        import services.html_bindings as hb
        import services.html_structure as hs
        import services.model_assembly as ma
        import services.page_shell as ps
        import services.spec_page_html as sph
        import services.spec_semantics as ss
        import services.spec_tree as spec_tree
        from services import spec_first_pipeline as sfp

        spec = {
            "rootNodeId": "n0", "version": 3, "appName": "维保云",
            "personas": [{"id": "u1", "name": "主管", "goals": ["派工"]}],
            "successCriteria": [{"id": "sc1", "text": "24 小时派工"}],
            "nodes": [], "pages": [{"id": "p1", "name": "工单页"}],
        }
        monkeypatch.setattr(spec_tree, "generate_spec_tree", lambda g, **kw: dict(spec))
        monkeypatch.setattr(
            sph, "generate_pages_parallel",
            lambda s, **kw: {"pages": {"p1": "<html>x</html>"}, "failed": {}},
        )
        monkeypatch.setattr(ps, "unify_shell", lambda p, s, **kw: {"pages": dict(p)})
        monkeypatch.setattr(ps, "check_shell_consistency", lambda *a, **kw: [])
        monkeypatch.setattr(ps, "repair_pages_after_bind", lambda p, b, **kw: (dict(p), [], []))
        monkeypatch.setattr(hs, "derive_structure", lambda p, **kw: {"entities": [], "pages": []})
        monkeypatch.setattr(ss, "derive_semantics", lambda st, sp, **kw: {"roles": []})
        monkeypatch.setattr(
            ma, "assemble", lambda *a, **k: {"model": {"datamodel": {}}, "gate": {"passed": True}}
        )
        monkeypatch.setattr(hb, "bind_pages", lambda p, m, **kw: {"pages": dict(p), "failed": {}})

        sfp.run_spec_first("做个工单系统")
        got = sfp.take_last_pages()
        assert got is not None
        assert "styleBrief" in got and "designLanguage" in got, (
            "载体没捎带设计段——refine_model_of 永远合不回任何东西"
        )
        assert isinstance(got["designLanguage"], dict) and got["designLanguage"], (
            "回落确定性设计语言的轮次，designLanguage 该是非空 dict"
        )
