"""刀 3（只重写一块）的路由判据（2026-08-27）。

这一刀最要紧的一条不是"改得动"，是**改完只有这一块变**——旁边那块和页面
其余部分必须一个字节不动。改坏了不会报错，只会是"整页看着变了一点"，
而用户以为自己只改了一块。

⚠ 判据**不打真 LLM，也不 mock 它**：直接测 `slice_block` / `validate_block_body`
  / `replace_block` 这三段纯逻辑，再用 AST 剥掉文档字符串查路由**真的调了它们**。
  LLM 那一跳由 ai-edit-element 那条已有链路覆盖，在这儿重复打只是烧钱和引抖动。

⚠ 变异自查（写完把修复改回去，确认变红）：
    · 去掉 validate_block_body 那句      → 「劫边界的 body 被放行」红
    · replace_block 改成整页重写          → 「旁边那块字节不变」红
    · 把 slice_block 的重名判定去掉        → 「重名直接失败」红
"""

from __future__ import annotations

import ast
import os

import pytest

from services.page_blocks import (
    BLOCK_MARK_ATTR,
    BlockEditError,
    replace_block,
    slice_block,
    validate_block_body,
)

ROUTE_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "routes",
    "sliderule_full.py",
)


def _page(a_body: str = "<p>甲的内容</p>", b_body: str = "<p>乙的内容</p>") -> str:
    return (
        "<html><body><nav>壳</nav>"
        f'<div {BLOCK_MARK_ATTR}="甲" data-block-kind="card">{a_body}</div>'
        "<hr>"
        f'<div {BLOCK_MARK_ATTR}="乙" data-block-kind="table">{b_body}</div>'
        "<footer>底</footer></body></html>"
    )


class TestOnlyThisBlockChanges:
    """⚠ 这一组是整刀的核心。"""

    def test_replace_touches_only_the_named_block(self):
        before = _page()
        after = replace_block(before, "甲", "<p>改过了</p>")
        assert "<p>改过了</p>" in after
        # 反向：旁边那块、壳、页脚一个字节不变
        assert "<p>乙的内容</p>" in after
        assert "<nav>壳</nav>" in after
        assert "<footer>底</footer>" in after
        assert "<p>甲的内容</p>" not in after

    def test_unmanaged_text_is_byte_identical(self):
        """grok managed_text 的 unmanaged_text：两侧一个字节不许动。"""
        before = _page()
        cut = slice_block(before, "甲")
        after = replace_block(before, "甲", "<span>x</span>")
        assert after.startswith(cut["before"] + cut["head"])
        assert after.endswith(cut["tail"] + cut["after"])

    def test_block_head_survives_so_the_name_does_not_change(self):
        """换完不重新打标——名字换了等于用户选中的块换了人。"""
        after = replace_block(_page(), "甲", "<p>x</p>")
        assert f'{BLOCK_MARK_ATTR}="甲"' in after
        assert slice_block(after, "甲")["body"] == "<p>x</p>"

    def test_empty_body_is_allowed_and_still_only_touches_one_block(self):
        after = replace_block(_page(), "甲", "")
        assert slice_block(after, "甲")["body"] == ""
        assert "<p>乙的内容</p>" in after


class TestGatesAreFailClosed:
    def test_body_carrying_the_block_marker_is_rejected(self):
        # 劫边界：body 里写 data-block 能凭空长出一块，下一次 slice 的边界就错了
        with pytest.raises(BlockEditError):
            validate_block_body(f'<div {BLOCK_MARK_ATTR}="偷">x</div>', name="甲")

    def test_unbalanced_tags_are_rejected(self):
        # 多一个闭合标签会把外层的块提前关掉，那一页后半段全被吸进这一块里
        with pytest.raises(BlockEditError):
            validate_block_body("<div><p>x</p></div></div>", name="甲")
        with pytest.raises(BlockEditError):
            validate_block_body("<div><p>x</p>", name="甲")

    def test_script_is_rejected(self):
        with pytest.raises(BlockEditError):
            validate_block_body("<script>alert(1)</script>", name="甲")

    def test_duplicate_block_name_fails_instead_of_guessing(self):
        # 抄 grok 的 duplicate requested item：同名两块，改哪一块都是猜
        dup = (
            f'<div {BLOCK_MARK_ATTR}="甲">1</div>'
            f'<div {BLOCK_MARK_ATTR}="甲">2</div>'
        )
        with pytest.raises(BlockEditError):
            slice_block(dup, "甲")

    def test_missing_block_fails(self):
        with pytest.raises(BlockEditError):
            slice_block(_page(), "不存在的块")

    def test_gate_rejection_leaves_the_page_untouched(self):
        """反向：过不了闸时**不许**落一份半改的页面。"""
        before = _page()
        with pytest.raises(BlockEditError):
            replace_block(before, "甲", "<div>没闭合")
        # replace_block 是纯函数，原文当然没变——这条钉的是"闸在拼接之前"
        assert before == _page()


class TestRouteIsWiredCorrectly:
    """路由这一层测不到 LLM，但**接线**测得到（第三条：函数写对了 ≠ 被调用了）。"""

    @staticmethod
    def _route_src() -> str:
        with open(ROUTE_FILE, encoding="utf-8") as fh:
            return fh.read()

    @staticmethod
    def _route_body() -> str:
        """剥掉文档字符串再查——本仓踩过：grep 的标识符同时出现在注释里。"""
        src = TestRouteIsWiredCorrectly._route_src()
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef) and node.name == "ai_edit_page_block":
                stripped = [
                    n
                    for n in node.body
                    if not (
                        isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)
                    )
                ]
                return "\n".join(ast.unparse(n) for n in stripped)
        raise AssertionError("路由 ai_edit_page_block 不见了")

    def test_route_exists_and_is_registered(self):
        assert '@router.post("/apps/{app_id}/pages/{page_id}/ai-edit-block")' in self._route_src()

    def test_route_actually_calls_the_three_gates(self):
        body = self._route_body()
        assert "slice_block(" in body
        assert "validate_block_body(" in body
        assert "replace_block(" in body

    def test_route_does_not_persist(self):
        """跟 ai-edit-element 同一条边界：改完不落库，用户点保存才 PATCH。"""
        body = self._route_body()
        assert "update_page_html" not in body
        assert "save_app_or_version" not in body

    def test_route_requires_revise_permission(self):
        # ⚠ ast.unparse 会把双引号规范成单引号，比较前统一一下
        assert "app_access.require('revise'" in self._route_body().replace('"', "'")

    def test_route_fails_closed_on_gate_error(self):
        """过不了闸要报错，**不许**兜底端出原页面或半改的页面。"""
        body = self._route_body()
        assert "HTTPException(422" in body
        # 反向：不许出现"闸失败就回原文"这种 fail-open 写法
        assert "return {'html': page_html}" not in body.replace('"', "'")

    def test_route_takes_page_html_from_the_caller(self):
        """无状态：整页由前端传上来，否则连改两块时第一块的改动会被悄悄丢掉。"""
        assert "payload.get('pageHtml')" in self._route_body().replace('"', "'")
