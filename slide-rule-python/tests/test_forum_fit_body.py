"""正文复核必须咬住两件事：行号映射、不许拿 C 填漏判。

标题档 2026-08-05 把 topic_id 发给模型，模型改写成 1、2、3…，374 条静默
对不上。正文档若再填漏判为 C，会把本该入选的踢掉还显示“筛完了”。
把修复改回去，这两条都要红。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from forum_fit_body import clip_body, parse_grades, too_short  # noqa: E402


def _strip_comments(src: str) -> str:
    src = re.sub(r'"""[\s\S]*?"""', "", src)
    src = re.sub(r"'''[\s\S]*?'''", "", src)
    src = re.sub(r"#[^\n]*", "", src)
    return src


def test_parse_grades_maps_lineno_not_topic_id():
    """模型回 1、2、3 时必须落到真实 topic_id，不能把行号当成 id。"""
    rows = [(114091, "花超爱", "x"), (146460, "早筛", "y"), (167946, "ITOps", "z")]
    got = parse_grades(
        [
            {"i": 1, "grade": "U", "why": "删帖"},
            {"i": 2, "grade": "B", "why": "个人工具"},
            {"i": 3, "grade": "A", "why": "工单流转"},
        ],
        rows,
    )
    assert set(got) == {114091, 146460, 167946}
    assert got[114091][0] == "U"
    assert got[146460][0] == "B"
    assert got[167946][0] == "A"


def test_parse_grades_does_not_fill_missing_with_c():
    """漏判必须缺席。补 C 是最省事也最坏的做法。"""
    rows = [(10, "甲", "a"), (20, "乙", "b"), (30, "丙", "c")]
    got = parse_grades([{"i": 1, "grade": "A", "why": "工单"}], rows)
    assert 10 in got
    assert 20 not in got
    assert 30 not in got
    assert "C" not in {g for g, _ in got.values()}


def test_parse_grades_drops_out_of_range_lineno():
    rows = [(10, "甲", "a")]
    got = parse_grades(
        [{"i": 0, "grade": "A"}, {"i": 2, "grade": "A"}, {"i": "x", "grade": "A"}],
        rows,
    )
    assert got == {}


def test_short_deleted_posts_are_unusable():
    assert too_short("删帖删帖删帖")
    assert too_short("111111你好。")
    assert too_short(
        "在线演示 | 教学书籍 | 项目文档 | 作者的话 项目官网：https://example.com"
    )
    assert not too_short("用户提交申请，管理员审批，仓库派单。" * 20)


def test_clip_body_strips_images_and_caps_length():
    text = "简介 " + "![截图](https://cdn.example/a.png) " + ("流程流转 " * 400)
    out = clip_body(text, limit=80)
    assert "cdn.example" not in out
    assert len(out) <= 81
    assert "简介" in out


def test_write_back_does_not_overwrite_title_grade():
    """正文档写 fit_body_*。改去 set fit_grade 会把标题幻觉一起盖掉。"""
    src = _strip_comments(
        (Path(__file__).resolve().parents[1] / "scripts" / "forum_fit_body.py").read_text(
            encoding="utf-8"
        )
    )
    assert "fit_body_grade = v.g" in src
    assert "fit_grade = v.g" not in src
    assert "set fit_grade" not in src.lower()
