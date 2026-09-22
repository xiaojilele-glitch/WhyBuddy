"""页面改名必须进 SSE：第 4.5 步把 `p1` 改成 `seat_selection`，得当场告诉前端。

## 这条防的是「画布 12 张卡对应 6 个页面」

真机 sr-20260906111901（自习室占座）实测到的形状：

    65~110s   spec_page × 6   p3 p1 p2 p6 p5 p4          bound=false  ← 第 3 步素颜
    110.4s    spec_page × 6   同样六个 p*                 bound=false  ← 3.5 外壳统一
    225.3s    spec_page × 6   seat_hogging_report …       bound=true   ← 6.5 打完孔
              pageIdAliases = {"p1": "seat_selection", "p2": "my_reservations…", …}

前端按 pageId 认卡（`useSlideRuleSession.onSpecPage` 里那句 `findIndex`），
认不出第三批是同一批页 → 走 `[...prev, page]` 追加 → **12 张卡、12 条
「🖼 界面已出」，对应 6 个页面**。前 6 张素颜、未打孔、点不动，永久孤儿。

那张别名表**当时已经存在**，只是只随交付物落库、不进流——落库那份救的是
刷新之后的宿主，正在看直播的前端一个字都收不到。

## 抄的标准答案

grok-build `crates/codegen/xai-codebase-graph/src/types/file_event.rs`：

    /// A file was renamed/moved.
    Renamed {
        /// Original path.
        from: PathBuf,
        /// New path.
        to: PathBuf,
    },

    fn requires_reparse(&self) -> bool {
        FileEvent::Renamed { .. } => false,   // Only path update needed
    }

改名是**一等事件**、自带两头；消费方只更新键，不重新解析内容。

## 判据钉的是什么

`spec_page_renamed` 事件"存在"没有意义——它必须**排在改名后那批 `spec_page`
之前**。晚一步，前端已经按新 id 建好了六张重复的卡，再告诉它"其实是改名"
已经没用了。所以下面既验事件出得来，也验**先后**。
"""

import ast
import asyncio
import os
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services import spec_first_pipeline as sfp  # noqa: E402
from services.slide_rule_coverage import author_coverage_contract  # noqa: E402

_SERVICES = Path(__file__).resolve().parents[1] / "services"

GOAL = "做一个自习室占座管理系统，包含选座、违规工单和运营报表"

HTML = ('<!DOCTYPE html><html lang="zh-CN"><head><title>选座</title>'
        '<script src="https://cdn.tailwindcss.com"></script></head>'
        '<body><main>选座</main></body></html>')


def _seeded_state(session_id: str) -> V5SessionState:
    state = V5SessionState(sessionId=session_id, goal={"text": GOAL}, artifacts=[])
    authored = author_coverage_contract(GOAL, "turn-1")
    state.coverageContract = authored["contract"]
    state.coverageGaps = authored["gaps"]
    return state


@pytest.fixture()
def driver(monkeypatch, tmp_path):
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    import services.v5_full_driver as driver_mod

    monkeypatch.setattr(driver_mod, "persist_state", lambda s: s)
    return driver_mod


def _drive(driver, state, hook):
    """跑一趟流，在第一个能力执行时叫一次 hook。"""
    from sliderule_llm import capabilities as caps

    once = {"done": False}

    def fake_native(body, **kw):
        if not once["done"]:
            once["done"] = True
            hook()
        cap = body["capabilityId"]
        return {"title": cap, "summary": "s", "content": "c", "provenance": "python-llm"}

    os.environ["SLIDERULE_LLM_ROUND_CAPS"] = "1"
    old = caps.execute_capability
    caps.execute_capability = fake_native
    try:
        async def _collect():
            evs = []
            async for ev in driver.drive_full_v5_session_stream(
                state, max_loops=1, user_instruction=GOAL
            ):
                evs.append(ev)
            return evs

        return asyncio.run(_collect())
    finally:
        caps.execute_capability = old
        os.environ.pop("SLIDERULE_LLM_ROUND_CAPS", None)


def _src(name: str) -> str:
    """剥掉注释和文档字符串——本仓的注释里大段引用了病灶写法，
    不剥的话 grep 到的是注释，变异后照样绿（CLAUDE.md §2）。"""
    text = (_SERVICES / name).read_text(encoding="utf-8")
    text = re.sub(r'"""[\s\S]*?"""', "", text)
    text = re.sub(r"#[^\n]*", "", text)
    return text


# ── 通电：改名真的能上流 ──────────────────────────────────────────


def test_改名上了流_而且带着两头(driver):
    """最基本的一条：sink 装着，叫一次就有事件，from/to 都在。"""
    def hook():
        assert sfp._rename_sink_var.get() is not None, "驱动器没装改名 sink——整段静默失效"
        sfp._emit_page_renamed({"p1": "seat_selection"})

    events = _drive(driver, _seeded_state("rn-1"), hook)
    got = [e for e in events if e["type"] == "spec_page_renamed"]
    assert len(got) == 1, f"改名没上流：{[e['type'] for e in events]}"
    assert got[0]["from"] == "p1"
    assert got[0]["to"] == "seat_selection"


def test_改名排在改名后那批页面之前(driver):
    """**要害**。这条钉的是先后，不是"有没有"。

    重演真机的三段：素颜页用旧 id → 第 4.5 步改名 → 6.5 那批用新 id。
    改名必须夹在中间。晚一步前端就已经把重复的卡建好了，事件再对也没用。

    变异：把改名塞进另一条队列（哪怕仍然"先 put"）→ 两条队列各自排水，
    先后不再由队列保证，这条会红。
    """
    def hook():
        page = sfp._page_sink_var.get()
        page("p1", HTML, 1, 1)                              # 第 3 步：旧 id
        sfp._emit_page_renamed({"p1": "seat_selection"})     # 第 4.5 步：改名
        page("seat_selection", HTML, 1, 1, True)             # 第 6.5 步：新 id

    events = _drive(driver, _seeded_state("rn-2"), hook)
    trail = [
        (e["type"], e.get("pageId") or e.get("to"))
        for e in events
        if e["type"] in ("spec_page", "spec_page_renamed")
    ]
    assert trail == [
        ("spec_page", "p1"),
        ("spec_page_renamed", "seat_selection"),
        ("spec_page", "seat_selection"),
    ], f"先后不对：{trail}"


def test_同一条队列_不是两条(driver):
    """上一条的结构版：改名和页面共用 _page_q。

    单靠行为判据，"两条队列恰好这次顺序对了"也能绿（队列都是 FIFO、
    排水又挨着，小样本下很容易蒙对）。这条直接钉住"只有一条队列"。
    """
    src = _src("v5_full_driver.py")
    assert "_page_q.put(_PageRenamed(" in src, "改名没进 _page_q——顺序就没人保证了"
    assert "_rename_q" not in src, "开了第二条队列，先后又变成不可预期"


# ── 代价判据：不许为了修这个而把别的弄坏 ──────────────────────────


def test_页面事件一条都不许少(driver):
    """代价判据。把排水口写成"认出改名就 continue"很容易顺手把页面也吃掉，
    或者 `isinstance` 判反（NamedTuple 也是 tuple，判反就全都当改名）。"""
    def hook():
        page = sfp._page_sink_var.get()
        sfp._emit_page_renamed({"p1": "a", "p2": "b"})
        for i, pid in enumerate(("a", "b", "p3"), start=1):
            page(pid, HTML, i, 3, True)

    events = _drive(driver, _seeded_state("rn-3"), hook)
    pages = [e for e in events if e["type"] == "spec_page"]
    assert [e["pageId"] for e in pages] == ["a", "b", "p3"], "页面被改名那支吃掉了"
    assert len([e for e in events if e["type"] == "spec_page_renamed"]) == 2


def test_没改名的轮次不许发空事件(driver):
    """`canonical_page_id_map` 一个都没改就返回空表，**精修轮几乎总是这样**。
    那种轮次里"改名"这件事根本没发生，发一条空的等于让前端处理不存在的事。"""
    def hook():
        assert sfp._emit_page_renamed({}) == 0
        assert sfp._emit_page_renamed(None) == 0
        assert sfp._emit_page_renamed("不是表") == 0

    events = _drive(driver, _seeded_state("rn-4"), hook)
    assert [e for e in events if e["type"] == "spec_page_renamed"] == []


def test_改成自己不算改名(driver):
    """rekey 表里出现恒等项时不许惊动前端——前端会去找 `from` 那张卡、
    把它改成同名，白跑一次渲染。"""
    def hook():
        assert sfp._emit_page_renamed({"p1": "p1"}) == 0
        # 混着来：真改名的那条要过，恒等的那条要拦
        assert sfp._emit_page_renamed({"p1": "p1", "p2": "seat_selection"}) == 1

    events = _drive(driver, _seeded_state("rn-5"), hook)
    got = [e for e in events if e["type"] == "spec_page_renamed"]
    assert [(e["from"], e["to"]) for e in got] == [("p2", "seat_selection")]


def test_两头缺一头不许发(driver):
    def hook():
        assert sfp._emit_page_renamed({"": "seat_selection"}) == 0
        assert sfp._emit_page_renamed({"p1": ""}) == 0

    events = _drive(driver, _seeded_state("rn-6"), hook)
    assert [e for e in events if e["type"] == "spec_page_renamed"] == []


# ── fail-open：这是增强，不许赔掉已经烧过 LLM 的页 ────────────────


def test_sink没装的时候安静返回0():
    """脚本直调 / 老调用方没装 sink——不许抛。"""
    assert sfp._rename_sink_var.get() is None
    assert sfp._emit_page_renamed({"p1": "seat_selection"}) == 0


def test_sink自己炸了也不许往上抛():
    """整条 fail-open。这一步后面还有第 5/6 步，为一件"顺带推给前端看"的事
    赔掉已经烧了几分钟 LLM 的页面，代价方向就错了。"""
    def boom(*_a, **_kw):
        raise RuntimeError("下游炸了")

    with sfp.rename_sink_scope(boom):
        assert sfp._emit_page_renamed({"p1": "seat_selection"}) == 0


def test_出块之后sink卸掉了():
    with sfp.rename_sink_scope(lambda *_a: None):
        assert sfp._rename_sink_var.get() is not None
    assert sfp._rename_sink_var.get() is None


# ── 接线：第 4.5 步真的叫了这个口子 ──────────────────────────────


def test_第4_5步真的推了改名():
    """防的是"口子建好了、没人叫"这种静默失效（本仓 §4）。

    钉在**同一个 if _canon 块**里：改名落库（`_page_id_aliases`）和推流是
    同一件事实的两个消费者，谁拆开谁就制造了"落库救刷新、直播救不了"的
    半新半旧——那正是这次的病灶。
    """
    src = _src("spec_first_pipeline.py")
    i = src.find("_page_id_aliases = {**_page_id_aliases, **_canon}")
    assert i > 0, "第 4.5 步记别名那行不见了，这条判据要重写"
    window = src[i : i + 600]
    assert "_emit_page_renamed(_canon)" in window, (
        "第 4.5 步记了别名却没推流——落库那份只救刷新后的宿主，"
        "正在看直播的前端还是会建重复的卡"
    )


def test_第4_5步改键也改HTML孔():
    """别名是第二通道。新生成这一份孔必须跟键同一套，否则别名被抹掉
    菜单又静默点不动。钉在同一个 ``if _canon`` 块里（§3：函数写对了 ≠ 接上了）。
    """
    src = _src("spec_first_pipeline.py")
    i = src.find("if _canon:")
    assert i > 0
    window = src[i : i + 1800]
    assert "rewrite_html_page_ids(pages, _canon)" in window, (
        "第 4.5 步改了键却没改 HTML 孔——菜单点的还是 p1，页键已经是语义 id"
    )
    assert "rekey_page_map(pages, _canon)" in window


def test_推了几条记在stages里():
    """照 grok `dedup_duplicate_tool_results` 交回条数那个习惯：
    这类"顺带推一把"的口子不留个数，出问题时只能靠猜。"""
    src = _src("spec_first_pipeline.py")
    assert 'st["pageIdRenamesEmitted"]' in src


def test_改名口子是keyword无关的纯函数_不读全局别名表():
    """它只该看传进来的 `_canon`。读 `_page_id_aliases`（**累积**表）会把
    往轮次的改名在这一轮重发一遍——前端拿着早就不存在的旧 id 去找卡。"""
    tree = ast.parse((_SERVICES / "spec_first_pipeline.py").read_text(encoding="utf-8"))
    fn = next(
        n
        for n in ast.walk(tree)
        if isinstance(n, ast.FunctionDef) and n.name == "_emit_page_renamed"
    )
    names = {n.id for n in ast.walk(fn) if isinstance(n, ast.Name)}
    assert "_page_id_aliases" not in names, "读了累积别名表，会重发往轮次的改名"
