"""新链路上不许再跑 enrich_*（2026-08-14）。

## 这条钉的是什么

`enrich_freeform_blocks` / `enrich_monitor_page_overviews` 存在的理由只有一个：
**老链路除了五系统 JSON 之外没有任何版式来源**，只能让 FreeformInsight 现场
设计一棵内容树出来。

新链路上这个问题不存在——第 3 步产出真 HTML、第 3.5 步统一外壳、第 6.5 步
打 data-* 孔。再跑一遍 enrich 是**让模型把已经画好的页面重新发明一次**。

## 为什么这条值得单独立一个文件

架构图 ⚑⚑B 早就写下了这个口径（「enrich_* 那整层在新链路上不跑」），
**但代码里一个开关都没有**：`_try_llm_generate_evidence` 里从
`run_spec_first` 到两处 `enrich_*` 之间没有任何分支，也没有任何用例钉住。

图上写了、代码没跟 —— 这是 2026-08-14 那轮图码对照核出的第六例，
跟前五处（HTMLCARRIER / SPECGAP / BINDRT / ⚑6 / ⚑⚑E'）是同一个形状。
**所以这里补的不只是开关，是那条一直缺席的判据。**

## 判据钉在行为上，不钉在源码文本上

这仓库刚为这件事付过学费：第 3 步那条「不许引 tenacity」头一版写成
`"tenacity" not in src`，结果被模块里那句「不引 tenacity」的**注释**判红。

所以这里不去 grep 源码里有没有 `if from_spec_first`，而是**真的把两个 enrich
换成计数器再跑一遍**——改法换了（比如挪进别的函数、改成早退）判据照样成立，
而"版式被重新发明了一次"这件事一旦发生就一定被抓到。

## 反向那半同样重要

只查"新链路不跑"是不够的：把两行 enrich 直接删掉也能让那条断言变绿，
而那会**把老链路一起砍掉**——``SLIDERULE_SPEC_FIRST=0`` 时区块页是唯一
产出，没了 enrich 它就是一页空的。所以两个方向各一条。

2026-08-18 起 spec-first **试过失败不再回落 GEN5**。那一轮 enrich 不该跑
（没有模型）。老路保险改钉在「把新链路关掉」。
"""

import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import v5_capability_executor as ex  # noqa: E402
from services import spec_first_pipeline as sfp  # noqa: E402

FIXTURE = Path(__file__).resolve().parent.parent / "services" / "data" / "builtin_domain_models.json"


def _gate_passing_model() -> dict:
    """仓库里冻结的过闸夹具——它本来就是"生成后过结构门再冻结"的产物。

    ⚠ 用真夹具而不是手搓一个 dict：手搓的过不了 v5_model_gate，
      于是函数会在闸那里就返回 None，两处 enrich 根本走不到——
      **用例会变成绿的，但它什么都没验**。
    """
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["service_ticket"]


@pytest.fixture
def 记账(monkeypatch):
    """把两个 enrich 换成计数器，并记录 preview_sink 有没有被建。"""
    calls = {"freeform": 0, "monitor": 0}

    from services import freeform_block

    def _fake_freeform(model, *a, **k):
        calls["freeform"] += 1
        return model

    def _fake_monitor(model, *a, **k):
        calls["monitor"] += 1
        return model

    monkeypatch.setattr(freeform_block, "enrich_freeform_blocks", _fake_freeform, raising=False)
    monkeypatch.setattr(
        freeform_block, "enrich_monitor_page_overviews", _fake_monitor, raising=False
    )
    yield calls


@pytest.fixture(autouse=True)
def _clear_stash():
    sfp._last_pages_var.set(None)
    yield
    sfp._last_pages_var.set(None)


def _run(monkeypatch, *, spec_first_ok: bool, 记账, spec_first_enabled: bool = True):
    """跑一趟 _try_llm_generate_evidence，控制 spec-first 成不成 / 开不开。"""
    model = _gate_passing_model()

    monkeypatch.setattr(sfp, "spec_first_enabled", lambda: spec_first_enabled, raising=False)

    if spec_first_enabled and spec_first_ok:
        monkeypatch.setattr(
            sfp, "run_spec_first", lambda goal, **k: {"model": model}, raising=False
        )
    elif spec_first_enabled:
        def _boom(goal, **k):
            raise sfp.SpecFirstError("用例注入：新链路挂了")

        monkeypatch.setattr(sfp, "run_spec_first", _boom, raising=False)
        from services import v5_llm_generate

        monkeypatch.setattr(
            v5_llm_generate, "generate_five_system_model", lambda *a, **k: model, raising=False
        )
    else:
        from services import v5_llm_generate

        monkeypatch.setattr(
            v5_llm_generate, "generate_five_system_model", lambda *a, **k: model, raising=False
        )

    out = ex._try_llm_generate_evidence("给连锁宠物医院做一套诊疗管理", None)
    return out


class Test新链路上不再重新发明版式:
    def test_spec_first_成功时两段_enrich_都不跑(self, monkeypatch, 记账):
        """省下来的是实打实的墙钟：架构图自记 monitor.design 75.1s。

        而且省的不是"可能没用的东西"——freeformOverview / freeformBlocks
        全仓只有 AppRuntimeScreen 消费，会话页早已改成渲染 HTML 页，
        那份产物**一帧都不会出现**。
        """
        out = _run(monkeypatch, spec_first_ok=True, 记账=记账)
        assert out is not None, "夹具应当过闸——过不了闸这条用例就什么都没验"
        assert 记账["freeform"] == 0, "新链路上还在跑 enrich_freeform_blocks"
        assert 记账["monitor"] == 0, "新链路上还在跑 enrich_monitor_page_overviews"


class Test老链路照旧:
    def test_关掉新链路时两段_enrich_必须照跑(self, monkeypatch, 记账):
        """⚠ 这条是上面那条的反向保险。

        把两行 enrich 直接删掉，上面那条也会变绿——而那等于把老链路一起
        砍了。老路只在 ``SLIDERULE_SPEC_FIRST=0`` 时还是主路。
        spec-first 试过失败不再回落 GEN5，那一轮没有模型，enrich 不该跑。
        """
        out = _run(
            monkeypatch, spec_first_ok=False, 记账=记账, spec_first_enabled=False
        )
        assert out is not None
        assert 记账["freeform"] == 1, "老链路 enrich_freeform_blocks 必须照跑"
        assert 记账["monitor"] == 1, "老链路 enrich_monitor_page_overviews 必须照跑"

    def test_spec_first_失败不回落所以enrich也不跑(self, monkeypatch, 记账):
        out = _run(monkeypatch, spec_first_ok=False, 记账=记账)
        assert out is None, "spec-first 挂了还交了模型——又在回落 GEN5"
        assert 记账["freeform"] == 0
        assert 记账["monitor"] == 0
