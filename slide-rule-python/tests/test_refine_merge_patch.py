"""精修改成收补丁（RFC 7386）—— 没提到的段必须**结构上**不可能被动。

## 为什么走到这一步

2026-08-16 一整天在治同一个病，三次修复逐级推进：

    48ffe604  指令能到达生成层                  必要，不够
    0f5686e5  精修提示词不再自相矛盾            必要，不够
    fef97cb3  精修模式提到主循环之前            **保住了结构**（菜单 3/3、页面不丢）

线上干净复测 sr-20260816201658（指令针对确实存在的页面，还明写「其他页面不要
动」）：

    菜单保留   3 / 3   ✓
    逐段指纹   0 / 6   ✗   workflow、rbac 跟指令毫不相干，照样全变

前三条都是在**求模型自觉**，到此为止。Merge Patch 把它变成结构问题：模型只被
允许输出要改的那部分，其余由代码从基线合并——**没提到的段想变也变不了**。

## 判据落在哪

不测"模型听不听话"（要真调 LLM 且不稳定）。测的是**合并这一层的行为**：
给一份只动 datamodel 的补丁，合并结果里 workflow/rbac 必须与基线**同一个对象值**。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from services import v5_llm_generate as gen  # noqa: E402
from services.merge_patch import looks_like_full_model, merge_patch  # noqa: E402

BASE = {
    "datamodel": {"entities": [{"id": "alert", "name": "预警"}]},
    "workflow": {"nodes": [{"id": "n1"}]},
    "rbac": {"roles": ["admin"]},
    "page": {"pages": [{"id": "p1", "name": "监控大屏"}]},
    "aigc": {"caps": []},
    "appbundle": {"appIdentity": {"productName": "康养平台"}},
}


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv("SLIDERULE_REFINE_MERGE_PATCH", raising=False)
    gen.set_refine_context(None)
    yield
    gen.set_refine_context(None)


# ── RFC 7386 本身（照规范第 2 节的例子）────────────────────────────────

def test_rfc7386_null_deletes_rather_than_sets_null():
    """null 是**删除**，不是"设成 null"。规范唯一的语义陷阱，别"改良"。"""
    assert merge_patch({"a": 1, "b": 2}, {"b": None}) == {"a": 1}


def test_rfc7386_arrays_are_replaced_wholesale():
    """数组整体替换，不逐项合并 —— 规范定的（数组走 else 分支）。"""
    assert merge_patch({"a": [1, 2, 3]}, {"a": [4]}) == {"a": [4]}


def test_rfc7386_nested_objects_merge_recursively():
    got = merge_patch({"a": {"x": 1, "y": 2}}, {"a": {"y": 9}})
    assert got == {"a": {"x": 1, "y": 9}}


def test_merge_does_not_mutate_the_baseline():
    """基线是版本史里的对象，被就地改掉的话历史就被污染了。"""
    base = {"a": {"x": 1}}
    merge_patch(base, {"a": {"x": 2}})
    assert base == {"a": {"x": 1}}, "基线被就地改了"


# ── 接到生成链路上之后的行为 ───────────────────────────────────────────

def test_untouched_sections_stay_identical_to_the_baseline():
    """主判据：补丁只动 datamodel → workflow/rbac 必须与基线一模一样。

    这就是线上那 0/6 要变成的东西。
    """
    gen.set_refine_context(BASE, "给预警列表加些模拟数据")
    patch = {"datamodel": {"entities": [{"id": "alert", "name": "预警", "seed": [1, 2]}]}}

    merged = gen._apply_refine_patch(patch)

    assert merged["workflow"] == BASE["workflow"], "没提到的 workflow 被动了"
    assert merged["rbac"] == BASE["rbac"], "没提到的 rbac 被动了"
    assert merged["page"] == BASE["page"], "没提到的 page 被动了"
    assert merged["datamodel"]["entities"][0]["seed"] == [1, 2], "补丁没生效"


def test_a_partial_patch_becomes_a_complete_model():
    """补丁只有一段，合并后必须六段齐全 —— 否则后面的完整性校验会判"缺段"。"""
    gen.set_refine_context(BASE, "改点东西")
    merged = gen._apply_refine_patch({"page": {"pages": [{"id": "p1", "name": "改了名"}]}})
    for s in ("datamodel", "workflow", "rbac", "page", "aigc", "appbundle"):
        assert s in merged, f"合并后缺 {s}"


def test_model_ignoring_the_patch_contract_is_taken_as_a_whole_model():
    """模型不配合、吐了整份 → **不合并**，按整份走（行为同修复前）。

    ⚠ 这条判据的第一版写的是"合并等价于整份替换"，测试当场打脸：
    Merge Patch 是**递归**合并，整份补丁会跟基线逐键混合，基线里那些新版本
    本该丢掉的键会留下来——拿到 {'nodes': [...], 'totally': 'different'} 这种
    缝合怪，比整份替换更糟。所以整份必须走"不合并"这条路。
    """
    gen.set_refine_context(BASE, "改点东西")
    full = {k: {"totally": "different"} for k in BASE}
    assert looks_like_full_model(full, tuple(BASE)) is True
    merged = gen._apply_refine_patch(full)
    assert merged["workflow"] == {"totally": "different"}, "整份被合并了，混进了基线的旧键"
    assert "nodes" not in merged["workflow"], "基线的 nodes 泄漏进来了 —— 缝合怪"


def test_non_refine_generation_is_untouched():
    """非精修（首轮生成）原样放行 —— 不能顺手把首次生成也当补丁合并。

    代价判据：首轮没有基线，误合并会拿 None 当底。
    """
    assert gen.get_refine_context() is None
    payload = {"datamodel": {"entities": []}}
    assert gen._apply_refine_patch(payload) is payload


def test_the_env_switch_can_turn_it_off(monkeypatch):
    """留退路：线上出事要能一条环境变量退回整份语义。"""
    monkeypatch.setenv("SLIDERULE_REFINE_MERGE_PATCH", "0")
    gen.set_refine_context(BASE, "改点东西")
    payload = {"datamodel": {"entities": []}}
    assert gen._apply_refine_patch(payload) is payload, "开关关掉了却还在合并"


def test_merge_failure_does_not_break_generation(monkeypatch):
    """合并是优化，它自己炸了不能拖垮一次能正常跑完的生成。"""
    gen.set_refine_context(BASE, "改点东西")
    import services.merge_patch as mp

    monkeypatch.setattr(mp, "merge_patch", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    payload = {"datamodel": {"entities": []}}
    assert gen._apply_refine_patch(payload) is payload


def test_the_prompt_asks_for_a_patch_not_a_full_model():
    """提示词得真的要补丁 —— 合并层再对，模型交整份也白搭。"""
    gen.set_refine_context(BASE, "给预警列表加些模拟数据")
    tail = gen._build_user_content("给社区养老服务站做一套系统")[-600:]
    assert "Merge Patch" in tail or "merge patch" in tail.lower(), "末尾没有要补丁"
    assert "NOT the full model" in tail, "没有明确排除『整份』"


def test_the_merge_is_actually_wired_into_generation():
    """合并函数写对了 ≠ 它被调用了。

    ⚠ 这条是补上来的：变异验证时把 `model = _apply_refine_patch(model)` 从
    generate_five_system_model 里删掉，上面 11 条**照样全绿**——它们只直接调
    _apply_refine_patch，从没验证它接在链路上。这就是本仓反复记的
    "闸全绿但东西没了"，差点又栽一次。

    源码判据，先剥注释（本文件注释里就写着这个函数名，不剥必然假绿）。
    """
    import inspect
    import re

    src = inspect.getsource(gen)
    code = re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))

    fn_at = code.index("def generate_five_system_model")
    body = code[fn_at:]
    call_at = body.find("_apply_refine_patch(model)")
    check_at = body.find("all(section in model for section in _REQUIRED_SECTIONS)")

    assert call_at > -1, "生成链路里没调 _apply_refine_patch —— 合并层是死代码"
    assert check_at > -1, "找不到完整性校验，判据锚点失效"
    assert call_at < check_at, (
        "合并排在完整性校验之后 —— 补丁只含一两段，会先被判「缺段」打回"
    )
