"""FieldRef 类型契约的棘轮：已知冲突冻结，新增一律拒绝，基线只准变小（2026-08-10）。

## 起因

356 个区块里，32 个 `*FieldRef` 名字被要求成多种类型。但先分清两件事：

  · **同名冲突本身不会让闸判错** —— 闸按区块查该区块声明的类型，两个区块
    各查各的；提示词也是按区块渲染的（`_format_binding_schema` 会输出
    `descFieldRef(text field)`），模型被如实告知过。
  · **真正让闸拦人的是"要求了模型几乎不产出的类型"** —— 改之前全目录 1029 处
    类型要求里 `text` 只有 12 处、`ref` 只有 3 处。线上日志那条
    `page.pages[case_kanban]…descFieldRef must be a text field (got 'string')`
    就是 `KanbanBoard` 声明 text 造成的。

所以这一轮把 15 处 `text`/`ref` 全改成 `string`（运行期同为字符串，渲染器不动），
剩下 27 个"同名不同义"（errorFieldRef 在 metrics 是错误数、在 monitor 是错误
信息）留待逐个改名，先用棘轮锁住不再增长。
"""

import json
from pathlib import Path

import pytest

CATALOG = json.loads(
    (Path(__file__).resolve().parent.parent / "services/data/experience_block_catalog.json")
    .read_text(encoding="utf-8")
)


def _types_by_field() -> dict:
    out: dict = {}
    for b in CATALOG["blocks"]:
        for f, t in ((b.get("bindingSchema") or {}).get("entityFieldRefs") or {}).items():
            out.setdefault(f, set()).add(t)
    return out


def test_契约里不再出现稀有类型():
    """text / ref 是模型几乎不产出的类型，要求它就是给自己挖坑。

    改之前：text 12 处、ref 3 处，全目录 1029 处里占 1.5%。
    """
    seen = {t for types in _types_by_field().values() for t in types}
    assert "text" not in seen, "text 只占 1.5%，模型不会自发产出，要求它必然过不了闸"
    assert "ref" not in seen, "ref 同理"


def test_基线记录的就是当前实际的冲突():
    baseline = {k: set(v) for k, v in CATALOG["fieldRefTypeConflicts"].items()}
    actual = {f: t for f, t in _types_by_field().items() if len(t) > 1}
    assert baseline == actual, (
        f"基线与实际不一致。多出来的: {set(baseline) - set(actual)}；"
        f"没记上的: {set(actual) - set(baseline)}"
    )


def test_单一类型的名字不许出现在基线里():
    """基线是债务清单，还清了就得划掉——否则它会变成永远不清的垃圾场。"""
    types = _types_by_field()
    stale = [f for f in CATALOG["fieldRefTypeConflicts"] if len(types.get(f, set())) <= 1]
    assert not stale, f"这些已经统一了，请从 fieldRefTypeConflicts 删掉: {stale}"


def test_棘轮真的会拦住新增冲突():
    """判据对 ≠ 接线对：直接喂一份带新冲突的目录给校验函数。"""
    from services.schema_legal import _assert_field_ref_type_ratchet

    good = tuple(
        {"bindingSchema": {"entityFieldRefs": dict((b.get("bindingSchema") or {}).get("entityFieldRefs") or {})}}
        for b in CATALOG["blocks"]
    )
    _assert_field_ref_type_ratchet(good)  # 现状必须通过

    # 给一个本来单一类型的名字加第二种类型 → 必须炸
    poisoned = good + (
        {"bindingSchema": {"entityFieldRefs": {"titleFieldRef": "number"}}},
    )
    with pytest.raises(ValueError, match="titleFieldRef"):
        _assert_field_ref_type_ratchet(poisoned)


def test_棘轮也拦住_基线内名字换类型():
    from services.schema_legal import _assert_field_ref_type_ratchet

    field = next(iter(CATALOG["fieldRefTypeConflicts"]))
    blocks = tuple(
        {"bindingSchema": {"entityFieldRefs": dict((b.get("bindingSchema") or {}).get("entityFieldRefs") or {})}}
        for b in CATALOG["blocks"]
    ) + ({"bindingSchema": {"entityFieldRefs": {field: "date"}}},)
    with pytest.raises(ValueError, match=field):
        _assert_field_ref_type_ratchet(blocks)


def test_每个区块都标了_generality():
    """未标注的对搜索排序那条规则是隐形的（GENERALITY_BOOST 读它）。"""
    missing = [b["type"] for b in CATALOG["blocks"] if not b.get("generality")]
    assert not missing, f"{len(missing)} 个没标 generality: {missing[:10]}"
