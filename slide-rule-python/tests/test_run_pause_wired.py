"""暂停真的接在跑的那条链上了吗（2026-08-28 接线）。

## 这个文件跟 test_run_cooperative_pause 的分工

那个验的是**机制**（等得住、放行接着跑、取消出得来、超时按跳过）。
这个验的是**接线**——机制写对了 ≠ 它被接上了（CLAUDE.md §3）。

## ⚠ 只接了流式那条循环

`while loop < max_loops:` 在 v5_full_driver 里有**两处**：1386 行是同步驱动器
（脚本/测试入口），2200 行附近是流式驱动器（前端主路径）。写这段时第一次
替换就因为 `count == 2` 当场断言失败——那正是本仓「同步/流式改一半」那个坑
（CLAUDE.md §4）在这次接线上的现形。

这次**有意只接流式**：同步入口没有"前端按暂停"这回事。所以下面既钉住
"流式那条有"，也钉住"这个选择是明写的"，免得下一个人以为是漏了。
"""

import asyncio
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import run_cancel, run_pause  # noqa: E402


@pytest.fixture(autouse=True)
def _reset():
    run_cancel.bind(None)
    run_pause.bind(None)
    yield
    run_cancel.bind(None)
    run_pause.bind(None)
    os.environ.pop("SLIDERULE_RUN_PAUSE_ENABLED", None)


class Test安全点接在驱动器上:
    def test_没人按暂停时零成本(self):
        """正常路径上只多一次字典读取——这条决定了敢不敢把它放进主循环。"""

        async def scenario():
            run_pause.bind(run_pause.new_slot())
            assert await run_pause.pause_here("loop-0") is None

        asyncio.run(scenario())

    def test_没绑位子也不炸(self):
        """老调用点 / 脚本入口没绑过位子，行为必须跟从前一模一样。"""

        async def scenario():
            run_pause.bind(None)
            assert await run_pause.pause_here("loop-0") is None

        asyncio.run(scenario())

    def test_按了暂停就停住_放行后拿到答案(self):
        async def scenario():
            slot = run_pause.new_slot()
            run_pause.bind(slot)
            gate = run_pause.request_hold(slot)
            assert gate is not None
            asyncio.get_running_loop().call_later(0.05, gate.answer, {"选了": "工号"})
            res = await run_pause.pause_here("loop-1")
            assert res is not None and res.answered
            assert res.answer == {"选了": "工号"}
            # 取走之后位子空了：一次按下只停一次，不会下一轮又停
            assert await run_pause.pause_here("loop-2") is None

        asyncio.run(scenario())

    def test_正在等的时候_路由按run_id还找得到那个闸(self):
        """⚠ 2026-08-28 真机咬出来的洞，单测当时全绿。

        第一版 `take_hold` 把闸从位子里**取走**，于是驱动器一开始等，路由就
        再也找不到它——`release` 恒 released=false，这一轮永远停在那儿。
        真机：按暂停 → 停住 ✅ → 放行 → {"released":false}、15 秒零新事件。

        单测没咬住，是因为它直接拿着 gate 对象调 answer，**绕过了位子查找**
        ——正向判据齐全、反向判据缺失（CLAUDE.md §3）。这条走的就是路由那条路。
        """

        async def scenario():
            slot = run_pause.new_slot()
            run_pause.bind(slot)
            run_pause.request_hold(slot)

            async def releaser():
                await asyncio.sleep(0.05)
                # 路由手上只有位子，没有 gate 对象——必须从这儿找得到
                gate = slot.active or slot.pending
                assert gate is not None, "正在等的时候位子里空了，路由找不到闸"
                gate.answer({"选了": "工号"})

            res, _ = await asyncio.gather(
                run_pause.pause_here("loop-1"), releaser()
            )
            assert res is not None and res.answered

        asyncio.run(scenario())

    def test_等完了要把正在等清掉(self):
        """不清的话下一轮的 release 会打到一个已经结束的闸上，
        返回 released=true 却什么也没发生——又一个"闸绿了东西没动"。"""

        async def scenario():
            slot = run_pause.new_slot()
            run_pause.bind(slot)
            gate = run_pause.request_hold(slot)
            gate.skip()
            await run_pause.pause_here("loop-1")
            run_pause.finish_hold()
            assert slot.active is None and slot.pending is None

        asyncio.run(scenario())

    def test_重复按不开第二道闸(self):
        slot = run_pause.new_slot()
        run_pause.bind(slot)
        a = run_pause.request_hold(slot)
        b = run_pause.request_hold(slot)
        assert a is b

    def test_总闸关掉时按不动(self):
        """⚠ 它能停住一条跑了两分钟的推演，出事时要有一根总闸。"""
        os.environ["SLIDERULE_RUN_PAUSE_ENABLED"] = "0"
        slot = run_pause.new_slot()
        run_pause.bind(slot)
        assert run_pause.request_hold(slot) is None


class Test接在流式那条链上:
    def _driver_code(self) -> str:
        import services.v5_full_driver as d

        with open(d.__file__, encoding="utf-8") as fh:
            body = fh.read()
        # 剥注释再找：本仓踩过"判据 grep 到的词其实在注释里"
        return "\n".join(
            line for line in body.splitlines() if not line.lstrip().startswith("#")
        )

    def _hold_fn_code(self) -> str:
        """Read the manual pause block from the actual streaming main loop.

        SPEC decisions return to a questionnaire; they no longer use this gate.
        AST boundaries keep these assertions independent of adjacent comments.
        """
        import ast
        import inspect

        import services.v5_full_driver as driver

        tree = ast.parse(inspect.getsource(driver.drive_full_v5_session_stream))
        loop = next(
            node for node in ast.walk(tree)
            if isinstance(node, ast.While) and ast.unparse(node.test) == "loop < max_loops"
        )
        def assigns(node, name):
            return isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == name
                for target in node.targets
            )
        first = next(i for i, node in enumerate(loop.body) if assigns(node, "_pause_res"))
        last = next(i for i, node in enumerate(loop.body) if assigns(node, "ui"))
        return ast.unparse(ast.Module(body=loop.body[first:last], type_ignores=[]))

    def test_停住之前先报一声_前端才变得了形态(self):
        """⚠ 必须在**开始等之前** yield：等上了才报，卡片在整段等待期间都是
        旧样子，用户不知道自己按的那下生效了没有。

        真机（2026-09-06 sr-20260906045441）：`run_pause_started` 迟到 3 秒，
        前端 `runPaused` 点不亮，假设卡上单条的两个按钮点了不放行。
        更细的同款判据见 tests/test_pause_visibility.py（按 AST 认 yield，
        防"退化成普通赋值时字面量还在原地"）。
        """
        import ast

        tree = ast.parse(self._hold_fn_code())
        started = [node.lineno for node in ast.walk(tree) if isinstance(node, ast.Yield) and "run_pause_started" in ast.dump(node)]
        waited = [node.lineno for node in ast.walk(tree) if isinstance(node, ast.Await) and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Attribute) and node.value.func.attr == "wait"]
        assert started and waited
        assert min(started) < min(waited), "The pause notification must be yielded before waiting"

    def test_流式循环里真的调了安全点(self):
        """⚠ 反向判据：机制写对了 ≠ 它被调用了。

        删掉调用点这条会红，而 test_run_cooperative_pause 那一整个文件照样
        全绿——那正是本仓数过十次以上的形状。
        """
        code = self._driver_code()
        assert "take_hold()" in code, "驱动器里没有安全点调用——机制没接上"

    def test_安全点在流式那条循环里_不是同步那条(self):
        code = self._driver_code()
        loops = [m.start() for m in re.finditer(r"while loop < max_loops:", code)]
        assert len(loops) == 2, f"驱动器里的主循环数量变了（{len(loops)}），接线位置要重认"
        holds = [m.start() for m in re.finditer(r"take_hold\(\)", code)]
        assert holds, "驱动器里没有安全点调用——机制没接上"
        assert all(h > loops[0] for h in holds), "有安全点插在了同步驱动器上"
        assert any(h > loops[1] for h in holds), "流式循环里没有安全点"

    def test_安全点在最贵的活开始之前(self):
        """位置照 run_cancel 的纪律：别再开始下一件大活儿。

        插在 orchestrate_plan / pick 之后就等于"这一轮已经烧起来了才停"。
        """
        code = self._driver_code()
        at = code.index("take_hold()")
        nxt = code.index("orchestrate_plan", at)
        assert at < nxt

    def test_spec_decisions_return_to_control_without_a_dedicated_pause(self):
        """Saved SPEC decisions end the factory call before closure generation.

        The live HTTP/pipeline test is in test_spec_decisions_questionnaire; this
        guards the retired pause boundary without requiring its deleted helper.
        """
        import ast
        import inspect

        import services.v5_full_driver as driver

        tree = ast.parse(inspect.getsource(driver.drive_full_v5_session_stream))
        names = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
        assert "_drain_assumption_hold" not in names
        assert "_assumption_q" not in names
        stops = [
            node for node in ast.walk(tree)
            if isinstance(node, ast.If)
            and isinstance(node.test, ast.Call)
            and isinstance(node.test.func, ast.Name)
            and node.test.func.id == "_spec_decisions_pending"
            and any(isinstance(child, ast.Return) for child in ast.walk(node))
        ]
        assert len(stops) == 1
        stop = stops[0]
        assert any(
            isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and any(isinstance(arg, ast.Name) and arg.id == "_park_spec_decisions" for arg in node.args)
            for node in ast.walk(stop)
        ), "SPEC must be persisted before the control handback"
        assert any(
            isinstance(node, ast.Yield) and isinstance(node.value, ast.Dict)
            and any(isinstance(value, ast.Constant) and value.value == "complete" for value in node.value.values)
            for node in ast.walk(stop)
        ), "The control host needs a complete event before it can ask the questionnaire"

    def test_三种没答的结局都不许把这一轮判死(self):
        """暂停不是取消。真机实测取消 → publishClosure=null、白烧一轮；
        暂停的三种结局都要接着跑到最后一步。"""
        # ⚠ 同上：从"`take_hold()` 之后 1400 字符"改成整个函数体。
        #   魔数窗口在隔壁加几行之后就把要找的东西挤出去了，而它报的错
        #   （断言 recover_from 不在窗口里）看起来像"恢复配方被删了"。
        code = self._hold_fn_code()
        # 没答时走恢复配方继续，而不是 break / raise
        assert "recover_from" in code
        assert "break" not in code.split("recover_from")[0][-200:]


class Test注册表把闸和run对上:
    def test_run上有位子且起跑时绑过(self):
        """⚠ 绑定必须在起跑**之前**——Context 是那一刻复制的，绑晚了线程里
        读到 None，整条线路静默失效（run_cancel 头注为此专门写过一段）。"""
        import services.run_registry as rr

        with open(rr.__file__, encoding="utf-8") as fh:
            code = "\n".join(
                l for l in fh.read().splitlines() if not l.lstrip().startswith("#")
            )
        assert "self.pause_slot = run_pause.new_slot()" in code
        # 跟 cancel 的绑定挨在一起，且都在 _drive 的开头
        at_cancel = code.index("run_cancel.bind(run.cancel_token)")
        at_pause = code.index("run_pause.bind(run.pause_slot)")
        assert 0 < at_pause - at_cancel < 200, "暂停的绑定没跟取消的绑在同一处"

    def test_孤儿看门狗对暂停中的run放手(self):
        """⚠ 关页面十分钟变成取消，就是看门狗没认暂停闸。

        删掉 is_holding / orphan_exempt 这两道判断，这条红。
        """
        import services.run_registry as rr

        with open(rr.__file__, encoding="utf-8") as fh:
            code = "\n".join(
                l for l in fh.read().splitlines() if not l.lstrip().startswith("#")
            )
        assert "is_holding" in code
        assert "is_orphan_exempt" in code
        assert "mark_unattended" in code

    def test_暂停和取消是两个操作_没有被合并(self):
        """⚠ 取消是终止、暂停是停住等人，两者不是同一件事的两个力度。"""
        import services.run_registry as rr

        assert hasattr(rr, "hold_run") and hasattr(rr, "release_run")
        assert hasattr(rr, "cancel_run")

    def test_路由开了两个口子(self):
        import routes.sliderule_full as r

        paths = {getattr(x, "path", "") for x in r.router.routes}
        assert "/runs/{run_id}/hold" in paths
        assert "/runs/{run_id}/release" in paths
