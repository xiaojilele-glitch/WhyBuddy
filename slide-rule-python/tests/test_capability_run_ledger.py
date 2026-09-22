# -*- coding: utf-8 -*-
"""台账要说得出一次执行的结局、花了多久、是谁写的。

## 事故形态（不是某一次真机，是 6 个构造点的常态）

`CapabilityRun` 此前**说不出结局**：只有 `error`（有值 = 失败）和嵌在
`timing` 里的 `durationMs`。于是：

  * "成功" 和 "没人填 error" 长得一模一样；
  * `engine_scheduling.commit_artifact*` 那条路径压根没有 timing，一条
    没有耗时的记录和一条耗时丢了的记录也长得一模一样；
  * `slide_rule_trust` 为了挂 ledgerEntryId 造的空壳，跟一次真执行长得一样；
  * 两个路由构造点是 `append(CapabilityRun(...))` 之后再按
    **`capabilityRuns[-1]`** 打耗时补丁 —— 下标 -1 假定"我刚 append 的
    一定还在最后"，并发或中间插了别的记录就把耗时记到别人头上，且不报错。

## 抄的是 grok 的哪一处

`xai-tool-protocol/src/session_event.rs`：

    ToolCallCompleted {
        tool_call_id: String,
        tool_name: String,
        duration_ms: u64,
        outcome: ToolCallOutcome,
    }

    pub enum ToolCallOutcome {
        Success, Error, Cancelled,
        #[serde(other)] Unknown,
    }

配一条反向判据：

    #[test]
    fn turn_ended_missing_required_field_rejected() {
        let v = json!({ … /* missing "outcome" */ });
        assert!(serde_json::from_value::<SessionEvent>(v).is_err());
    }

**三件事一起搬**：四档枚举（不是布尔）、必填、以及"少一个字段就失败"的
反向判据。

## ⚠ "必填"落在写路径，不在 pydantic

`CapabilityRun` 是**持久化记录**。库里已有的每条都没有这三个字段，改成
pydantic required 的话读回来会 `invalid_session` → `_coerce_many` 把**整条
会话跳过**（persistence.py:370），症状是「会话从侧栏消失了」——`AwaitReason`
头上记着的那三次事故就是这个形状，本轮已经踩了第四次（`spec_assumption`）。

所以：
  * 模型层三个字段有默认值（`status="unknown"` 就是 grok 那个
    `#[serde(other)] Unknown` 的对应物，如实说"不知道"）；
  * 写路径走 `CapabilityRun.server_record(...)`，三个参数 keyword-only
    且**无默认值** —— 漏一个是 TypeError；
  * 本文件最后那条扫全仓的判据禁止生产代码直接 `CapabilityRun(...)`。
    **这条才是防"加第 7 个构造点又忘填"的闸**（本仓第四条：只改一部分
    不报错、只有一部分不生效）。
"""

from __future__ import annotations

import ast
import pathlib

import pytest

from models.v5_state import CapabilityRun

PY_ROOT = pathlib.Path(__file__).parent.parent
#: 允许直接 `CapabilityRun(...)` 的地方：模型自己（`server_record` 里那一次
#: `cls(...)` 是本体）、以及持久化读回路径（历史记录没有那三个字段，
#: 读回来**必须**能用普通构造）。
_DIRECT_OK = {
    pathlib.Path("models/v5_state.py"),
}


def _production_py_files():
    for p in sorted(PY_ROOT.rglob("*.py")):
        parts = p.relative_to(PY_ROOT).parts
        if parts[0] in ("tests", ".venv", "__pycache__"):
            continue
        if "__pycache__" in parts:
            continue
        yield p


# ── 结局是四档枚举，不是布尔 ──────────────────────────────────────────
class Test结局:
    def test_四档跟grok的ToolCallOutcome一一对应(self):
        from models.v5_state import CapabilityRunStatus

        assert set(CapabilityRunStatus.__args__) == {
            "success",
            "error",
            "cancelled",
            "unknown",
        }, "词表漂了。四档对应 grok ToolCallOutcome 的 Success/Error/Cancelled/Unknown"

    def test_不许写没申报的结局(self):
        """变异：把 status 的类型从 Literal 改成 str → 本条红。"""
        with pytest.raises(Exception):
            CapabilityRun(
                id="r", capabilityId="c", turnId="t", status="没这一档"  # type: ignore[arg-type]
            )

    def test_默认是unknown而不是success(self):
        """⚠ 这一条是整件事的要害。默认 success 等于**替所有没填的记录撒谎**，
        而"没填"恰恰是此前 6 个构造点的常态。

        grok 的对应物是 `#[serde(other)] Unknown`：不知道就说不知道。
        """
        run = CapabilityRun(id="r", capabilityId="c", turnId="t")
        assert run.status == "unknown"
        assert run.durationMs is None
        assert run.provenance is None

    def test_老记录读回来不许报错(self):
        """库里每条历史记录都没有这三个字段。读不回来 → `_coerce_many` 把整条
        会话跳过 →「会话从侧栏消失了」。

        变异：把三个字段改成 pydantic required → 本条红。
        """
        old = {
            "id": "run-old",
            "capabilityId": "evidence.search",
            "turnId": "t0",
            "inputs": [],
            "outputs": ["a0"],
            "gateResults": [],
        }
        run = CapabilityRun(**old)
        assert run.status == "unknown", "老记录必须如实是 unknown，不是 success"


# ── 写路径三个字段必填 ────────────────────────────────────────────────
class Test写路径必填:
    @pytest.mark.parametrize("missing", ["status", "durationMs", "provenance"])
    def test_少任何一个都是TypeError(self, missing):
        """对应 grok 的 `turn_ended_missing_required_field_rejected`。

        变异：给 `server_record` 的任一参数加默认值 → 对应那档红。
        """
        kwargs = dict(
            status="success",
            durationMs=120,
            provenance="test.fixture",
            id="r",
            capabilityId="c",
            turnId="t",
        )
        kwargs.pop(missing)
        with pytest.raises(TypeError):
            CapabilityRun.server_record(**kwargs)  # type: ignore[arg-type]

    def test_三个都给就写得出来(self):
        run = CapabilityRun.server_record(
            status="error",
            durationMs=250,
            provenance="scheduling.error",
            id="r-1",
            capabilityId="risk.analyze",
            turnId="t-1",
            error={"code": "boom"},
        )
        assert run.status == "error"
        assert run.durationMs == 250
        assert run.provenance == "scheduling.error"

    def test_durationMs允许显式None但不许省略(self):
        """`scheduling.commit` 那条路径**真的没有计时**。逼它编一个 0 更糟：
        0 会被读成"这一步不花时间"。

        但省略不行 —— 显式 `None` 是一次有意识的声明，省略是忘了。
        """
        run = CapabilityRun.server_record(
            status="success",
            durationMs=None,
            provenance="scheduling.commit",
            id="r-2",
            capabilityId="evidence.search",
            turnId="t-2",
        )
        assert run.durationMs is None
        assert run.timing is None, "没有耗时就别造一个空 timing 出来"

    def test_顶层耗时与timing两处对齐(self):
        """两处书写、一处填。老读者取 `timing.durationMs`，新读者取顶层，
        不许出现两个不同的数。

        变异：去掉 `timing.setdefault("durationMs", …)` → 本条红。
        """
        run = CapabilityRun.server_record(
            status="success",
            durationMs=999,
            provenance="executor.run",
            id="r-3",
            capabilityId="report.write",
            turnId="t-3",
            timing={"startedAt": "2026-09-06T00:00:00Z"},
        )
        assert run.durationMs == 999
        assert (run.timing or {})["durationMs"] == 999
        assert (run.timing or {})["startedAt"] == "2026-09-06T00:00:00Z", (
            "对齐耗时的时候把调用方给的 timing 其它字段冲掉了"
        )

    def test_只给timing也把顶层补上(self):
        """反向也要对齐：调用方只给 timing 时顶层不许空着，否则按顶层字段
        做统计的人会数出一堆 0。"""
        run = CapabilityRun.server_record(
            status="success",
            durationMs=None,
            provenance="executor.run",
            id="r-4",
            capabilityId="report.write",
            turnId="t-4",
            timing={"durationMs": 42},
        )
        assert run.durationMs == 42

    def test_不许写没申报的来源(self):
        with pytest.raises(Exception):
            CapabilityRun.server_record(
                status="success",
                durationMs=1,
                provenance="随便写的",  # type: ignore[arg-type]
                id="r-5",
                capabilityId="c",
                turnId="t",
            )


# ── 这条才是真正的闸：不许绕过工厂 ────────────────────────────────────
class Test全仓构造点:
    def test_生产代码不许直接构造CapabilityRun(self):
        """**防"加第 7 个构造点又忘填"。**

        本仓第四条：只改一部分不报错、只有一部分不生效。台账三格如果靠
        "记得在 6 个地方都填"，第 7 个构造点出现的那天它就静默失效了 ——
        而失效的表现是"台账里有几条 unknown"，没有人会注意到。

        变异：把任一生产构造点改回 `CapabilityRun(...)` → 本条红并指名道姓。
        """
        offenders = []
        for path in _production_py_files():
            rel = path.relative_to(PY_ROOT)
            if rel in _DIRECT_OK:
                continue
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            except SyntaxError as exc:  # pragma: no cover — 语法坏了另有判据管
                pytest.fail(f"{rel} 语法错误：{exc}")
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and node.func.id == "CapabilityRun"
                ):
                    offenders.append(f"{rel}:{node.lineno}")
        assert not offenders, (
            "这些地方直接构造了 CapabilityRun，绕过了 server_record 的必填检查："
            + ", ".join(offenders)
            + "。台账三格（status / durationMs / provenance）会静默变成 unknown/None。"
        )

    def test_判据自己没打空(self):
        """扫到的 `server_record(` 调用点必须真的存在。

        没有这一条的话，把全部构造点删干净也能让上面那条绿 —— 一个空判据。
        """
        found = []
        for path in _production_py_files():
            src = path.read_text(encoding="utf-8")
            if "CapabilityRun.server_record(" in src:
                found.append(path.relative_to(PY_ROOT).as_posix())
        assert len(found) >= 5, f"生产侧 server_record 调用点只量到 {found}"

    def test_ledger空壳如实报unknown(self):
        """⚠ 这一条是行为判据，不是形状判据。

        `slide_rule_trust` 为了挂 ledgerEntryId 会造一条空壳记录 —— 真正那次
        执行**没在台账里留下记录**，它的结局这条路径确实不知道。谎称 success
        的后果是台账里凭空多出一条"成功执行"，而它对应的执行根本没被观测到。

        抄 grok `ToolCallOutcome` 的 `#[serde(other)] Unknown`：不知道就说不
        知道。变异：把这里的 `status="unknown"` 改成 `"success"` → 本条红。
        """
        from models.v5_state import Artifact, ProducedBy, V5SessionState
        from services.slide_rule_trust import record_provenance_and_trust_ledger

        state = V5SessionState(
            sessionId="s-stub",
            goal={"text": "台账空壳"},
            artifacts=[],
            capabilityRuns=[],
        )
        art = Artifact.server_construct(
            id="a-stub",
            content="x",
            trustLevel="untrusted",
            producedBy=ProducedBy(
                capabilityRunId="run-never-recorded", capabilityId="evidence.search"
            ),
        )
        record_provenance_and_trust_ledger(state=state, artifact=art)

        stub = [r for r in state.capabilityRuns if r.id == "run-never-recorded"]
        assert stub, "空壳记录没造出来 —— 判据自己打空了"
        assert stub[0].status == "unknown", (
            "为挂 ledgerEntryId 造的空壳谎称了结局。那次执行没被观测到，"
            f"不许说成 {stub[0].status}"
        )
        assert stub[0].provenance == "trust.ledger_stub"
        assert stub[0].durationMs is None

    def test_每个来源都真的有人用(self):
        """申报了却没人用的档位说明词表和现实漂了。

        `test.fixture` 例外：它是给测试和脚本留的，生产代码里本来就不该出现。
        """
        from models.v5_state import CapabilityRunProvenance

        declared = set(CapabilityRunProvenance.__args__) - {"test.fixture"}
        used = set()
        for path in _production_py_files():
            src = path.read_text(encoding="utf-8")
            for name in declared:
                if f'provenance="{name}"' in src:
                    used.add(name)
        assert used == declared, (
            f"申报了但生产代码里没人写的来源：{sorted(declared - used)}；"
            f"（反过来也查：写了但没申报的会被 pydantic 当场拦下）"
        )


# ── 第二轮真机：顶层 durationMs 从落地第一天就是死的 ──────────────────
#
# 上一轮给 CapabilityRun 加了顶层 durationMs，`server_record()` 里也做了与
# timing 的双向对齐。真机跑完一看，**13 行台账的顶层 durationMs 全是 None**，
# 而 timing.durationMs 全都有值：
#
#     evidence.search   顶层=None  timing.durationMs=9477
#     factory.pages     顶层=None  timing.durationMs=219510
#
# 因为主路径上耗时不是**建记录时**给的，是**跑完之后**打在已有记录上的，
# 一共五处（v5_full_driver 三处、slide_rule_session 两处），形状都是
# `last.timing = {"durationMs": dur}`。它们绕过了工厂。
#
# 这是本仓第四条的又一次现形：**加字段的时候只改了「创建」那一半，
# 「更新」那一半在别处。** 判据分两层：
#   · 行为层：stamp_run_timing 必须两处一起写
#   · 接线层：扫全仓，不许再有绕过它的裸赋值


class Test补耗时:
    def test_两处一起写(self):
        """顶层 durationMs 与 timing.durationMs 必须同时落。

        变异：去掉 `run.durationMs = int(durationMs)` → 本条红。
        """
        from models.v5_state import stamp_run_timing

        run = CapabilityRun.server_record(
            status="success", durationMs=None, provenance="test.fixture",
            id="r-stamp", capabilityId="evidence.search", turnId="t",
        )
        assert run.durationMs is None and run.timing is None

        stamp_run_timing(run, durationMs=9477, parallel=True)
        assert run.durationMs == 9477, "顶层没写 —— 真机那 13 行全 None 就是这个"
        assert (run.timing or {})["durationMs"] == 9477
        assert (run.timing or {})["parallel"] is True

    def test_裸dict也认(self):
        """台账在库里可能是历史裸 dict。五处补丁点原来各自手写
        `hasattr / isinstance` 分叉，收进来一处。"""
        from models.v5_state import stamp_run_timing

        row = {"id": "r", "capabilityId": "c", "turnId": "t"}
        stamp_run_timing(row, durationMs=1234)
        assert row["durationMs"] == 1234
        assert row["timing"]["durationMs"] == 1234

    def test_不覆盖已有的timing其它字段(self):
        """合并而不是整块替换 —— 原来那五处是直接赋一个新字典，
        谁先写的 startedAt 会被后写的抹掉。"""
        from models.v5_state import stamp_run_timing

        run = CapabilityRun.server_record(
            status="success", durationMs=None, provenance="test.fixture",
            id="r2", capabilityId="c", turnId="t",
            timing={"startedAt": "2026-09-06T00:00:00Z"},
        )
        stamp_run_timing(run, durationMs=42)
        assert (run.timing or {})["startedAt"] == "2026-09-06T00:00:00Z"
        assert (run.timing or {})["durationMs"] == 42

    def test_没耗时就不往timing里塞None(self):
        """`durationMs=None` 是合法的（有些路径真的没计时）。
        塞一个 None 进 timing 等于拿空值冒充测量值。"""
        from models.v5_state import stamp_run_timing

        run = CapabilityRun.server_record(
            status="success", durationMs=None, provenance="test.fixture",
            id="r3", capabilityId="c", turnId="t",
        )
        stamp_run_timing(run, durationMs=None)
        assert run.durationMs is None
        assert run.timing is None, "凭空造了一个 timing 出来"

    def test_自己炸了不许拖垮已经跑完的一轮(self):
        """补耗时是观测项（本仓第七条：增强类 fail-open）。"""
        from models.v5_state import stamp_run_timing

        class _Hostile:
            @property
            def timing(self):
                raise RuntimeError("炸了")

        stamp_run_timing(_Hostile(), durationMs=1)   # 不许抛
        stamp_run_timing(None, durationMs=1)

    def test_生产代码不许绕过它裸赋timing(self):
        """★ 这条才是防「加第六处补丁点又忘了顶层」的闸。

        变异：把任一处改回 `last.timing = {...}` → 本条红并指名道姓。
        """
        import re

        offenders = []
        for path in _production_py_files():
            rel = path.relative_to(PY_ROOT)
            if rel == pathlib.Path("models/v5_state.py"):
                continue          # 本体在这儿
            for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                stripped = line.split("#", 1)[0]
                if re.search(r"\.timing\s*=\s*\{", stripped) or re.search(
                    r"\[[\"']timing[\"']\]\s*=\s*\{", stripped
                ):
                    offenders.append(f"{rel.as_posix()}:{i}")
        assert not offenders, (
            "这些地方绕过 stamp_run_timing 直接赋 timing，顶层 durationMs 会静默留空："
            + ", ".join(offenders)
        )

    def test_判据自己没打空(self):
        found = [
            p.relative_to(PY_ROOT).as_posix()
            for p in _production_py_files()
            if "_stamp_run_timing(" in p.read_text(encoding="utf-8")
        ]
        assert len(found) >= 2, f"生产侧 stamp_run_timing 调用点只量到 {found}"
