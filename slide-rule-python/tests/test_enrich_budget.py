"""体验层成本笼子哨兵（2026-07-26）。

历史问题：每个 FreeformInsight 区块 + 每个 monitor 页都各自独立生一张视觉
参考图、各起一个一次性 E2B 沙盒截图自检——无缓存、无上限、全部串行，区块
多的应用把"过门→发布"拖到分钟级。

修法：每次 enrich 调用带预算（env 可调），超预算的区块退化为纯文字生成
（与未配生图/沙盒时行为一致），命中预算打日志不静默；截图沙盒支持
SLIDERULE_E2B_TEMPLATE 预烤模板跳过现装。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import app_screenshot, freeform_block
from services import enrich_timing
from services.freeform_block import enrich_freeform_blocks, enrich_monitor_page_overviews


def _model_with_blocks(n: int) -> dict:
    return {
        "datamodel": {"entities": []},
        "appbundle": {"appIdentity": {"theme": "azure"}, "preferredDevice": "desktop"},
        "page": {
            "pages": [
                {
                    "id": "p1",
                    "kind": "business",
                    "blocks": [
                        {
                            "id": f"b{i}",
                            "type": "FreeformInsight",
                            "props": {"designBrief": f"卡片{i}"},
                        }
                        for i in range(n)
                    ],
                }
            ]
        },
    }


def test_enrich_blocks_budget_flags(monkeypatch):
    calls = []

    def fake_generate(brief, datamodel, **kwargs):
        calls.append(
            (kwargs.get("use_reference_image"), kwargs.get("allow_screenshot_verify"))
        )
        return {"root": {"tag": "div", "text": "ok"}}

    monkeypatch.setattr(freeform_block, "generate_freeform_block", fake_generate)
    enrich_freeform_blocks(_model_with_blocks(6))

    ref_flags = [c[0] for c in calls]
    shot_flags = [c[1] for c in calls]
    # 默认预算：前 4 个生参考图，前 2 个跑截图自检，其余纯文字
    assert ref_flags == [True, True, True, True, False, False]
    assert shot_flags == [True, True, False, False, False, False]


def test_enrich_blocks_budget_env_zero(monkeypatch):
    monkeypatch.setenv("SLIDERULE_ENRICH_MAX_REF_IMAGES", "0")
    calls = []

    def fake_generate(brief, datamodel, **kwargs):
        calls.append(kwargs.get("use_reference_image"))
        return {"root": {"tag": "div", "text": "ok"}}

    monkeypatch.setattr(freeform_block, "generate_freeform_block", fake_generate)
    enrich_freeform_blocks(_model_with_blocks(3))
    assert calls == [False, False, False]


def test_monitor_overview_generates_exactly_one_sheet_for_the_landing_page(monkeypatch):
    """同步体验层只设计首页；非首页保留标准布局并标记延迟增强。

    之前是"每页各一张、上限 4 张"。实测单张 60~85s 且串行，而真正被用到的
    只有落地页那张——它同时是应用中心卡片显示的画面。其余页拿到参照板的
    收益远不抵那一分多钟。

    非首页原有 stats/charts/blocks 不删除，所以仍可由标准渲染器立即使用。
    """
    calls = []

    def fake_generate(brief, datamodel, **kwargs):
        calls.append(kwargs.get("use_reference_image"))
        return {"root": {"tag": "div", "text": "ok"}}

    monkeypatch.setattr(freeform_block, "generate_freeform_block", fake_generate)
    monkeypatch.setattr(freeform_block, "_image_generation_configured", lambda: True)
    monkeypatch.setattr(freeform_block, "_supports_image_content_parts", lambda: True)
    model = {
        "datamodel": {"entities": []},
        "appbundle": {"appIdentity": {"theme": "azure"}, "landingPageRef": "m1"},
        "page": {
            "pages": [
                {"id": f"m{i}", "kind": "monitor", "stats": [{"id": "s", "entity": "e"}]}
                for i in range(3)
            ]
        },
    }
    enrich_monitor_page_overviews(model)
    # 只有落地页进入生成器，且**只设计一档**。
    #
    # 2026-08-06 更新：此前这里断言 [True, True]（默认档 + 手机档两次调用，
    # 共用同一张参照板），并要求产物带 .mobile。11c4497「单设备权威」把
    # preferredDevice 收敛成 desktop/phone 二选一（services/device_policy.py：
    # 先看目标里有没有明说，再看模型的选择，兜底 desktop），一个应用只有一档，
    # freeform_block 里 design_total 随之写死成 1、手机档那一支整段删除。
    # 那次同步更新了 test_monitor_overview.py 等，**漏了这个文件**。
    assert calls == [True]
    assert model["page"]["pages"][1].get("freeformOverview")
    assert "mobile" not in model["page"]["pages"][1]["freeformOverview"]
    for page in (model["page"]["pages"][0], model["page"]["pages"][2]):
        assert "freeformOverview" not in page
        assert page["freeformOverviewStatus"] == "deferred"
        assert page.get("stats"), "延迟视觉增强不能删除标准渲染所需内容"


def test_sheet_falls_back_to_the_first_page_when_landing_is_missing(monkeypatch):
    """模型漏填 landingPageRef 时退回第一个符合条件的页。

    不能因为一个字段没填就整个应用一张图都没有——卡片会掉回活渲染。
    """
    calls = []
    monkeypatch.setattr(
        freeform_block, "generate_freeform_block",
        lambda brief, datamodel, **kw: (calls.append(kw.get("use_reference_image")) or {"root": {"tag": "div"}}),
    )
    monkeypatch.setattr(freeform_block, "_image_generation_configured", lambda: True)
    monkeypatch.setattr(freeform_block, "_supports_image_content_parts", lambda: True)
    model = {
        "datamodel": {"entities": []},
        "appbundle": {"appIdentity": {"theme": "azure"}},  # 没有 landingPageRef
        "page": {
            "pages": [
                {"id": f"m{i}", "kind": "monitor", "stats": [{"id": "s", "entity": "e"}]}
                for i in range(2)
            ]
        },
    }
    enrich_monitor_page_overviews(model)
    assert calls == [True], "漏填落地页时第一页应当拿到唯一设备档的参照板"
    assert model["page"]["pages"][1]["freeformOverviewStatus"] == "deferred"


def test_no_sheet_at_all_when_image_generation_is_not_configured(monkeypatch):
    """没配生图 key = 一张都不生。**这就是开关，没有第二个环境变量。**"""
    calls = []
    monkeypatch.setattr(
        freeform_block, "generate_freeform_block",
        lambda brief, datamodel, **kw: (calls.append(kw.get("use_reference_image")) or {"root": {"tag": "div"}}),
    )
    monkeypatch.setattr(freeform_block, "_image_generation_configured", lambda: False)
    monkeypatch.setattr(freeform_block, "_supports_image_content_parts", lambda: True)
    model = {
        "datamodel": {"entities": []},
        "appbundle": {"appIdentity": {"theme": "azure"}, "landingPageRef": "m0"},
        "page": {"pages": [{"id": "m0", "kind": "monitor", "stats": [{"id": "s", "entity": "e"}]}]},
    }
    enrich_monitor_page_overviews(model)
    assert all(c is False for c in calls)
    assert model["page"]["pages"][0].get("freeformOverview"), "没图也要出设计"


def test_budget_counts_failed_attempts(monkeypatch):
    """预算按尝试计费——参考图在 generate 开头就生成了，失败的区块钱照样
    花了；只在成功分支计数会让网关抖动时笼子完全失效（终检实测:12 区块
    全带参考图）。"""
    from services.freeform_block import FreeformGenerationError

    calls = []

    def fake_generate(brief, datamodel, **kwargs):
        calls.append(kwargs.get("use_reference_image"))
        raise FreeformGenerationError("simulated gateway flake")

    monkeypatch.setattr(freeform_block, "generate_freeform_block", fake_generate)
    enrich_freeform_blocks(_model_with_blocks(8))
    # 默认上限 4：失败也扣预算，第 5 个起必须不再带参考图
    assert calls == [True, True, True, True, False, False, False, False]


def test_budget_env_garbage_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("SLIDERULE_ENRICH_MAX_REF_IMAGES", "not-a-number")
    assert freeform_block._env_budget("SLIDERULE_ENRICH_MAX_REF_IMAGES", 4) == 4
    monkeypatch.setenv("SLIDERULE_ENRICH_MAX_REF_IMAGES", "-3")
    assert freeform_block._env_budget("SLIDERULE_ENRICH_MAX_REF_IMAGES", 4) == 0


def test_monitor_visuals_fail_open_when_run_deadline_is_too_close(monkeypatch):
    calls = []
    monkeypatch.setattr(freeform_block, "generate_freeform_block", lambda *_a, **_k: calls.append(1))
    monkeypatch.setattr(freeform_block, "_image_generation_configured", lambda: True)
    monkeypatch.setattr(freeform_block, "_supports_image_content_parts", lambda: True)
    model = {
        "appbundle": {"landingPageRef": "m1", "preferredDevice": "desktop"},
        "page": {"pages": [{"id": "m1", "kind": "monitor", "stats": [{"id": "s1"}]}]},
    }
    token = enrich_timing.begin_run_budget(seconds=1)
    try:
        enrich_monitor_page_overviews(model)
    finally:
        enrich_timing.reset_run_budget(token)
    assert calls == []
    assert model["page"]["pages"][0]["freeformOverviewStatus"] == "deferred_budget"


def test_monitor_keeps_text_only_landing_design_when_only_reference_image_is_over_budget(monkeypatch):
    calls = []

    def fake_generate(*_args, **kwargs):
        calls.append(kwargs)
        return {"root": {"type": "stack", "children": []}}

    monkeypatch.setattr(freeform_block, "generate_freeform_block", fake_generate)
    monkeypatch.setattr(freeform_block, "_image_generation_configured", lambda: True)
    monkeypatch.setattr(freeform_block, "_supports_image_content_parts", lambda: True)
    monkeypatch.setattr(
        freeform_block,
        "_generate_overview_sheet_b64",
        lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("reference image must be skipped")),
    )
    model = {
        "appbundle": {"landingPageRef": "m1", "preferredDevice": "desktop"},
        "page": {"pages": [{"id": "m1", "kind": "monitor", "stats": [{"id": "s1"}]}]},
    }
    token = enrich_timing.begin_run_budget(seconds=200)
    try:
        enrich_monitor_page_overviews(model)
    finally:
        enrich_timing.reset_run_budget(token)
    assert len(calls) == 1
    assert calls[0]["use_reference_image"] is False
    assert calls[0]["reference_image_b64"] is None
    assert model["page"]["pages"][0]["freeformOverviewStatus"] == "ready"


def test_run_budget_defaults_to_eighteen_minutes_and_can_be_overridden(monkeypatch):
    """默认 1080s（2026-08-07 由 540 上调，用户裁决 ×2）。

    上调的实测依据：一趟真实推演（连锁药房处方与库存协同）里
    `stage=model.generate ms=532765` 一项就吃掉 540 的 99%，
    `stage=monitor.design got=0 skippedReason=deadline` —— 首页版式整段被
    掐掉，退回固定骨架。理由与"为什么不是 Contract 的问题"记在
    enrich_timing._DEFAULT_RUN_BUDGET_SECONDS 上方。

    这条断言钉的是**默认值**：预算是 fail-open 视觉增强的唯一闸门，
    悄悄被改小的表现是"某些话题的首页突然没有版式了"，不会报错。
    """
    monkeypatch.delenv("SLIDERULE_RUN_BUDGET_SECONDS", raising=False)
    assert enrich_timing.run_budget_seconds() == 1080
    monkeypatch.setenv("SLIDERULE_RUN_BUDGET_SECONDS", "420")
    assert enrich_timing.run_budget_seconds() == 420


def test_run_budget_leaves_room_for_design_after_a_heavy_generation():
    """重话题也要走得完版式那一段——这是这次上调的**目的**，单独钉住。

    版式的进入门槛是 `required_visual_seconds = 150 + 130 * design_total`
    （freeform_block:2802），单页即 280s。实测最慢的一次模型生成 533s：

        540  − 533 = 7s    < 280  → 跳过（改之前，用户实测到的现象）
        1080 − 533 = 547s  > 280  → 走得完

    哪天有人把默认值调回去（或调到 813 以下），这条会先响。
    """
    HEAVIEST_GENERATION_SECONDS = 533  # 2026-08-07 连锁药房那一轮实测
    DESIGN_THRESHOLD_SECONDS = 150 + 130 * 1
    assert (
        enrich_timing._DEFAULT_RUN_BUDGET_SECONDS - HEAVIEST_GENERATION_SECONDS
        >= DESIGN_THRESHOLD_SECONDS
    ), "预算不足以在最慢的一次生成之后还做得完版式设计"


class _FakeSandbox:
    def __init__(self):
        self.ran = []

    def run_code(self, code, timeout=None):
        self.ran.append(code)

        class R:
            error = None

        return R()


def test_ensure_playwright_skips_install_with_template(monkeypatch):
    monkeypatch.setenv("SLIDERULE_E2B_TEMPLATE", "sliderule-playwright")
    sandbox = _FakeSandbox()
    assert app_screenshot._ensure_playwright(sandbox, 90) is True
    assert sandbox.ran == []  # 模板已烤好，零现装


def test_ensure_playwright_installs_without_template(monkeypatch):
    monkeypatch.delenv("SLIDERULE_E2B_TEMPLATE", raising=False)
    sandbox = _FakeSandbox()
    assert app_screenshot._ensure_playwright(sandbox, 90) is True
    assert len(sandbox.ran) == 1
    assert "playwright" in sandbox.ran[0]
