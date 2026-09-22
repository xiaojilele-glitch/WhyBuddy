"""Dead sockets must not be the product path.

⚠ 2026-08-27 PR-10：drive_v5_full_path 定义点一处、产品路由调用点零。
mcp_runtime / skill_runtime 是可注入适配器，流式 driver 与薄控制面不调。
反向：把 import 接回 sliderule_full / rehearsal_control → 剥注释后必须红。
正向：POST /control-turn-stream 仍在——清死代码不许顺手拆掉活控制面。
"""

from __future__ import annotations

import ast
from pathlib import Path

from control_turn_support import PY_ROOT, strip_python

ROUTES = PY_ROOT / "routes" / "sliderule_full.py"
DRIVER = PY_ROOT / "services" / "v5_full_driver.py"
CONTROL = PY_ROOT / "services" / "rehearsal_control.py"
POLICY = PY_ROOT / "services" / "archetype_legal.py"
PLAN = PY_ROOT / "services" / "capability_plan.py"
WORKFLOW = PY_ROOT / "services" / "workflow_registry.py"

DEAD_ADAPTER_IMPORTS = (
    "services.mcp_runtime",
    "mcp_runtime",
    "services.skill_runtime",
    "skill_runtime",
)
DEAD_ADAPTER_CALLS = (
    "get_mcp_runtime",
    "set_mcp_runtime",
    "create_mcp_runtime",
    "get_skill_runtime",
    "set_skill_runtime",
    "create_skill_runtime",
)


def _imported_modules(path: Path) -> set[str]:
    """AST 进口名单。注释/文档串里的标识符进不来——本仓踩过 grep 假绿。"""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add(alias.name)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


def _function_body(stripped: str, def_needle: str) -> str:
    start = stripped.find(def_needle)
    assert start != -1, f"活函数失踪: {def_needle}"
    nxt = stripped.find("\ndef ", start + len(def_needle))
    nxt_async = stripped.find("\nasync def ", start + len(def_needle))
    ends = [i for i in (nxt, nxt_async) if i != -1]
    end = min(ends) if ends else len(stripped)
    return stripped[start:end]


def test_drive_v5_full_path_not_in_sliderule_full_live_body():
    """产品路由活体不得引用死 driver。

    反向：再写 `from services.v5_session_driver import drive_v5_full_path`
    或在 /drive-full-stream、/control-turn-stream 里调用它 → 这条红。
    墓碑注释必须点名，否则剥注释自检没锚（本仓：标识符只在注释里 → 假绿）。
    """
    raw = ROUTES.read_text(encoding="utf-8")
    stripped = strip_python(ROUTES)
    assert "drive_v5_full_path" in raw, (
        "sliderule_full 墓碑注释必须点名 drive_v5_full_path，"
        "否则剥注释自检没锚"
    )
    assert "drive_v5_full_path" not in stripped, (
        "sliderule_full 活体又引用了 drive_v5_full_path——"
        "产品流走信封 helper / control-turn-stream，不是 v5_session_driver"
    )
    stream_body = _function_body(stripped, "def drive_full_stream")
    control_body = _function_body(stripped, "def control_turn_stream")
    assert "drive_v5_full_path" not in stream_body
    assert "drive_v5_full_path" not in control_body
    assert "v5_session_driver" not in stripped


def test_product_stream_routes_still_exist():
    """清死代码不许拆掉活控制面，也不许拆掉脚本插座 /drive-turn。"""
    raw = ROUTES.read_text(encoding="utf-8")
    stripped = strip_python(ROUTES)
    assert '@router.post("/control-turn-stream")' in raw
    assert '@router.post("/drive-full-stream")' in raw
    assert '@router.post("/drive-turn")' in raw
    assert "run_control_turn" in stripped
    assert "start_drive_full_factory_run" in stripped
    assert "drive_reasoning_turn" in stripped


def test_mcp_and_skill_runtime_not_imported_by_streaming_driver_or_control():
    """流式 driver / 薄控制面不得进口 mcp_runtime、skill_runtime。

    反向：在 rehearsal_control 加 `from services.mcp_runtime import …`
    或在 v5_full_driver 加 `from .skill_runtime import …` → 这条红。
    不匹配 v5_skill_runtime_graph（那是活的技能图投影，不是本适配器）。
    """
    for path in (DRIVER, CONTROL, POLICY, PLAN, WORKFLOW):
        imported = _imported_modules(path)
        for name in DEAD_ADAPTER_IMPORTS:
            assert name not in imported, (
                f"{path.name} 进口了 {name}——非产品流适配器，禁止接成控制面"
            )
        stripped = strip_python(path)
        assert "from services.mcp_runtime import" not in stripped
        assert "from .mcp_runtime import" not in stripped
        assert "from services.skill_runtime import" not in stripped
        assert "from .skill_runtime import" not in stripped
        for call in DEAD_ADAPTER_CALLS:
            assert call not in stripped, (
                f"{path.name} 活体调用了 {call}——流式 driver / 控制面不调这对适配器"
            )


def test_adapter_headers_tombstone_the_dead_socket():
    """适配器头注必须点名「非产品流、流式 driver 不调、禁止接成控制面」。

    删掉这段事故记录 → 这条红。下一个人才能看见为什么不能把它们当控制面。
    """
    for rel in ("services/mcp_runtime.py", "services/skill_runtime.py"):
        header = (PY_ROOT / rel).read_text(encoding="utf-8").split("from ", 1)[0]
        for needle in (
            "非产品流",
            "流式 driver 不调",
            "禁止接成控制面",
            "2026-08-27",
        ):
            assert needle in header, f"{rel} 头注缺墓碑片段: {needle}"


def test_strip_comments_is_what_makes_the_dead_driver_assert_real():
    """自检：剥注释真的把墓碑原文去掉了。不剥的话上面那条会被注释喂饱。"""
    raw = ROUTES.read_text(encoding="utf-8")
    stripped = strip_python(ROUTES)
    assert "不通电的插座" in raw
    assert "不通电的插座" not in stripped
    assert "def drive_full_stream" in stripped
    assert "def control_turn_stream" in stripped
