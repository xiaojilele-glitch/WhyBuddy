"""结构闸失败这条路上的三件事：日志说得清、修复走得便宜、写入不静默丢（2026-08-09）。

## 为什么补这一整个文件

起因是一趟真机执行日志（黑灰产情报自动化分析，22 分 52 秒，网页端）：

    [enrich-timing] stage=model.generate   ms=172608 ok=1 used=1
    [enrich-timing] stage=model.regenerate ms=190608 ok=1 used=1
    [enrich-timing] stage=model.generate   ms=208699 ok=1 used=1
    [enrich-timing] stage=model.regenerate ms=119739 ok=1 used=1
    [enrich-timing] stage=model.generate   ms=165796 ok=1 used=1
    [enrich-timing] stage=model.regenerate ms=134641 ok=1 used=1
    [enrich-timing] stage=monitor.design   ms=0 got=0 skippedReason=deadline

`model.regenerate` 只有一个来源：模型没过结构闸、带着裁决回喂重生成。
generate/regenerate **严格成对出现 3 次** —— 首轮过闸率 0/3，重生成烧掉 445 秒
（占全程 34%），把 1080 秒预算撑爆 228 秒，最后一页的版式设计直接超时跳过。

而这趟推演最贵的一环，事后**查不动**：

  · 闸拦了什么 —— `_format_gate_findings` 的结果只喂给模型，没有任何日志；
  · 为什么按全价重生 —— section 级修复只挂在并行分支下，而并行默认关，
    日志里也不说它走了哪条；
  · 顺带暴露的第三件 —— 同一份日志里刷了 18 条
    `PydanticSerializationUnexpectedValue: Expected 'CoverageGap'/'DependencyEdge'`，
    追下去是 `_set_gap` 把 pydantic 的 setattr 报错 `except: pass` 吞了。

三条各自都小，但都属于"不喊疼的错误"：跑得通、看着正常、代价全在事后。
所以钉在这里。
"""

import pytest

from services.v5_capability_executor import _findings_all_sectioned, _log_gate_findings


def _f(path: str, message: str, skill: str = "") -> dict:
    return {"code": "X", "path": path, "message": message, "ref": "", "affectedSkill": skill}


class TestLogGateFindings:
    """闸拦了什么，必须落到容器日志里。"""

    def test_打印前三条的_path_与_message(self, capsys):
        findings = [_f(f"page.pages[{i}]", f"悬空引用 {i}") for i in range(5)]
        _log_gate_findings("首轮拦截", findings)
        out = capsys.readouterr().out
        assert "page.pages[0]: 悬空引用 0" in out
        assert "page.pages[2]: 悬空引用 2" in out
        # 只取前 3 条：真跑里同类裁决会刷屏，前 3 条足够定性
        assert "悬空引用 3" not in out

    def test_说明总数与被截掉的条数(self, capsys):
        _log_gate_findings("首轮拦截", [_f("p", "m") for _ in range(7)])
        out = capsys.readouterr().out
        assert "7 项" in out
        assert "另有 4 项" in out

    def test_只有一条时不显示另有(self, capsys):
        _log_gate_findings("首轮拦截", [_f("p", "m")])
        out = capsys.readouterr().out
        assert "1 项" in out
        assert "另有" not in out

    def test_字段缺失不炸(self, capsys):
        # findings 是模型/门禁两边拼出来的，不能假设字段齐全
        _log_gate_findings("首轮拦截", [{}, {"path": "p"}, {"message": "m"}])
        assert "结构闸首轮拦截" in capsys.readouterr().out

    def test_空列表也打一行(self, capsys):
        # "闸拦了但一条 finding 都没有"本身就是要看见的异常形态
        _log_gate_findings("首轮拦截", [])
        assert "0 项" in capsys.readouterr().out


class TestFindingsAllSectioned:
    """决定走 section 级修复还是全价重生的判据。"""

    def test_全部点名才算数(self):
        assert _findings_all_sectioned([_f("p", "m", "page"), _f("d", "m", "datamodel")])

    def test_有一条没点名就不算(self):
        # 没点名的那条问题在 section 级修复后依然存在，闸会再拦一次 —— 白花一次调用。
        # v5_model_gate 里 108 处 _finding( 只有 63 处带 skill=，这不是罕见情况。
        assert not _findings_all_sectioned([_f("p", "m", "page"), _f("x", "m", "")])

    def test_appbundle_算可修复的_section(self):
        # regenerate_failed_sections 对纯 appbundle 的裁决做确定性重组，一次 LLM 都不调
        assert _findings_all_sectioned([_f("a", "m", "appbundle")])

    def test_不认识的_skill_不算(self):
        assert not _findings_all_sectioned([_f("p", "m", "nonexistent")])

    def test_空列表不算(self):
        # 没有 findings 却走到这儿说明闸的裁决丢了，别拿它去省钱
        assert not _findings_all_sectioned([])

    def test_非字典条目不算(self):
        assert not _findings_all_sectioned([_f("p", "m", "page"), "oops"])


class TestCoverageGapWrites:
    """`_set_gap` 不许再静默丢字段。"""

    def test_模型对象上写_updatedAt_与_resolvedByArtifactId(self):
        # 这两个字段以前没声明，pydantic v2 抛 ValueError，被 except: pass 吞掉。
        # 表现是"gap 是 dict 就写进去了、是模型对象就丢了"，同一次调用两种行为。
        from models.v5_state import CoverageGap
        from services.slide_rule_coverage import _set_gap

        gap = CoverageGap(id="g1", kind="missing_evidence", label="x", createdAt="2026-08-09")
        _set_gap(gap, status="resolved", updatedAt="2026-08-09T00:00:00", resolvedByArtifactId="art-1")
        assert gap.status == "resolved"
        assert gap.updatedAt == "2026-08-09T00:00:00"
        assert gap.resolvedByArtifactId == "art-1"

    def test_dict_形态行为不变(self):
        from services.slide_rule_coverage import _set_gap

        gap = {"id": "g1", "status": "open"}
        _set_gap(gap, status="resolved", updatedAt="t")
        assert gap == {"id": "g1", "status": "resolved", "updatedAt": "t"}

    def test_写未声明字段当场炸而不是静默丢(self):
        # 这条就是这次改动的核心：再出现同样的模型/写入方分叉，必须立刻可见。
        from models.v5_state import CoverageGap
        from services.slide_rule_coverage import _set_gap

        gap = CoverageGap(id="g1", kind="missing_evidence", label="x", createdAt="2026-08-09")
        with pytest.raises(ValueError):
            _set_gap(gap, 这个字段模型里没有="v")

    def test_两个字段与_TS_契约同名(self):
        # 补的是 Python 侧的漏，不是新增契约：
        # shared/blueprint/v5-reasoning-state.ts:307/311 早就有这两个可选字段。
        from models.v5_state import CoverageGap

        assert "resolvedByArtifactId" in CoverageGap.model_fields
        assert "updatedAt" in CoverageGap.model_fields
        for name in ("resolvedByArtifactId", "updatedAt"):
            assert CoverageGap.model_fields[name].default is None, f"{name} 必须可选，老快照不能因此读不回来"


class TestSerialSectionRepairWiring:
    """串行分支到底走没走 section 级修复 —— 判据对不等于接线对。

    这是这次三条改动里唯一改了**行为**的一条（另外两条是日志和字段声明），
    所以单测判据函数不够，得把 `_try_llm_generate_evidence` 真跑一遍，
    数清楚 `generate_five_system_model` 被调了几次。
    """

    @pytest.fixture
    def wired(self, monkeypatch):
        """把闸、生成、section 修复三处都换成可计数的假件。

        返回一个 `run(findings, repair_returns)` ：跑一次带门禁失败的生成，
        给回 {generate 次数, repair 次数}。首轮闸恒失败、重试闸恒通过，
        好把注意力留在"重试是怎么拿到的"上。
        """
        import services.v5_llm_generate as gen_mod
        import services.v5_model_gate as gate_mod
        import services.v5_parallel_generate as par_mod
        from services.v5_capability_executor import _try_llm_generate_evidence

        def run(findings, repair_returns):
            calls = {"generate": 0, "repair": 0}
            gate_calls = {"n": 0}

            def fake_generate(goal, llm_json_fn=None, gate_feedback=None):
                calls["generate"] += 1
                return _model_ok()

            def fake_gate(model, **kwargs):
                gate_calls["n"] += 1
                # 第一次拦，之后放行 —— 重试模型从哪来不影响这个判定
                if gate_calls["n"] == 1:
                    return {"passed": False, "findings": findings}
                return {"passed": True, "findings": []}

            def fake_repair(goal, model, findings, *, call_json):
                calls["repair"] += 1
                return repair_returns

            # 这条测的是 GEN5 过闸失败后的 section 修复。spec-first 默认开
            # 且失败不再回落，不关掉的话根本走不到这里。
            monkeypatch.setattr(
                "services.spec_first_pipeline.spec_first_enabled", lambda: False
            )
            monkeypatch.setattr(gen_mod, "generate_five_system_model", fake_generate)
            monkeypatch.setattr(gate_mod, "validate_five_system_model", fake_gate)
            monkeypatch.setattr(par_mod, "regenerate_failed_sections", fake_repair)
            monkeypatch.setattr(par_mod, "parallel_generation_enabled", lambda: False)
            # 确定性修复器不参与本判定，短路掉免得它改动模型形状
            monkeypatch.setattr(
                "services.v5_model_repair.repair_five_system_model",
                lambda m: {"model": m},
            )
            _try_llm_generate_evidence("目标", None)
            return calls

        return run

    def test_全部点名时只做_section_修复_不再整包重生(self, wired):
        # 这就是要省掉的那 445 秒：改前这里必然是 generate=2
        calls = wired([_f("p", "m", "page")], repair_returns=_model_ok())
        assert calls["repair"] == 1
        assert calls["generate"] == 1, "section 级修复成功后不该再整包重生一次"

    def test_有裁决没点名时不碰_section_修复_直接走全价(self, wired):
        calls = wired([_f("p", "m", "page"), _f("x", "m", "")], repair_returns=_model_ok())
        assert calls["repair"] == 0
        assert calls["generate"] == 2

    def test_section_修复没产出时回落整包_最坏情况与改前一致(self, wired):
        # 这条是这次改动的安全网：省不了的时候必须退回老行为，而不是直接判死
        calls = wired([_f("p", "m", "page")], repair_returns=None)
        assert calls["repair"] == 1
        assert calls["generate"] == 2

    def test_走全价时日志说清楚为什么(self, wired, capsys):
        wired([_f("p", "m", "page"), _f("x", "m", "")], repair_returns=_model_ok())
        out = capsys.readouterr().out
        assert "整包重生成" in out
        assert "2 项裁决里有 1 项没点名" in out


def _model_ok() -> dict:
    from services.v5_llm_generate import _REQUIRED_SECTIONS

    return {section: {"id": section} for section in _REQUIRED_SECTIONS}
