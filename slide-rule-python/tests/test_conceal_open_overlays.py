# -*- coding: utf-8 -*-
"""首屏关着是生成提示词的事，不在产出后再藏一遍。

2026-08-20 古籍数字资源库：事后 conceal / 消毒层收口是治标。根因是
桌面 purpose 把「新增」写进要画的界面，画页提示词又抄 Tailwind UI 打开态。
把 generate 再接上 conceal_open_overlays，本文件必须红。
"""

import ast
import inspect

from services import spec_page_html as sph
from services.html_bindings import bind_page


def _called_names(fn) -> list:
    tree = ast.parse(inspect.getsource(fn))
    return [
        n.func.id
        for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
    ]


class Test首屏由提示词约束不事后藏:
    def test_generate_page_html_does_not_conceal(self):
        assert "conceal_open_overlays" not in _called_names(sph.generate_page_html)

    def test_edit_page_html_does_not_conceal(self):
        assert "conceal_open_overlays" not in _called_names(sph.edit_page_html)

    def test_bind_page_does_not_conceal(self):
        assert "conceal_open_overlays" not in _called_names(bind_page)

    def test_no_conceal_helper(self):
        assert not hasattr(sph, "conceal_open_overlays")

    def test_contract_requires_rest_state(self):
        """钉的是「首屏是静息态 / 不要画新增表单」，不是事后 hidden。"""
        prompt = sph.build_page_html_prompt("x")
        assert "fixed inset-0" in prompt
        assert "hidden" in prompt
        assert "未打开浮层" in prompt
        assert "at rest" in prompt
        assert "新增" in prompt and "按钮" in prompt
