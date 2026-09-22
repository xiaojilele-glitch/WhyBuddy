"""模型快照在**过闸那一刻**就落地，不等它变成完整闭环（2026-08-09）。

## 起因：725 秒买了一份已经有的东西

线上一趟真跑（黑灰产情报自动化分析系统，22 分 52 秒）的会话状态里：

    reasoningEvents  loop-1 wallMs=387713（含收口）
                     loop-2 wallMs=370341（含收口）
                     loop-3 wallMs=354975（含收口）
    modelVersions    只有 1 条，createdAt = 18:38:31 —— 最后一轮结束那一刻
    产物             art-1/2/3-appbundle.runtimeClosure 各 3089 字节，**字节完全相同**

后两轮 725 秒（占全程 55%）重新生成出了与第一轮一模一样的东西。三次
`[enrich-timing] model.generate` 分别烧掉 172.6 / 208.7 / 165.8 秒。

`_reuse_this_turn_model` 那把锁本来就是治这个的，但它读 `modelVersions`，
而当时唯一的写入口 `record_model_version` 要求闭环 perSkillEvidence 六段齐全
（`extract_model_from_closure` 缺一段返回 None）。轮次没走到完整闭环 →
一条都不记 → 下一轮读到空 → 全价重来。

**最贵的产物只在最便宜的条件满足时才进缓存。** 锁在最需要它的场景里用不上。
"""

import pytest

from models.v5_state import V5SessionState
from services.v5_full_driver import (
    goal_digest,
    record_model_snapshot,
    reusable_model_for_turn,
)

SECTIONS = ("datamodel", "rbac", "workflow", "page", "aigc", "appbundle")


def _model(tag: str = "v1") -> dict:
    return {s: {"id": s, "tag": tag} for s in SECTIONS}


def _state(turn: str = "turn-1") -> V5SessionState:
    st = V5SessionState(
        sessionId="s-1",
        goal={"text": "黑灰产情报自动化分析系统", "status": "clear"},
        ownerId="u-1",
    )
    st.lastTurnId = turn
    return st


class Test记快照:
    def test_直接记一份模型_不经过闭环(self):
        st = _state()
        record_model_snapshot(st, _model(), "黑灰产情报自动化分析系统")
        assert len(st.modelVersions) == 1
        assert st.modelVersions[0]["model"] == _model()
        assert st.modelVersions[0]["turnId"] == "turn-1"
        assert st.modelVersions[0]["goalDigest"] == goal_digest(st)

    def test_记完就能被复用锁读到(self):
        # 这条是整件事的目的：下一轮不必重新生成
        st = _state()
        assert reusable_model_for_turn(st) is None
        record_model_snapshot(st, _model(), "目标")
        assert reusable_model_for_turn(st) == _model()

    def test_模型没变不追加新版本(self):
        st = _state()
        record_model_snapshot(st, _model(), "目标")
        record_model_snapshot(st, _model(), "目标")
        assert len(st.modelVersions) == 1, "同一份模型记两遍不该产生两个版本"

    def test_同轮模型变了_替换队尾不追加(self):
        """★ 2026-08-18 步伴真机：同一轮两遍 spec-first（第一遍 p2 被 525 打掉、
        第二遍补全）产出两份不同模型，旧逻辑追加成 mv-2/mv-3 同挂一个 turnId。
        前端刷新回放按「一轮=一个气泡」铺消息，两条同轮版本 = 两个同 id 气泡，
        assistant-ui MessageRepository 抛错整页白屏。同轮第二份 = 该轮最终产物，
        **就地替换队尾**：id 不变、模型换新、指令刷新。"""
        st = _state()
        record_model_snapshot(st, _model("v1"), "第一遍（残次）")
        record_model_snapshot(st, _model("v2"), "第二遍（补全）")
        assert [v["id"] for v in st.modelVersions] == ["mv-1"], \
            "同轮第二份模型追加了新版本——刷新回放会撞出两个同 id 气泡"
        assert st.modelVersions[0]["model"] == _model("v2"), "替换后队尾必须是新模型"
        assert st.modelVersions[0]["instruction"] == "第二遍（补全）"
        assert st.currentModelVersionId == "mv-1"
        # 复用锁读的是队尾——替换后拿到的必须是最新那份
        assert reusable_model_for_turn(st) == _model("v2")

    def test_换轮模型变了才追加(self):
        # 反向配对：跨轮才是新版本。只有上面那条没有这条 = 版本史再也长不大。
        st = _state("turn-1")
        record_model_snapshot(st, _model("v1"), "首轮")
        st.lastTurnId = "turn-2"
        record_model_snapshot(st, _model("v2"), "第二轮")
        assert [v["id"] for v in st.modelVersions] == ["mv-1", "mv-2"]
        assert st.currentModelVersionId == "mv-2"

    def test_没有turnId时同轮替换不生效_照旧追加(self):
        # 旧会话/测试夹具可能没有 lastTurnId——空 turnId 判不了"同轮"，
        # 宁可多存也不许把两轮误合成一轮。
        st = V5SessionState(sessionId="s-1", goal={"text": "g"})
        record_model_snapshot(st, _model("v1"), "a")
        record_model_snapshot(st, _model("v2"), "b")
        assert len(st.modelVersions) == 2

    def test_空模型不记(self):
        st = _state()
        record_model_snapshot(st, {}, "目标")
        record_model_snapshot(st, None, "目标")  # type: ignore[arg-type]
        assert st.modelVersions == []

    def test_目标变了就不复用(self):
        # 复用键的另一半（turborepo#4572 的教训：影响输出的输入必须进键）
        st = _state()
        record_model_snapshot(st, _model(), "目标")
        st.goal = {"text": "换了个完全不同的目标"}
        assert reusable_model_for_turn(st) is None

    def test_换轮次就不复用(self):
        st = _state()
        record_model_snapshot(st, _model(), "目标")
        st.lastTurnId = "turn-2"
        assert reusable_model_for_turn(st) is None


class Test页面也进比较键:
    """★ 2026-08-18 烘焙店真机：精修加「临期预警」列，六段 model 字节全没变
    （rbac/workflow/aigc 沿用、实体角色没动），**只有页面 HTML 变了**。
    `last == model` 只看模型 → 判"没变"跳过 → 版本不涨（预览停在 v3）、
    同轮复用锁合不上 → 外圈第二遍全价重跑。turborepo#4572 的原型坑：
    影响输出的输入没进比较键。

    页面从请求域暂存 peek（spec_first_pipeline._last_pages_var）。
    """

    @staticmethod
    def _pages(tag: str) -> dict:
        return {
            "version": "spec-first-pipeline-v1",
            "pages": {"order_workbench": f"<html>{tag}</html>"},
            "navItems": [{"id": "order_workbench", "name": "订货台"}],
        }

    @pytest.fixture(autouse=True)
    def _clean_stash(self):
        from services.spec_first_pipeline import _last_pages_var

        token = _last_pages_var.set(None)
        yield
        _last_pages_var.reset(token)

    def _seed(self, pages) -> None:
        from services.spec_first_pipeline import _last_pages_var

        _last_pages_var.set(pages)

    def test_只改页面不改模型_也要涨版本(self):
        st = _state("turn-1")
        self._seed(self._pages("旧"))
        record_model_snapshot(st, _model(), "首轮")
        st.lastTurnId = "turn-2"
        self._seed(self._pages("加了临期预警列"))
        record_model_snapshot(st, _model(), "订货工作台加临期预警列")
        assert len(st.modelVersions) == 2, \
            "页面变了模型没变 → 没记版本：预览停在旧页、复用锁合不上、外圈第二遍全价重跑"
        tail = st.modelVersions[-1]
        assert tail["turnId"] == "turn-2"
        assert tail["instruction"] == "订货工作台加临期预警列"
        assert tail["specFirstPages"] == self._pages("加了临期预警列")
        # 整件事的目的：同轮锁当场合上，第二次收口直接复用
        assert reusable_model_for_turn(st) == _model()

    def test_页面模型都没变_照旧不追加(self):
        # 反向配对：判据必须能分辨"真没变"。没有这条，上面那条也可以靠
        # "无脑每次都追加"变绿——版本史会被回放/重试灌爆。
        st = _state("turn-1")
        self._seed(self._pages("同一份"))
        record_model_snapshot(st, _model(), "首轮")
        st.lastTurnId = "turn-2"
        self._seed(self._pages("同一份"))
        record_model_snapshot(st, _model(), "第二轮")
        assert len(st.modelVersions) == 1, "页面模型都没变还追加——版本史膨胀"
        assert st.currentModelVersionId == st.modelVersions[0]["id"]

    def test_暂存为空_页面维度不参与判定(self):
        # 回落老链路/纯模型轮：暂存是空的（take 语义 + 只在整链跑成时写入），
        # 此时行为必须与旧版逐字一致——模型没变就不追加。
        st = _state("turn-1")
        record_model_snapshot(st, _model(), "首轮")
        st.lastTurnId = "turn-2"
        record_model_snapshot(st, _model(), "第二轮")
        assert len(st.modelVersions) == 1

    def test_同轮只改页面_替换队尾不追加(self):
        # 与「同轮模型变了_替换队尾不追加」同一条纪律：同轮第二份是该轮
        # 最终产物，就地替换——追加会撞出两个同 id 气泡（P0 白屏的形状）。
        st = _state("turn-1")
        self._seed(self._pages("第一遍"))
        record_model_snapshot(st, _model(), "第一遍")
        self._seed(self._pages("第二遍补全"))
        record_model_snapshot(st, _model(), "第二遍")
        assert [v["id"] for v in st.modelVersions] == ["mv-1"]
        assert st.modelVersions[0]["specFirstPages"] == self._pages("第二遍补全")
        assert st.modelVersions[0]["instruction"] == "第二遍"

    def test_追加时页面取本轮暂存_不取上一轮残留(self):
        # 此调用点在 _cache_spec_first_pages 之前，state.specFirstPages 还是
        # 上一轮的旧页——直接存它就是"新模型配旧页"（东西看着在，其实是旧的）。
        st = _state("turn-2")
        st.specFirstPages = self._pages("上一轮残留")
        self._seed(self._pages("本轮新画"))
        record_model_snapshot(st, _model("v2"), "本轮")
        assert st.modelVersions[-1]["specFirstPages"] == self._pages("本轮新画")


class Test过闸即缓存:
    """写入侧接线：`_try_llm_generate_evidence` 一返回就该记上。"""

    @staticmethod
    def _llm_result(tag: str = "v1") -> dict:
        return {
            s: {"id": f"llm-linkage-{s}", "_model_section": {"id": s, "tag": tag}}
            for s in SECTIONS
        }

    def test_从_llm_result_拼回模型并记上(self):
        from services.v5_capability_executor import _cache_gate_passed_model

        st = _state()
        _cache_gate_passed_model(st, self._llm_result(), "黑灰产情报自动化分析系统")
        assert len(st.modelVersions) == 1
        assert st.modelVersions[0]["model"] == _model()
        # 记完立刻可复用 —— 下一轮的收口不必再生成一遍
        assert reusable_model_for_turn(st) == _model()

    def test_缺段就不记(self):
        # 半份模型复用出去比不复用更糟：下游按六段齐全假设读
        from services.v5_capability_executor import _cache_gate_passed_model

        st = _state()
        broken = self._llm_result()
        broken["rbac"].pop("_model_section")
        _cache_gate_passed_model(st, broken, "目标")
        assert st.modelVersions == []

    def test_自己出问题不能把推演带崩(self, capsys):
        from services.v5_capability_executor import _cache_gate_passed_model

        class _Boom:
            @property
            def modelVersions(self):
                raise RuntimeError("状态炸了")

        _cache_gate_passed_model(_Boom(), self._llm_result(), "目标")  # type: ignore[arg-type]
        assert "模型快照记录跳过" in capsys.readouterr().out

    def test_两条写入路径记的是同一种东西(self):
        """闭环那条路与过闸那条路，存进去的必须是同一份模型。

        否则复用锁会在两条路之间抖：一条存增强前、一条存增强后，
        命中与否取决于上一轮走的是哪条。
        """
        from services.v5_capability_executor import _cache_gate_passed_model
        from services.v5_full_driver import record_model_version

        via_gate = _state()
        _cache_gate_passed_model(via_gate, self._llm_result(), "目标")

        via_closure = _state()
        closure = {
            "perSkillEvidence": {
                s: {"modelSection": {"id": s, "tag": "v1"}} for s in SECTIONS
            }
        }
        record_model_version(via_closure, closure, "目标")

        assert via_gate.modelVersions[0]["model"] == via_closure.modelVersions[0]["model"]


class Test接线:
    """判据对 ≠ 接线对：上面那些直接调 helper 的测试，把调用点删掉照样全绿。

    所以这一条走真实路径 `_build_per_skill_evidence`，只断言一件事：
    模型过闸之后，`state.modelVersions` 里必须有东西。
    """

    @pytest.fixture
    def gate_passes(self, monkeypatch):
        import services.v5_capability_executor as ex
        import services.v5_llm_generate as gen_mod
        import services.v5_model_gate as gate_mod

        model = _model()
        monkeypatch.setattr(ex, "_llm_generate_enabled", lambda: True)
        # 活路径是 spec-first。只钉 GEN5 会在「新链路挂了不回落」之后假绿/假红。
        monkeypatch.setattr(
            "services.spec_first_pipeline.run_spec_first",
            lambda goal, **k: {"model": dict(model)},
        )
        monkeypatch.setattr(
            gen_mod, "generate_five_system_model",
            lambda goal, llm_json_fn=None, gate_feedback=None: dict(model),
        )
        monkeypatch.setattr(
            gate_mod, "validate_five_system_model",
            lambda m, **kw: {"passed": True, "findings": []},
        )
        # 增强两段与确定性修复都短路：本条只测"过闸之后有没有记快照"
        monkeypatch.setattr("services.v5_model_repair.repair_five_system_model", lambda m: {"model": m})
        monkeypatch.setattr("services.freeform_block.enrich_freeform_blocks", lambda m: m)
        monkeypatch.setattr(
            "services.freeform_block.enrich_monitor_page_overviews",
            lambda m, preview_sink=None: m,
        )
        monkeypatch.setattr("services.device_policy.normalize_model_preferred_device", lambda g, m: m)
        return model

    def test_过闸之后状态里就有可复用的模型(self, gate_passes):
        from services.v5_capability_executor import _build_per_skill_evidence

        st = _state()
        assert st.modelVersions == []
        _build_per_skill_evidence(st, blocked_signal=False, goal=st.goal["text"])
        assert st.modelVersions, "过闸了却没记快照 —— 下一轮会全价重新生成一遍"
        assert reusable_model_for_turn(st) == gate_passes

    def test_精修轮同轮第二次收口_直接复用不再生成(self, gate_passes, monkeypatch):
        """★ 2026-08-18 烘焙店真机：第一遍 spec-first 局部打孔成功后，外圈
        又放行了一次收口；第二遍生成撞 525 → 回落老链路 GEN5 整份重画，把
        第一遍"只重画 1 页"的产物冲掉。精修分支此前**从不问**同轮复用锁
        （文档还写着"精修在走到这里之前就分流了"），锁形同虚设。

        判据走真实 _build_per_skill_evidence：本轮已有快照时，生成入口
        一次都不许被调。
        """
        import services.v5_capability_executor as ex
        from services.v5_capability_executor import _build_per_skill_evidence
        from services.v5_llm_generate import set_refine_context

        st = _state()
        record_model_snapshot(st, _model("refined"), "本轮精修指令")
        assert reusable_model_for_turn(st) == _model("refined"), "前置：锁必须已合上"

        calls = []
        monkeypatch.setattr(
            ex, "_try_llm_generate_evidence",
            lambda *a, **kw: calls.append(1) or None,
        )
        set_refine_context(_model("prev"), "本轮精修指令")
        try:
            matches = _build_per_skill_evidence(
                st, blocked_signal=False, goal=st.goal["text"]
            )
        finally:
            set_refine_context(None)
        assert calls == [], "同轮已有快照，第二次收口仍去重新生成——GEN5 覆盖事故的入口"
        for skill in SECTIONS:
            assert skill in matches, f"复用命中后证据没铺上 {skill}"

    def test_精修轮第一次收口_没有快照照常生成(self, gate_passes, monkeypatch):
        # 反向配对：锁没合上（本轮还没产物）时精修必须照常生成，
        # 否则精修永远吃上一轮的旧模型。
        import services.v5_capability_executor as ex
        from services.v5_capability_executor import _build_per_skill_evidence
        from services.v5_llm_generate import set_refine_context

        st = _state()
        assert st.modelVersions == []
        calls = []

        def _fake_generate(*a, **kw):
            calls.append(1)
            return None  # 生成失败走 D2 保底，本条只看"有没有去生成"

        monkeypatch.setattr(ex, "_try_llm_generate_evidence", _fake_generate)
        set_refine_context(_model("prev"), "本轮精修指令")
        try:
            _build_per_skill_evidence(st, blocked_signal=False, goal=st.goal["text"])
        finally:
            set_refine_context(None)
        assert calls == [1], "没有本轮快照时精修必须走生成，不许静默复用旧模型"

    def test_精修轮版本史记的是本轮指令_不是goal(self, gate_passes):
        """★ 2026-08-18 烘焙店真机：三轮精修的版本 instruction 全是首轮 goal
        原文——刷新回放按版本史铺气泡，每一轮都顶着首轮的话，对话史整段失真。
        精修指令原文就在 refine 上下文里，接线判据走真实 _build_per_skill_evidence。
        """
        from services.v5_capability_executor import _build_per_skill_evidence
        from services.v5_llm_generate import set_refine_context

        st = _state()
        set_refine_context(_model("prev"), "损耗登记页的表格增加一列残次原因分类")
        try:
            _build_per_skill_evidence(st, blocked_signal=False, goal=st.goal["text"])
        finally:
            set_refine_context(None)
        assert st.modelVersions, "精修过闸没记快照"
        assert (
            st.modelVersions[-1]["instruction"]
            == "损耗登记页的表格增加一列残次原因分类"
        ), f"精修轮存的是 {st.modelVersions[-1]['instruction']!r}——goal 顶替了本轮指令"
