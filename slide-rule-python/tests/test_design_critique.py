# -*- coding: utf-8 -*-
"""设计评审的维度、证据与护栏（2026-08-04）。

## 为什么这些护栏是必须的

UICrit（UIST'24，google-research-datasets/uicrit）拿 3059 条专业设计师批评
做过实测：**zero-shot 让模型自由评审 UI，只有 13.1% 的意见有效**。而这条
链路上的修订是**直接采纳**的——没有护栏就等于让一个八成说胡话的评审去改
用户的页面。

三条护栏对应该论文的三个结论：
① 能算准的交给 axe-core（deterministic，官方口径 no false positives），
   不进模型的主观判断；
② 维度白名单 + 强制两段式「standard/observed」——真实批评的固定结构，
   必须先说出依据的标准，就很难凭空编问题；
③ 修订不许把内容改少，且必须过深校验——想变好不能反而变坏。
"""

import json

import pytest
from pydantic import BaseModel, ValidationError

from services.freeform_block import (
    _count_nodes,
    _critique_against_reference,
    _format_axe_evidence,
)


class TestNodeCount:
    def test_递归数整棵树(self):
        tree = {"tag": "div", "children": [
            {"tag": "div", "children": [{"tag": "span"}]},
            {"tag": "p"},
        ]}
        assert _count_nodes(tree) == 4

    def test_非字典与空树算零(self):
        assert _count_nodes(None) == 0
        assert _count_nodes("x") == 0
        assert _count_nodes({"tag": "div"}) == 1


class TestAxeEvidence:
    def test_没有违规就不占篇幅(self):
        assert _format_axe_evidence([]) == ""
        assert _format_axe_evidence(None) == ""

    def test_明说是算出来的硬事实而非主观判断(self):
        out = _format_axe_evidence([
            {"id": "color-contrast", "impact": "serious", "count": 2,
             "help": "Elements must meet minimum color contrast ratio thresholds",
             "sample": ["insufficient color contrast of 1.65 (foreground color: #c9c9c9)"]},
        ])
        # 模型要能分清「必须修的硬问题」和「它自己的主观建议」
        assert "不是主观判断" in out and "必须修" in out
        assert "color-contrast" in out
        assert "1.65" in out  # 确切数值要带上，这是 LLM 给不出的精度

    def test_条数封顶不撑爆上下文(self):
        many = [{"id": f"r{i}", "impact": "minor", "count": 1, "help": "h", "sample": []}
                for i in range(20)]
        assert _format_axe_evidence(many).count("- r") <= 6


class _FakeDesign(BaseModel):
    """替身 schema：只要求有 root，够用来测护栏分支。"""

    root: dict


def _fake_llm(monkeypatch, content: str):
    import services.freeform_block as fb

    class _Res:
        def __init__(self, c):
            self.content = c

    monkeypatch.setattr(
        fb, "call_llm_with_retry", lambda *a, **k: _Res(content), raising=False
    )
    # call_llm_with_retry 是函数体内 import 的，得改到源模块上
    import sliderule_llm.client as cli

    monkeypatch.setattr(cli, "call_llm_with_retry", lambda *a, **k: _Res(content))


ORIGINAL = {"root": {"tag": "div", "children": [
    {"tag": "div", "children": [{"tag": "span"}]},
    {"tag": "p"},
]}}


def _critique(monkeypatch, content):
    _fake_llm(monkeypatch, content)
    return _critique_against_reference(
        ORIGINAL,
        reference_image_b64="AA==",
        preview_screenshot_b64="BB==",
        design_brief="测试",
        FreeformDesign=_FakeDesign,
        axe_violations=[],
    )


class TestGuardrails:
    def test_修订把内容改少了要被拒(self, monkeypatch, capsys):
        """UICrit 高幻觉率的另一面：模型会自信地「精简」掉不该删的东西。"""
        shrunk = json.dumps({"findings": [], "design": {"root": {"tag": "div"}}})
        assert _critique(monkeypatch, shrunk) is None
        assert "改少了" in capsys.readouterr().out

    def test_节点数持平或变多才采纳(self, monkeypatch):
        grown = json.dumps({"findings": [], "design": {"root": {"tag": "div", "children": [
            {"tag": "div", "children": [{"tag": "span"}]},
            {"tag": "p"}, {"tag": "p"},
        ]}}})
        got = _critique(monkeypatch, grown)
        assert got is not None
        assert _count_nodes(got["root"]) == 5

    def test_没问题时返回_None_用原版(self, monkeypatch):
        assert _critique(monkeypatch, json.dumps({"findings": [], "design": None})) is None

    def test_兼容老口径_GOOD(self, monkeypatch):
        assert _critique(monkeypatch, '"GOOD"') is None

    def test_深校验不过就丢弃修订(self, monkeypatch):
        bad = json.dumps({"findings": [], "design": {"没有root字段": 1}})
        assert _critique(monkeypatch, bad) is None

    def test_深校验失败日志包含具体字段路径与原因(self, monkeypatch, capsys):
        class _StrictNode(BaseModel):
            tag: str

        class _StrictDesign(BaseModel):
            root: _StrictNode

        _fake_llm(
            monkeypatch,
            json.dumps({"findings": [], "design": {"root": {"tag": 7}}}),
        )
        assert _critique_against_reference(
            ORIGINAL,
            reference_image_b64="AA==",
            preview_screenshot_b64="BB==",
            design_brief="测试",
            FreeformDesign=_StrictDesign,
            axe_violations=[],
        ) is None
        out = capsys.readouterr().out
        assert "root.tag" in out
        assert "string" in out.lower()

    def test_不是_JSON_就丢弃(self, monkeypatch):
        assert _critique(monkeypatch, "这一版挺好的，不用改") is None

    def test_评审意见要留痕(self, monkeypatch, capsys):
        """否则 revised=0 永远分不清「确实没问题」还是「它根本没在看」。"""
        payload = json.dumps({
            "findings": [{"dimension": "层级", "standard": "最重要的信息应视觉主导",
                          "observed": "三个 KPI 字号一致，看不出主次"}],
            "design": None,
        })
        _critique(monkeypatch, payload)
        out = capsys.readouterr().out
        assert "评审意见[层级]" in out
        assert "最重要的信息应视觉主导" in out
        assert "看不出主次" in out


class TestPromptDiscipline:
    """prompt 是这套东西的核心资产，几条硬纪律用源码断言钉住。"""

    def _prompt_src(self):
        import inspect

        import services.freeform_block as fb

        return inspect.getsource(fb._critique_against_reference)

    def test_维度白名单在场且带实证占比(self):
        src = self._prompt_src()
        for dim in ["图标与文案", "视觉层级", "可点击元素", "一致性", "字号与字重", "对齐与边界", "留白与密度"]:
            assert dim in src, f"缺维度：{dim}"
        assert "20.6%" in src and "13.6%" in src  # 权重来自 11328 条真实批评

    def test_强制两段式(self):
        src = self._prompt_src()
        assert "standard" in src and "observed" in src
        assert "写不出「标准」的意见一律不要提" in src

    def test_明令不许删已有内容(self):
        assert "不要删掉已有的卡片" in self._prompt_src()

    def test_图表占位仍然明确排除(self):
        # 这一步没有真实行数据，图表必然是占位——不排除掉会引来一堆假问题
        assert "暂无数据" in self._prompt_src()
