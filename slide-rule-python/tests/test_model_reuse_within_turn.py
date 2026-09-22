# -*- coding: utf-8 -*-
"""本轮模型复用：第二次收口不该把整条生成链重跑一遍。

## 事故

2026-08-04 真跑：模型自己在多个 loop 里选了收口，MAX_REPEAT_PER_CAP=2 放行
两次。第二次收口时生成入口没有复用通道，从头再调一次 LLM 生成（13 万字），
拿到一份全新模型。而链路上那三道幂等保护——page.freeformOverview 已存在就
跳过、chartColors 已有就不重取、sheet_used 计数——检查的全是「model 内部
字段」，新模型上这些都是空，保护形同虚设。于是生图 100s + 取色 12s + 设计
100s 整套重跑，两张不同参照图取出两套不同配色（5 色 vs 4 色），后写覆盖
先写，第一遍 233 秒全废，占整轮 23.5 分钟的 14%。

**锁挂在门上，但每次来的是一扇新门。**

## 复用键的两个来源

- vercel/turborepo#4572「cache doesn't invalidate on change in dependent
  code」：缓存最大的坑不是没命中，是**影响输出的输入没进键**，于是改了
  东西还吃旧结果。→ goal 必须进键。
- Stripe 幂等键：同一个键配不同参数必须拒绝，而不是静默返回旧结果。
  → goalDigest 对不上时宁可重算。

作用域刻意收窄到单轮：跨轮复用会让「用户补充需求后仍拿旧模型」。
"""

import pytest

from models.v5_state import V5SessionState
from services.v5_full_driver import goal_digest, reusable_model_for_turn

GOAL = "给公司做一套请假审批系统：登记员工和假期余额、提交请假单、主管审批"

MODEL = {
    "datamodel": {"entities": [{"id": "employee", "name": "员工"}]},
    "page": {"pages": [{"id": "p1", "name": "我的请假单",
                        # 增强产物就在模型里——这正是复用能连生图一起省掉的原因
                        "freeformOverview": {"root": {"tag": "div"}}}]},
    "rbac": {}, "workflow": {}, "aigc": {},
    "appbundle": {"appIdentity": {"productName": "假期无忧",
                                  "chartColors": ["#2f7eea", "#ff9f1c"]}},
}


def _state(*, turn="turn-1", goal=GOAL, version_turn="turn-1",
           version_goal_digest=None, model=MODEL, with_version=True):
    st = V5SessionState(sessionId="s", goal={"text": goal})
    st.lastTurnId = turn
    if with_version:
        st.modelVersions = [{
            "id": "mv-1",
            "turnId": version_turn,
            "goalDigest": version_goal_digest if version_goal_digest is not None else goal_digest(st),
            "model": model,
        }]
    return st


class TestGoalDigest:
    def test_同一目标同一指纹(self):
        assert goal_digest(_state()) == goal_digest(_state())

    def test_目标不同指纹不同(self):
        assert goal_digest(_state()) != goal_digest(_state(goal="做个记账应用"))

    def test_首尾空白不影响(self):
        assert goal_digest(_state(goal=GOAL)) == goal_digest(_state(goal=f"  {GOAL}  "))


class TestReuseKey:
    def test_同轮同目标可复用(self):
        assert reusable_model_for_turn(_state()) == MODEL

    def test_换了一轮不复用(self):
        """跨轮复用会让「用户补充需求之后仍拿到旧模型」——turborepo 那个坑。"""
        assert reusable_model_for_turn(_state(turn="turn-2")) is None

    def test_目标变了不复用(self):
        st = _state()
        st.goal = {"text": "完全不同的需求：做一个社区团购系统"}
        assert reusable_model_for_turn(st) is None

    def test_旧快照没记指纹时不复用(self):
        """加 goalDigest 之前存下的版本没有这个字段——宁可重算，不赌。"""
        assert reusable_model_for_turn(_state(version_goal_digest="")) is None

    def test_没有历史版本不复用(self):
        assert reusable_model_for_turn(_state(with_version=False)) is None

    def test_没有_lastTurnId_不复用(self):
        st = _state()
        st.lastTurnId = None
        assert reusable_model_for_turn(st) is None

    @pytest.mark.parametrize("bad", [None, "字符串", 123, {"model": "不是字典"}])
    def test_快照形状不对不复用(self, bad):
        st = _state()
        st.modelVersions = [bad] if not isinstance(bad, dict) else [bad]
        assert reusable_model_for_turn(st) is None

    def test_复用的是最新一版(self):
        st = _state()
        newer = {**MODEL, "aigc": {"marker": "newer"}}
        st.modelVersions.append({
            "id": "mv-2", "turnId": "turn-1",
            "goalDigest": goal_digest(st), "model": newer,
        })
        assert reusable_model_for_turn(st) == newer


class TestSnapshotCarriesDigest:
    def test_记录版本时写入_goalDigest(self):
        """没有这个字段，复用键就缺了一半，等于 turborepo 那个坑。"""
        from services.v5_full_driver import record_model_version

        st = V5SessionState(sessionId="s", goal={"text": GOAL})
        st.lastTurnId = "turn-1"
        closure = {"perSkillEvidence": {
            k: {"modelSection": MODEL[k]}
            for k in ("datamodel", "workflow", "rbac", "page", "aigc", "appbundle")
        }}
        record_model_version(st, closure, "首次生成")
        assert len(st.modelVersions) == 1
        assert st.modelVersions[0]["goalDigest"] == goal_digest(st)
        # 存完立刻就能被复用——这正是第二次收口要走的路
        assert reusable_model_for_turn(st) is not None


class TestExecutorReuse:
    def test_命中复用时不调_LLM_生成(self, monkeypatch, capsys):
        import services.v5_capability_executor as ex

        called = {"n": 0}

        def _boom(*a, **k):
            called["n"] += 1
            return None

        monkeypatch.setattr(ex, "_try_llm_generate_evidence", _boom)
        st = _state()
        per_skill = ex._build_per_skill_evidence(st, False, GOAL)
        assert called["n"] == 0, "复用命中了却还去调 LLM 生成"
        # 六项证据都由复用模型铺齐
        assert all(per_skill[s].get("evidencePresent") for s in ex.REQUIRED_EVIDENCE_KEYS)
        assert "复用上一版" in capsys.readouterr().out

    def test_复用失败时照常走生成不被拖垮(self, monkeypatch):
        """复用是省时间的优化，它自己出问题绝不能把能正常生成的推演带崩。"""
        import services.v5_capability_executor as ex

        def _boom(state):
            raise RuntimeError("版本史读挂了")

        # ⚠ 2026-08-29：模型版本记账搬到了 services/model_versions（原来长在驱动器里，
        #   执行器要用就得反向 import，是最核心那对的循环依赖）。执行器现在向下取，
        #   patch 点跟着走——**patch 错模块不会报错，只会静静地测不到东西**。
        monkeypatch.setattr(
            "services.model_versions.reusable_model_for_turn", _boom
        )
        st = _state()
        assert ex._reuse_this_turn_model(st, {}) is False


class TestTrustedClosureDecision:
    def test_同轮同目标的可信闭环直接结束(self):
        """Temporal USE_EXISTING + LangGraph END：同一输入的成功闭环不再进 planning。"""
        from services import v5_full_driver as driver

        decide = getattr(driver, "trusted_closure_decision", None)
        assert callable(decide), "驱动还没有可信闭环的确定性终止边"

        st = _state()
        st.publishClosure = {
            "blocked": False,
            "evidencePresentCount": 6,
            "skillCount": 6,
            "perSkillEvidence": {
                key: {"evidencePresent": True, "modelSection": MODEL[key]}
                for key in ("datamodel", "workflow", "rbac", "page", "aigc", "appbundle")
            },
        }

        assert decide(st, GOAL, repair=False) == "end"

    def test_同步和流式驱动都在_planning_之前检查终止边(self):
        import inspect

        from services import v5_full_driver as driver

        src = inspect.getsource(driver)
        checks = src.split("if trusted_closure_decision(state, ui", 2)
        assert len(checks) == 3, "同步和流式驱动必须各有一条确定性终止边"
        for body in checks[1:]:
            planning_at = min(
                pos for pos in (
                    body.find("orchestrate_plan"),
                    body.find('yield {"type": "reasoning_step", "label": "planning"'),
                ) if pos >= 0
            )
            assert body.find('== "end"') < planning_at


# ── 这把锁得真的被合上（2026-08-05）──────────────────────────────
#
# 上面整组都绿，可 2026-08-05 真跑里复用**一次都没命中**：第二次收口老老实实
# 重跑了建模 200s + 生图 113s + 取色 14s + 设计 277s，一共 608 秒，占整轮 45%。
#
# 原因不在复用逻辑，在**没人往 modelVersions 里写**：record_model_version
# 原本只在驱动器循环**结束之后**调一次，循环里那份永远是空的，
# reusable_model_for_turn 每次都因为「没有历史版本」返回 None。
#
# 上面 TestReuseKey 全是手搓 state 喂进去的——测的是"拿到快照之后怎么判"，
# 测不到"快照压根没人写"。跟同一天查出的 publishClosure 那个 bug 一模一样：
# 该在循环里更新的状态写在了循环外，单元测试绿着，真机全废。


def _driver_source():
    import inspect

    from services import v5_full_driver

    return inspect.getsource(v5_full_driver)


class TestSnapshotIsRecordedInsideTheLoop:
    def test_收过口的那一轮当场记版本(self):
        """两条驱动路径都要记——bug 在状态写回的位置，跟走哪条驱动无关。"""
        src = _driver_source()
        assert src.count("record_model_version(state, _round_closure, user_instruction)") == 2

    def test_记版本紧跟着写回闭环(self):
        """两件事必须挨着做，而且同一个条件。

        分开写迟早只改一处——publishClosure 写回是 2026-08-05 补的，
        record_model_version 当时就漏在了循环外，隔了两行。
        """
        src = _driver_source()
        for block in src.split("state.publishClosure = _round_closure")[1:]:
            head = block[:600]
            assert "record_model_version" in head, (
                "写回闭环之后没有紧跟着记版本——复用锁又会读到空的 modelVersions"
            )
