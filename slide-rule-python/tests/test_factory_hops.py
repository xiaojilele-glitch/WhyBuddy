"""工厂 hop 人话 → 唯一工具名。跟 client/src/lib/factory-hops.ts 同一把尺子。

抄 grok-build AskUserQuestion：选项点下去是 typed 答案，不是新 prompt。
「进入数据模型反推（Structure）」必须认出 structure。
「闭环发布管理系统」不许认成 closure。
"""

from __future__ import annotations

import ast
from pathlib import Path

from services.closed_tools import (
    FACTORY_HOP_LABELS,
    factory_capability_id,
    factory_hop_from_text,
    hop_from_factory_capability,
    host_factory_hop,
    is_factory_hop_command,
)
from services.rehearsal_control import resolve_forced_tool

ROOT = Path(__file__).resolve().parents[2]
TS = ROOT / "client" / "src" / "lib" / "factory-hops.ts"


def test_unique_hop_from_card_label():
    assert factory_hop_from_text("进入数据模型反推（Structure）") == "structure"
    assert factory_hop_from_text("进入数据模型反推（structure）") == "structure"
    assert factory_hop_from_text("进入权限绑定（bind）") == "bind"
    assert factory_hop_from_text("直接执行闭环发布（closure）") == "closure"
    assert factory_hop_from_text("直接执行闭环发布") == "closure"
    assert factory_hop_from_text("继续画页面") == "pages"


def test_product_named_like_a_hop_is_not_a_hop():
    assert factory_hop_from_text("闭环发布管理系统") is None
    assert factory_hop_from_text("做一个闭环发布管理系统") is None
    assert is_factory_hop_command("闭环发布管理系统") is False
    assert is_factory_hop_command("做一个社区图书馆借还书系统") is False


def test_multi_hop_sentence_is_a_command_but_not_a_unique_forced_tool():
    text = "继续进行数据模型反推（structure）与权限绑定（bind）"
    assert factory_hop_from_text(text) is None
    assert is_factory_hop_command(text) is True


def test_resolve_forced_tool_reads_hop_from_user_text():
    """活路径：收尾卡点下去 POST 往往不带 forcedTool，只带选项标签。"""
    assert (
        resolve_forced_tool({}, "进入数据模型反推（Structure）") == "structure"
    )
    assert resolve_forced_tool({}, "闭环发布管理系统") is None
    # 确认继续留下的 pages 不许盖掉 Structure 人话。
    assert (
        resolve_forced_tool({"forcedTool": "pages"}, "进入数据模型反推（Structure）")
        == "structure"
    )
    assert (
        resolve_forced_tool({"forcedTool": "pages"}, "假设已确认。继续画页面。")
        == "pages"
    )


def test_resolve_forced_tool_does_not_let_topic_hijack_explicit_intent():
    """显式意图不许被话题里的 hop 关键词盖掉。

    变异：把 factory_hop_from_text 无条件排到 forcedTool 之前 → 本条红。
    """
    assert (
        resolve_forced_tool(
            {"forcedTool": "rehearse"}, "做一个门店客户数据结构管理台"
        )
        == "rehearse"
    )
    assert (
        resolve_forced_tool(
            {"forcedTool": "refine"}, "把权限绑定那一栏改成扫码"
        )
        == "refine"
    )
    assert (
        resolve_forced_tool(
            {"forcedTool": "rehearse"}, "做一个社区健身房预约系统"
        )
        == "rehearse"
    )
    assert (
        resolve_forced_tool(
            {"forcedTool": "restore_version"}, "进入数据模型反推（Structure）"
        )
        == "restore_version"
    )


def test_ts_parser_exists_and_shares_the_wechat_guard():
    """漏一侧 = 审查条仍闪，或者新产品被当 hop。"""
    src = TS.read_text(encoding="utf-8")
    assert "export function factoryHopFromText" in src
    assert "闭环发布(?!管理|[系统平台应用])" in src
    tree = ast.parse(
        (Path(__file__).resolve().parents[1] / "services" / "closed_tools.py")
        .read_text(encoding="utf-8")
    )
    names = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    assert "factory_hop_from_text" in names
    assert "is_factory_hop_command" in names
    assert "factory_capability_id" in names
    assert "host_factory_hop" in names


def test_host_hop_is_exactly_one_factory_tool():
    assert host_factory_hop(["structure"]) == "structure"
    assert host_factory_hop(["spec", "pages"]) is None
    assert host_factory_hop([]) is None
    assert host_factory_hop(None) is None


def test_factory_capability_id_is_the_write_identity():
    """账本按 hop 记。pages 的 runtimeClosure 不许冒充 structure。"""
    assert factory_capability_id("structure") == "factory.structure"
    assert hop_from_factory_capability("factory.structure") == "structure"
    assert hop_from_factory_capability("appbundle.runtimeClosure") is None
    assert hop_from_factory_capability("factory.unknown") is None


def test_hop_labels_match_the_ts_table():
    """漏一侧 = 左栏「正在执行 factory.structure」。"""
    src = TS.read_text(encoding="utf-8")
    for hop, label in FACTORY_HOP_LABELS.items():
        assert f"{hop}:" in src or f'{hop}: "' in src
        assert label in src, f"TS 缺 {hop} 人话：{label}"
    from services.turn_narration import human_capability_label

    assert human_capability_label("factory.structure") == FACTORY_HOP_LABELS["structure"]
    assert "factory." not in human_capability_label("factory.pages")
