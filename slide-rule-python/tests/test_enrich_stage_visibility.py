"""慢阶段必须在流上可见（2026-08-04 起，2026-08-05 补建模两段）。

## 这条防的是一个 165.8 秒的黑屏

真机量到（社区消防巡检那轮，10.2 分钟）：五系统建模的最后一个 llm_delta 之后，
到 skill_start/datamodel 之前，**165.8 秒一个事件都没有**——比选材那六段加起来
还长，而且落在最难受的位置：用户已经等了七八分钟、眼看要出结果，突然黑三分钟。

那段时间后端在干这三件事，埋点里数是现成的，只是从来没往前端送：

    monitor.sheet    104.9s   生成首页参照图
    monitor.palette   19.1s   从参照图读配色
    monitor.design    59.5s   照着图设计版式

## 为什么带"大概多久"

生参照图那 ~105 秒**在物理上没法流式**——图片没有"逐字"这回事，画完一次性
返回。这类操作能给的只有"在做什么 + 正常要多久"：用户能自己判断"还在正常
范围"还是"真卡了"。只给转圈图标的话，等 30 秒和等 3 分钟看起来一模一样。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import enrich_timing  # noqa: E402
from services.v5_full_driver import (  # noqa: E402
    _ENRICH_STAGE_LABELS,
    _enrich_stage_event,
    _progress_heartbeat_event,
)


def test_the_slow_stages_are_all_covered():
    """慢的那几段一个都不能漏——漏掉哪一段，那一段就还是黑的。

    2026-08-05 加了建模两段。原因是这条线上**最长的一个洞根本不在体验层**：
    真机一轮里 234.6s → 445.6s 之间 211 秒无事件，夹在"选中收口"和"生成
    首页参照图"中间，比上面三段里任何一段都长。当初先埋体验层，是因为它在
    最末尾、最显眼，不是因为它最慢。

    写成全等而不是包含：多出来的名字同样要过审。名单外的阶段会被
    `_enrich_stage_event` 直接丢掉（内部子步骤报出来只会把一条清晰的进度线
    拆成一堆碎片），所以加进来就意味着"决定让用户看见"。

    2026-08-14 加了 spec-first 六段。新链路一轮 8~9 分钟，不报的话左侧
    **从头黑到尾**——不是"某一段黑三分钟"，是整条链一个字都没有。
    """
    assert set(_ENRICH_STAGE_LABELS) == {
        "model.generate",
        "model.regenerate",
        "monitor.sheet",
        "monitor.palette",
        "monitor.design",
        # spec-first 里报七步。⚠ specfirst.shell 故意不在——见下一条
        "specfirst.spec",
        # 2026-08-15 晚加：按应用定设计语言（风格那一半，注进第 3 步的槽位）。
        # 报它是因为它**会花十几秒且用户能感知结果**（整个应用的配色与密度
        # 由它定）——跟 shell 那种零 LLM、0.0 秒的不是一类东西。
        "specfirst.design",
        # 2026-08-17 加：精修时判"这次要改哪几页"（按需重画）。
        # 报它的理由跟 specfirst.design 同款——**一次 LLM 调用、5~15 秒、
        # 而且用户能感知结果**（它决定了接下来哪几页会被重画）。跟 shell
        # 那种零 LLM、0.0 秒的不是一类东西。
        # ⚠ 只有精修轮会出现；新建应用那条路上这一步根本不进。
        "specfirst.pagescope",
        # 2026-08-17 加：图判作用域（影子）。同 pagescope 的理由：一次 LLM
        # 调用、3~10 秒，不报左侧会黑。⚠ 它出生时是影子模式（只打对照日志、
        # 不改行为），但墙钟是真花的——"影子"省的是行为风险，省不了时间。
        "specfirst.graphscope",
        "specfirst.pages",
        "specfirst.structure",
        "specfirst.semantics",
        "specfirst.assemble",
        "specfirst.bind",
    }


def test_the_zero_cost_step_stays_off_the_stream():
    """外壳统一不报：零 LLM、实测 0.0 秒，start/end 背靠背只会闪一下。

    这跟"内部子步骤不报"是同一条纪律的另一面——那条防的是**碎**，
    这条防的是**闪**。两者都让进度线变得不像进度线。
    """
    assert "specfirst.shell" not in _ENRICH_STAGE_LABELS
    assert _enrich_stage_event("start", "specfirst.shell", {}) is None


def test_spec_first_stages_are_actually_instrumented():
    """名单里有名字不等于埋点在——这条是上面那条的**反向判据**。

    正向判据（名字在表里）只查"报出来的对不对"，查不出"该报的在不在"：
    表里写 `specfirst.pages`、而 pipeline 里那个 with 写的是别的名字或者根本
    没写，两边都不会红，左侧照样黑。本仓数到第十次的失败形态就是这个形状
    （闸全绿但东西没了），成因每次都是"只有正向判据"。

    所以这里从 pipeline 源码里把 `_stage("…")` 的实参捞出来，跟表逐一对。
    """
    import inspect
    import re

    from services import spec_first_pipeline

    src = inspect.getsource(spec_first_pipeline.run_spec_first)
    instrumented = set(re.findall(r'_stage\(\s*"([^"]+)"', src))
    labelled = {n for n in _ENRICH_STAGE_LABELS if n.startswith("specfirst.")}

    assert labelled <= instrumented, f"表里有名字但链路里没埋点：{labelled - instrumented}"
    # 反过来也要对：埋了点却没进表 = 那一段在左侧是黑的。shell 是唯一的例外，
    # 而且是**显式**例外——写在这里，改的人躲不过。
    assert instrumented - labelled == {"specfirst.shell"}, (
        f"埋了点却没进表（左侧会黑）：{instrumented - labelled - {'specfirst.shell'}}"
    )


def test_model_generation_stage_is_actually_instrumented():
    """名单里有名字不等于埋点在。

    `_ENRICH_STAGE_LABELS` 只是"愿意报哪些"，真正发事件的是
    v5_llm_generate 里那个 with。两边对不上时名单是死的，屏幕照样黑。
    """
    import inspect

    from services.v5_llm_generate import generate_five_system_model

    src = inspect.getsource(generate_five_system_model)
    assert "_enrich_stage(stage_name" in src
    assert "model.regenerate" in src and "model.generate" in src


def test_retry_does_not_split_into_two_visible_steps():
    """一次失败重试要表现为同一段变慢，不是同一条步骤闪两遍。

    闪两遍在屏幕上像出错了。埋点因此包住整个重试循环，而不是单次调用。
    """
    import inspect

    from services.v5_llm_generate import generate_five_system_model

    src = inspect.getsource(generate_five_system_model)
    stage_at = src.index("_enrich_stage(stage_name")
    loop_at = src.index("for attempt in range(attempts)")
    assert stage_at < loop_at, "埋点必须在重试循环外层"


def test_every_label_carries_a_duration_hint():
    """每一段都要带时长提示，理由见文件头（没法流式时它是唯一的判断依据）。

    单位收秒或分钟都行——建模那两段中位数三分多钟，写成"通常 200~240 秒"
    没人愿意在脑子里换算。要的是"看一眼知道还要等多久"。
    """
    for name, (label, hint) in _ENRICH_STAGE_LABELS.items():
        assert label and not label.split(".")[0] in ("monitor", "model"), (
            f"{name} 要给人话，不是内部阶段名"
        )
        assert "秒" in hint or "分钟" in hint, f"{name} 缺时长提示"


def test_start_and_end_are_paired():
    fields = {"page": "quality_dashboard", "device": "desktop", "current": 1, "total": 1}
    start = _enrich_stage_event("start", "monitor.sheet", fields)
    end = _enrich_stage_event("end", "monitor.sheet", {**fields, "ms": 104895, "ok": True})
    assert start["type"] == "reasoning_step"
    assert end["type"] == "reasoning_step_result"
    # 成对的关键是 label 一致——前端靠它把这一条收掉，对不上就会一直转
    assert start["label"] == end["label"]
    assert end["ms"] == 104895 and end["error"] is False
    assert start["pageId"] == end["pageId"] == "quality_dashboard"
    assert start["device"] == end["device"] == "desktop"
    assert start["current"] == end["current"] == 1
    assert start["total"] == end["total"] == 1
    assert start["elapsedMs"] == 0
    assert end["elapsedMs"] == 104895


def test_skipped_stage_is_not_reported_as_a_failure():
    """got=0 是"跳过了/没产出"（比如没配生图 key），不是失败。

    混同的话，没配生图的环境会满屏红叉——而那恰恰是设计上允许的降级路径。
    """
    ev = _enrich_stage_event("end", "monitor.sheet", {"ms": 0, "ok": True, "got": 0})
    assert ev["error"] is False


def test_deadline_skip_reason_survives_the_sse_projection():
    ev = _enrich_stage_event(
        "end",
        "monitor.design",
        {"ms": 0, "ok": True, "got": 0, "skippedReason": "deadline", "page": "p1"},
    )
    assert ev["skippedReason"] == "deadline"
    assert ev["pageId"] == "p1"


def test_progress_heartbeat_keeps_active_stage_context():
    active = _enrich_stage_event(
        "start",
        "monitor.design",
        {"page": "quality_dashboard", "device": "phone", "current": 2, "total": 2},
    )
    heartbeat = _progress_heartbeat_event(active, elapsed_ms=15001)
    # ⚠ 这里**故意**比整份 dict，不是比几个键：精确相等就是这条的反向判据
    #   （§3）——「心跳里不许多带东西」。多带 = 前端拿到没约定的字段，
    #   或者内部字段顺着心跳漏出去。
    #   所以产线正当地新增一个字段时，正确做法是**在这里补上并配一条透传判据**
    #   （见下），不是把 == 改成"包含"——那等于把反向判据拆了。
    assert heartbeat == {
        "type": "progress_heartbeat",
        "stage": "monitor.design",
        "label": active["label"],
        "pageId": "quality_dashboard",
        "device": "phone",
        "current": 2,
        "total": 2,
        "elapsedMs": 15001,
        "productStep": None,
    }


def test_progress_heartbeat_carries_the_product_step():
    """★ 配对：上一条只证明了 productStep 这个**键**在，没证明它**透传**。

    上一条喂的 active 里根本没有 productStep，拿到 None 是「两边都空」的巧合——
    把产线那行改成写死 `"productStep": None` 也照样绿。这条把值喂进去再读出来。
    （§3：每写一条「应该有 X」，配一条「X 真的被用到了」。）
    """
    active = _enrich_stage_event(
        "start",
        "monitor.design",
        {"page": "quality_dashboard", "device": "phone", "current": 1, "total": 3},
    )
    active["productStep"] = "画页面"
    assert _progress_heartbeat_event(active, elapsed_ms=1)["productStep"] == "画页面", (
        "productStep 没从 active 透传到心跳——前端那条进度线上这一格永远是空的"
    )


def test_internal_substeps_stay_off_the_stream():
    """内部子步骤不报——报出来会把一条清晰的进度线拆成一堆看不懂的碎片。"""
    for internal in ("block.refimage", "freeform.total", "monitor.total", "block.screenshot"):
        assert _enrich_stage_event("start", internal, {}) is None


def test_sink_receives_start_before_end_and_never_breaks_the_pipeline():
    """sink 要在阶段**开始**时就叫一声（否则等于没改），且自身出错不能传染。"""
    seen = []
    enrich_timing.set_stage_sink(lambda phase, name, fields: seen.append((phase, name)))
    try:
        with enrich_timing.stage("monitor.sheet", page="p1"):
            assert seen == [("start", "monitor.sheet")], "开始时就要叫，不能等跑完"
    finally:
        enrich_timing.set_stage_sink(None)
    assert [p for p, _ in seen] == ["start", "end"]

    # sink 自己炸了，被测链路必须照常跑完
    enrich_timing.set_stage_sink(lambda *_a: 1 / 0)
    try:
        with enrich_timing.stage("monitor.design", page="p1"):
            pass
    finally:
        enrich_timing.set_stage_sink(None)


def test_stage_still_reraises_so_fail_open_semantics_survive():
    """异常照常向上抛——ENRICH 全程 fail-open，吞掉就变成"成功但内容为空"。"""
    enrich_timing.set_stage_sink(lambda *_a: None)
    try:
        raised = False
        try:
            with enrich_timing.stage("monitor.design"):
                raise RuntimeError("boom")
        except RuntimeError:
            raised = True
        assert raised
    finally:
        enrich_timing.set_stage_sink(None)
