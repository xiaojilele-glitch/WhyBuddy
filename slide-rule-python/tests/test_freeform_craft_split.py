"""把「怎么画」那一段从写死处方拆成按业务现写（2026-08-07）。

起因是量出来的一个数：同一个 build_freeform_prompt，喂两个毫不相干的业务
（连锁药房 / 设施农业大棚），产出的首页设计提示词**逐字相同**。用固定夹具
量到 68.3%，用真实会话的 brief 量到 98.6%——8512 字里只有 123 字随业务变化，
而那 123 字全是 enum 选项名和内容清单，没有一个字关于"怎么排"。

图标处方（每张 KPI 卡左上角一个 40~48px 圆角色块底座）和间距/圆角/阴影刻度
加起来 1618 字，是这份提示词里最"教人怎么画"的部分，也是每个业务拿到的
同一份处方。药房和大棚照着同一份处方画，画出来自然是同一张脸。

这组测试锁住拆完之后的三条纪律：

① **兜底必须逐字节等于改造前**——改写失败是常态（LLM 会超时、会被限流），
   回落路径不能顺手"顺便改进一下"，否则失败路径就成了没人验过的第三种行为。
② **回落是静默的、无条件的**——任何异常、空回复、短回复都回落，绝不上抛。
   这一段是加分项，把主生成路径拖挂了就是负收益。
③ **预算不够就不跑**——这一步嵌在 monitor.design 里面，而 design 自己的准入线
   只有 130s。卡着准入线进来再花 40s 改写，留给出版式的只剩 90s，结果不是
   "版式朴素一点"而是版式整段失败、首页退回固定骨架。
"""

import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import services.freeform_block as fb  # noqa: E402

_DM = {
    "entities": [
        {
            "id": "order",
            "name": "订单",
            "fields": [
                {"id": "amount", "name": "金额", "type": "number"},
                {
                    "id": "state",
                    "name": "状态",
                    "type": "enum",
                    "options": [{"id": "a", "label": "待办"}, {"id": "b", "label": "完成"}],
                },
            ],
        }
    ]
}


def _prompt(**kw):
    return fb.build_freeform_prompt("某某系统的首页总览", _DM, device="desktop", **kw)


# ---- ① 兜底逐字节等于改造前 -------------------------------------------------


def test_icon_contract_has_no_unfilled_placeholder():
    """契约是模板不是成品：搬成模块常量之后 f-string 没了，图标清单得自己填。

    这条锁的是一个真实的踩空：原文里 `{json.dumps(...)}` 是 f-string 就地插值，
    直接当普通字符串用会把这串源码原样发给模型。
    """
    text = fb._icon_contract()
    assert "{icon_list}" not in text
    assert "json.dumps" not in text
    assert "WalletOutlined" in text, "图标清单确实插进去了"


def test_fallback_still_carries_the_old_prescription():
    """图标底座和间距刻度这两条是当初真机踩出来的，兜底路径必须还留着。"""
    text = fb._craft_fallback()
    assert "40~48px" in text            # KPI 卡图标底座
    assert "4、8、12、16、24、32" in text  # 间距刻度


# ---- 图标契约：永远在，跟改写没关系 -----------------------------------------


def test_icon_contract_present_on_both_paths():
    """两页真机产出一个 iconRef 都没有、图标名被当正文写进 text——就是因为
    "挂在 iconRef 字段上"这句话跟着处方一起被搬进了改写范围。

    契约必须**无条件**在提示词里：现写成功也在，回落兜底也在。
    """
    for craft in (None, "随便写点作画要求。" * 20):
        with patch.object(fb, "_refine_craft_via_llm", return_value=craft):
            text = _prompt()
        assert '"iconRef"' in text, "必须写清图标挂在哪个字段上"
        assert "绝不要把图标名写进 text 字段" in text
        assert "fontSize" in text, "图标大小由 fontSize 决定，这是机制不是审美"


def test_icon_contract_not_in_craft_fallback():
    """反向锁：契约不许留在处方里，否则现写成功时它会跟着处方一起消失。"""
    assert "iconRef" not in fb._craft_fallback()


def test_refine_system_prompt_hands_off_the_mechanism():
    """改写系统提示必须告诉改写 LLM「怎么挂由系统交代」。

    不说这一句，它会以为图标这块全归自己管，写出"图标统一 16px"这种
    只讲外观、不讲挂载的要求，下游就没有依据去写 iconRef。
    """
    assert "系统已经另外交代过了" in fb._FREEFORM_CRAFT_REFINE_SYSTEM


# ---- ② 回落静默、无条件 -----------------------------------------------------


def test_prompt_falls_back_when_refine_returns_none():
    with patch.object(fb, "_refine_craft_via_llm", return_value=None):
        assert "40~48px" in _prompt()
    with patch.object(fb, "_refine_craft_via_llm", return_value=""):
        assert "40~48px" in _prompt(), "空串跟 None 一样要回落"


def test_refine_swallows_import_error():
    """连 import 失败也要当"这一步跳过"。

    这是 fail-open 里最容易漏的一格：`from sliderule_llm.client import ...`
    原本写在 try 外面，模块缺失/循环导入会直接把 build_freeform_prompt 炸掉，
    首页退回固定骨架——比拿兜底处方画一张同质化的页糟得多。
    """
    with patch.dict(sys.modules, {"sliderule_llm.client": None}):
        assert fb._refine_craft_via_llm("brief", _DM) is None


def test_refine_swallows_llm_error():
    class _Err(Exception):
        pass

    fake = type(sys)("sliderule_llm.client")
    fake.LlmError = _Err
    fake.call_llm_with_retry = lambda *a, **k: (_ for _ in ()).throw(_Err("rate limited"))
    with patch.dict(sys.modules, {"sliderule_llm.client": fake}):
        assert fb._refine_craft_via_llm("brief", _DM) is None


def test_refine_swallows_unexpected_error():
    fake = type(sys)("sliderule_llm.client")
    fake.LlmError = type("LlmError", (Exception,), {})
    fake.call_llm_with_retry = lambda *a, **k: (_ for _ in ()).throw(ValueError("nope"))
    with patch.dict(sys.modules, {"sliderule_llm.client": fake}):
        assert fb._refine_craft_via_llm("brief", _DM) is None


def test_refine_rejects_too_short_reply():
    """短回复不是"简洁的作画要求"，是模型没听懂——当失败处理，别拿去用。"""
    fake = type(sys)("sliderule_llm.client")
    fake.LlmError = type("LlmError", (Exception,), {})
    fake.call_llm_with_retry = lambda *a, **k: type("R", (), {"content": "用蓝色。"})()
    with patch.dict(sys.modules, {"sliderule_llm.client": fake}):
        assert fb._refine_craft_via_llm("brief", _DM) is None


def test_refine_strips_code_fence():
    body = "把告警放在最显眼的位置，" * 20
    fake = type(sys)("sliderule_llm.client")
    fake.LlmError = type("LlmError", (Exception,), {})
    fake.call_llm_with_retry = lambda *a, **k: type("R", (), {"content": f"```\n{body}\n```"})()
    with patch.dict(sys.modules, {"sliderule_llm.client": fake}):
        got = fb._refine_craft_via_llm("brief", _DM)
    assert got is not None and not got.startswith("```")


# ---- ③ 预算不够就不跑 -------------------------------------------------------


def test_refine_skipped_when_budget_low():
    """卡着 design 准入线（130s）进来时不许再花 40s 改写。"""
    called = []
    fake = type(sys)("sliderule_llm.client")
    fake.LlmError = type("LlmError", (Exception,), {})
    fake.call_llm_with_retry = lambda *a, **k: called.append(1)
    with patch.dict(sys.modules, {"sliderule_llm.client": fake}), patch.object(
        fb, "remaining_run_budget_seconds", return_value=150.0
    ):
        assert fb._refine_craft_via_llm("brief", _DM) is None
    assert called == [], "预算不够时根本不该发起 LLM 调用"


def test_refine_runs_when_budget_absent():
    """拿不到预算上下文（单测/离线调用）时照常跑——与 palette/design 两处一致。"""
    body = "把告警放在最显眼的位置，" * 20
    fake = type(sys)("sliderule_llm.client")
    fake.LlmError = type("LlmError", (Exception,), {})
    fake.call_llm_with_retry = lambda *a, **k: type("R", (), {"content": body})()
    with patch.dict(sys.modules, {"sliderule_llm.client": fake}), patch.object(
        fb, "remaining_run_budget_seconds", return_value=None
    ):
        assert fb._refine_craft_via_llm("brief", _DM) is not None


# ---- 拆出来的效果：craft 段确实进了提示词，且能被业务改写 --------------------


def test_refined_craft_replaces_fallback_in_prompt():
    marker = "这一页的重点是让值班的人一眼看到越限的棚。" * 5
    with patch.object(fb, "_refine_craft_via_llm", return_value=marker):
        text = _prompt()
    assert marker in text
    assert "40~48px" not in text, "现写成功时不该再把写死的处方一起塞进去"


def test_contract_sections_survive_regardless_of_craft():
    """契约段（标签/style 白名单/chart 字段）不在改写范围内，两条路径都必须在。

    这条是这次拆分最要命的边界：改写的产物是给「必须过校验的 JSON 树」用的
    作画要求，漏掉契约 → 设计判失败 → 首页退回固定骨架。
    """
    for craft in (None, "随便写点什么作画要求。" * 20):
        with patch.object(fb, "_refine_craft_via_llm", return_value=craft):
            text = _prompt()
        assert "只能用安全原子积木拼" in text
        assert "style 对象的 key 只能用这些 CSS 属性名" in text
        assert '"chart"' in text or "chart 字段" in text or "chart" in text
