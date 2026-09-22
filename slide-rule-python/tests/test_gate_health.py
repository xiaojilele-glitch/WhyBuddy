# -*- coding: utf-8 -*-
"""闸的体检：一道一直给同一个结论的闸，等于没在量东西（2026-09-05）。

## 起因

今天之前，15 个走到闭环的会话**全是 `证据 0/6 + blocked`，一个例外都没有**。
那个整齐度本身就是答案，但没有任何一处在看它，于是它躲了几个月：

  · `0/6 blocked` 读起来像「闸正常工作，它拦住了东西」——**坏成不响容易被
    发现，坏成一直响反而安全**；
  · 「一直被拦」同时符合另一个说得通的故事（"产品还不够好"）；
  · 相关性闸的手写标定集是自我印证的，喂真库才掉到 63%。

形状抄 grok-build `goal_tracker.rs` 的 `record_classifier_stall` /
`record_evaluator_blocker`：**同一个指纹连续 N 次**才算数，指纹变了就重置。
不是"拦了百分之几"——把 15 个不同应用按 15 个不同理由拦下是健康的，
按**同一个理由**拦下才是坏的，比率区分不了这两件事。

## 判据形状

第一组用**今天那 15 个会话的真实形状**回放：它必须开口。这是整件事的目的，
排在最前面。后面几组是反向配对：健康的闸不许被打扰。
"""

import json

import pytest

from services import gate_health
from services.gate_health import (
    STREAK_THRESHOLD,
    WINDOW_SIZE,
    record_verdict,
    snapshot,
    summary_line,
)


@pytest.fixture(autouse=True)
def _clean(tmp_path, monkeypatch):
    gate_health._reset_for_tests()
    monkeypatch.setenv("SLIDERULE_GATE_HEALTH_DIR", str(tmp_path))
    yield
    gate_health._reset_for_tests()


class Test今天那15个会话:
    def test_全是0slash6时必须开口(self):
        """★ 事故本体回放。这条红 = 报警器又装成了不会响的那种。"""
        tripped = [record_verdict("evidence", passed=False, fingerprint="0/6")
                   for _ in range(15)]
        hits = [t for t in tripped if t]
        assert hits, "15 个会话全是 0/6，体检一声没吭"
        assert hits[0]["reason"] == "GateRepeatingItself"
        assert hits[0]["gate"] == "evidence"

    def test_第三次就开口_不用等到第十五次(self):
        """早说比晚说值钱：15 次才说，前 14 次的真机时间已经烧掉了。"""
        first = None
        for i in range(1, 8):
            r = record_verdict("evidence", passed=False, fingerprint="0/6")
            if r and first is None:
                first = i
        assert first == STREAK_THRESHOLD, f"第 {first} 次才开口，阈值是 {STREAK_THRESHOLD}"

    def test_说的是去查闸_不是去改产物(self):
        """★ 这条报警的价值全在措辞上。

        当时我（和这个代码库）犯的错是**信了闸的读数**：它说 0/6，就去查
        为什么没生成；它说 21% 不相关，就去补页面。报警必须把人推向
        「先看尺子直不直」，否则它只会加速走错方向。
        """
        rec = None
        for _ in range(STREAK_THRESHOLD):
            rec = record_verdict("relevance", passed=False,
                                 fingerprint="CLOSURE_GOAL_RELEVANCE_FAILED@0.208") or rec
        assert rec is not None
        assert "自我印证" in rec["message"]
        assert "别急着改被它拦下的产物" in rec["message"]

    def test_留了一条可回查的记录(self, tmp_path):
        for _ in range(STREAK_THRESHOLD):
            record_verdict("evidence", passed=False, fingerprint="0/6")
        path = tmp_path / "gate-health.jsonl"
        assert path.exists(), "只打了日志没落盘——日志会滚走，几个月后没人查得到"
        rows = [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x]
        assert rows[0]["reason"] == "GateRepeatingItself"
        assert rows[0]["type"] == "GateHealth"   # 同 run_degradation 的 Condition 形状
        assert rows[0]["gate"] == "evidence"


class Test健康的闸不许被打扰:
    def test_不同理由拦下不同应用_不算重复自己(self):
        """★ 两条判据的分工：理由各不相同 → **不是**「重复自己」。

        一道闸把不同的应用按不同的理由拦下来，说明它在真的量东西。这种情况
        不该扣上 GateRepeatingItself 的帽子——那顶帽子的诊断是"去查判据是不是
        自我印证"，对这里是误导。

        （窗口满了之后另一条判据会说"最近 10 次全拦"，那是另一个诊断、另一句
        话，见 Test一边倒那一头。两条各管一头，别混。）
        """
        for i in range(WINDOW_SIZE - 1):
            r = record_verdict("relevance", passed=False, fingerprint=f"缺{i}号业务点")
            assert r is None, f"第 {i} 次就误报了：{r}"

    def test_放行时理由各不相同也不算重复自己(self):
        for i in range(WINDOW_SIZE - 1):
            assert record_verdict("evidence", passed=True, fingerprint=f"6/6@{i}") is None

    def test_一直放行同一个结论不算重复自己(self):
        """★ 2026-09-05 真机当场打脸的那一条。

        接上产线第一发就误报：「factoryTodo 连续 3 次给出同一个结论
        （pass:clear）」——首轮待办为空是**常态**，一道天天说"没欠账"的闸
        没有任何问题。grok 那两个入口本来就只在拒绝时调用，我图省事推广到
        两侧才招出这个误报。

        放行侧的退化是另一种形状（"从来没拦过"），归窗口一边倒管。
        """
        for _ in range(STREAK_THRESHOLD + 2):
            r = record_verdict("factoryTodo", passed=True, fingerprint="clear")
            assert r is None or r["reason"] != "GateRepeatingItself", (
                "一道一直说「没问题」的闸被扣上了「重复自己」的帽子"
            )

    def test_结论变了就重置连击(self):
        for _ in range(STREAK_THRESHOLD - 1):
            record_verdict("evidence", passed=False, fingerprint="0/6")
        record_verdict("evidence", passed=True, fingerprint="6/6")   # 变了
        assert record_verdict("evidence", passed=False, fingerprint="0/6") is None, (
            "中间明明出现过另一种结论，连击没被重置"
        )

    def test_同一个指纹但一边过一边拦_算两种结论(self):
        """pass/block 进指纹：同样的量化结果，一次过一次拦，不是"重复自己"。"""
        for _ in range(STREAK_THRESHOLD - 1):
            record_verdict("relevance", passed=False, fingerprint="0.5")
        assert record_verdict("relevance", passed=True, fingerprint="0.5") is None

    def test_同一个诊断只报一次_不刷屏(self):
        """30 次判定最多两条记录：重复自己 + 一边倒，各一次。

        同一个诊断反复刷屏，报警器就会被人关掉——那比没有报警器更糟。
        """
        got = [g for g in (record_verdict("evidence", passed=False, fingerprint="0/6")
                           for _ in range(30)) if g]
        reasons = [g["reason"] for g in got]
        assert reasons == ["GateRepeatingItself", "GateAlwaysBlocking"], reasons
        assert len(reasons) == len(set(reasons)), "同一个诊断报了不止一次"

    def test_各道闸各记各的(self):
        for _ in range(STREAK_THRESHOLD):
            record_verdict("evidence", passed=False, fingerprint="0/6")
        assert record_verdict("relevance", passed=False, fingerprint="别的") is None, (
            "闸之间串台了"
        )


class Test一边倒那一头:
    """指纹连击抓不到「永远放行」——放行时理由各不相同，指纹不会重复。
    那一头只能靠窗口内的一边倒程度。两条判据各管一头。"""

    def test_窗口内全放行会开口(self):
        rec = None
        for i in range(WINDOW_SIZE + 2):
            rec = record_verdict("someGate", passed=True, fingerprint=f"各不相同{i}") or rec
        assert rec is not None and rec["reason"] == "GateAlwaysPassing"
        assert "形同虚设" in rec["message"]

    def test_窗口内有过一次例外就不算一边倒(self):
        record_verdict("someGate", passed=False, fingerprint="拦了一次")
        for i in range(WINDOW_SIZE - 1):
            assert record_verdict("someGate", passed=True, fingerprint=f"x{i}") is None


class Test体检自己不许拖垮推演:
    def test_指纹是个怪东西也不炸(self):
        assert record_verdict("g", passed=False, fingerprint=None) is None or True

    def test_落盘失败不抛(self, monkeypatch):
        monkeypatch.setenv("SLIDERULE_GATE_HEALTH_DIR", "/proc/不可写的地方")
        for _ in range(STREAK_THRESHOLD):
            rec = record_verdict("evidence", passed=False, fingerprint="0/6")
        assert rec is not None, "落盘失败把整条报警吞了——记录可以丢，报警不能丢"

    def test_收尾那行人话(self):
        for _ in range(STREAK_THRESHOLD):
            record_verdict("evidence", passed=False, fingerprint="0/6")
        line = summary_line()
        assert "evidence" in line and "拦3/3" in line
        assert snapshot()[0]["tripped"] == ["GateRepeatingItself"]

    def test_没记过东西时收尾不打空行(self):
        assert summary_line() == ""


class Test接在真链路上:
    """§1：判据得证明它**在闭环判定那条路上被调用**，不是装在不通电的插座上。"""

    def test_闭环判定真的把三道闸都记了(self):
        """不 grep 标识符（那个词同时出现在注释里，变异之后照样绿——本仓踩过），
        改成**解析产线的 AST**，把 `_gate_record(...)` 的第一个实参逐个取出来。
        """
        import ast
        import inspect

        from services import v5_capability_executor as ex

        tree = ast.parse(inspect.getsource(ex))
        gates = set()
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call)
                    and getattr(node.func, "id", None) == "_gate_record"
                    and node.args
                    and isinstance(node.args[0], ast.Constant)):
                gates.add(node.args[0].value)
        assert {"evidence", "relevance", "factoryTodo"} <= gates, (
            f"闭环判定没把三道闸都记进体检，只记了：{sorted(gates)}"
        )

    def test_记在闭环判定那一段里_不是别处(self):
        """★ §1：光有调用不算数，得在**真跑的那条路**上。

        锚点用 `_stable_closure_hash`——闭环判定每一次都会算它（真机验过），
        体检必须排在它前面同一段里。
        """
        import inspect

        from services import v5_capability_executor as ex

        src = inspect.getsource(ex)
        # ⚠ 用 rindex：`_stable_closure_hash` 有**两处**调用，前一处在
        #   `build_fallback_blocked_closure`（E37 兜底），排在体检前面。
        #   用 index 会锚到那一处，判据红得莫名其妙——第一版就踩了。
        anchor = src.rindex("closure_hash, stable_digest = _stable_closure_hash")
        assert "_gate_record(" in src[:anchor], "体检没排在闭环判定算 hash 之前"
        assert src[:anchor].rindex("_gate_record(") > anchor - 3000, (
            "体检离闭环判定太远，多半装在了另一段（不通电的插座）"
        )

    def test_指纹里不许掺会话id(self):
        """★ 掺了每次都不一样，连击永远不触发——等于装了个不会响的报警器。

        ⚠ 这条第一版是切字符串切出来的，而 `closure_hash, stable_digest` 在
          文件里有**两处**，`index` 锚到了前面那处兜底函数，切出来的片段
          根本不含体检那几行——变异（把 sessionId 拌进指纹）之后判据照样绿。
          改成解析 AST，逐个取 `_gate_record(...)` 的 fingerprint 实参再看。
          （本仓第二条：判据必须能被变异咬住；切片锚点选错就是咬不住。）
        """
        import ast
        import inspect

        from services import v5_capability_executor as ex

        tree = ast.parse(inspect.getsource(ex))
        bad = []
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call)
                    and getattr(node.func, "id", None) == "_gate_record"):
                continue
            for kw in node.keywords:
                if kw.arg != "fingerprint":
                    continue
                text = ast.dump(kw.value)
                if "sessionId" in text or "session_id" in text:
                    bad.append(ast.unparse(kw.value))
        assert not bad, f"指纹里掺了会话 id，连击永远不触发：{bad}"


class Test记录要能回查:
    """「连续 3 次同一个结论」——是哪 3 次？拿不到会话就没法往下查。

    台账是**进程级**的（跨会话累计，那正是今天那 15 个会话该被抓住的方式），
    所以更需要这个：报警说的可能是三个不同会话里的同一句话。
    """

    def test_报警带着是哪几发(self):
        rec = None
        for sid in ("sr-A", "sr-B", "sr-C"):
            rec = record_verdict("evidence", passed=False, fingerprint="0/6",
                                 context=sid) or rec
        assert rec is not None
        assert rec["samples"] == ["sr-A", "sr-B", "sr-C"], rec.get("samples")

    def test_会话id不进指纹(self):
        """★ 反向配对，也是整件事的命门：进了指纹每次都不一样，连击永远不触发。"""
        for sid in ("sr-A", "sr-B", "sr-C", "sr-D"):
            r = record_verdict("evidence", passed=False, fingerprint="0/6", context=sid)
        assert r is None or True
        assert snapshot()[0]["streak"] >= STREAK_THRESHOLD, (
            "换了会话 id 连击就断了——说明它混进指纹了，报警器不会响"
        )

    def test_不给context也不炸(self):
        for _ in range(STREAK_THRESHOLD):
            rec = record_verdict("evidence", passed=False, fingerprint="0/6")
        assert rec is not None and rec.get("samples") == []


class Test读接口:
    """跑迭代批次时得能随时看见开火率——**三处迭代里有两处不产生 run**。

    ⚠ 2026-09-05：`summary_line()` 只挂在 `run_registry._finish` 上。会话迭代
      走 run，收尾会打；点选编辑和画布是直接 `PATCH /apps/{id}/pages/{pid}`，
      跑完不经过任何 run 收尾——那两处的 `pageEdit` 闸攒在进程台账里没人打印。
      于是加了 `GET /gate-health`。判据两头都要钉：**接口在**（正），
      **它跟收尾那行是同一个 snapshot**（负——另起一套口径就是 §4 的"只改一半"）。
    """

    def _route(self):
        import ast
        import inspect

        from routes import sliderule_full as rf

        tree = ast.parse(inspect.getsource(rf))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for dec in node.decorator_list:
                if (isinstance(dec, ast.Call)
                        and getattr(dec.func, "attr", "") == "get"
                        and dec.args
                        and isinstance(dec.args[0], ast.Constant)
                        and dec.args[0].value == "/gate-health"):
                    return node
        return None

    def test_有这条读接口(self):
        assert self._route() is not None, "GET /gate-health 没了——跑迭代时看不见开火率"

    def test_读接口走的是收尾那同一个snapshot(self):
        """★ 反向判据：不许自己再算一遍比率。

        自己算 = 两套口径，收尾说 3/10、接口说别的，下一个人查半天。
        """
        import ast

        node = self._route()
        assert node is not None
        called = {
            getattr(c.func, "id", None) or getattr(c.func, "attr", None)
            for c in ast.walk(node)
            if isinstance(c, ast.Call)
        }
        assert "_gate_snapshot" in called, "读接口没调 snapshot()，多半自己另算了一套"
        assert not any(
            isinstance(n, ast.BinOp) and isinstance(n.op, ast.Div)
            for n in ast.walk(node)
        ), "读接口里出现了除法——比率该由 snapshot/summary_line 一处说了算"

    def test_读接口没绕过鉴权(self):
        import ast

        node = self._route()
        assert node is not None
        assert any(
            isinstance(c, ast.Call) and getattr(c.func, "id", None) == "_auth"
            for c in ast.walk(node)
        ), "读接口没过 _auth"

    def test_收尾那行也还在(self):
        """§3 配对：接口有了不等于收尾那行还在。删掉收尾照样"有地方能看"，
        但跑批日志里就再也没有那一行了。"""
        import inspect

        from services import run_registry

        src = inspect.getsource(run_registry._finish)
        assert "summary_line()" in src, "跑批收尾不打开火率了"

    def test_空清单不许读成绿灯(self):
        """★ 台账是**进程内存**：uvicorn 一 reload 就归零。

        2026-09-05 真机：跑完一轮画布编辑去读开火率，拿到
        `{"gates": [], "line": ""}`——看着像「各道闸都没开过火，一切正常」，
        实情是我刚改过 python 文件、uvicorn 重启、台账清零。
        「还没判过任何东西」和「判过而且都放行了」在屏幕上长得一模一样，
        正是本仓最忌的那类。所以空清单必须自带「从什么时候开始记的」。
        """
        import ast

        node = self._route()
        assert node is not None
        src = ast.dump(node)
        assert "since" in src, "空清单没带记账起点——空会被读成绿灯"
        from services.gate_health import ledger_since

        assert ledger_since(), "记账起点是空的"

