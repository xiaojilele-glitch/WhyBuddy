"""page-only 精修合并实体字段：并集，不是整个换掉（2026-08-24）。

## 现场

验证「页面-only 精修落库时开新版本」那个修复时，在隔离实例上跑通一次真实
的 page-only 短路（锁死图判种子、其余全走真代码：真 LLM、真 bind、真落库）。
真机图书馆那趟应用里，字段本就散在多个页面上（读者姓名/电话在档案页，
借书证状态在借还台页）——检查那一轮的落库结果时，没有观察到字段丢失，
但读代码发现这是**巧合**：那一轮碰巧被重画的那一页恰好覆盖了「读者」实体
的全部字段，不是这段代码本来就安全。

## 病灶

`overlay_page_only_model` 只送**这一次重画的那一页** HTML 去反推结构
（spec_first_pipeline 第 4 步只喂 `_redrawn_html`，照搬页不送）。旧写法是：

    for entity in new_entities:          # 这一页反推出来的实体
        old_ents[entity["id"]] = _as_dm_entity(entity)   # ← 整个换掉

如果实体的字段散在多个页面，只重画其中一页时，反推结构只看得到**这一页**
用到的那几个字段。整个换掉 = 只在别的页面（这次没重画、原样照搬）才用到的
字段，从 datamodel 上**凭空消失**——不是被删了，是"这一页没提到，重新认
的时候把它认丢了"。照搬页的 HTML 里那个 `data-field="reader.card_status"`
绑定还在，指向的字段却从模型里没了：静默的悬空引用，不报错、不告警，正是
本仓第三条说的"正向判据齐全、反向判据缺失"那个形状——`test_refine_short_circuit.py`
里原有那条测试只断言"没碰到的段（rbac/workflow/aigc）保持不变"，从没断言过
"碰到的这一段（datamodel）不许丢东西"。

## 判据

不盯"有没有调 _merge_entity_into"，盯**合并前存在、这一页没提到的字段**
在合并后还在不在——用户没删的字段，模型不许替他删。

变异验证（写完必做，纪律二）：把合并逻辑改回"整个替换"（`old_ents[eid] =
fresh_entity`，不分新旧实体），下面核心那条必红。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.refine_short_circuit import overlay_page_only_model


def _reuse_model(reader_fields):
    """一个「读者」实体的字段散在多页——档案页与借还台页各用各的那几个。"""
    return {
        "datamodel": {"entities": [
            {"id": "reader", "name": "读者", "fields": reader_fields},
            {"id": "book", "name": "图书", "fields": [
                {"id": "isbn", "name": "ISBN", "type": "string"},
            ]},
        ]},
        "rbac": {"roles": [], "permissions": [], "menus": []},
        "workflow": {"nodes": []},
        "page": {"pages": [
            {"id": "archive", "name": "档案页", "fieldBindings": ["reader.name", "reader.phone"]},
            {"id": "desk", "name": "借还台页", "fieldBindings": ["reader.card_status"]},
        ]},
        "aigc": {"capabilities": []},
        "appbundle": {
            "landingPageRef": "archive", "preferredDevice": "desktop",
            "pageBindings": [], "roleRefs": [], "dataModelRefs": ["reader", "book"],
            "appIdentity": {"appName": "借阅通"},
        },
    }


ALL_READER_FIELDS = [
    {"id": "name", "name": "姓名", "type": "string"},
    {"id": "phone", "name": "电话", "type": "string"},
    {"id": "card_status", "name": "借书证状态", "type": "string"},
]

REUSE_MODEL = _reuse_model(ALL_READER_FIELDS)

# 只重画「档案页」，结构步只喂档案页 HTML → 只反推得出「读者」在档案页
# 能看到的那两个字段（name、phone）。借还台页那个 card_status 没被送去
# 反推，不该出现在这次的 structure 输出里。
STRUCTURE_ONLY_ARCHIVE_PAGE = {
    "entities": [
        {"id": "reader", "name": "读者", "fields": [
            {"id": "name", "name": "姓名", "type": "string"},
            {"id": "phone", "name": "电话", "type": "string"},
        ]},
    ],
}


def _fields(model, entity_id):
    ent = next(e for e in model["datamodel"]["entities"] if e["id"] == entity_id)
    return {f["id"] for f in ent["fields"]}


class Test只重画一页时不许丢掉别的页在用的字段:
    def test核心_借还台页用的card_status在只重画档案页之后还在(self):
        """★★ 这是本文件要钉的那个 bug。"""
        out = overlay_page_only_model(REUSE_MODEL, STRUCTURE_ONLY_ARCHIVE_PAGE)
        got = _fields(out, "reader")
        assert "card_status" in got, (
            f"借还台页在用的 card_status 字段丢了（合并逻辑把整个实体换成了"
            f"只重画的那一页看到的字段）：现存 {got}"
        )
        assert got == {"name", "phone", "card_status"}, f"字段集合不对：{got}"

    def test_未涉及的实体原样不动(self):
        """book 实体这一轮结构步压根没提到，必须保持原样——这是既有测试
        `test_overlay不改rbac和workflow` 的同门兄弟，只是换成了 datamodel。"""
        out = overlay_page_only_model(REUSE_MODEL, STRUCTURE_ONLY_ARCHIVE_PAGE)
        assert _fields(out, "book") == {"isbn"}


class Test反向_合并不能变成从不更新:
    """上面那条治的是"丢字段"。反过来同样重要：这一页新增的字段、或者
    这一页把某个字段重新描述了一遍（改了 name/type），必须真的生效——
    否则"并集"退化成"只认第一次见到的版本"，用户在页面上加的新列永远
    进不了模型。"""

    def test_这一页新增的字段必须合进去(self):
        structure = {
            "entities": [
                {"id": "reader", "name": "读者", "fields": [
                    {"id": "name", "name": "姓名", "type": "string"},
                    {"id": "phone", "name": "电话", "type": "string"},
                    {"id": "overdue_count", "name": "累计逾期次数", "type": "number"},
                ]},
            ],
        }
        out = overlay_page_only_model(REUSE_MODEL, structure)
        got = _fields(out, "reader")
        assert got == {"name", "phone", "card_status", "overdue_count"}, (
            f"新增字段 overdue_count 没有合进去：{got}"
        )

    def test_这一页重新描述过的字段_类型真的会刷新(self):
        structure = {
            "entities": [
                {"id": "reader", "name": "读者", "fields": [
                    {"id": "name", "name": "姓名", "type": "string"},
                    # 这一页把 phone 从 string 改判成 phone 类型
                    {"id": "phone", "name": "联系电话", "type": "phone"},
                ]},
            ],
        }
        out = overlay_page_only_model(REUSE_MODEL, structure)
        ent = next(e for e in out["datamodel"]["entities"] if e["id"] == "reader")
        phone = next(f for f in ent["fields"] if f["id"] == "phone")
        assert phone["type"] == "phone", "这一页重新识别出的类型没有刷新进去"
        assert phone["name"] == "联系电话"

    def test_真正的新实体仍然整段收进来(self):
        structure = {
            "entities": [
                {"id": "reservation", "name": "预约单", "fields": [
                    {"id": "id_no", "name": "预约号", "type": "string"},
                ]},
            ],
        }
        out = overlay_page_only_model(REUSE_MODEL, structure)
        ids = {e["id"] for e in out["datamodel"]["entities"]}
        assert "reservation" in ids
        assert _fields(out, "reservation") == {"id_no"}
        # 旧实体（reader/book）原样都在——新实体是"加"，不是"换"
        assert ids == {"reader", "book", "reservation"}


class Test字段顺序稳定:
    """老字段位置不因为合并而挪动，只有真正新增的字段追加到末尾——
    可读性判据，不是硬约束，但漂移会让 diff 变得难审。"""

    def test_老字段位置不变_新字段追加在最后(self):
        structure = {
            "entities": [
                {"id": "reader", "name": "读者", "fields": [
                    {"id": "phone", "name": "电话（刷新过）", "type": "string"},
                    {"id": "overdue_count", "name": "累计逾期次数", "type": "number"},
                ]},
            ],
        }
        out = overlay_page_only_model(REUSE_MODEL, structure)
        ent = next(e for e in out["datamodel"]["entities"] if e["id"] == "reader")
        ordered_ids = [f["id"] for f in ent["fields"]]
        assert ordered_ids == ["name", "phone", "card_status", "overdue_count"], ordered_ids
