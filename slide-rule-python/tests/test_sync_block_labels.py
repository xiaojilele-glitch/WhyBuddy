from scripts.sync_block_labels import block_label_counts, rewrite_catalog_labels


def test_rewrite_removes_non_adjacent_duplicate_block_labels_without_touching_other_labels():
    source = """{
  "pageRegions": {
    "header": {
      "label": "标题操作区"
    }
  },
  "blocks": [
    {
      "type": "Example", "description": "demo",
      "label": "新插入",
      "generality": "generic",
      "label": "旧位置"
    }
  ],
  "pageKindPresets": {}
}"""

    assert block_label_counts(source) == {"Example": 2}

    rewritten, wrote = rewrite_catalog_labels(source, {"Example": "唯一名称"})

    assert wrote == 1
    assert block_label_counts(rewritten) == {"Example": 1}
    assert rewritten.count('"label": "唯一名称"') == 1
    assert '"label": "标题操作区"' in rewritten


def test_rewrite_is_idempotent():
    source = """{
  "blocks": [
    {
      "type": "Example",
      "label": "唯一名称",
      "description": "demo"
    }
  ],
  "pageKindPresets": {}
}"""

    once, _ = rewrite_catalog_labels(source, {"Example": "唯一名称"})
    twice, _ = rewrite_catalog_labels(once, {"Example": "唯一名称"})

    assert twice == once


def test_rewrite_preserves_existing_label_position():
    source = """{
  "blocks": [
    {
      "type": "MetricGrid",
      "generality": "generic",
      "label": "旧名称",
      "description": "指标"
    }
  ],
  "pageKindPresets": {}
}"""

    rewritten, wrote = rewrite_catalog_labels(source, {"MetricGrid": "指标卡"})

    assert wrote == 1
    assert rewritten.index('"generality"') < rewritten.index('"label": "指标卡"')
    assert rewritten.index('"label": "指标卡"') < rewritten.index('"description"')
