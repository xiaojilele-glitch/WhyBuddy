# -*- coding: utf-8 -*-
"""读窗要一次吞得下一个正常源文件——**三道夹子都得放开**。

## 这条判据是哪来的（2026-09-14 真机）

`artifacts/control-real-model/1fcfd3d4`，真 LLM（text168/grok-4.6）+ 真 E2B，
目标「给任务加截止日期字段」。53 秒后：

    stopReason=token_budget limit=64000 used=64488
    project_read × 15 | 源码改动：0 处 | 页面落库：0 份

读窗当时是 2000 字符。落库的 offset 是这么走的：

    database.mjs  offset=0 → 2000 → 4000   （总长 7458）
    server.mjs    offset=0 → 2000 → 4000   （总长 7356）

**一次都没打转。** 模型老老实实翻页，翻到第 5 轮（共 16 轮）预算就烧完了，
四个主源文件各差最后 1400~3400 字没读到，一行代码都还没改。原地打转护栏
（`action_stationarity`）自始至终没响——它是对的，这不是打转。

病在窗口：同样的 32346 字节，2000 的窗要 19 次调用摊进 4 轮，而控制面每一轮
都把**全部历史重发一遍**，于是这些字节被重复计费 4 次。8000 的窗是 6 次调用
1 轮。字节没变，轮数变了，账就差了几倍。

## 为什么判据必须同时钉三个数（CLAUDE.md §4）

读窗是一条**三节的链**，中间任何一节没放开，前面放开的都白搭，而且
**不报错、不告警**——只是读回来的还是 3500 字：

    ReadArguments.limit              8000   模型能要多少
    PROJECT_READ_MAX_RESULT_CHARS   10000   信封（_bounded_text 夹整包 JSON）
    control_tool_result_max_chars()  ——     回喂（默认 4000，project_read 覆盖）

所以下面每一条都是**端到端**量的：拿真模板的真文件，走真 `_read`，
再过一遍真 `bound_tool_result`，最后数**模型实际拿到手的字符数**。
量常量本身证明不了链路通（§3：名单里有名字 ≠ 埋点在）。
"""

from __future__ import annotations

import json
import pathlib

import pytest

from services.project_tool_contracts import (
    PROJECT_READ_MAX_CHARS,
    PROJECT_READ_MAX_RESULT_CHARS,
    ReadArguments,
    explicit_read_window,
    project_tool_definitions,
)
from services.rehearsal_control import (
    CONTROL_TOOL_RESULT_MAX_CHARS,
    bound_tool_result,
    control_tool_result_max_chars,
)

TEMPLATE = pathlib.Path(__file__).resolve().parents[2] / "project-templates" / "react-vite-tasks"

#: 锁文件/生成物不算"正常源文件"：它们本来就该走 project_search，不该整份读。
#: node_modules 是本机装过模板依赖后留下的二进制，收集阶段当 utf-8 读会炸。
_NOT_ORDINARY_SOURCE = {"package-lock.json"}
_SKIP_DIR_PARTS = {"node_modules", ".git", "dist", "build"}


def _ordinary_sources() -> dict[str, str]:
    out: dict[str, str] = {}
    for path in sorted(TEMPLATE.rglob("*")):
        if not path.is_file():
            continue
        parts = path.relative_to(TEMPLATE).parts
        if any(part in _SKIP_DIR_PARTS for part in parts):
            continue
        rel = path.relative_to(TEMPLATE).as_posix()
        if rel in _NOT_ORDINARY_SOURCE:
            continue
        try:
            out[rel] = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
    return out


def test_模板真的在_不然下面几条量的是空气():
    """§3 反向：夹具没了要立刻红，不能静静地变成「0 个文件全都通过」。"""
    sources = _ordinary_sources()
    assert TEMPLATE.is_dir(), TEMPLATE
    assert len(sources) >= 8, sorted(sources)
    assert max(len(t) for t in sources.values()) > 5000, "模板里没有胖文件，测不到东西"


def test_默认读只回路径():
    """无窗 project_read 只回路径+摘要。把默认改回整文件灌入必须红。

    走产线 `_read` + `bound_tool_result`，不重抄指针信封。database.mjs
    超过摘要上限，全文若再进 content，本条立刻红。
    """
    from services.project_tools import ProjectTools

    text = (TEMPLATE / "database.mjs").read_text(encoding="utf-8")
    assert len(text) > 800
    pointer = ProjectTools._read(
        None,
        {"database.mjs": text},
        type("Rev", (), {"revision": "r1"})(),
        ReadArguments(path="database.mjs"),
    )
    fed = json.loads(bound_tool_result(
        {"ok": True, "tool": "project_read", **pointer},
        "project_read",
    ))
    assert fed["content"] == ""
    assert fed["path"] == "database.mjs"
    assert fed.get("excerpt")
    assert text not in json.dumps(fed, ensure_ascii=False)
    assert explicit_read_window(ReadArguments(path="database.mjs")) is False


# ── 端到端：模型实际拿到手的是多少字 ──────────────────────────────────────


def _delivered(text: str) -> int:
    """走完整条链，返回模型**实际读到**的正文字符数。

    不重抄 `_read` 的切片逻辑——重抄的判据只能证明"我抄对了"（§一之二）。
    这里直接跑产线那两个函数。
    """
    from services.project_tools import _bounded_text

    args = ReadArguments(path="x", offset=0)
    result = {"revision": "prv-" + "0" * 32, "path": "x", "sha256": "a" * 64,
        "offset": 0, "nextOffset": 0, "truncated": True, "totalChars": len(text)}
    result["content"] = _bounded_text(result, "content", text[:args.limit],
        cap=PROJECT_READ_MAX_RESULT_CHARS)
    result["nextOffset"] = len(result["content"])
    result["truncated"] = result["nextOffset"] < len(text)
    # 回喂那一道：project_read 走 per-tool 覆盖，不是默认的 4000。
    fed = json.loads(bound_tool_result({"ok": True, "tool": "project_read", **result},
        "project_read"))
    assert not fed.get("truncated") or fed.get("preview") is None, \
        "回喂那一道还在裁——per-tool 覆盖没生效"
    return len(fed["content"])


@pytest.mark.parametrize("rel", sorted(_ordinary_sources()))
def test_显式读窗仍能一次吞下正常源文件(rel: str):
    """显式 offset/limit 仍走 8000 三道夹。默认无窗是指针，见 test_默认读只回路径。

    ⚠ 变异咬这条：把 PROJECT_READ_MAX_CHARS 改回 2000（或者只改它、
      不改信封/回喂那两道）→ database.mjs / server.mjs / main.tsx /
      application.test.mjs 四条立刻红。这正是真机那一趟的形态。
    """
    text = _ordinary_sources()[rel]
    delivered = _delivered(text)
    assert delivered == len(text), (
        f"{rel} 共 {len(text)} 字，一次只读到 {delivered} 字——"
        f"模型得翻 {-(-len(text) // max(delivered, 1))} 次才读得完"
    )


def test_锁文件不在此列_它该走搜索():
    """反向：不是"把窗口开到无限大"。

    38415 字的 package-lock.json 仍然读不完一次——描述里写明了这种该用
    project_search。判据钉住这条边界，免得下一个人为了"全都一次读完"
    把窗口开到几十万字，再把上下文顶穿。
    """
    lock = (TEMPLATE / "package-lock.json").read_text(encoding="utf-8")
    assert len(lock) > PROJECT_READ_MAX_CHARS
    assert _delivered(lock) < len(lock)


# ── 三道夹子：每一道都得亲自量，不许只量最上面那个 ────────────────────────


def test_信封不许把正文砍回去():
    """§4：只调 ReadArguments.limit、不调信封 = 一点效果都没有。

    变异：把 PROJECT_READ_MAX_RESULT_CHARS 改回 3800 → 本条红。
    """
    fat = "const x = 1;\n" * 900  # ~11k 字，够胖
    assert len(fat) > PROJECT_READ_MAX_CHARS
    assert _delivered(fat) == PROJECT_READ_MAX_CHARS, (
        "信封（或回喂）比读窗还紧，正文被砍回去了"
    )


def test_回喂那一道对project_read放开_对别人不放开():
    """抄 grok `per_tool_max_output_bytes`：按工具名覆盖，**默认档不动**。

    默认档挡的是 `search_evidence` 那类长度我们说了不算的结果（hits 来自
    公网）。`project_read` 的长度在我们自己手里，已经夹过一道了。

    变异：把覆盖表清空 → 上面 test_每个正常源文件都能一次读完 红。
    变异：把默认档也一起调大 → 本条红。
    """
    assert control_tool_result_max_chars("project_read") == PROJECT_READ_MAX_RESULT_CHARS
    assert control_tool_result_max_chars("search_evidence") == CONTROL_TOOL_RESULT_MAX_CHARS
    assert control_tool_result_max_chars(None) == CONTROL_TOOL_RESULT_MAX_CHARS
    assert CONTROL_TOOL_RESULT_MAX_CHARS == 4000, "默认档被顺手改了"


def test_三道夹子的次序必须是放开的():
    """读窗 ≤ 信封 ≤ 回喂。任何一道比上一道紧，上一道就是摆设。"""
    assert PROJECT_READ_MAX_CHARS <= PROJECT_READ_MAX_RESULT_CHARS
    assert PROJECT_READ_MAX_RESULT_CHARS <= control_tool_result_max_chars("project_read")


# ── 描述不许跟常量对不上 ──────────────────────────────────────────────────


def test_描述里的数字是渲染出来的_不是手打的():
    """抄 grok `interpolate_description`（`{max_lines_read}`）。

    写死一个数字、改了常量不改描述 → 模型按一个不存在的窗口分页，
    不报错、不告警（§4 的又一例）。

    变异：把 interpolate_description 换成直接返回 description → 本条红，
    因为占位符会原样漏到描述里。
    """
    desc = [t for t in project_tool_definitions()
            if t["function"]["name"] == "project_read"][0]["function"]["description"]
    assert "{max_read_chars}" not in desc, "占位符没被渲染就发给模型了"
    assert str(PROJECT_READ_MAX_CHARS) in desc
    # 反向：别的工具不许被顺手塞进一个读窗数字。
    search = [t for t in project_tool_definitions()
              if t["function"]["name"] == "project_search"][0]["function"]["description"]
    assert str(PROJECT_READ_MAX_CHARS) not in search


def test_不传limit的schema默认仍是读窗上限():
    """显式要窗时 limit 默认仍是 8000。不传字段则走指针，不是整份灌入。"""
    assert ReadArguments(path="x").limit == PROJECT_READ_MAX_CHARS
    from services.project_tool_contracts import explicit_read_window
    assert explicit_read_window(ReadArguments(path="x")) is False
    assert explicit_read_window(ReadArguments(path="x", offset=0)) is True


# ── 真机那一趟：同一批文件，改造前后要几轮 ────────────────────────────────


def test_真机那批文件的调用次数要真的降下来():
    """判据落在**用户真正付费的东西**上：轮数（§5）。

    2026-09-14 真机读的就是这六个文件。控制面每轮重发全部历史，所以
    "读完要几轮"直接决定 token 账单。改造前 19 次 / 4 轮，之后 6 次 / 1 轮。
    """
    real = ["database.mjs", "server.mjs", "src/main.tsx",
            "tests/application.test.mjs", "src/style.css", "README.md"]
    sources = _ordinary_sources()
    assert set(real) <= set(sources), sorted(sources)
    calls = sum(-(-len(sources[r]) // PROJECT_READ_MAX_CHARS) for r in real)
    assert calls == len(real), f"这批文件仍要 {calls} 次调用，一次一个才对"
    before = sum(-(-len(sources[r]) // 2000) for r in real)
    assert before > calls * 2, (before, calls)
