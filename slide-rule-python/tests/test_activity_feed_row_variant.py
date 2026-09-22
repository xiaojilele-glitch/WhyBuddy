"""ActivityFeed 宽行档：variant + detailFieldRefs 的账本、校验与文案。

起因是拿参考图跟真实渲染对照：参考图把动态流画成一条满宽的信息行
（状态 | 单号 | 描述 | 关联单据 | 时间），真实渲染是一条窄时间轴，右边三分之二
全空。宽度不是 bug——积木拿到的就是满宽，是时间轴这个形态撑不满。

`detailFieldRefs` 是**数组型字段引用**，目录里第一个用上 entityFieldRefLists
的绑定键。校验口径必须跟单值的 entityFieldRefs 一样严：引用不存在的字段会让
渲染端画出一列空白，而空白列跟"这条记录这个字段没填"在界面上长得一模一样。
"""

from services.schema_legal import EXPERIENCE_BLOCK_BINDING_SCHEMAS, EXPERIENCE_BLOCKS
from services.v5_model_gate import validate_five_system_model

DATAMODEL = {
    "entities": [
        {
            "id": "batch",
            "name": "批次",
            "fields": [
                {"id": "code", "name": "批次号", "type": "string"},
                {"id": "roasted_at", "name": "烘焙日期", "type": "date"},
                {"id": "weight", "name": "出豆重量", "type": "number"},
                {
                    "id": "status",
                    "name": "状态",
                    "type": "enum",
                    "options": [{"id": "done", "label": "已完成"}],
                },
            ],
        },
        {
            "id": "bean",
            "name": "生豆",
            "fields": [{"id": "origin", "name": "产地", "type": "string"}],
        },
    ]
}


# blockRef（把现成积木嵌进 freeform 设计树）自 2026-08-03 起整体删除——逐行
# 内容改由设计模型用 rowsRef 自己画，见 freeform_block.RowsRef。原先这里那批
# "ActivityFeed 的 row 档 / detailFieldRefs 走 freeform 内嵌路径"的深校验用例
# 随机制一并移除；detailFieldRefs 本身仍然有效（业务页的 page.blocks 还在用），
# 由下面的 Gate 段守着。


def test_catalog_declares_variant_and_detail_refs():
    entry = next(b for b in EXPERIENCE_BLOCKS if b["type"] == "ActivityFeed")
    variant = entry["propsSchema"]["properties"]["variant"]
    # 第一个取值是默认档——prompt 里明说"不写按第一个算"，顺序是契约不是巧合
    assert variant["enum"] == ["timeline", "row"]
    schema = EXPERIENCE_BLOCK_BINDING_SCHEMAS["ActivityFeed"]
    assert "detailFieldRefs" in schema["optional"]
    assert schema["entityFieldRefLists"]["detailFieldRefs"]["maxItems"] == 3

# ── Gate 校验（page.blocks 路径）───────────────────────────────────────


# 复用 gate 测试那份完整模型：Gate 在缺技能段时会先短路报 missing section，
# 手搓半份模型根本走不到 binding 深校验（第一版就这么写的，四个 case 全空）。
from test_v5_llm_generate_gate import _valid_library_model  # noqa: E402


def _feed_findings(binding):
    model = _valid_library_model()
    model["page"]["pages"][0]["blocks"] = [
        {"id": "feed1", "type": "ActivityFeed", "binding": binding}
    ]
    gate = validate_five_system_model(model)
    return [f for f in gate["findings"] if "detailFieldRefs" in str(f.get("path", ""))]


def _lib_binding(**extra):
    # loan.due_date 是 date、loan.status 是 enum、loan.book_id 是 ref
    return {"entityRef": "loan", "timeFieldRef": "due_date", **extra}


def test_gate_accepts_good_detail_refs():
    assert _feed_findings(_lib_binding(detailFieldRefs=["status", "book_id"])) == []


def test_gate_flags_dangling_detail_ref():
    findings = _feed_findings(_lib_binding(detailFieldRefs=["ghost"]))
    assert findings and "ghost" in findings[0]["message"]


def test_gate_flags_non_array_detail_refs():
    findings = _feed_findings(_lib_binding(detailFieldRefs="status"))
    assert findings and "array of field ids" in findings[0]["message"]


def test_gate_flags_too_many_detail_refs():
    findings = _feed_findings(
        _lib_binding(detailFieldRefs=["status", "book_id", "id", "due_date"])
    )
    assert findings and "at most 3" in findings[0]["message"]
