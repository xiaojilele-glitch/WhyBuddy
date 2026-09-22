"""binding.*FieldRef 类型不匹配的确定性修复（2026-08-10）。

## 用例全部抄自线上容器日志

一趟真实推演（黑灰产情报自动化分析系统）里结构闸的 4 条裁决，**无一例外**
都是这个形状：

    descFieldRef      'analyst_note' must be a text   field (got 'string')
    actionFieldRef    'action'       must be a string field (got 'enum')
    descFieldRef      'risk_level'   must be a text   field (got 'enum')
    applicantFieldRef 'owner_role'   must be a string field (got 'ref')
    summaryFieldRef   'risk_level'   must be a text   field (got 'enum')

不是悬空引用、不是结构错——模型挑了个语义上合理的字段，只是类型不对。

此前这类没有任何确定性修复（`_repair_block_binding` 只修 entityRef 拼写），
每次都得走一轮 LLM 回喂重生成：**172~208 秒买一个"把 string 改成 text"**。
那趟 loop-1 甚至回喂完仍未过（换了个区块报错），收口 0/6。

而且它必然反复：目录里 entityFieldRefs 共要求 708 处类型，
string 285 / enum 197 / number 155 / date 56 / **text 12** / ref 3 ——
`text` 是 12/708 的少数派，`analyst_note` 这种字段人来标也会标 string。
"""

import pytest

from services.v5_model_repair import _repair_binding_field_types


def _model(fields: dict, entity: str = "case") -> dict:
    return {
        "datamodel": {
            "entities": [
                {
                    "id": entity,
                    "fields": [{"id": fid, "type": t} for fid, t in fields.items()],
                }
            ]
        }
    }


def _block(btype: str, binding: dict, bid: str = "b1") -> dict:
    return {"id": bid, "type": btype, "binding": binding}


def _wants(btype: str) -> dict:
    from services.v5_model_gate import EXPERIENCE_BLOCK_BINDING_SCHEMAS

    return (EXPERIENCE_BLOCK_BINDING_SCHEMAS.get(btype) or {}).get("entityFieldRefs") or {}


@pytest.fixture
def desc_block_type():
    """目录里任意一个对某字段要求 text 的区块类型 —— 判据取自真相源，不写死。"""
    from services.v5_model_gate import EXPERIENCE_BLOCK_BINDING_SCHEMAS

    for btype, schema in EXPERIENCE_BLOCK_BINDING_SCHEMAS.items():
        for field, want in ((schema.get("entityFieldRefs") or {})).items():
            if want == "text":
                return btype, field
    pytest.skip("目录里没有要求 text 的绑定字段")


class Test修好日志里那几条:
    def test_要text给了string_唯一候选直接改(self, desc_block_type):
        btype, field = desc_block_type
        model = _model({"analyst_note": "string", "detail": "text", "title": "string"})
        block = _block(btype, {"entityRef": "case", field: "analyst_note"})
        notes = {}
        out = _repair_binding_field_types(block, model, notes, "p1")
        assert out["binding"][field] == "detail"
        rec = notes["repaired"][0]
        assert rec["from"] == "analyst_note" and rec["to"] == "detail"
        assert "类型要 text" in rec["reason"] and "是 string" in rec["reason"]

    def test_要text给了enum_同样修(self, desc_block_type):
        btype, field = desc_block_type
        model = _model({"risk_level": "enum", "summary_text": "text"})
        block = _block(btype, {"entityRef": "case", field: "risk_level"})
        out = _repair_binding_field_types(block, model, {}, "p1")
        assert out["binding"][field] == "summary_text"


class Test不该动的一律不动:
    def test_类型已经对就不碰(self, desc_block_type):
        btype, field = desc_block_type
        model = _model({"detail": "text", "other": "text"})
        block = _block(btype, {"entityRef": "case", field: "detail"})
        notes = {}
        out = _repair_binding_field_types(block, model, notes, "p1")
        assert out["binding"][field] == "detail"
        assert notes == {}, "没毛病就不该留痕"

    def test_没有类型对的候选就留给门硬拦(self, desc_block_type):
        # fail-closed 不变：修不了就别装作修好了
        btype, field = desc_block_type
        model = _model({"analyst_note": "string", "level": "enum"})
        block = _block(btype, {"entityRef": "case", field: "analyst_note"})
        notes = {}
        out = _repair_binding_field_types(block, model, notes, "p1")
        assert out["binding"][field] == "analyst_note"
        assert notes == {}

    def test_多个候选且分不出高下就不猜(self, desc_block_type):
        # 本文件既有纪律：歧义不猜（_unique_near_match 同款）
        btype, field = desc_block_type
        model = _model({"x": "string", "aaaaaa": "text", "bbbbbb": "text"})
        block = _block(btype, {"entityRef": "case", field: "x"})
        notes = {}
        out = _repair_binding_field_types(block, model, notes, "p1")
        assert out["binding"][field] == "x"
        assert notes == {}

    def test_悬空字段不碰_那是门的_DANGLING_判据(self, desc_block_type):
        # 在这儿猜一把，会把"引用错了"伪装成"引用对了但选得怪"
        btype, field = desc_block_type
        model = _model({"detail": "text"})
        block = _block(btype, {"entityRef": "case", field: "根本不存在的字段"})
        notes = {}
        out = _repair_binding_field_types(block, model, notes, "p1")
        assert out["binding"][field] == "根本不存在的字段"
        assert notes == {}

    def test_实体对不上就不动(self, desc_block_type):
        btype, field = desc_block_type
        model = _model({"detail": "text"}, entity="case")
        block = _block(btype, {"entityRef": "别的实体", field: "whatever"})
        assert _repair_binding_field_types(block, model, {}, "p1")["binding"][field] == "whatever"

    def test_不认识的区块类型_没binding_没entityRef_都安全(self):
        model = _model({"detail": "text"})
        for block in (
            _block("不存在的区块类型", {"entityRef": "case", "descFieldRef": "x"}),
            {"id": "b", "type": "DataTable"},
            _block("DataTable", {"descFieldRef": "x"}),
            {"id": "b", "type": "DataTable", "binding": "不是对象"},
        ):
            _repair_binding_field_types(block, model, {}, "p1")  # 不炸即可


class Test纯函数:
    def test_不改入参(self, desc_block_type):
        btype, field = desc_block_type
        model = _model({"analyst_note": "string", "detail": "text"})
        binding = {"entityRef": "case", field: "analyst_note"}
        block = _block(btype, binding)
        out = _repair_binding_field_types(block, model, {}, "p1")
        assert binding[field] == "analyst_note", "入参被改了"
        assert out["binding"][field] == "detail"
        assert out is not block


class Test接进修复主流程:
    """判据对 ≠ 接线对 —— 走 repair_five_system_model 整条路验一遍。"""

    def test_整模型修复会修掉绑定类型(self, desc_block_type):
        from services.v5_model_repair import repair_five_system_model

        btype, field = desc_block_type
        model = _model({"analyst_note": "string", "detail": "text"})
        model["page"] = {
            "pages": [
                {
                    "id": "p1",
                    "blocks": [_block(btype, {"entityRef": "case", field: "analyst_note"})],
                }
            ]
        }
        out = repair_five_system_model(model)["model"]
        blocks = out["page"]["pages"][0]["blocks"]
        assert blocks[0]["binding"][field] == "detail", "接线没通：整条路没修到绑定类型"

    def test_修完之后门不再报这条(self, desc_block_type):
        """终判：修复的目的是让门放行，所以直接问门。"""
        from services.v5_model_gate import _validate_block_binding

        btype, field = desc_block_type
        model = _model({"analyst_note": "string", "detail": "text"})
        block = _block(btype, {"entityRef": "case", field: "analyst_note"})

        before: list = []
        _validate_block_binding(
            "page.pages[p1].blocks[b1]", btype, block["binding"],
            {"case"}, {"case.analyst_note": "string", "case.detail": "text"}, before,
        )
        assert any(field in f["path"] for f in before), "前置条件不成立：门本来就没报这条"

        fixed = _repair_binding_field_types(block, model, {}, "p1")
        after: list = []
        _validate_block_binding(
            "page.pages[p1].blocks[b1]", btype, fixed["binding"],
            {"case"}, {"case.analyst_note": "string", "case.detail": "text"}, after,
        )
        assert not any(field in f["path"] for f in after), f"修完门还在报：{after}"
