"""门禁：实体字段的 type 必须落在封闭合法域内（2026-07-29）。

## 为什么补这条

组件覆盖率审查时顺手验了一下"门禁会不会拦住不认识的字段类型"，答案是
**不会**——喂 boolean/datetime/file 三个进去，findings 一条都没有、全放行。
FIELD_TYPES 此前只在技能 binding 那里用过，实体字段的 type 一路没人查，
所谓"合法域"其实只是 prompt 里的一句约定。

## 漏掉的代价：静默降级

不是"模型写错了没人说"这么轻。前端 field-value-type 对认不出的类型一律
`return "text"`，于是一个 `file` 字段会安安静静变成普通文本输入框——
用户以为这儿能传附件，实际只能打字。不报错、不提示、测试也全绿，
只有真去用的人才会发现不对。这类不喊疼的错误最贵。

## 边界：缺省不罚

datamodel 字段语义那一段的既有口径是"出现即校验、缺省不罚"（老模型零破坏）。
不写 type 的字段按 string 处理，跟以前一样过门——这条测试也把它钉住，
免得日后有人把校验收紧成"必须显式声明"，把历史模型全判死。
"""

import copy
import json
from pathlib import Path

import pytest

from services.schema_legal import FIELD_TYPES
from services.v5_model_gate import validate_five_system_model

FIXTURE = Path(__file__).resolve().parent.parent / "services" / "data" / "builtin_domain_models.json"


def _base_model() -> dict:
    """拿一份**冻结的、确定能过门**的真实模型当基线。

    不手搓最小模型：门禁在六段任一为空时会提前 return，手搓的夹具很容易
    在走到字段语义那一段之前就短路，于是测试看着通过、其实什么都没校验到
    （第一版就是这么骗过自己的——appbundle 给了空字典，直接早退）。
    """
    models = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return copy.deepcopy(next(iter(models.values())))


def _with_first_field_type(value) -> dict:
    m = _base_model()
    field = m["datamodel"]["entities"][0]["fields"][0]
    if value is None:
        field.pop("type", None)
    else:
        field["type"] = value
    return m


def _type_findings(verdict: dict) -> list:
    return [f for f in verdict["findings"] if str(f.get("path", "")).endswith(".type")]


def test_baseline_fixture_passes():
    """基线必须先过门，否则下面每条断言都是在测别的东西。"""
    assert validate_five_system_model(_base_model())["passed"]


@pytest.mark.parametrize("bad", ["file", "boolean", "datetime", "image", "json"])
def test_illegal_field_type_is_rejected(bad):
    verdict = validate_five_system_model(_with_first_field_type(bad))
    assert not verdict["passed"], f"{bad} 不该过门"
    hits = _type_findings(verdict)
    assert hits, f"{bad} 被拦下了，但没有指向 .type 的 finding"
    # 报错要点名合法集合——只说"非法"没法让模型自我修正
    assert "/".join(FIELD_TYPES) in hits[0]["message"]


@pytest.mark.parametrize("good", list(FIELD_TYPES))
def test_every_legal_type_passes(good):
    """合法域里的每一个都要放行——参数化跟着 FIELD_TYPES 走，
    日后往账本里加类型，这条会自动覆盖到，不用记得改测试。"""
    verdict = validate_five_system_model(_with_first_field_type(good))
    assert not _type_findings(verdict), f"{good} 是合法类型却被拦"


def test_type_check_is_case_insensitive():
    """模型偶尔会吐 `TEXT`/`Date`。大小写不是错，不该因此拦人。"""
    assert not _type_findings(validate_five_system_model(_with_first_field_type("TEXT")))
    assert not _type_findings(validate_five_system_model(_with_first_field_type(" Date ")))


def test_missing_type_still_passes():
    """缺省不罚：老模型不写 type 的照旧当 string。"""
    verdict = validate_five_system_model(_with_first_field_type(None))
    assert verdict["passed"]
    assert not _type_findings(verdict)


# ── 不吃 binding 的积木（2026-07-29 真跑撞到）────────────────────────


def test_binding_free_block_prompt_says_omit_not_none():
    """prompt 里不能用裸的 "none" 当哨兵——模型会把它当成要填的值。

    真跑撞过：`binding=none (不使用 binding；…)` 这行，四个 QuickActionPanel
    全部产出 `"binding": {"entityRef": "none"}`，门禁报 4 条 entityRef 悬挂。
    哨兵词长得像值就会被当成值，必须写成祈使句。
    """
    from services.schema_legal import EXPERIENCE_BLOCK_BINDING_SCHEMAS, _format_binding_schema

    line = _format_binding_schema(EXPERIENCE_BLOCK_BINDING_SCHEMAS["QuickActionPanel"])
    assert line.startswith("OMIT")
    assert "do NOT emit a `binding` key" in line
    # 裸 none 不能出现在开头（note 正文里出现"不使用 binding"是可以的）
    assert not line.startswith("none")


def test_layout_prompt_forbids_the_slots_wrapper():
    """Step 7 的措辞不能再让"槽位"读起来像个叫 slots 的键。

    原文是 "a layout object with slots summary/primary/..."，真跑一轮里 6 个
    页面全写成了 `layout: {"slots": {...}}`——跟上面那条 binding=none 是同
    一类事故：prompt 里长得像键名的词会被当成键名。这里锁两件事：给了字面
    例子、并且明确点名 `slots` 包装是错的。
    """
    from services.schema_legal import experience_block_prompt_block

    prompt = experience_block_prompt_block()
    step7 = [ln for ln in prompt.splitlines() if "Step 7 — Page layout" in ln]
    assert len(step7) == 1, "Step 7 那行找不到（或重复了）"
    line = step7[0]
    # 2026-08-08：例子跟着区域词汇换（旧的是 "summary": ["kpi_grid"]）。
    # 这条防的东西没变——**长得像键名的词会被当成键名**，所以既要给摊平写法的
    # 字面例子，也要明说 slots 包装是错的。
    assert '"headerExtra": ["kpi_grid"]' in line, "缺少摊平写法的字面例子"
    assert '{"slots": {...}} is WRONG' in line, "没点名 slots 包装是错的"


def test_gate_reports_binding_on_a_binding_free_block():
    """塞了 binding 要直说"这块不该有 binding"，别报成 entityRef 悬挂。

    报"实体找不到"会把人引去查数据模型，而真正该做的是把整个 binding 删掉。
    freeform 的 BlockRef 深校验早就有这条规则，page.blocks 这边漏了。
    """
    from test_v5_llm_generate_gate import _valid_library_model
    from services.v5_model_gate import validate_five_system_model

    model = _valid_library_model()
    model["page"]["pages"][0]["blocks"] = [
        {"id": "qa1", "type": "QuickActionPanel", "binding": {"entityRef": "none"}}
    ]
    findings = [
        f for f in validate_five_system_model(model)["findings"]
        if "qa1" in str(f.get("path", ""))
    ]
    assert findings, "塞了 binding 却没报"
    assert "takes no binding" in findings[0]["message"]
    # 只报这一条，不再顺带报 entityRef 悬挂（那条会误导排查方向）
    assert not any("not found in datamodel.entities" in f["message"] for f in findings)


def test_gate_still_accepts_binding_free_block_without_binding():
    from test_v5_llm_generate_gate import _valid_library_model
    from services.v5_model_gate import validate_five_system_model

    model = _valid_library_model()
    model["page"]["pages"][0]["blocks"] = [{"id": "qa1", "type": "QuickActionPanel"}]
    assert not [
        f for f in validate_five_system_model(model)["findings"]
        if "qa1" in str(f.get("path", ""))
    ]
