"""spec-first 画出来的页面必须活到交付（2026-08-14）。

## 这条防的是"交付那一刻蒸发"

此前主轴只取 `run_spec_first(...)["model"]`，**`res["pages"]` 整个扔掉**。
表现是：推演**过程中**右侧能看到新链路的 HTML（spec_page 事件逐页推），
一跑完就换回老 ENRICH 区块路径。用户原话「最后执行完，我发现变成老链路了」。

18 分钟画出来的五页，在收口那一刻没了。而且没有一处会报错——模型是好的、
闸是绿的、闭环是成的，只是交付物换了一个。**又一次"闸全绿但东西没了"。**

## 两条纪律，缺一条就变成"东西看着在，其实是旧的"

  ① `take_last_pages` 是**取走**语义（读一次就清）
  ② 暂存只在整条链**跑成之后**才写（中途抛异常时那行根本不执行）

合起来保证：新链路挂了、老路兜住的那一轮，state.specFirstPages 是空的，
而不是上一轮的旧页面。这个形状本仓数过太多次，所以两条都单独有用例。
"""

import inspect
import textwrap
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services import spec_first_pipeline as sfp  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_stash():
    sfp._last_pages_var.set(None)
    yield
    sfp._last_pages_var.set(None)


class Test暂存的取用语义:
    def test_没跑过就是空的(self):
        assert sfp.take_last_pages() is None

    def test_取走一次就清(self):
        """⚠ 这条是"东西看着在其实是旧的"的唯一防线。

        留在原地的话：这一轮新链路挂了 → 回落老路 → 调用方照样读到
        **上一轮**的页面，当成这一轮的产出落库。用户看到的是一份跟当前
        话题无关的界面，而没有一处会报错。
        """
        sfp._last_pages_var.set({"pages": {"p1": "<html></html>"}})
        assert sfp.take_last_pages() is not None
        assert sfp.take_last_pages() is None, "第二次必须是空的"

    def test_只在整条链跑成之后才写入(self):
        """判据钉在源码顺序上：写暂存那行必须在最后的 return 之前、
        且在所有可能抛 SpecFirstError 的步骤之后。

        中途抛异常时它根本不执行——于是暂存里不会留下半份产物冒充成品。
        """
        src = inspect.getsource(sfp.run_spec_first)
        set_at = src.index("_last_pages_var.set(")
        # 第 3 步那道"一页都没出来就抛"必须在写入之前
        raise_at = src.index("第 3 步一页都没出来")
        assert raise_at < set_at, "写暂存不能早于失败判定"
        assert "return result" in src[set_at:], "写入之后才 return"


class Test打孔成功数不许被一页失败清零:
    """2026-08-18 CareBridge：bind 3 成 1 败，落库 boundPages=0。

    类型注释一直写的是成功数。有失败就把成功数改成 0，刷新后舞台撒谎。
    """

    def test_部分失败记成功数(self):
        assert sfp.count_bound_pages(
            ["p1", "p2", "p3", "p4"], True, {"p2": "打孔失败"}
        ) == 3

    def test_没跑打孔就是零(self):
        assert sfp.count_bound_pages(["p1", "p2"], False, {}) == 0
        # 反向：就算失败名单是空的，没跑也不能冒充打上了
        assert sfp.count_bound_pages(["p1"], False, {}) == 0

    def test_全失败是零_全成功是页数(self):
        ids = ["p1", "p2"]
        assert sfp.count_bound_pages(ids, True, {"p1": "a", "p2": "b"}) == 0
        assert sfp.count_bound_pages(ids, True, {}) == 2

    def test_相位与成功数同源(self):
        ids = ["p1", "p2", "p3", "p4"]
        failed = {"p2": "打孔失败"}
        status = sfp.page_bind_status(ids, True, failed)
        assert status == {
            "p1": sfp.PAGE_BIND_BOUND,
            "p2": sfp.PAGE_BIND_FAILED,
            "p3": sfp.PAGE_BIND_BOUND,
            "p4": sfp.PAGE_BIND_BOUND,
        }
        assert sfp.count_bound_pages(ids, True, failed) == 3
        assert sfp.page_bind_status(ids, False, {}) == {
            pid: sfp.PAGE_BIND_SKIPPED for pid in ids
        }

    def test_落库那行走计数函数_不许退回全有全无(self):
        """只测 helper 会假绿：把调用改回 `if not bound_failed else 0`，
        helper 用例仍绿，真机刷新还是 0。判据钉在 run_spec_first 落库块。"""
        src = inspect.getsource(sfp.run_spec_first)
        blob = src[src.index("_last_pages_var.set") : src.index("return result")]
        assert "count_bound_pages(" in blob, "落库没走计数——成功数到不了会话"
        assert "page_bind_status(" in blob, (
            "落库没走每页相位——前端只能靠成功数反推，K8s 那条就空了"
        )
        assert "not bound_failed else 0" not in blob, (
            "又退回「有失败就整记 0」——CareBridge 那次的谎"
        )

    def test_没跑bind不许记成bound(self):
        """2026-09-07 真机：tools=pages，6 页零 data-rows，相位全 bound。

        变异：第二参改回 bind_html，本条必须红。bind_html 默认 True，
        pages 单跳也会冒充打过孔。
        """
        src = inspect.getsource(sfp.run_spec_first)
        blob = src[src.index("bind_ran =") : src.index("return result")]
        assert '"bind" in stages' in blob
        assert "count_bound_pages(pages, bind_ran" in blob
        assert "page_bind_status(pages, bind_ran" in blob
        assert "count_bound_pages(pages, bind_html" not in blob
        assert "page_bind_status(pages, bind_html" not in blob


class Test落库那一处:
    def test_主轴真的调了落库(self):
        """**每一个**调生成的分支都要落库，漏一处就是「某些路径下页面没了」。

        ⚠ 2026-09-04 重写：上一版钉的是
        `src.count("_cache_spec_first_pages(state)") == 2`——一个写死的数字。
        产线后来正当地多出第三处（closure 单跳那条，`if _host_hop:`），判据就
        红了，而它红的原因跟它想守的事一点关系都没有：**没人漏落库，是数字过期了**。
        这正是 CLAUDE.md §2 说的「盯字面别盯语义」，红了两周没人敢动，因为看不出
        它到底在守什么。

        改成按语义问：凡是调了 `_try_llm_generate_evidence` 的那个分支体，
        里面必须也有 `_cache_spec_first_pages`。新增分支自动被盖住，
        删掉任何一处的落库照样红。
        """
        import ast

        from services import v5_capability_executor as ex

        fn_src = textwrap.dedent(inspect.getsource(ex._build_per_skill_evidence))
        fn = ast.parse(fn_src).body[0]

        def _calls(nodes, name):
            return any(
                isinstance(n, ast.Call)
                and getattr(n.func, "id", getattr(n.func, "attr", None)) == name
                for node in nodes
                for n in ast.walk(node)
            )

        branches = []
        for node in ast.walk(fn):
            if isinstance(node, ast.If):
                branches.append(node.body)
                if node.orelse and not (
                    len(node.orelse) == 1 and isinstance(node.orelse[0], ast.If)
                ):
                    branches.append(node.orelse)

        generating = [b for b in branches if _calls(b, "_try_llm_generate_evidence")]
        assert generating, (
            "一个调生成的分支都没找到——判据跟产线脱节了，去看 _build_per_skill_evidence"
        )
        for body in generating:
            assert _calls(body, "_cache_spec_first_pages"), (
                f"第 {body[0].lineno} 行那个分支调了生成却没落库——这条路径上页面会蒸发"
            )

    def test_落库失败不打死推演(self):
        from services import v5_capability_executor as ex

        src = inspect.getsource(ex._cache_spec_first_pages)
        assert "except Exception" in src
        assert "不影响推演" in src

    def test_空产物不写脏数据(self, monkeypatch):
        """一页都没有时不该写一个空壳上去——空壳会让前端判成"有新链路产物"
        然后渲染出一片空白，比掉回老链路更糟。"""
        from services import v5_capability_executor as ex

        state = V5SessionState(sessionId="s1", goal={"text": "x"}, artifacts=[])
        sfp._last_pages_var.set({"pages": {}})
        ex._cache_spec_first_pages(state)
        assert state.specFirstPages is None

    def test_有产物就落到状态上(self):
        from services import v5_capability_executor as ex

        state = V5SessionState(sessionId="s2", goal={"text": "x"}, artifacts=[])
        sfp._last_pages_var.set({
            "version": "spec-first-pipeline-v1",
            "pages": {"p1": "<html>甲</html>", "p2": "<html>乙</html>"},
            "navItems": [{"id": "p1"}],
            "boundPages": 2,
        })
        ex._cache_spec_first_pages(state)
        assert state.specFirstPages is not None
        assert set(state.specFirstPages["pages"]) == {"p1", "p2"}
        assert state.specFirstPages["boundPages"] == 2

    def test_回落老链路的那一轮状态上不该有页面(self):
        """把两条纪律合起来验一次：这是真正会烧到用户的那个场景。"""
        from services import v5_capability_executor as ex

        # 上一轮成功，产物被取走
        sfp._last_pages_var.set({"pages": {"p1": "<html>上一轮</html>"}})
        prev = V5SessionState(sessionId="s3", goal={"text": "上一个话题"}, artifacts=[])
        ex._cache_spec_first_pages(prev)
        assert prev.specFirstPages is not None

        # 这一轮新链路挂了 → 暂存里什么都没有 → 新状态上不许出现上一轮的页面
        now = V5SessionState(sessionId="s3", goal={"text": "新话题"}, artifacts=[])
        ex._cache_spec_first_pages(now)
        assert now.specFirstPages is None, "读到了上一轮的页面——东西看着在，其实是旧的"

    def test_假设确认不被整份替换冲掉(self):
        """⚠ 2026-09-03 团子：确认继续把 assumptionsConfirmed=True 写进
        specFirstPages，结构反推那一跳 take_last_pages 没有这个键，整份
        替换后刷新又把伴随式卡摊回来。

        变异：把 _cache_spec_first_pages 里那行 carry 删掉 → 本条红。
        """
        from services import v5_capability_executor as ex

        state = V5SessionState(sessionId="s-ask", goal={"text": "x"}, artifacts=[])
        state.specFirstPages = {
            "pages": {"p1": "<html>旧</html>"},
            "spec": {"appName": "团子", "assumptions": [{"id": "a1"}]},
            "assumptionsConfirmed": True,
        }
        sfp._last_pages_var.set({
            "version": "spec-first-pipeline-v1",
            "pages": {"p1": "<html>新</html>"},
            "spec": {"appName": "团子", "assumptions": [{"id": "a1"}]},
        })
        ex._cache_spec_first_pages(state)
        assert state.specFirstPages["pages"]["p1"] == "<html>新</html>"
        assert state.specFirstPages.get("assumptionsConfirmed") is True, (
            "工厂整份替换把假设确认冲掉了——刷新会复弹伴随式卡"
        )

    def test_反向_上一跳没确认就不要凭空写成已确认(self):
        from services import v5_capability_executor as ex

        state = V5SessionState(sessionId="s-open", goal={"text": "x"}, artifacts=[])
        state.specFirstPages = {
            "pages": {"p1": "<html>旧</html>"},
            "spec": {"appName": "团子"},
        }
        sfp._last_pages_var.set({
            "pages": {"p1": "<html>新</html>"},
            "spec": {"appName": "团子"},
        })
        ex._cache_spec_first_pages(state)
        assert "assumptionsConfirmed" not in (state.specFirstPages or {}), (
            "没确认过却写成 True，卡就永远摊不出来"
        )


class Test应用中心那一份:
    """页面除了落会话（上面那组），还要跟着闭环记录落进 App Store（2026-08-14）
    ——应用中心的卡和只读预览靠它渲染真页面，不再拿区块渲染器凑合出一张
    光板 antd 表格。"""

    def test_peek只读不清(self):
        """落 App Store 用的是 peek：它跑在会话侧 take 之前，用 take 会把
        _cache_spec_first_pages 饿死——页面进了应用中心、会话里却没了。"""
        sfp._last_pages_var.set({"pages": {"p1": "<html>甲</html>"}})
        assert sfp.peek_last_pages() is not None
        assert sfp.peek_last_pages() is not None, "peek 不许清场"
        assert sfp.take_last_pages() is not None, "take 还能取到——peek 没动它"
        assert sfp.take_last_pages() is None

    def test_闭环落库真的带上了页面(self):
        """判据钉在源码上：这条线断了不会有用例变红（落库照常成功、模型照常
        正确，只有应用中心的卡永远回落区块渲染）。"""
        from services import v5_capability_executor as ex

        src = inspect.getsource(ex)
        save_at = src.index("app_store.save_app_or_version(")
        # 只看该调用后的一小段，防止匹配到文件里别处的同名字样
        call = src[save_at: save_at + 1200]
        assert "pages_json=peek_last_pages()" in call, (
            "闭环落库没带页面——应用中心的卡拿不到 HTML"
        )

    def test_落库入口把页面传到了三条分支(self):
        """save_app_or_version 三条分支（幂等更新/新版本/新应用）都得把
        pages_json 传下去，漏一条就是"某些路径下页面没了"。"""
        import services.app_store as store

        src = inspect.getsource(store.save_app_or_version)
        assert src.count("pages_json=pages_json") == 3


class Test状态字段本身:
    def test_字段在_且默认为空(self):
        state = V5SessionState(sessionId="s4", goal={"text": "x"}, artifacts=[])
        assert state.specFirstPages is None

    def test_能被序列化带走(self):
        """会话要落盘、要过 SSE、要在刷新之后重放。序列化不掉才算数。"""
        state = V5SessionState(sessionId="s5", goal={"text": "x"}, artifacts=[])
        state.specFirstPages = {"pages": {"p1": "<html>甲</html>"}, "boundPages": 1}
        dumped = state.model_dump(mode="json")
        assert dumped["specFirstPages"]["pages"]["p1"] == "<html>甲</html>"

    def test_前端存回去那一侧也带着它(self):
        """⚠ 跨端判据。前端 preservePythonEvidenceProjection 是"存回去"那一侧，
        漏列一个键 = **存一次丢一次**，而且不会有任何一处报错：
        推演完看得见，刷新一下就没了。
        """
        import pathlib

        root = pathlib.Path(__file__).resolve().parents[2]
        text = (root / "client/src/pages/sliderule/useSlideRuleSession.ts").read_text(
            encoding="utf-8"
        )
        block = text[text.index("function preservePythonEvidenceProjection"):]
        block = block[: block.index("\n}")]
        assert "specFirstPages" in block, "前端存回去时会把它丢掉"


class Test页面跟着版本一起回退:
    """回退不带页面 = **说谎**：指针回到 v1，右侧还是 v3 的页面。

    这跟 restore 那条 D8 修复（"UI 显示回到 v1、实际跑的还是 v3"）是同一个病，
    只是发生在交付物上而不是模型上。
    """

    def _snap(self, state, model, pages, instruction="改一版"):
        from services.v5_full_driver import record_model_snapshot

        state.specFirstPages = pages
        record_model_snapshot(state, model, instruction)

    def test_快照带上当时的页面(self):
        state = V5SessionState(sessionId="v1", goal={"text": "x"}, artifacts=[])
        self._snap(state, {"datamodel": {"entities": [1]}}, {"pages": {"p1": "<html>甲</html>"}})
        assert state.modelVersions[-1]["specFirstPages"]["pages"]["p1"] == "<html>甲</html>"

    def test_每版记各自那份_不串(self):
        # ⚠ 2026-08-18 起 _PAGES_KEPT_VERSIONS=1（413 事故，见常量头注）：
        #   追加新版时旧版页面**如实置空**，不是拿新版页面冒充。所以判据改成：
        #   队尾是自己那份，旧版是 None——两者都不许串成对方的。
        state = V5SessionState(sessionId="v2", goal={"text": "x"}, artifacts=[])
        self._snap(state, {"datamodel": {"entities": [1]}}, {"pages": {"p1": "<html>一版</html>"}})
        self._snap(state, {"datamodel": {"entities": [2]}}, {"pages": {"p1": "<html>二版</html>"}})
        assert state.modelVersions[-1]["specFirstPages"]["pages"]["p1"] == "<html>二版</html>"
        older = state.modelVersions[0]["specFirstPages"]
        assert older is None or older["pages"]["p1"] == "<html>一版</html>", \
            "旧版页面要么如实置空，要么是自己那份——绝不许是新版的"

    def test_只有最近几版带页面_更早的抹掉(self):
        """⚠ 容量闸。实测单页 19~28KB、五页一版约 125KB，20 版全带 = 2.5MB
        的会话 blob，而它每次存盘都要过一遍。"""
        from services.v5_full_driver import _PAGES_KEPT_VERSIONS

        state = V5SessionState(sessionId="v3", goal={"text": "x"}, artifacts=[])
        for i in range(_PAGES_KEPT_VERSIONS + 3):
            self._snap(state, {"datamodel": {"entities": [i]}},
                       {"pages": {"p1": f"<html>第{i}版</html>"}})
        carried = [v for v in state.modelVersions if v.get("specFirstPages")]
        assert len(carried) == _PAGES_KEPT_VERSIONS
        # 留下的必须是**最近的**那几版，不是最早的
        assert carried[-1]["specFirstPages"]["pages"]["p1"].endswith(
            f"第{_PAGES_KEPT_VERSIONS + 2}版</html>")

    def test_抹掉的是页面_不是整条版本(self):
        """版本记录本身要留着——◀▶ 还得能回退到那一版的模型，
        只是那一版**如实没有页面**（右侧回落老区块渲染）。"""
        from services.v5_full_driver import _PAGES_KEPT_VERSIONS

        state = V5SessionState(sessionId="v4", goal={"text": "x"}, artifacts=[])
        for i in range(_PAGES_KEPT_VERSIONS + 2):
            self._snap(state, {"datamodel": {"entities": [i]}},
                       {"pages": {"p1": f"<html>第{i}版</html>"}})
        oldest = state.modelVersions[0]
        assert oldest["specFirstPages"] is None
        assert isinstance(oldest.get("model"), dict), "模型不许跟着页面一起没了"

    def test_回退那一处真的会换页面(self):
        """判据钉在路由源码上：这条线断了不会有任何用例变红
        （回退照常成功、模型照常正确，只有页面是上一版的）。

        ⚠ 2026-08-29 改写。原判据 grep 的是**那一行的字面**
        （`state.specFirstPages = target.get("specFirstPages") or None`）。
        它咬住的是位置，不是语义——而位置正好是后来出事的地方：那一行原本
        坐在闭环重建**之前**，重建内部三处 persist_state 会把抹空的交付物
        当场落库，随后 D8 判 409 报「指针未移动」，页却已经没了（真机
        sr-it-065848-A：回退前 6 张，409 之后 0 张，且单调守卫让它补不回来）。

        修法是把这一刀挪到判决之后，于是那句字面消失、判据变红——**修对了
        反而红**，正是本仓第五条说的"盯语义别盯字面"。

        现在这条只管**次序**（换页必须在判决之后），换页本身的行为判据在
        tests/test_page_id_aliases_survive_refine.py::Test回退失败不许把交付页烧掉。
        """
        import pathlib

        # ⚠ 2026-08-29：业务核从 routes 下沉到 services/model_version_restore
        #   （原来业务层反向 import 路由层，是个真的循环依赖）。这条判据钉的是
        #   **次序**（换页必须在 D8 判决之后），跟它住哪儿无关，跟着搬即可。
        src = (pathlib.Path(__file__).resolve().parents[1]
               / "services/model_version_restore.py").read_text(encoding="utf-8")
        block = src[src.index("def restore_model_version_locked"):]
        # 剥注释再找：本仓踩过"grep 到的词其实在注释里"。
        code = "\n".join(
            line for line in block.splitlines() if not line.lstrip().startswith("#")
        )
        assert 'target.get("specFirstPages") or None' in code, (
            "回退没换页面——指针回到 v1，右侧还是 v3 的页"
        )
        verdict = code.index("closure_rebuild_mismatch")
        assign = code.index('target.get("specFirstPages") or None')
        assert assign > verdict, (
            "换页坐在 D8 判决之前——重建里的 persist_state 会把它落库，"
            "而判决可能随后 409：那时指针没动、页已经没了，且补不回来"
        )


class Test循环的进展判据:
    """「执行闭环不了，都执行 9 轮了」——2026-08-14 真机。

    查下来闭环**是成的**（blocked=False、证据 6/6），卡住的是覆盖门里一条
    `gap-evidence-turn-1`：外部证据缺口，`capabilityId=None`，**没有任何能力
    负责解它**。而每轮 evidence.search 都产出新产物，于是"产物变多"这个
    进展信号恒为真、计数器每轮清零，"没进展就停"那道兜底一次都没触发过。

    判据查的是"有没有在干活"，不是"有没有在向门前进"。
    """

    def test_产物变多不再算进展(self):
        import inspect

        from services import v5_full_driver as drv

        src = inspect.getsource(drv.drive_full_v5_session_stream)
        block = src[src.index("# progress tracking"):]
        block = block[: block.index("if no_progress_streak >= 2")]
        assert "if now_res > prev_resolved:" in block, "进展判据没收严"
        assert "now_art > prev_art_count" not in block, (
            "产物数还在当进展信号——外部证据缺口那种解不掉的场景会一直跑到 max_loops"
        )

    def test_缺口有新解决仍然算进展(self):
        """收严不能收成"永远不重置"——那样正常推进的轮次也会被两轮判死。"""
        import inspect

        from services import v5_full_driver as drv

        src = inspect.getsource(drv.drive_full_v5_session_stream)
        assert "no_progress_streak = 0" in src

    def test_兜底仍然是两轮(self):
        import inspect

        from services import v5_full_driver as drv

        src = inspect.getsource(drv.drive_full_v5_session_stream)
        assert "no_progress_streak >= 2" in src


class Test回退时页面要真的落库:
    """⚠ 2026-08-29 真机 sr-it-B-072108：**指针动了、页没跟着动。**

    回退成功（restored=true、currentModelVersionId=mv-1），库里却还是 mv-2
    那五张页——五个 md5 与精修轮逐字节相同。查下来在持久层：

        回退这一笔天生没有任何集合增长（artifacts / capabilityRuns /
        conversation / reasoningEvents / replayLog 全都不变）
          → _is_same_turn_progress = False（实测）
          → 同轮守卫「退回旧核」
          → 只有豁免名单里的字段活下来：publishClosure、skillRuntimeGraph、
            modelVersions、currentModelVersionId、turnNarrations
          → specFirstPages 不在名单里 → 被退回旧值

    表现就是 D8 那个病落在交付物上：UI 显示回到 mv-1，右侧还是 mv-2 的页。
    路由那一层写得再对也没用——它写了，持久层把它退了回去（本仓第三条：
    「函数写对了 ≠ 它被调用了」在这里是「写进去了 ≠ 落了库」）。

    ⚠ 豁免必须**挂在指针变化上**，不能无条件加进名单：specFirstPages 与名单里
    其它几个不同，客户端快照**会**带着它回传，无条件豁免等于给"陈旧同轮快照
    不许 clobber"开了个口子。
    """

    @staticmethod
    def _prior_and_incoming(inc_pointer, inc_pages):
        prior = V5SessionState(
            sessionId="g1", goal={"text": "x"}, artifacts=[],
            lastTurnId="turn-4-drive-full",
        )
        prior.modelVersions = [{"id": "mv-1", "model": {}}, {"id": "mv-2", "model": {}}]
        prior.currentModelVersionId = "mv-2"
        prior.specFirstPages = {"pages": {"p1": "<html>新版</html>"}}
        inc = prior.model_copy(deep=True)
        inc.currentModelVersionId = inc_pointer
        inc.specFirstPages = inc_pages
        return prior, inc

    def _write_state(self, prior, inc):
        from services import persistence

        return persistence._resolve_write_state(prior, inc)

    def test_指针动了页就得跟着落库(self):
        prior, inc = self._prior_and_incoming("mv-1", {"pages": {"p1": "<html>老版</html>"}})
        out = self._write_state(prior, inc)
        assert out.currentModelVersionId == "mv-1"
        assert (out.specFirstPages or {}).get("pages") == {"p1": "<html>老版</html>"}, (
            "回退把指针挪了，页却被守卫退回旧值——右侧还是上一版的页"
        )

    def test_目标版本没有页时如实置空(self):
        """`_PAGES_KEPT_VERSIONS = 1`，往回退一步的快照页早被抹了，这才是常态。"""
        prior, inc = self._prior_and_incoming("mv-1", None)
        out = self._write_state(prior, inc)
        assert out.specFirstPages is None, (
            f"该置空却留下了 {out.specFirstPages}——拿另一版的页冒充这一版的"
        )

    def test_指针没动时陈旧快照照旧不许覆盖页(self):
        """⚠ 反向判据。这一条就是豁免为什么要挂在指针变化上。

        客户端回传的 state 带着 specFirstPages（useSlideRuleSession 会带），
        同轮陈旧快照若能覆盖交付页，用户刷新一下就能把刚生成的页打回上一版。
        """
        prior, inc = self._prior_and_incoming("mv-2", {"pages": {"p1": "<html>陈旧</html>"}})
        out = self._write_state(prior, inc)
        assert (out.specFirstPages or {}).get("pages") == {"p1": "<html>新版</html>"}, (
            "同轮陈旧快照把交付页 clobber 了——守卫这道口子开大了"
        )
