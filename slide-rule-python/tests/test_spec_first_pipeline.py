# -*- coding: utf-8 -*-
"""spec-first 七步接主轴。

这组测试钉的不是"链路跑得通"（那要真 LLM，另有跑批脚本），而是**接线本身
不许出错的那几条**：开关口径、失败不静默、探针看得见、以及不引编排依赖。
"""

import ast
import inspect

import pytest

from services import spec_first_pipeline as sfp


class Test默认开且关得掉:
    """2026-08-14 由默认关翻成默认开（用户拍板）。

    ⚠ 翻默认的证据只有 n=3 的一轮 A/B，够不上目录窄化那次 p=0.00004 的量级。
    所以这组测试的重点从"证明它默认关着"变成了**"证明它关得掉"**——默认开
    之后，用户唯一的退路就是这个开关，它必须真的好使。
    """

    def test_没设过就是开(self, monkeypatch):
        monkeypatch.delenv("SLIDERULE_SPEC_FIRST", raising=False)
        assert sfp.spec_first_enabled() is True

    @pytest.mark.parametrize("off", ["0", "false", "FALSE", "no", "off", " off "])
    def test_显式关就关得掉(self, monkeypatch, off):
        """这条是默认开之后唯一的退路，比上面那条更要紧。

        大小写与前后空格都要认：`.env` 里写 `SLIDERULE_SPEC_FIRST=OFF ` 却没
        关掉，用户看到的是"我明明关了它还在跑"，而且没有一处会报错。
        """
        monkeypatch.setenv("SLIDERULE_SPEC_FIRST", off)
        assert sfp.spec_first_enabled() is False

    @pytest.mark.parametrize("on", ["", "1", "true", "yes", "on", "随便写"])
    def test_写别的一律当开(self, monkeypatch, on):
        """空串按"没设过"算——`.env` 里留一行 `SLIDERULE_SPEC_FIRST=` 是常见写法。

        写不认识的值也当开：这是默认开该有的样子（拼错一个词不该让功能
        悄悄消失）。要关就得写清楚。
        """
        monkeypatch.setenv("SLIDERULE_SPEC_FIRST", on)
        assert sfp.spec_first_enabled() is True

    def test_开关词表跟仓里其它开关一个字不差(self):
        """口径分叉的代价是"我在 A 处关得掉、B 处关不掉"。

        仓里默认开的开关都用同一份 off 词表（enrich_timing / block_narrowing /
        intake_judge / v5_parallel_generate / mailer / v5_full_driver 两处）。
        """
        assert sfp._OFF_VALUES == frozenset({"0", "false", "no", "off"})


class Test探针能看出静默失效:
    """rank-bm25 那次的教训：依赖漏了、代码 fail-open，功能一声不吭整个失效，
    而 health、日志、返回值**没有任何一处看得出来**。"""

    def test_七个模块都在时报_effective(self, monkeypatch):
        monkeypatch.setenv("SLIDERULE_SPEC_FIRST", "1")
        r = sfp.spec_first_readiness()
        assert r["modules"] == len(sfp._STEP_MODULES)
        assert r["missing"] == []
        assert r["effective"] is True

    def test_开关关着就不算_effective(self, monkeypatch):
        # ⚠ 默认开之后要**显式关**才测得到这一支（delenv 现在等于开）。
        #   这条一度是 delenv，翻默认那天它会静悄悄地变成"测默认开"——
        #   用例照常绿，而"关掉之后探针怎么说"从此没人管。
        monkeypatch.setenv("SLIDERULE_SPEC_FIRST", "0")
        r = sfp.spec_first_readiness()
        assert r["enabled"] is False and r["effective"] is False
        # ⚠ 但模块数照报——「没开」和「开了但缺模块」必须分得出来
        assert r["modules"] == len(sfp._STEP_MODULES)

    def test_默认状态下探针就说自己是开的(self, monkeypatch):
        """默认开了，探针也得跟着说开——两处口径分叉的话，
        /ready 会在功能正跑的时候报"没启用"。"""
        monkeypatch.delenv("SLIDERULE_SPEC_FIRST", raising=False)
        r = sfp.spec_first_readiness()
        assert r["enabled"] is True and r["effective"] is True

    def test_模块清单只有一份_不手抄(self):
        """探针与 import 共用 _STEP_MODULES。手抄两份必然漂移——
        本仓在「区块 uses 声明」「前端手抄区域词汇」上踩过两次。"""
        src = inspect.getsource(sfp.spec_first_readiness)
        assert "_STEP_MODULES" in src

    def test_探针不许因为被探的东西坏了而炸(self):
        src = inspect.getsource(sfp.spec_first_readiness)
        assert "except" in src


class Test接主轴那一处:
    def test_主轴先试新链路再回落老路(self):
        from services import v5_capability_executor as ex

        src = inspect.getsource(ex._try_llm_generate_evidence)
        assert "spec_first_enabled" in src
        assert "run_spec_first" in src
        # 老路仍在——两条链路并存，⛔1 描述的是老路
        assert "generate_five_system_model(goal, llm_json_fn=llm_json_fn)" in src

    def test_回落必须留痕_不许静默(self):
        """「新链路跑通了」和「新链路挂了但老路兜住了」在外面长得一样，
        正是本仓数到第九次的形状（闸全绿但东西没了）。"""
        from services import v5_capability_executor as ex

        src = inspect.getsource(ex._try_llm_generate_evidence)
        assert "spec-first 失败，不回落老链路" in src
        assert "_block_gen5 = True" in src

    def test_新模块缺失不打死老路(self):
        from services import v5_capability_executor as ex

        src = inspect.getsource(ex._try_llm_generate_evidence)
        # import 失败要被兜住，否则新链路一个语法错就让整个产品不能生成
        assert "except Exception" in src

    def test_探针进了_ready(self):
        import app

        src = inspect.getsource(app)
        assert '"specFirst": _spec_first_readiness()' in src


class Test不引编排依赖:
    """LangGraph / Burr / Prefect / Temporal / Dagster 逐个看过，一个都不引。

    这条链是**线性的**（只有第 3 步一处扇出），而 checkpoint / 进度 / 预算 /
    重试仓里都有更贴合的：run_registry（SSE Last-Event-ID 续播 + 孤儿看门狗）、
    enrich_timing.stage()、remaining_run_budget_seconds()、call_llm_with_retry。
    引进来会多出**第二套编排模型**，checkpoint 跟现有事件日志各记各的。
    跟第 3 步拒绝 tenacity 是同一个判断：多一个依赖换一个更差的集成。

    ⚠ 判据走 AST 查**真实 import**，不做字符串搜索——上面这段注释里就写着
    那几个名字，字符串搜索会把注释判红。这个坑本仓踩过一次（"tenacity"
    not in src 被自己的墓碑注释判红），AST 里没有注释，正好分得开。
    """

    @pytest.mark.parametrize(
        "lib", ["langgraph", "burr", "prefect", "temporalio", "dagster"]
    )
    def test_没有真的导入它们(self, lib):
        tree = ast.parse(inspect.getsource(sfp))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported |= {a.name.split(".")[0] for a in node.names}
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
        assert lib not in imported

    def test_埋点用仓里现成的那套(self):
        src = inspect.getsource(sfp)
        assert "from .enrich_timing import stage" in src


class Test失败不回落占位:
    def test_一页都没出来就抛(self, monkeypatch):
        """第 3 步全挂还继续往下走，等于拿一份空 HTML 去反推结构——
        下游会得到一个"成功"的空模型，而没有一处会发现它是空的。"""
        monkeypatch.setattr(
            "services.spec_tree.generate_spec_tree",
            lambda *a, **k: {"pages": [{"id": "p1"}], "nodes": []},
        )
        monkeypatch.setattr(
            "services.spec_page_html.generate_pages_parallel",
            lambda *a, **k: {"pages": {}, "failed": {"p1": "网关断了"}},
        )
        with pytest.raises(sfp.SpecFirstError) as exc:
            sfp.run_spec_first("随便一个话题")
        assert "第 3 步" in str(exc.value)

    def test_异常类型自己说清纪律(self):
        assert "不回落老链路" in (sfp.SpecFirstError.__doc__ or "")


class Test页面一出来就往外交:
    """`on_page` 从主轴一路透传到第 3 步。

    这条链一轮 8~9 分钟，第 3 步在第二分钟就有能看的东西。中间任何一环把
    回调丢了，前端就只能等到最后——**而且不会有任何一处报错**（页面照常
    产出、模型照常返回、闸照常绿）。所以这里钉的是"传到了"，不是"没炸"。
    """

    def test_透传到第_3_步(self, monkeypatch):
        """2026-08-14 竖屏改：回调不再原样透传，而是包了一层 _with_device
        （每个页面事件注入 device，前端选画布视口用）。所以判据从
        「is 同一个对象」改成「叫它一次，事件真到了原回调手里、且带 device」。"""
        seen: dict = {}
        calls: list = []
        monkeypatch.setattr(
            "services.spec_tree.generate_spec_tree",
            lambda *a, **k: {"pages": [{"id": "p1"}], "nodes": []},
        )
        def _capture(spec, **kw):
            seen["on_page"] = kw.get("on_page")
            # 第 3 步交白卷 → 抛 SpecFirstError，测试到此为止：
            # 这条只管"回调有没有传到"，不需要把整条链跑完
            return {"pages": {}, "failed": {"p1": "到这里就够了"}}

        monkeypatch.setattr("services.spec_page_html.generate_pages_parallel", _capture)

        def sentinel(pid, html, done, total, **kw):
            calls.append((pid, kw.get("device")))

        with pytest.raises(sfp.SpecFirstError):
            sfp.run_spec_first("随便一个话题", on_page=sentinel)
        assert seen["on_page"] is not None, "回调在中间被丢了——前端会一直黑到最后"
        seen["on_page"]("p1", "<html/>", 1, 1)
        assert calls == [("p1", "desktop")], "事件没到原回调手里，或没带 device"

    def test_不传也能跑(self):
        """默认 None——老调用方一个字都不用改。"""
        import inspect as _inspect

        sig = _inspect.signature(sfp.run_spec_first)
        assert sig.parameters["on_page"].default is None
        assert sig.parameters["on_page"].kind is _inspect.Parameter.KEYWORD_ONLY


class Test统一与打孔后重发页面:
    """3.5 / 6.5 之后要把改好的页面**再冲一遍** sink（2026-08-14 晚）。

    病灶：第 3 步直播的是各页各自发明菜单的素颜页（「三个产品名、三套菜单」，
    见 page_shell.py 头注），3.5 修好了、6.5 打完孔——但改好的页面从不回推。
    前端 onSpecPage 早就写好了"同一页第二次到达——覆盖"的逻辑，后端却一次
    都没发过第二次。用户整个推演期（十几分钟）盯着的都是错误画面，
    要等 finalState 才换，**而且没有一处报错**。
    """

    def _wire_full_chain(self, monkeypatch):
        monkeypatch.setattr(
            "services.spec_tree.generate_spec_tree",
            lambda *a, **k: {
                "appName": "网",
                "pages": [{"id": "p1", "name": "甲"}, {"id": "p2", "name": "乙"}],
                "nodes": [],
            },
        )
        monkeypatch.setattr(
            "services.spec_page_html.generate_pages_parallel",
            lambda spec, **kw: {
                "pages": {"p1": "<html>素1</html>", "p2": "<html>素2</html>"},
                "failed": {},
            },
        )
        monkeypatch.setattr(
            "services.page_shell.unify_shell",
            # **kw 收下 device（2026-08-14 竖屏加的实参）
            lambda pages, spec, **kw: {
                "pages": {"p1": "<html>壳1</html>", "p2": "<html>壳2</html>"},
                "navItems": [{"id": "p1", "name": "甲"}, {"id": "p2", "name": "乙"}],
            },
        )
        monkeypatch.setattr(
            "services.page_shell.check_shell_consistency", lambda *a, **k: []
        )
        monkeypatch.setattr(
            "services.html_structure.derive_structure",
            lambda *a, **k: {"entities": [], "pages": []},
        )
        monkeypatch.setattr(
            "services.spec_semantics.derive_semantics", lambda *a, **k: {"roles": []}
        )
        monkeypatch.setattr(
            "services.model_assembly.assemble", lambda *a, **k: {"model": {"ok": 1}}
        )
        monkeypatch.setattr(
            "services.html_bindings.bind_pages",
            lambda pages, model, **kw: {
                "pages": {"p1": "<html>孔1</html>", "p2": "<html>孔2</html>"},
                "failed": {},
            },
        )

    def test_统一后重发_打孔后再重发且带_bound(self, monkeypatch):
        self._wire_full_chain(monkeypatch)
        emitted: list = []

        def sink(pid, html, done, total, bound=False, device="desktop"):
            emitted.append((pid, html, bound))

        sfp.run_spec_first("随便一个话题", on_page=sink)

        # 3.5 统一后的壳版（bound=False）先到，6.5 打孔版（bound=True）后到。
        # 第 3 步素颜页的直播由 generate_pages_parallel 内部调 sink，
        # 这里被 stub 掉了，所以列表里只有两轮重发——正好把重发单独钉住。
        # 统一之后立刻钉语义色，第一轮重发是带 token 的壳，不是 stub 原文。
        assert [e[0] for e in emitted] == ["p1", "p2", "p1", "p2"]
        assert [e[2] for e in emitted] == [False, False, True, True]
        assert "壳1" in emitted[0][1] and "sliderule-theme" in emitted[0][1]
        assert "壳2" in emitted[1][1] and "sliderule-theme" in emitted[1][1]
        assert emitted[2][0] == "p1" and emitted[2][2] is True
        assert "孔1" in emitted[2][1] and "sliderule-theme" in emitted[2][1]
        assert emitted[3][0] == "p2" and emitted[3][2] is True
        assert "孔2" in emitted[3][1] and "sliderule-theme" in emitted[3][1]

    def test_failed_binding_stays_unbound_in_live_notifications(self, monkeypatch):
        self._wire_full_chain(monkeypatch)
        monkeypatch.setattr("services.html_bindings.bind_pages", lambda pages, model, **kw: {
            "pages": {"p1": "<html>bound first page</html>"}, "failed": {"p2": "invalid field"},
        })
        emitted = []
        sfp.run_spec_first("test partial binding", on_page=lambda pid, html, done, total, bound=False, device="desktop": emitted.append((pid, bound)))
        assert emitted[-2:] == [("p1", True), ("p2", False)]

    def test_四参老_sink_不炸整条链(self, monkeypatch):
        """重发多带一个 bound 参数。老 sink 只收四个位置参——TypeError 必须
        被吞掉（UI 推送失败不许赔掉已经烧过 LLM 的页面，纪律同
        generate_pages_parallel 的 on_page）。"""
        self._wire_full_chain(monkeypatch)

        def old_sink(pid, html, done, total):  # 故意少一个参数
            return None

        out = sfp.run_spec_first("随便一个话题", on_page=old_sink)
        # ⚠ 比"模型还在不在"，不比整份相等：run_spec_first 会往 model 上挂
        #   designLanguage（那是它唯一被落库的通道）。比全等的话，链路每加
        #   一个随模型走的产物，这条不相干的用例就红一次。
        assert out["model"]["ok"] == 1, "老 sink 炸了不该带走整轮产物"

    def test_外壳一致性判据接进了生产账本(self, monkeypatch):
        """check_shell_consistency 此前只在测试里跑——生产链路统一完没人验，
        6.5 的 LLM 改写更没人验（提示词说"一个像素不改"，但那只是请求）。
        这里钉的是两处都记了账：shell.problems 与 bind.shellProblems。"""
        self._wire_full_chain(monkeypatch)
        monkeypatch.setattr(
            "services.page_shell.check_shell_consistency",
            lambda *a, **k: [{"path": "p2.nav", "message": "菜单被动了"}],
        )
        out = sfp.run_spec_first("随便一个话题")
        assert out["stages"]["shell"]["problems"] == 1
        assert out["stages"]["bind"]["shellProblems"] == 1


class Test缺页日志不许炸交付:
    """2026-08-20 Foclip 真机：声明几页、第 3 步少交几页，对账那行
    `[spec_first] ⚠ 交付页数对不上 SPEC` 是裸 print。Windows 控制台 GBK
    编不出 ⚠（报错 position 13），UnicodeEncodeError 逃出第 3 步，被当成
    LLM_GENERATE_FAILED——规格和设计都写完了，六段模型整份丢掉，右栏空白、
    证据 0/6。缺页本身只记不拦；日志把自己写成 fail-closed 才是事故。
    """

    def test_Windows控制台打不出警告符_缺页仍交付(self, monkeypatch):
        import sys

        class GbkConsole:
            encoding = "gbk"

            def write(self, s):
                s.encode("gbk")
                return len(s)

            def flush(self):
                return None

        monkeypatch.setattr(sys, "stdout", GbkConsole())
        monkeypatch.setattr(
            "services.spec_tree.generate_spec_tree",
            lambda *a, **k: {
                "appName": "网",
                "pages": [{"id": "p1", "name": "甲"}, {"id": "p2", "name": "乙"}],
                "nodes": [],
            },
        )
        monkeypatch.setattr(
            "services.spec_page_html.generate_pages_parallel",
            lambda spec, **kw: {
                "pages": {"p1": "<html>素1</html>"},
                "failed": {"p2": "超时"},
            },
        )
        monkeypatch.setattr(
            "services.page_shell.unify_shell",
            lambda pages, spec, **kw: {
                "pages": {pid: f"<html>壳{pid}</html>" for pid in pages},
                "navItems": [{"id": pid, "name": pid} for pid in pages],
            },
        )
        monkeypatch.setattr(
            "services.page_shell.check_shell_consistency", lambda *a, **k: []
        )
        monkeypatch.setattr(
            "services.html_structure.derive_structure",
            lambda *a, **k: {"entities": [], "pages": []},
        )
        monkeypatch.setattr(
            "services.spec_semantics.derive_semantics", lambda *a, **k: {"roles": []}
        )
        monkeypatch.setattr(
            "services.model_assembly.assemble", lambda *a, **k: {"model": {"ok": 1}}
        )
        monkeypatch.setattr(
            "services.html_bindings.bind_pages",
            lambda pages, model, **kw: {
                "pages": {pid: f"<html>孔{pid}</html>" for pid in pages},
                "failed": {},
            },
        )
        out = sfp.run_spec_first("随便一个话题")
        assert out["model"]["ok"] == 1, (
            "缺页对账的 ⚠ 打不出就把交付拖死了——跟 Foclip 那轮 0/6 同一形状"
        )
        assert out["stages"]["pages"].get("missingPages") == "p2"


class Test局部打孔只跳过已经打过孔的页:
    def test_照搬但没打孔的页必须重打(self):
        """真机：首轮 bind 被标 refine，reuse 页全 skip，权限没接到页面上。"""
        pages = {
            "p1": "<html><body>素颜页</body></html>",
            "p2": '<div data-rows="employee"><span data-field="name"></span></div>',
        }
        skip = sfp.pages_to_skip_bind(
            pages, refine=True, reuse_ids=["p1", "p2"]
        )
        assert "p1" not in skip
        assert "p2" in skip

    def test_非精修不跳(self):
        pages = {"p1": '<div data-field="x"></div>'}
        assert sfp.pages_to_skip_bind(pages, refine=False, reuse_ids=["p1"]) == set()
