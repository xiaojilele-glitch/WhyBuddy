"""版本回退：重建必须用**目标版本**的模型，不是当前那一版（2026-08-29）。

## 事故

前端 ◀ 按钮走 POST /model-versions/{id}/restore →
`_restore_model_version_locked`。它进重建之前把两个插座都摆好了：

    set_model_override(target["model"])
    set_refine_context(target["model"], f"回退到版本 {version_id}")

而 `_ensure_runtime_closure_evidence` 紧接着自己又调了一次
`set_refine_context(refine_model_of(state, current_model), ...)`——按**当前**
闭环承载的模型，也就是要被回退掉的那一版。调用方的意图被下一行整个盖掉：

    重建出来的还是当前模型
      → D8 判 extract_model_from_closure(closure) != target["model"]
      → 409 closure_rebuild_mismatch
      → **回退永远失败**

真机 sr-it-C-073213（mv-1 与 mv-2 核心段不同）：409。
真机 sr-it-B-072108 那次"成功"是**假绿**——那一轮精修产出的四个核心段与 mv-1
逐字节相同，D8 比什么都相等，回退根本没生效也照样过。

⚠ 这就是 CLAUDE.md 第一条：插座是通的，插头被下一行拔了。而且 5123 条用例
全绿——把修复改回去照样全绿（第三条：正向判据齐全、反向判据缺失）。所以这个
文件存在的意义只有一条：**把修复改回去，它必须变红。**
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services import v5_full_driver as drv  # noqa: E402
from services import v5_llm_generate as gen  # noqa: E402

TARGET = {"datamodel": {"entities": [{"name": "目标版"}]}, "rbac": {}, "workflow": {}, "aigc": {}}
CURRENT = {"datamodel": {"entities": [{"name": "当前版"}]}, "rbac": {}, "workflow": {}, "aigc": {}}


@pytest.fixture
def _rebuild(monkeypatch):
    """把重建拆到只剩「决定拿哪个模型」这一件事。"""
    monkeypatch.setattr(drv, "derive_publish_closure_response", lambda s: {"blocked": False})
    monkeypatch.setattr(drv, "derive_skill_runtime_graph_response", lambda s: {"nodes": []})
    monkeypatch.setattr(drv, "extract_model_from_closure", lambda c: CURRENT)
    monkeypatch.setattr(drv, "persist_state", lambda s: None)
    monkeypatch.setattr(drv, "append_reasoning_event", lambda *a, **k: None)
    monkeypatch.setattr(drv, "append_replay_event", lambda *a, **k: None)
    monkeypatch.setattr(drv, "_commit_capability_result", lambda *a, **k: None)
    monkeypatch.setattr(drv, "_result_to_dict", lambda r: {})

    seen = {}

    def _exec(cap_id, state, *a, **k):
        # 能力真跑的时候看见的精修上下文——判据要的就是这一刻。
        seen["refine"] = gen.get_refine_context()
        seen["override"] = gen.get_model_override()
        return {}

    monkeypatch.setattr(drv, "execute_v5_capability", _exec)
    yield seen
    gen.set_refine_context(None)
    gen.set_model_override(None)


def _state():
    st = V5SessionState(sessionId="r1", goal={"text": "危化品领用"}, artifacts=[])
    st.modelVersions = [{"id": "mv-1", "model": TARGET}, {"id": "mv-2", "model": CURRENT}]
    st.currentModelVersionId = "mv-2"
    return st


class Test直供在场时不许改写精修上下文:
    def test_回退时重建看见的是目标版本(self, _rebuild):
        """⚠ 把 `if get_model_override() is None:` 那道闸删掉，这条必红。"""
        gen.set_model_override(TARGET)
        gen.set_refine_context(TARGET, "回退到版本 mv-1")
        drv._ensure_runtime_closure_evidence(_state(), "restore:mv-1", 0)
        got = (_rebuild.get("refine") or {}).get("model")
        assert got == TARGET, (
            f"重建拿的是 {got}——不是回退目标。D8 随后必判 "
            "closure_rebuild_mismatch，◀ 按钮 409，回退永远失败"
        )

    def test_直供插座本身也还在(self, _rebuild):
        """⚠ 反向判据：别把"不覆盖精修上下文"做成"把直供也一起关了"。"""
        gen.set_model_override(TARGET)
        gen.set_refine_context(TARGET, "回退到版本 mv-1")
        drv._ensure_runtime_closure_evidence(_state(), "restore:mv-1", 0)
        assert _rebuild.get("override") == TARGET

    def test_没有直供时照旧按当前模型精修(self, _rebuild):
        """⚠ 反向判据：普通精修轮**必须**保持原样。

        这条闸只认 model_override——那是版本回退直供专用的插座（见
        set_model_override 的 docstring）。日常精修没有它，行为一个字不变，
        否则「在现有五系统模型上做最小增量」当场变成整轮重建。
        """
        gen.set_model_override(None)
        gen.set_refine_context(None)
        drv._ensure_runtime_closure_evidence(_state(), "菜单显示有问题", 0)
        got = (_rebuild.get("refine") or {}).get("model")
        assert got is not None and (got.get("datamodel") or {}) == CURRENT["datamodel"], (
            f"普通精修轮的上下文被改坏了：{got}"
        )
