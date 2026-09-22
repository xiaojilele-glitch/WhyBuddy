# -*- coding: utf-8 -*-
"""同轮的纯标量翻转必须真的落库（2026-09-04 真机，用户报的那条）。

## 事故

用户报：「为啥刷新页面，伴随式澄清会弹出来」。两趟真机（充电桩 sr-…WNDV86M153、
宠物寄养 sr-…NZ1Z98H07S）都复现，且**跑完静止后再刷新**照样弹——排除了"我量早了"。

给 `persistence._resolve_write_state` 打上落库探针后，一眼就看见了：

    in(lt=turn-1 conf=True)    prior(lt=turn-1 conf=False)        → 写回 False
    in(lt=turn-2 ph=awaiting)  prior(lt=turn-2 ph=orchestrating)  → 写回 orchestrating

`_resolve_write_state` 的同轮守卫要求「至少一个服务端集合有增长」才算真进展。
**纯标量翻转天生零增长**，于是这两笔一直在被静静丢掉，落库日志一个字不吭：

  · `assumptionsConfirmed` False→True：控制面在 forced hop 那段置位后 `_apersist`，
    而 `_handoff_factory` 只把 **sessionId** 交给工厂、工厂从库里重新加载
    ——库里那笔没落，工厂读回 False。刷新后同一张卡又摊出来。
  · `runtimePhase` orchestrating→awaiting：驱动器终端块连写 5 笔全被丢掉，
    会话在侧栏永远显示「推演中」（就是 finding4 的相位僵死）。
    ⚠ 顺带纠正一条我先前的判断：那不是"我中途关浏览器造成的"，也不止
    `GeneratorExit` 那一条路——**正常收尾这条路一样被丢**。

## 修法

守卫本来要防的是**客户端**回传的轮前快照。进程内的服务端写入手里拿的是活对象，
不存在"少了一截 committed 数据"。所以给它们把同轮判据从「有增长」放宽到
「没缩水」（`_collections_not_shrunk`），低轮次照旧挡住，客户端判据一个字没动。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from models.v5_state import V5SessionState
from services.persistence import _collections_not_shrunk, _resolve_write_state

_SVC = Path(__file__).resolve().parents[1] / "services"
_ROUTES = Path(__file__).resolve().parents[1] / "routes"


def _st(turn: str, *, phase: str, confirmed=None, artifacts=None, pages=0):
    sfp = {"pages": {f"p{i}": {"html": "x"} for i in range(pages)}}
    if confirmed is not None:
        sfp["assumptionsConfirmed"] = confirmed
    return V5SessionState(
        sessionId="sr-guard-1",
        goal={"text": "t"},
        lastTurnId=turn,
        runtimePhase=phase,
        specFirstPages=sfp,
        artifacts=[{"id": a, "kind": "note", "content": ""} for a in (artifacts or [])],
    )


class Test服务端同轮翻转会落库:
    def test_相位落回awaiting不许被丢(self):
        """这条红 = 会话在侧栏永远显示「推演中」。"""
        prior = _st("turn-2", phase="orchestrating", pages=5)
        inc = _st("turn-2", phase="awaiting", pages=5)
        out = _resolve_write_state(prior, inc, server_write=True)
        assert out.runtimePhase == "awaiting"

    def test_控制面无轮次的失败相位不许被丢(self):
        """⚠ 2026-09-21 真机 HKA1MC5142：控制面首轮 503，会话 lastTurnId
        仍是空。守卫 `if p_lt and i_lt` 不进，incoming 必须原样留下 failed。
        """
        prior = V5SessionState(
            sessionId="sr-guard-1",
            goal={"text": "t"},
            runtimePhase="idle",
        )
        inc = V5SessionState(
            sessionId="sr-guard-1",
            goal={"text": "t"},
            runtimePhase="failed",
            awaitReason="error",
            awaitDetail="llm_unavailable",
            controlTranscript=[{"kind": "canned", "text": "503"}],
        )
        out = _resolve_write_state(prior, inc, server_write=True)
        assert out.runtimePhase == "failed"
        assert out.awaitReason == "error"

    def test_假设确认置True不许被丢(self):
        """这条红 = 用户点了「确认继续」，刷新后同一张卡又摊回来。"""
        prior = _st("turn-1", phase="awaiting", confirmed=False)
        inc = _st("turn-1", phase="awaiting", confirmed=True)
        out = _resolve_write_state(prior, inc, server_write=True)
        assert (out.specFirstPages or {}).get("assumptionsConfirmed") is True

    def test_重起草SPEC时置False同样不许被丢(self):
        """⚠ 反向：只放行 False→True 会留下第二个坑——重新起草 SPEC 那一跳
        把 `assumptionsConfirmed` 置回 False，丢掉的话新假设卡永远不摊。
        """
        prior = _st("turn-3", phase="awaiting", confirmed=True)
        inc = _st("turn-3", phase="awaiting", confirmed=False)
        out = _resolve_write_state(prior, inc, server_write=True)
        assert (out.specFirstPages or {}).get("assumptionsConfirmed") is False

    def test_放行的是这一笔而不是把守卫拆了(self):
        """⚠ 反向：集合缩水（真丢了东西）的服务端写入照旧写回 prior。

        这条是「放宽到没缩水」之所以安全的全部理由——变异掉
        `_collections_not_shrunk` 的调用就会红。
        """
        prior = _st("turn-2", phase="orchestrating", artifacts=["a1", "a2"])
        inc = _st("turn-2", phase="awaiting", artifacts=["a1"])  # a2 没了
        out = _resolve_write_state(prior, inc, server_write=True)
        assert out.runtimePhase == "orchestrating", "缩水的快照被放进来了"
        assert {a.id for a in (out.artifacts or [])} == {"a1", "a2"}

    def test_低轮次的服务端写入照旧挡住(self):
        """⚠ 反向：真·陈旧（轮次更小）跟 server_write 无关，一律挡。"""
        prior = _st("turn-5", phase="awaiting", confirmed=True)
        inc = _st("turn-2", phase="orchestrating", confirmed=False)
        out = _resolve_write_state(prior, inc, server_write=True)
        assert out.runtimePhase == "awaiting"
        assert (out.specFirstPages or {}).get("assumptionsConfirmed") is True


class Test客户端那条判据一个字没动:
    def test_客户端同轮零增长仍然写回prior(self):
        """⚠ 反向：2026-08-27 那场事故（前端 catch 里 PUT 轮前快照，把刚问出来的
        澄清问题整组抹掉）靠的就是这条。放宽不许波及它。
        """
        prior = _st("turn-2", phase="orchestrating", pages=5)
        inc = _st("turn-2", phase="awaiting", pages=5)
        out = _resolve_write_state(prior, inc)  # 默认 server_write=False
        assert out.runtimePhase == "orchestrating"

    def test_客户端同轮有增长仍然放行(self):
        prior = _st("turn-2", phase="orchestrating", artifacts=["a1"])
        inc = _st("turn-2", phase="awaiting", artifacts=["a1", "a2"])
        out = _resolve_write_state(prior, inc)
        assert out.runtimePhase == "awaiting"


def _src_no_comments(path: Path) -> str:
    """⚠ 剥注释再匹配：本仓被抓到过「判据 grep 到的是文档字符串里那个词」。"""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Module)):
            body = getattr(node, "body", None)
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                body.pop(0)
    return ast.unparse(tree)


class Test接在真跑的那条路上:
    """CLAUDE.md §1：改之前先确认这条链真的在跑。判据钉住三个调用点。"""

    def test_驱动器的persist_state是服务端写(self):
        src = _src_no_comments(_SVC / "persistence.py")
        assert "save_session_record(state, server_write=True)" in src, (
            "persist_state 没标服务端写：驱动器终端块的相位又会被丢"
        )

    def test_控制面的_persist是服务端写(self):
        src = _src_no_comments(_SVC / "rehearsal_control.py")
        assert "save_session(state, server_write=True)" in src, (
            "控制面 _persist 没标服务端写：假设确认又落不进库"
        )

    def test_客户端PUT不许标服务端写(self):
        """⚠ 反向：路由那条是**客户端**回传，标上就等于把守卫拆了。"""
        src = _src_no_comments(_ROUTES / "sliderule_full.py")
        assert "server_write=True" not in src, (
            "客户端 PUT 被标成服务端写了"
        )

    def test_工厂只拿到sessionId所以必须落库(self):
        """这条钉住「为什么非落库不可」：工厂是从库里重新加载的。

        `_handoff_factory` 交给 `start_drive_full_factory_run` 的是
        `state.sessionId`，不是 state 对象——控制面在内存里置的位，
        不落库就等于没置。
        """
        tree = ast.parse((_SVC / "rehearsal_control.py").read_text(encoding="utf-8"))
        fn = next(
            n for n in ast.walk(tree)
            if isinstance(n, ast.AsyncFunctionDef) and n.name == "_handoff_factory"
        )
        calls = [
            n for n in ast.walk(fn)
            if isinstance(n, ast.Call)
            and "start_drive_full_factory_run" in ast.unparse(n.func)
        ]
        assert calls, "找不到点火调用"
        first = ast.unparse(calls[0].args[0]) if calls[0].args else ""
        assert first == "state.sessionId", (
            f"点火第一个参数变成了 {first!r}——若改成传 state 对象，"
            "本文件的落库判据就不再是这条链的必要条件了，请一起改注释"
        )


class Test拆出来的谓词本身:
    def test_没缩水就是没缩水(self):
        prior = _st("turn-1", phase="awaiting", artifacts=["a1"])
        assert _collections_not_shrunk(prior, _st("turn-1", phase="awaiting", artifacts=["a1"]))
        assert _collections_not_shrunk(
            prior, _st("turn-1", phase="awaiting", artifacts=["a1", "a2"])
        )
        assert not _collections_not_shrunk(prior, _st("turn-1", phase="awaiting"))
