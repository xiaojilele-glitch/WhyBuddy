# -*- coding: utf-8 -*-
"""第 3 步：spec 的每一页 → HTML（直出，不经图）。

这组测试钉三件事：口径真的抄了 screenshot-to-code、失败不许回落占位、
以及「这里不打 data-* 洞」这条分工不许被人顺手改回去。
"""

import pytest

from services import spec_page_html as sph


SPEC = {
    "rootNodeId": "n0",
    "successCriteria": [{"id": "sc1", "text": "报修能闭环"}],
    "nodes": [
        {"id": "n0", "type": "requirement", "title": "提交报修工单",
         "acceptance": "当报修人提交故障信息时，系统应生成唯一工单并展示工单编号。"},
        {"id": "n1", "type": "design", "title": "入口设计",
         "notes": "以设备报修为入口，建立清晰的工单创建流程。"},
        {"id": "n9", "type": "requirement", "title": "别的页才管的事",
         "acceptance": "这条不该出现在本页的 brief 里。"},
    ],
    "pages": [{"id": "p1", "name": "报修登记页", "audience": "报修人",
               "purpose": "提交故障并拿到工单号", "coversNodes": ["n0", "n1"]}],
}
PAGE = SPEC["pages"][0]

_OK_HTML = (
    "<!doctype html><html><head>"
    '<script src="https://cdn.tailwindcss.com"></script>'
    "</head><body><h1>报修登记</h1><table><th>工单编号</th></table></body></html>"
)


class Test页面简报只取本页覆盖到的需求:
    def test_带上页面身份三件套(self):
        brief = sph.build_page_brief(PAGE, SPEC)
        for want in ("报修登记页", "报修人", "提交故障并拿到工单号"):
            assert want in brief

    def test_acceptance_与_notes_原文进简报(self):
        brief = sph.build_page_brief(PAGE, SPEC)
        assert "系统应生成唯一工单并展示工单编号" in brief
        assert "以设备报修为入口" in brief

    def test_不把整棵树倒进去(self):
        """倒整棵树会让每一页长得一样——spec 的页面清单本来就是按职责切好的。"""
        assert "这条不该出现在本页的 brief 里" not in sph.build_page_brief(PAGE, SPEC)

    def test_引用不存在的节点不炸(self):
        page = {**PAGE, "coversNodes": ["n0", "不存在"]}
        assert "系统应生成唯一工单" in sph.build_page_brief(page, SPEC)


class Test口径抄的是_screenshot_to_code:
    """自己另发明一套，是今天让整轮对照失去意义的那个错（runner.py:220）。
    这一步现在在主链路上，更不该用手写版。"""

    def test_四段都在(self):
        p = sph.build_page_html_prompt("页面：报修登记页")
        assert p.startswith("Generate UI for ")           # create/text.py 的开头
        assert "Selected stack: html_tailwind." in p      # build_selected_stack_policy
        assert "## Design system" in p                    # build_design_system_prompt_block
        assert "# Instructions" in p

    def test_instructions_跟设计系统走_不许通用后台皮(self):
        """2026-08-31：modern and sleek / professional fonts 会把每页画成同一套
        中台皮。风格走 <design_system>，UX 那条可以留。

        反向：那两句套话回来本条必须红；新那句删掉也必须红。
        """
        p = sph.build_page_html_prompt("x")
        assert (
            "- Follow the <design_system> visual tone. "
            "Do not invent a generic admin skin."
        ) in p
        assert "- Follow UX best practices." in p
        assert "已确认的产品决定" in p
        assert "HTML comments" in p
        assert "modern and sleek" not in p
        assert "professional fonts" not in p

    def test_image_policy_取_disabled_那一支(self):
        """这个 harness 没有 generate_images 工具，抄 enabled 那支等于让模型
        去调不存在的东西。"""
        p = sph.build_page_html_prompt("x")
        assert "Image generation is disabled for this request." in p
        assert "Do not call generate_images." in p
        assert "Do not invent unsplash or pexels photo IDs" in p
        assert "通用后台" in p
        assert "bg-slate-900" in p
        assert "placehold.co" in p
        assert "exact https addresses" not in p
        assert "面团" in p
        assert "SlideRule" in p

    def test_设计系统带冲突优先级声明(self):
        p = sph.build_page_html_prompt("x")
        assert "prioritize the design system" in p

    def test_占位必须是可读中文这条在里面(self):
        """这条在参照图那边早就有，改两段式时漏掉过一次，实测灰条当场复发。"""
        p = sph.build_page_html_prompt("x")
        assert "不许用灰色横条或色块代替" in p

    def test_桌面契约禁止整页居中卡片(self):
        """满电青年：max-w-6xl mx-auto 白卡片漂在浅绿底上。手机契约有铺满，桌面漏了。"""
        p = sph.build_page_html_prompt("x")
        assert "铺满 1920×1080" in p
        assert "铺满 1920×1920" not in p
        assert "mx-auto" in p
        assert "items-center justify-center" in p
        phone = sph.build_page_html_prompt("x", device="phone")
        assert "铺满 1920×1080" not in phone

    def test_桌面侧栏要给文字留宽度(self):
        """满电青年：工单页写成 w-16，点进去侧栏瘪了。契约得说清楚。"""
        p = sph.build_page_html_prompt("x")
        assert "w-64" in p
        assert "w-16" in p
        assert "items-center" in p
        assert "bg-zinc-950" in p
        phone = sph.build_page_html_prompt("x", device="phone")
        assert "不要写成图标轨 w-16" not in phone

    def test_content_app契约不要侧栏且图是一等公民(self):
        p = sph.build_page_html_prompt("某页", product_archetype="content_app")
        assert "不要左侧边栏" in p or "不要 <aside>" in p
        assert "图是一等公民" in p
        assert "placehold.co" in p
        assert "必须用 w-64" not in p
        assert "<aside> 固定主导航" not in p
        desk = sph.build_page_html_prompt("某页")
        assert "<aside>" in desk
        assert "消费端内容产品" not in desk

    def test_content加phone仍是竖屏底栏再加图优先(self):
        p = sph.build_page_html_prompt(
            "某页", device="phone", product_archetype="content_app"
        )
        assert "390×844" in p
        assert "图是一等公民" in p
        assert "铺满 1920×1080" not in p

    def test_guidelines闸只记不拦(self):
        """对照 Vercel guidelines 的可机械部分。进 validate 就成了 fail-closed。"""
        html = (
            "<!doctype html><html><head>"
            '<script src="https://cdn.tailwindcss.com"></script></head>'
            '<body class="bg-white"><p class="text-gray-200">浅</p>'
            "<table></table></body></html>"
        )
        notes = sph.guidelines_gate_notes(html)
        assert any("对比" in n for n in notes)
        assert any("空态" in n for n in notes)
        assert sph.validate_page_html(html) == []
        content_notes = sph.guidelines_gate_notes(
            html, product_archetype="content_app"
        )
        assert any("<img>" in n for n in content_notes)

    def test_时段矩阵表头与格子同档(self):
        """2026-08-31 会聚通：表头 grid-cols-12、格子 grid-cols-24，
        Play CDN 又不产出 24 列。提示词要钉「同档列数、空位在文档流」。"""
        p = sph.build_page_html_prompt("x")
        assert "grid-cols" in p
        assert "column count" in p or "同档" in p
        assert "now-line" in p or "overlay" in p
        assert "flex-1" in p


class Test机械校验只挡明显不完整的:
    def test_合格的过(self):
        assert sph.validate_page_html(_OK_HTML) == []

    def test_截断能被抓住(self):
        """推理模型思考吃光预算、正文写一半就停，而 finish_reason 不会喊。
        收尾标签是最便宜的判据。"""
        assert any("截断" in p for p in sph.validate_page_html(_OK_HTML[:-40]))

    def test_没引_tailwind_算违约(self):
        bad = _OK_HTML.replace('<script src="https://cdn.tailwindcss.com"></script>', "")
        assert any("Tailwind" in p for p in sph.validate_page_html(bad))

    def test_一个中文都没有算违约(self):
        bad = "<!doctype html><html><head>" \
              '<script src="https://cdn.tailwindcss.com"></script>' \
              "</head><body><h1>Repair</h1></body></html>"
        assert any("中文" in p for p in sph.validate_page_html(bad))

    @pytest.mark.parametrize("lead", ["Here is the HTML:", "好的，这是页面："])
    def test_正文前带解释算违约(self, lead):
        assert sph.validate_page_html(lead + _OK_HTML)

    def test_不判丰富度(self):
        """丰富度只能渲染出来用眼睛看。今天在「造个数替代看一眼」上栽了四次：
        数字段 / 数语义标签 / 拿没加载 Tailwind 的截图当证据。
        机械判据只负责挡住「明显不是一份完整页面」的东西。"""
        import inspect

        src = inspect.getsource(sph.validate_page_html)
        for forbidden in ("区域数", "控件种类", "richness", "score"):
            assert forbidden not in src


class Test失败不回落占位:
    def test_校验一直不过就抛(self):
        class _R:
            content = "<html>没收尾也没 tailwind"

        with pytest.raises(sph.SpecPageHtmlError) as exc:
            sph.generate_page_html(PAGE, SPEC, llm_call=lambda *a, **k: _R(), max_attempts=2)
        assert "p1" in str(exc.value)

    def test_重试一次能救回来就算过(self):
        seen = {"n": 0}

        class _R:
            def __init__(self, c):
                self.content = c

        def _call(*_a, **_k):
            seen["n"] += 1
            return _R("<html>坏的" if seen["n"] == 1 else _OK_HTML)

        out = sph.generate_page_html(PAGE, SPEC, llm_call=_call, max_attempts=2)
        assert out["pageId"] == "p1" and seen["n"] == 2

    def test_围栏被剥掉(self):
        class _R:
            content = "```html\n" + _OK_HTML + "\n```"

        out = sph.generate_page_html(PAGE, SPEC, llm_call=lambda *a, **k: _R())
        assert out["html"].startswith("<!doctype html")

    def test_示例外链剥掉后页面留下(self):
        """★ Foclip：示例域名不能再把整页打进 failedPages。

        把 generate_page_html 里的 neutralize 调用删掉，本条必须红。
        """

        class _R:
            content = _OK_HTML.replace(
                "</body>",
                '<a href="https://tech.example.com/clip">来源条目</a></body>',
            )

        out = sph.generate_page_html(PAGE, SPEC, llm_call=lambda *a, **k: _R())
        assert "tech.example.com" not in out["html"]
        assert "来源条目" in out["html"]

    def test_生成入口真的调用了剥外链(self):
        """判据钉 AST 调用，不钉注释里出现过这个词。"""
        import ast
        import inspect

        tree = ast.parse(inspect.getsource(sph.generate_page_html))
        names = [
            n.func.id
            for n in ast.walk(tree)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
        ]
        assert "neutralize_foreign_urls" in names


class Test这里不打_data_洞:
    """第 3 步在上游，datamodel 还不存在——它要到第 4 步才从这份 HTML 反推。

    在这里写 data-field="resident.name" 是引用一个还没被发明的 id，校验不了；
    而校验不了的绑定就是下一个 DANGLING（旧模板库那些指向组件夹具的绑定，
    丢进真实话题必被结构闸拦下，是同一个形状）。
    """

    @pytest.mark.parametrize("hole", ["data-fact", "data-field", "data-chart", "data-rows"])
    def test_提示词不许要求打洞(self, hole):
        assert hole not in sph.build_page_html_prompt("x")

    def test_校验器不许开始认这些洞(self):
        import inspect

        src = inspect.getsource(sph.validate_page_html)
        assert "data-" not in src, (
            "第 3 步开始认 data-* 了——那是第 6 步的事。"
            "分工写在 spec_page_html 的模块 docstring 里，改之前先读它。"
        )


class Test瞬时错误不该打死整轮:
    """2026-08-13 真机撞到的：六页并发跑，一次 httpx.RemoteProtocolError
    （网关断开）把**整轮**打死，前面 70 秒的 SPEC 白跑。而那是瞬时错误，
    重跑一次就好。

    两个独立的洞，各修各的：
      ① generate_page_html 调的是裸 call_llm，一次网络重试都没有
      ② 调用方用 pool.map —— 任何一个 worker 抛异常，整个迭代就抛
    """

    def test_默认走带重试的调用_不是裸_call_llm(self):
        """判据钉在源码上：这条线断了不会有任何用例变红（网络错误在测试里
        本来就不会发生），只能靠源码断言守。"""
        import inspect

        import services.spec_page_html as mod

        src = inspect.getsource(mod.generate_page_html)
        assert "call_llm_with_retry" in src
        assert "from sliderule_llm.client import call_llm\n" not in src, "又退回裸调用了"

    def test_不引_tenacity_或_backoff(self):
        """仓里现成的 call_llm_with_retry 已经分好了 transient / 非 transient，
        还带 gRPC hedging 治长尾慢请求——tenacity 只覆盖重试不覆盖对冲，比它弱，
        引进来是多一个依赖换一个更差的实现。

        ⚠ 走 AST 查真实 import，**不做字符串搜索**。头一版就是 `"tenacity"
        not in src`，结果被模块里那句「不引 tenacity」的注释判红——
        判据必须钉在**真实语句**上，不是"文件里出现过这个词"。
        这条教训本仓记过（AST 里没有注释，所以墓碑注释能留、真实读取被禁）。
        """
        import ast
        import inspect

        import services.spec_page_html as mod

        tree = ast.parse(inspect.getsource(mod))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported |= {a.name.split(".")[0] for a in node.names}
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
        assert not ({"tenacity", "backoff"} & imported), f"引了 {imported}"

    def test_单页失败不拖垮整批(self):
        from services.spec_page_html import generate_pages_parallel

        spec = {
            "appName": "测试应用",
            "pages": [
                {"id": "p1", "name": "甲页", "purpose": "看甲", "audience": "甲方", "coversNodes": []},
                {"id": "p2", "name": "乙页", "purpose": "看乙", "audience": "乙方", "coversNodes": []},
                {"id": "p3", "name": "丙页", "purpose": "看丙", "audience": "丙方", "coversNodes": []},
            ],
            "nodes": [],
        }
        good = ('<!DOCTYPE html><html lang="zh-CN"><head>'
                '<script src="https://cdn.tailwindcss.com"></script></head>'
                '<body><main>中文正文</main></body></html>')

        class _R:
            def __init__(self, c): self.content = c

        seen: list = []

        def flaky(messages, **kwargs):
            seen.append(1)
            if len(seen) == 2:  # 第二页炸一次，模拟网关断开
                raise RuntimeError("Server disconnected without sending a response")
            return _R(good)

        out = generate_pages_parallel(spec, max_workers=1, llm_call=flaky)
        assert len(out["pages"]) == 2, "另外两页应该照样产出"
        assert len(out["failed"]) == 1
        assert "disconnected" in list(out["failed"].values())[0]

    def test_全部成功时_failed_是空的(self):
        from services.spec_page_html import generate_pages_parallel

        spec = {"appName": "x", "nodes": [],
                "pages": [{"id": "p1", "name": "甲", "purpose": "看", "audience": "谁", "coversNodes": []}]}

        class _R:
            content = ('<!DOCTYPE html><html><head>'
                       '<script src="https://cdn.tailwindcss.com"></script></head>'
                       '<body><main>中文</main></body></html>')

        out = generate_pages_parallel(spec, llm_call=lambda *a, **k: _R())
        assert out["failed"] == {} and len(out["pages"]) == 1

    def test_失败的页不产出占位_HTML(self):
        """**不 fail-open**：失败就是失败，不塞一份看着像那么回事的空壳。

        缺页不会被静默吞掉——第 4 步那条页面覆盖判据会发现（喂几份出几页）。
        """
        from services.spec_page_html import generate_pages_parallel

        spec = {"appName": "x", "nodes": [],
                "pages": [{"id": "p1", "name": "甲", "purpose": "看", "audience": "谁", "coversNodes": []}]}

        def boom(*a, **k):
            raise RuntimeError("网关断开")

        out = generate_pages_parallel(spec, llm_call=boom)
        assert out["pages"] == {}, "失败的页不该有任何产出"
        assert "p1" in out["failed"]

    def test_没有页面时不炸(self):
        from services.spec_page_html import generate_pages_parallel

        assert generate_pages_parallel({"pages": []}) == {"pages": {}, "failed": {}}


class Test一页好了就交出去:
    """`on_page` 是这条链上第一份"能直接看的东西"的出口。

    这一步产出的 HTML 比最终模型早四五分钟。攒齐再交，等于把那四五分钟
    白白变成转圈。
    """

    _SPEC = {
        "appName": "x",
        "nodes": [],
        "pages": [
            {"id": "p1", "name": "甲", "purpose": "看", "audience": "谁", "coversNodes": []},
            {"id": "p2", "name": "乙", "purpose": "看", "audience": "谁", "coversNodes": []},
        ],
    }
    _HTML = ('<!DOCTYPE html><html><head>'
             '<script src="https://cdn.tailwindcss.com"></script></head>'
             '<body><main>中文</main></body></html>')

    class _R:
        content = ('<!DOCTYPE html><html><head>'
                   '<script src="https://cdn.tailwindcss.com"></script></head>'
                   '<body><main>中文</main></body></html>')

    def test_每落地一页叫一次_并带进度(self):
        from services.spec_page_html import generate_pages_parallel

        seen: list = []
        out = generate_pages_parallel(
            self._SPEC, max_workers=1, llm_call=lambda *a, **k: self._R(),
            on_page=lambda pid, html, done, total: seen.append((pid, done, total)))

        assert [(p, d, t) for p, d, t in seen] == [("p1", 1, 2), ("p2", 2, 2)]
        assert len(out["pages"]) == 2

    def test_交出去的就是最终那份_HTML(self):
        """交半截等于前端渲染一份坏页面——比不交更糟。"""
        from services.spec_page_html import generate_pages_parallel

        got: dict = {}
        out = generate_pages_parallel(
            self._SPEC, max_workers=1, llm_call=lambda *a, **k: self._R(),
            on_page=lambda pid, html, *_: got.__setitem__(pid, html))
        assert got == out["pages"]

    def test_失败的页不叫(self):
        """失败的页没有产出（见上面那条"不产出占位"），自然也没什么可交。"""
        from services.spec_page_html import generate_pages_parallel

        seen: list = []

        def boom(*a, **k):
            raise RuntimeError("网关断开")

        generate_pages_parallel(self._SPEC, max_workers=1, llm_call=boom,
                                on_page=lambda *a: seen.append(a))
        assert seen == []

    def test_回调自己炸了不影响产出(self):
        """⚠ 这条是这个 sink 唯一危险的地方。

        它是"顺带推给前端看"，不是产出的一部分。让一次 UI 推送失败去打死
        已经生成好的页面，是拿次要的赔主要的——而且那份 HTML 已经烧过一次
        LLM 了，赔掉就得重烧。
        """
        from services.spec_page_html import generate_pages_parallel

        def sink(*_a):
            raise RuntimeError("SSE 队列满了")

        out = generate_pages_parallel(
            self._SPEC, max_workers=1, llm_call=lambda *a, **k: self._R(), on_page=sink)
        assert len(out["pages"]) == 2 and out["failed"] == {}

    def test_不传_on_page_一切照旧(self):
        """默认不传——老调用方一个字都不用改。"""
        from services.spec_page_html import generate_pages_parallel

        out = generate_pages_parallel(self._SPEC, llm_call=lambda *a, **k: self._R())
        assert len(out["pages"]) == 2

    def test_谁先好谁先交_不按提交顺序等(self):
        """⚠ 这条是整个 sink 的**成败判据**，2026-08-14 真机打脸补的。

        头一版写的是 `for page_id, fut in futures: fut.result()`——按提交顺序
        阻塞。五页并发跑着，可只要第一页慢，后面早就好了的页也得排队。真机
        量到的样子：

            [347s] p1  [347s] p2  [348s] p3   ← 三页挤在同一秒
            [369s] p4  [369s] p5

        用户原话「看着是画完了才显示，不是实时画的」。**接线全通、判据全绿、
        效果被一行遍历顺序抵消掉**——这正是本仓反复栽的那个形状，只不过这次
        栽在"我自己刚写的判据只查了叫没叫，没查什么时候叫"。
        """
        import threading

        from services.spec_page_html import generate_pages_parallel

        spec = {
            "appName": "x", "nodes": [],
            "pages": [
                {"id": "慢页", "name": "甲", "purpose": "看", "audience": "谁", "coversNodes": []},
                {"id": "快页", "name": "乙", "purpose": "看", "audience": "谁", "coversNodes": []},
            ],
        }
        released = threading.Event()

        def call(messages, **kwargs):
            # 第一页（提交顺序在前）卡住，直到第二页交付完才放行
            if "甲" in str(messages):
                assert released.wait(timeout=5), "第二页没能先交付——还在按提交顺序等"
            return self._R()

        seen: list = []
        out = generate_pages_parallel(
            spec, max_workers=2, llm_call=call,
            on_page=lambda pid, *_: (seen.append(pid), released.set()))

        assert seen[0] == "快页", f"先交付的应该是先跑完的那页，实际 {seen}"
        assert len(out["pages"]) == 2 and out["failed"] == {}

    def test_进度分母是总页数_不因乱序而错(self):
        """乱序交付之后 done/total 仍要单调数满，不能出现 2/2 之后还有一页。"""
        from services.spec_page_html import generate_pages_parallel

        spec = {"appName": "x", "nodes": [], "pages": [
            {"id": f"p{i}", "name": f"第{i}页", "purpose": "看",
             "audience": "谁", "coversNodes": []} for i in range(1, 5)]}
        seen: list = []
        generate_pages_parallel(spec, max_workers=4, llm_call=lambda *a, **k: self._R(),
                                on_page=lambda pid, html, d, t: seen.append((d, t)))
        assert [d for d, _ in seen] == [1, 2, 3, 4]
        assert {t for _, t in seen} == {4}
