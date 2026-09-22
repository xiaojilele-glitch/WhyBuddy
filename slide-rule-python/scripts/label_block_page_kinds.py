"""给体验区块推导 `pageKinds`（这种区块该出现在哪几种页上），写回目录 JSON。

    cd slide-rule-python
    .venv/bin/python scripts/label_block_page_kinds.py --check     # 只查硬判据，CI 用，不调模型
    .venv/bin/python scripts/label_block_page_kinds.py --dry-run   # 硬判据 + 模型初稿，打差异表
    .venv/bin/python scripts/label_block_page_kinds.py --write     # 落盘（只改 pageKinds 一个键）

## 为什么要有这个脚本

`pageKinds` 是**随每个区块被添加时手写的**（da0be83、9389227 那批"补 XX 区块"
的提交各写各的），没有标注脚本、没有中心化审校。对比 `generality` 有
`label_block_generality.py`——同样是产品判断，那个字段有一份能重跑的依据，
这个字段没有。后果量化过：控制住领域族之后有 25 对同域同能力的"一个能上、
另一个不能"的矛盾（tests/test_page_kind_consistency_ratchet.py 记着这笔账）。

三批人工放宽把矛盾降到了 9，但那条路走不通到底——**判据只覆盖 41/358 个区块**
（要有"同域 + 同能力 + 区域相交"的对照才数得着），剩下 317 个的声明没有任何
第二来源可以核对。所以补这个脚本：把"能重算的依据"补上。

## 这个脚本最重要的一条结论：**这个字段大部分不是技术约束**

写之前先把运行时逐处 `page.view.kind` 分支查了一遍（AppRuntimeScreen.tsx），
结论是页型对一个区块能不能上屏，只有下面这几处**真的**有影响：

    页型         逐行视图   视图形状   KPI/图表通道        区块渲染路径
    workbench    有         表         固定 statsBand      businessPageGrid
    wizard       有         表+步骤条    桌面有/手机无        businessPageGrid
    kanban       有         看板        桌面有/手机无        businessPageGrid
    calendar     有         月历        桌面有/手机无        businessPageGrid
    monitor      **无**     —          freeformOverview    blockScaffold
    dashboard    **无**     —          同上                blockScaffold / grid

⚠️ 中间那三行原本写的是"无"，**是错的**（2026-08-11 复核）。真实行为两个端不一样：

  · 桌面：`page.stats` / `page.charts` 照样渲染。`statsBand` 自己没有任何页型闸
    （AppRuntimeScreen.tsx:2674 只判 `page.stats.length > 0`），而这三种页会落进
    分支链最末那个 else（:3437 起），那里就摆着 statsBand / chartsBand。
  · 手机：**真的没有**。`wantsMetrics`（:2083）只认 dashboard / monitor /
    workbench，这三种页一个数字都出不来（wizard 只多一条 Steps）。

这条错误值得记一笔：正因为以为"这三种页压根没有 KPI 通道"，才会觉得把
MetricGrid/TrendChart 的 pageKinds 砍到只剩 workbench 是无害的——而
CHANNEL OWNERSHIP 同时要求这三种页"把 page.stats/charts 留空、改用积木"。
两下一夹，它们就成了**两条路都堵死**：积木不给用，自己声明的又被规矩禁止。

顺带说明为什么修法是"放开积木"而不是"改成让它们用 page.stats"：stats 那条路
在这三种页上**只有桌面通**，同一个页面换个端就没有数字了；积木两个端都渲染
（手机档见 :2339 `renderExperienceBlockScaffold(true, phonePrimaryDataView)`）。
CHANNEL OWNERSHIP 原本的分工是对的，错的是目录被砍窄了。

也就是说 **workbench / wizard / kanban / calendar 四种页型，从"这个区块能不能
在这儿干活"的角度看是可以互换的**：四者都有逐行视图、都走同一条
`businessPageGrid`、都吃同一张区域表（`regionsToGrid` 的几何按 band 走，跟页型
无关，只有 kanban/calendar 把右栏从 4/12 收到 3/12）。

所以本脚本的输出分两层，**不混在一起**：

  · 硬判据（hard_verdicts）：运行时真的会因此丢掉区块或画重复的，加上一条来自
    已自检预设的正面证据。只有 4 条，但每条都能指到具体行号或具体数据来源。
    这层进 CI（`--check`），不需要模型。
  · 设计建议（模型初稿）：其余全部。它影响的是**选材侧**——提示词里给模型的
    "这一页可以放这些"、组件库的页型筛选。标错了页面不会坏，只是推荐得不好。

**推论：这个字段不该上结构闸。** 门禁硬拒的前提是"违反了就一定错"，而四种
页型互换在运行时是无差别的。要拦的话只有硬判据那几条值得拦——而它们运行时
早就兜死了（见 hard_verdicts 里各自的行号）。这条推论已经写回
test_page_kind_consistency_ratchet.py 的「上闸还差什么」。

## 参考过的成熟方案

alibaba/lowcode-engine 的物料协议里是 `nestingRule.parentWhitelist` /
`childWhitelist`——**手写白名单**，引擎只负责校验，不负责推导。nocobase 的
`SchemaInitializer` 换了个思路：能往一个容器里加什么，由**容器提供什么数据
上下文**决定（DataBlockInitializer 按数据源过滤），而不是每个区块自己声明一张
页面清单。

本脚本照 nocobase 那个方向做：先写清"每种页提供什么"（PAGE_KIND_FACTS），
再问"这个区块需要什么"，两边对上才算能放。lowcode-engine 那种纯手写白名单
正是我们现在这份数据的形态，也正是它漂掉的原因。

## 三条纪律（都是从 label_block_generality.py 那边继承的教训）

**① 发 1..N 的行号，不发区块名。** 让模型原样抄回标识符，它有相当概率
"顺手规整一下"（forum_fit_grade.py 实测三分之一批次会把 id 重编成 1,2,3…，
静默丢了 374 条）。

**② 按页型分组问，不按区块分组问。** generality 那个脚本记着：混着问模型
几乎全答 yes（111 条混送标出 71 个 generic，等于没标）。这里同理——逐个区块问
"你能上哪几种页"会得到"都能"，所以改成对着**一种页**问"这一页提供 X，下面这些
里哪些在这种页上真能干活"。

**③ 落盘只改 `pageKinds` 一个键，按行改，不重新序列化。** 整文件 `indent=2`
回写会产生五千行重排（label_block_generality.py 里记着这笔账）。

**④ 默认不落盘。** 这份数据同时被 Python 侧（提示词白名单、页型预设自检）和
TS 侧（组件库筛选与计数，ComponentsLibraryPage.tsx 3977/4132）读，改它是产品
判断。`--dry-run` 打差异表给人过，`--write` 才动文件。
"""
from __future__ import annotations

import argparse
import functools
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "services" / "data" / "experience_block_catalog.json"
BATCH = 30

#: 总览页——这两种没有逐行视图。硬判据全都从这一条事实派生。
OVERVIEW_KINDS = ("monitor", "dashboard")

#: 每种页"提供什么"。喂给模型的就是这张表，也是硬判据的依据。
#:
#: 出处逐条写死在 evidence 里：这张表要是跟运行时漂了，模型拿到的就是假前提，
#: 而那种错误最难查（模型答得很有道理，只是前提是假的）。
PAGE_KIND_FACTS: dict[str, dict[str, Any]] = {
    "workbench": {
        "provides": "主实体的表（可筛、可选行、可行内操作）+ 全部 12 个区域；"
                    "声明了积木就由积木画版面，没声明才回落内置 ProTable",
        "row_view": True,
        "evidence": "AppRuntimeScreen.tsx usesProWorkbench / businessPageGrid",
    },
    "wizard": {
        "provides": "主实体的表 + 一条流程步骤条（来自 workflow.nodes）；"
                    "主列通常被分步表单占住，附属内容走 aside/supplement/footerBar；"
                    "KPI/趋势走 MetricGrid/TrendChart 积木（page.stats 在这种页上"
                    "只有桌面渲染、手机不出，所以归积木）",
        "row_view": True,
        "evidence": 'AppRuntimeScreen.tsx:3347 `page.view.kind === "wizard"` 的 Steps；'
                    ":2083 wantsMetrics 不含 wizard",
    },
    "kanban": {
        "provides": "主实体的看板（按 statusFieldId 分列，缺这个字段就回落成表）；"
                    "右栏比别的页型窄一格（3/12），因为棋盘吃宽度；"
                    "KPI/趋势走 MetricGrid/TrendChart 积木（同 wizard）",
        "row_view": True,
        "evidence": "AppRuntimeScreen.tsx:3180 KanbanBoard；business-page-layout.ts asideWidth；"
                    ":2083 wantsMetrics 不含 kanban",
    },
    "calendar": {
        "provides": "主实体的月历（按 dateFieldId 排，缺这个字段就回落成表）；"
                    "右栏同样窄一格；"
                    "KPI/趋势走 MetricGrid/TrendChart 积木（同 wizard）",
        "row_view": True,
        "evidence": "AppRuntimeScreen.tsx:3187 CalendarBoard；:2083 wantsMetrics 不含 calendar",
    },
    "monitor": {
        "provides": "**没有逐行视图**。KPI 与图表走 page.stats / page.charts，"
                    "由 freeformOverview 现场设计整页版式；积木走 blockScaffold，"
                    "排在设计版式后面",
        "row_view": False,
        "evidence": "AppRuntimeScreen.tsx:3362 monitor 分支；:1691 entityRows 是未筛全量",
    },
    "dashboard": {
        "provides": "同 monitor（没有逐行视图）；没有 freeformOverview 时退回业务网格",
        "row_view": False,
        "evidence": "AppRuntimeScreen.tsx:751 dashboardUsesBusinessGrid",
    },
}


def _catalog() -> dict[str, Any]:
    return json.loads(CATALOG.read_text(encoding="utf-8"))


@functools.lru_cache(maxsize=1)
def _preset_pairs_cached() -> tuple[tuple[str, frozenset[str]], ...]:
    """`preset_pairs()` 的缓存层。**别去掉。**

    `hard_verdicts()` 每次都要问一遍预设，而它会被调用 `区块数 × 页型数` 次
    （358 × 6 = 2148）。没有缓存时每次都重读并解析这份 ~1MB 的目录 JSON——
    实测 `--check` 因此要跑 17 秒，接进 CI 的一条纯本地检查慢成这样是没道理的。

    返回不可变结构（tuple + frozenset）：`lru_cache` 交出去的是同一个对象，
    返回可变的 dict/set 会让任何一处调用方的就地修改污染所有后续调用。
    """
    out: dict[str, set[str]] = {}
    for kind, presets in (_catalog().get("pageKindPresets") or {}).items():
        for ps in presets or []:
            for it in ps.get("blocks") or ps.get("items") or []:
                t = str(it.get("type") or "")
                if t:
                    out.setdefault(t, set()).add(str(kind))
    return tuple((t, frozenset(ks)) for t, ks in sorted(out.items()))


def preset_pairs() -> dict[str, set[str]]:
    """`pageKindPresets` 里已经用上的 (区块 → 页型) 组合。

    这是目录里**唯一一份经过校验的正面证据**：预设在服务启动时逐条自检
    （`schema_legal._load_page_kind_presets` 检查"区块通电了 / 这种页允许它 /
    这个槽位允许它"三件事，坏预设直接让服务起不来）。所以"某个预设在 wizard 页
    上用了 RecordForm"这件事，比任何人的印象都硬。

    加这条的由来：第一次跑第二层时，模型把 `RecordForm` 在 wizard 页判成"否"
    （理由"单体表单不能替代分步流程"），而目录里 `flow-form` 预设正是
    WorkflowTimeline + RecordForm 摆在 wizard 页上。模型说得有道理，只是事实不对
    ——它不知道这个组合已经被审过了。所以两处都补：硬判据把它钉成 require，
    提示词把预设当"已审核通过的正面例子"发给模型。

    每次返回一份新的可变副本——缓存层交出的是不可变结构（见
    `_preset_pairs_cached`），调用方就地改也污染不到别人。
    """
    return {t: set(ks) for t, ks in _preset_pairs_cached()}


def _hard_claims(block: dict[str, Any]) -> dict[str, list[tuple[str, str, str]]]:
    """四条硬规则各自的**主张**，一格可能有多条，这里**不消解**。

    返回 {页型: [(verdict, 理由, 规则号), …]}。

    拆出这一层是 2026-08-11 复审的结论。原来四条规则依次往同一个 dict 里
    `out[kind] = …`，于是**后写的赢**：硬④（预设推导出的 require）会静默盖掉
    硬①（总览页禁筛选类的 forbid），而这两条一个说"必须允许"、一个说"绝对不许"，
    根本不该有赢家。盖掉之后 `audit()` 会掉头要求把那个页型加回目录——而它正是
    渲染层会当场删掉、提示词也明令禁止的页型。当时数据里恰好没撞上，
    所以一路绿灯（唯一的重叠是 FilterBar@workbench，那个是良性的，见 `_resolve_claim`）。

    做法照 OPA/Rego 对 complete rule 的处理：多条规则给同一个键算出不同结果时，
    它不挑一个赢家，直接报 `eval_conflict_error`。冲突是**数据的问题**，
    应该炸给人看，不该由求值顺序悄悄决定。
    """
    out: dict[str, list[tuple[str, str, str]]] = {}
    btype = str(block.get("type") or "")
    cap = str(block.get("capability") or "")

    def claim(kind: str, verdict: str, why: str, rule: str) -> None:
        out.setdefault(kind, []).append((verdict, why, rule))

    # ── 硬① 总览页不放筛选类 ─────────────────────────────────────────
    # filterChange 在总览页够不到任何东西：只有本页的表/看板/日历吃筛过的行
    # （AppRuntimeScreen.tsx:812 applyPageFilter），而 KPI（:1922
    # pageStatDisplay）、图表（:2913 phoneChartNode）、积木与设计树（:1691
    # entityRows = state.entities，注释自己写着"未收窄"）全读未筛全量。
    # 渲染层已按 capability 兜死（:1781），提示词也禁（schema_legal.py）。
    if cap == "filter":
        for k in OVERVIEW_KINDS:
            claim(k, "forbid",
                  "总览页没有逐行视图，filterChange 够不到任何东西，是死控件", "硬①")

    # ── 硬② 总览页不放 KPI 积木 ──────────────────────────────────────
    # 总览页的 KPI/图表已经声明成 page.stats / page.charts 并由设计环节排版，
    # 再出一个 MetricGrid/TrendChart 就是同一份数字画两遍。
    # 渲染层兜死见 AppRuntimeScreen.tsx:1735 KPI_BLOCK_TYPES。
    if btype in ("MetricGrid", "TrendChart"):
        for k in OVERVIEW_KINDS:
            claim(k, "forbid",
                  "总览页的 KPI/图表归 page.stats/charts，这里会画两遍", "硬②")

    # ── 硬③ 筛选类至少要有一种带逐行视图的页 ──────────────────────────
    # 否则就是"只允许总览页 + 总览页不许放"，哪儿都摆不了。2026-08-11 真出现过
    # 两个（AnalyticsDateScope / DashboardParameterBar），见
    # tests/test_schema_legal_source.py 的 _OVERVIEW_ONLY_FILTERS_BASELINE。
    if cap == "filter":
        claim("workbench", "require_any_row",
              "筛选类必须至少有一种带逐行视图的页，否则无处可去", "硬③")

    # ── 硬④ 页型预设用上的组合必须允许 ───────────────────────────────
    # 预设在服务启动时逐条自检过（见 preset_pairs 的说明），是目录里唯一一份
    # 经过校验的正面证据。预设推荐了、而 pageKinds 不允许，服务直接起不来。
    for kind in preset_pairs().get(btype, set()):
        claim(kind, "require",
              f"pageKindPresets 在 {kind} 页上用了它，这条组合已自检通过", "硬④")

    return out


def _resolve_claim(kind: str, claims: list[tuple[str, str, str]]) -> tuple[str, str]:
    """把一格上的多条主张消解成一个判据，消解不了就判 `conflict`。

    只认两种可消解的情形，别再往里加"谁优先"的规则——那正是原来那份
    last-write-wins 的本质，只是写得更显眼一点：

      · **完全一致**：几条规则说的是同一件事（比如两个预设都用了它），合并理由。
      · **require 吸收 require_any_row**：require_any_row 的诉求是"至少有一种
        带逐行视图的页"，而 require 钉的这一格如果本来就是逐行视图页
        （`PAGE_KIND_FACTS[kind]["row_view"]`），那诉求已经被满足，不是矛盾。
        现实里只有 FilterBar@workbench 这一例。**这里要真去查 row_view**，
        不能因为"require 听起来更强"就吸收——预设要是把筛选类钉在某个非逐行
        视图的页上，那恰恰是要报的冲突。

    其余一律 `conflict`。最典型的是 forbid × require：硬①说总览页绝对不许放
    筛选类，硬④说某个预设在总览页上用了它。这两条不该有赢家——要么预设是错的，
    要么禁令是错的，得有人去看，不能靠 dict 的写入顺序拍板。
    """
    verdicts = {c[0] for c in claims}
    whys = "；".join(dict.fromkeys(f"{c[2]} {c[1]}" for c in claims))

    if len(verdicts) == 1:
        return claims[0][0], whys

    if verdicts == {"require", "require_any_row"} and PAGE_KIND_FACTS.get(
        kind, {}
    ).get("row_view"):
        return "require", whys

    return "conflict", f"硬判据自相矛盾（{'/'.join(sorted(verdicts))}）：{whys}"


def hard_verdicts(block: dict[str, Any]) -> dict[str, tuple[str, str]]:
    """硬判据：运行时**真的**会因此丢掉区块或画重复的那几条。

    返回 {页型: (verdict, 理由)}：

        forbid           这种页上不许有它——运行时会丢掉，或者会画重复
        require          这种页上必须允许它
        require_any_row  这一格只是"至少得有一种带逐行视图的页"的记账位，
                         不要求非得是它（同族别的页型顶上也算达标）
        conflict         几条硬规则在这一格上打架，消解不了——**数据要修**，
                         由 `audit()` 报出来，`--check` 会因此非零退出

    没进这张表的格子表示"运行时不在乎"，归设计建议那一层。

    条目少得出乎意料，但这正是本脚本查出来的结论——页型对区块准入的技术影响，
    全部集中在"有没有逐行视图"这一件事上，外加一条来自已自检预设的正面证据。
    """
    return {
        kind: _resolve_claim(kind, claims)
        for kind, claims in _hard_claims(block).items()
    }


def needs_model(verdict: tuple[str, str] | None) -> bool:
    """这一格要不要问模型。

    抽成函数是为了能被测试直接调到——它决定"哪些格子会被问"，而问漏了的表现
    是沉默的（区块永远进不了 `complete`，只会在输出里显示成"没问全，重跑"），
    靠跑一遍脚本根本看不出来是 bug 还是模型没答上。

        None             硬判据不管这一格 → 问
        require_any_row  只是记账位，本格是 yes 是 no 仍由模型判 → 问
        forbid / require 已经定死 → 不问（问了浪费调用，还可能被答反）
        conflict         规则自己打架 → **不问**。问模型没有意义：要修的是数据，
                         不是让模型来仲裁两条硬规则谁对。`audit()` 会报出来，
                         而且 `main()` 在有冲突时直接拒绝跑第二层。
    """
    return verdict is None or verdict[0] == "require_any_row"


def audit(blocks: list[dict[str, Any]]) -> list[tuple[str, str, str, str]]:
    """拿硬判据核对目录现状，返回 [(区块, 页型, 问题, 理由)]。

    这一层不调模型，`--check` 用它进 CI。
    """
    row_kinds = {k for k, v in PAGE_KIND_FACTS.items() if v["row_view"]}
    problems: list[tuple[str, str, str, str]] = []
    for b in blocks:
        if not b.get("generationEnabled"):
            continue
        declared = set(b.get("pageKinds") or [])
        btype = str(b.get("type") or "")
        for kind, (verdict, why) in hard_verdicts(b).items():
            if verdict == "conflict":
                # 规则之间打架，不是目录违反了规则——但同样得清零，而且更急：
                # 这一格上任何结论都是不可信的（原来靠写入顺序拍板，谁后写谁赢）
                problems.append((btype, kind, "硬判据自相矛盾，先修规则或预设", why))
            elif verdict == "forbid":
                if kind in declared:
                    problems.append((btype, kind, "目录允许了硬判据禁止的页型", why))
            elif verdict == "require":
                if kind not in declared:
                    problems.append((btype, kind, "目录缺了硬判据要求的页型", why))
            elif verdict == "require_any_row":
                # 不要求非得是这一格——同族任何一种带逐行视图的页顶上都算达标
                if not (declared & row_kinds):
                    problems.append(
                        (btype, "|".join(sorted(row_kinds)), "目录缺了硬判据要求的页型", why)
                    )
    return problems


RUBRIC = """你在给一个企业应用「体验区块库」判**页型推荐**：这个区块该不该被推荐到某一种页上。

这一轮问的是同一种页：**{kind}**。这种页提供的是：

{provides}
{blessed}
判据只有一条：**这个区块摆在这种页上，能不能真的干活、并且是这一页该有的东西。**

  · 能干活 = 它需要的数据/交互，这种页提供得起（比如需要"选中一行"的区块，
    在没有逐行视图的页上就干不了活）；
  · 该有 = 一个正常的这种页面上，用户会期待看到它。宁少勿多——多推一个，
    就是把一个不该出现的东西塞给了不需要它的人。

注意：**不要**因为"它看起来通用"就都答 yes。也不要因为名字带某个行业词就答 no
——行业专属件在对应行业的这种页上照样成立。

输出 JSON：{{"items":[{{"i":行号,"ok":true 或 false,"why":"不超过20字"}}]}}
每一行都要有，行号原样用输入给的那个数字。"""


def ask(kind: str, rows: list[tuple[str, str]], model: str) -> dict[str, tuple[bool, str]]:
    """问一种页：这批区块里哪些该被推荐到 kind 页上。

    **按页型分组问**，不按区块分组问——理由见模块文档的纪律②。
    """
    import httpx

    for attempt in range(3):
        try:
            return _ask_once(kind, rows, model)
        except httpx.HTTPError as exc:
            if attempt == 2:
                raise
            print(f"    重试 {attempt + 1}/2：{str(exc)[:80]}")
            time.sleep(2**attempt)
    return {}


_FORCE_RUBRIC = """下面这些「体验区块」在逐页型评审里被判成**哪一种页都不该放**。这不可能成立
——每个区块都是已经写好渲染器、已经放开生成的，总得有个归宿。

可选的页型只有这 6 种，各自提供的东西是：

{facts}

请为每一个**选出最合适的 1~2 种**页型。不要选"都行"，也不要一个都不选。
判据：这个区块需要的数据/交互，哪种页提供得起；一个正常的这种页面上，
用户会不会期待看到它。

输出 JSON：{{"items":[{{"i":行号,"kinds":["workbench"],"why":"不超过20字"}}]}}
kinds 只能从上面那 6 个名字里取，每一行都要有，行号原样用输入给的那个数字。"""


def force_pick(rows: list[tuple[str, str]], model: str) -> dict[str, tuple[set[str], str]]:
    """强制选择：给被清空的区块问"至少最合适的是哪一两种页"。

    跟 `ask()` 的区别是**问法从"能不能"换成"选哪个"**——逐页型问是判断题，一路
    答否就把区块清空了；这里是选择题，答不出"都不选"。
    """
    import httpx

    facts = "\n".join(
        f"  · {k}：{v['provides']}" for k, v in PAGE_KIND_FACTS.items()
    )
    for attempt in range(3):
        try:
            resp = httpx.post(
                f'{os.environ["LLM_BASE_URL"].rstrip("/")}/chat/completions',
                headers={"Authorization": f'Bearer {os.environ["LLM_API_KEY"]}'},
                json={
                    "model": model,
                    "stream": False,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": _FORCE_RUBRIC.format(facts=facts)},
                        {
                            "role": "user",
                            "content": "\n".join(
                                f"{i}. {line}" for i, (_t, line) in enumerate(rows, 1)
                            ),
                        },
                    ],
                },
                timeout=300,
            )
            resp.raise_for_status()
            items = json.loads(resp.json()["choices"][0]["message"]["content"])["items"]
            out: dict[str, tuple[set[str], str]] = {}
            for it in items:
                try:
                    lineno = int(it["i"])
                except (KeyError, TypeError, ValueError):
                    continue
                if not 1 <= lineno <= len(rows):
                    continue
                ks = {
                    str(k) for k in (it.get("kinds") or []) if str(k) in PAGE_KIND_FACTS
                }
                if ks:
                    out[rows[lineno - 1][0]] = (ks, str(it.get("why") or "")[:40])
            return out
        except httpx.HTTPError as exc:
            if attempt == 2:
                raise
            print(f"    重试 {attempt + 1}/2：{str(exc)[:80]}")
            time.sleep(2**attempt)
    return {}


def _blessed_examples(kind: str) -> str:
    """把这种页**已经审核通过**的预设组合发给模型当正面例子。

    第一次跑第二层时模型把 `RecordForm` 在 wizard 页判成"否"，而目录里
    `flow-form` 预设正是 WorkflowTimeline + RecordForm 摆在 wizard 页上。
    它的理由（"单体表单不能替代分步流程"）听着有道理，只是不知道这个组合已经
    被审过了。给它这几行，那类错就没了。
    """
    hits = sorted(t for t, ks in preset_pairs().items() if kind in ks)
    if not hits:
        return ""
    return (
        f"\n这种页上**已经审核通过**的组合（pageKindPresets，服务启动时逐条自检）："
        f"{'、'.join(hits)}。这几个一定答 true。\n"
    )


def _ask_once(kind: str, rows: list[tuple[str, str]], model: str) -> dict[str, tuple[bool, str]]:
    import httpx

    resp = httpx.post(
        f'{os.environ["LLM_BASE_URL"].rstrip("/")}/chat/completions',
        headers={"Authorization": f'Bearer {os.environ["LLM_API_KEY"]}'},
        json={
            "model": model,
            "stream": False,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": RUBRIC.format(
                        kind=kind,
                        provides=PAGE_KIND_FACTS[kind]["provides"],
                        blessed=_blessed_examples(kind),
                    ),
                },
                {
                    "role": "user",
                    "content": "\n".join(
                        f"{i}. {line}" for i, (_t, line) in enumerate(rows, 1)
                    ),
                },
            ],
        },
        timeout=300,
    )
    resp.raise_for_status()
    items = json.loads(resp.json()["choices"][0]["message"]["content"])["items"]
    out: dict[str, tuple[bool, str]] = {}
    for it in items:
        try:
            lineno = int(it["i"])
        except (KeyError, TypeError, ValueError):
            continue
        # 越界行号直接丢：宁可这条留空下次重问，也不能张冠李戴
        if not 1 <= lineno <= len(rows):
            continue
        out[rows[lineno - 1][0]] = (bool(it.get("ok")), str(it.get("why") or "")[:40])
    return out


def row_of(b: dict[str, Any]) -> tuple[str, str]:
    """喂给模型的一行。带上区域和事件——那才是"它需要什么"的真凭据。"""
    src = b.get("source")
    repo = src.get("repo", "-") if isinstance(src, dict) else "-"
    return (
        str(b["type"]),
        f'{b["type"]}｜{str(b.get("description") or "")[:80]}'
        f'｜能力={b.get("capability")}｜槽位={",".join(b.get("allowedRegions") or [])}'
        f'｜事件={",".join(b.get("events") or []) or "-"}｜来源={repo}',
    )


#: 默认并发。72 次调用串行跑实测 62 分钟，8 并发压到 10 分钟以内。
#:
#: 为什么不开更大：这个网关今天抖过好几次（首轮就撞上一次
#: `Connection reset by peer`，早先另一条链路还连着吃过 400）。并发越高，
#: 单位时间内的重试也越密，容易把"偶发抖动"变成"整轮被限流"。8 够用就停在 8。
_CONCURRENCY = 8


def run_batches(
    tasks: list[tuple[Any, list[tuple[str, str]]]],
    fn: Any,
    workers: int,
    label: str,
) -> tuple[dict[Any, list[dict[str, Any]]], list[tuple[Any, str]]]:
    """并发跑一批 (key, rows) 任务，返回 {key: [每批结果…]} 和失败清单。

    ## 为什么每批单独兜异常

    串行版一旦某批重试耗尽就整轮抛出——跑到第 50 分钟才挂，前面的都白花。
    并发之后这个代价更高（同时在飞的都废了），所以改成**单批失败只丢那一批**：
    那批区块落进"没问全"，照旧被差异表排除、被下一轮重跑捡起来。
    宁可少一批数据，不要一轮 62 分钟的产出。

    失败会打出来也会记进返回值——静默丢批比挂掉更坏。
    """
    results: dict[Any, list[dict[str, Any]]] = {}
    failures: list[tuple[Any, str]] = []
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fn, key, rows): (key, len(rows))
                   for key, rows in tasks}
        for fut in as_completed(futures):
            key, n = futures[fut]
            done += 1
            try:
                results.setdefault(key, []).append(fut.result())
            except Exception as exc:  # noqa: BLE001 —— 单批失败不该带走整轮
                failures.append((key, f"{type(exc).__name__}: {str(exc)[:120]}"))
                print(f"  [{done}/{len(tasks)}] ✗ {label} {key} 这批 {n} 个失败："
                      f"{type(exc).__name__}: {str(exc)[:80]}")
                continue
            print(f"  [{done}/{len(tasks)}] {label} {key} +{n}")
    return results, failures


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="只跑硬判据（不调模型），有违反就非零退出。CI 用")
    ap.add_argument("--dry-run", action="store_true", help="硬判据 + 模型初稿，只打表")
    ap.add_argument("--write", action="store_true", help="把推导结果写回目录")
    ap.add_argument("--kind", action="append",
                    help="只跑指定页型（可重复），默认全部 6 种")
    ap.add_argument("--draft-out", default="data/page_kinds_draft.json",
                    help="原始初稿落盘路径（相对 scripts/）。一小时的产出不能只留在终端")
    ap.add_argument("--concurrency", type=int, default=_CONCURRENCY,
                    help=f"并发调用数（默认 {_CONCURRENCY}）。1 = 串行")
    args = ap.parse_args()
    draft_path = (Path(__file__).resolve().parent / args.draft_out).resolve()

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    blocks: list[dict[str, Any]] = catalog["blocks"]
    enabled = [b for b in blocks if b.get("generationEnabled")]

    # ── 第一层：硬判据 ────────────────────────────────────────────────
    problems = audit(blocks)
    print(f"目录 {len(blocks)} 个区块（通电 {len(enabled)}）")
    print(f"硬判据违反 {len(problems)} 处")
    for btype, kind, what, why in problems:
        print(f"  ✗ {btype:<26} {kind:<10} {what} —— {why}")
    if args.check:
        if problems:
            print("\n硬判据是运行时真会丢区块/画重复的那几条，必须清零。")
        return 1 if problems else 0

    if not (args.dry_run or args.write):
        print("\n没指定 --check / --dry-run / --write，只跑了硬判据。")
        return 0

    # 规则自相矛盾时不许往下走。这跟"目录违反了规则"不是一回事：那种情况下
    # 规则本身还是可信的，推导有意义；而规则打架时，冲突格上的任何结论都建立在
    # "谁后写谁赢"上，推出来的标签是假的。宁可停在这里让人去看。
    conflicts = [p for p in problems if p[2].startswith("硬判据自相矛盾")]
    if conflicts:
        print(
            f"\n{len(conflicts)} 处硬判据自相矛盾，拒绝往下推导"
            "（冲突格上的结论会建立在规则求值顺序上，不可信）。先修规则或预设。",
            file=sys.stderr,
        )
        return 2

    # ── 第二层：设计建议（模型初稿）─────────────────────────────────
    if not os.getenv("LLM_API_KEY") or not os.getenv("LLM_BASE_URL"):
        print("缺 LLM_API_KEY / LLM_BASE_URL——第二层要调模型", file=sys.stderr)
        return 2
    model = os.getenv("LLM_MODEL") or "gpt-5.5"
    kinds = args.kind or list(PAGE_KIND_FACTS)
    bad = [k for k in kinds if k not in PAGE_KIND_FACTS]
    if bad:
        print(f"未知页型: {bad}", file=sys.stderr)
        return 2

    print(f"\n第二层：按页型问模型（{model}），{len(kinds)} 种页 × {len(enabled)} 个区块")
    derived: dict[str, set[str]] = {str(b["type"]): set() for b in enabled}
    asked: dict[str, set[str]] = {str(b["type"]): set() for b in enabled}
    why_of: dict[tuple[str, str], str] = {}

    # 六种页型的 72 次调用彼此独立，摊平成一张任务表并发跑（串行 62 分钟 → 8 并发
    # 10 分钟内）。硬判据那部分是纯本地计算，照旧串行，先算完再决定要问哪些。
    tasks: list[tuple[str, list[tuple[str, str]]]] = []
    rows_of_kind: dict[str, int] = {}

    for kind in kinds:
        verdict_of = {str(b["type"]): hard_verdicts(b).get(kind) for b in enabled}
        # 硬判据已经**定死**的格子不问模型——问了也只会浪费一次调用，还可能被它答反。
        #
        # ⚠️ require_any_row 不算定死，必须跟着问。它只是一个记账位（"筛选类至少
        # 得有一种带逐行视图的页"），本格是 yes 还是 no 仍由模型判——下面 :421 的
        # 注释一直是这么写的，但它被排除在 ask_list 外、答案又在那里被 discard 掉，
        # 于是没有任何地方真去问。
        #
        # 后果实测（完美模型模拟）：32 个筛选区块里 31 个的 workbench 格永远进不了
        # `asked`，:442 的 `asked >= set(kinds)` 因此永远不成立——它们被算作"没问全"，
        # `--dry-run` 每次都把它们列进"不下结论，重跑"，`--write` 一次都不会给它们
        # 打标。这个脚本存在的意义就是让 pageKinds 可重算，而筛选整族对它不可达。
        ask_list = [b for b in enabled if needs_model(verdict_of[str(b["type"])])]
        for b in enabled:
            v = verdict_of[str(b["type"])]
            if v is None:
                continue
            t = str(b["type"])
            asked[t].add(kind)
            if v[0] == "require":
                derived[t].add(kind)
            elif v[0] == "require_any_row":
                # 这一格不是"必须是它"，只是记账位——照旧交给模型判。
                # 上面预先 add 的那笔要撤掉：这一格算不算"问过"，取决于模型
                # 这一轮有没有答上（答上了由下面 :447 补记）。留着会让答不上来的
                # 也被当成问过，把"没问全"悄悄吞掉。现在它确实在 ask_list 里了。
                asked[t].discard(kind)
                continue
            why_of[(t, kind)] = f"硬判据：{v[1]}"

        rows = [row_of(b) for b in ask_list]
        rows_of_kind[kind] = len(rows)
        for start in range(0, len(rows), BATCH):
            tasks.append((kind, rows[start : start + BATCH]))

    print(f"  {len(tasks)} 批待问，并发 {args.concurrency}")
    batched, failures = run_batches(
        tasks, lambda k, r: ask(k, r, model), args.concurrency, "页型"
    )

    for kind in kinds:
        got: dict[str, tuple[bool, str]] = {}
        for part in batched.get(kind, []):
            got.update(part)
        for t, (ok, why) in got.items():
            asked[t].add(kind)
            if ok:
                derived[t].add(kind)
            why_of[(t, kind)] = why
        n_yes = sum(1 for _t, (ok, _w) in got.items() if ok)
        n_rows = rows_of_kind[kind]
        print(f"  {kind:<10} 问了 {n_rows:>3} 个（硬判据定死 {len(enabled) - n_rows} 个），"
              f"模型答 yes {n_yes}，答上 {len(got)}/{n_rows}")
    if failures:
        # 失败批的区块会落进"没问全"，被差异表排除。说清楚，不让它看起来像
        # "模型判它不该有页型"。
        print(f"\n⚠ {len(failures)} 批调用失败（那批区块算作没问全，重跑捡回来）：")
        for key, msg in failures[:8]:
            print(f"    {key}: {msg}")

    # ── 兜底：被判成"哪种页都不该放"的区块，回头强制选一次 ──────────────
    #
    # 2026-08-11 首轮实测照出来的洞：**按页型分组问，就没有任何一处在看
    # "这个区块还剩几种页"**。结果 8 个抽查样本 8 个被清空
    # （AlertGroupCommandHeader / AttachmentPanel / AlertRuleCommandHeader …
    # 现有页型被逐个否掉，一个不剩）。清空等于废掉一个渲染器，而每一轮单独看
    # 都"答得有道理"——这正是分组问的代价。
    #
    # 所以补一问，换成**强制选择**：不问"能不能"，问"至少最合适的是哪一两种"。
    # 措辞照本仓库反复验证过的那条走——给出路的问法才收得住（区域限制那次
    # "不给出路的禁令会被绕过"记的是同一件事）。
    if len(kinds) == len(PAGE_KIND_FACTS):
        emptied = [b for b in enabled if asked[str(b["type"])] >= set(kinds)
                   and not derived[str(b["type"])]]
        if emptied:
            print(f"\n兜底：{len(emptied)} 个区块被判成哪种页都不放，强制重选一次")
            rows = [row_of(b) for b in emptied]
            back_tasks = [
                (start // BATCH, rows[start : start + BATCH])
                for start in range(0, len(rows), BATCH)
            ]
            back, back_fail = run_batches(
                back_tasks, lambda _k, r: force_pick(r, model), args.concurrency, "兜底"
            )
            for parts in back.values():
                for got2 in parts:
                    for t, (ks, why) in got2.items():
                        derived[t] |= ks
                        for k in ks:
                            why_of[(t, k)] = f"兜底强制选：{why}"
            if back_fail:
                print(f"  ⚠ 兜底有 {len(back_fail)} 批失败，这些区块仍会是空的")
            still = [str(b["type"]) for b in emptied if not derived[str(b["type"])]]
            print(f"  强制重选后仍为空 {len(still)} 个"
                  + (f"：{', '.join(still[:10])}" if still else "（全部有归宿了）"))

    # ── 差异表 ────────────────────────────────────────────────────────
    # 只对**问全了 6 种页**的区块下结论：漏了一种页就没法说"目录更宽/更窄"。
    complete = [b for b in enabled if asked[str(b["type"])] >= set(kinds)]
    same, wider, narrower = [], [], []
    for b in complete:
        t = str(b["type"])
        cur = set(b.get("pageKinds") or []) & set(kinds)
        new = derived[t] & set(kinds)
        if cur == new:
            same.append(t)
        elif cur > new:
            wider.append((t, sorted(cur - new)))
        elif cur < new:
            narrower.append((t, sorted(new - cur)))
        else:
            wider.append((t, sorted(cur - new)))
            narrower.append((t, sorted(new - cur)))

    print(f"\n差异（问全 {len(kinds)} 种页的 {len(complete)} 个区块）：")
    print(f"  一致        {len(same)}")
    print(f"  目录更宽    {len(wider)}  ← 现在推荐了推导认为干不了活的页")
    for t, extra in sorted(wider)[:30]:
        first = extra[0]
        print(f"      {t:<26} 多 {','.join(extra):<22} {why_of.get((t, first), '')}")
    print(f"  目录更窄    {len(narrower)}  ← 现在挡住了推导认为能用的页")
    for t, miss in sorted(narrower)[:30]:
        first = miss[0]
        print(f"      {t:<26} 缺 {','.join(miss):<22} {why_of.get((t, first), '')}")
    incomplete = [str(b["type"]) for b in enabled if b not in complete]
    if incomplete:
        print(f"\n没问全的 {len(incomplete)} 个（不下结论，重跑）：{', '.join(incomplete[:12])}")

    # ── 存原始初稿 ────────────────────────────────────────────────────
    #
    # 2026-08-11 首轮跑完才发现漏了这件事：屏幕上的差异表两边各截 30 行，而**原始
    # 逐格判断一个字都没留**。要复核就得再花一个小时重跑一遍全部 API 调用。
    # 一小时的产出必须落地成文件，不能只活在终端回滚里。
    draft_path.parent.mkdir(parents=True, exist_ok=True)
    draft_path.write_text(
        json.dumps(
            {
                "model": model,
                "kinds": kinds,
                "pageKindFacts": {k: v["provides"] for k, v in PAGE_KIND_FACTS.items()},
                "blocks": {
                    str(b["type"]): {
                        "current": sorted(set(b.get("pageKinds") or [])),
                        "derived": sorted(derived[str(b["type"])]),
                        "asked": sorted(asked[str(b["type"])]),
                        "why": {
                            k: why_of[(str(b["type"]), k)]
                            for k in kinds
                            if (str(b["type"]), k) in why_of
                        },
                    }
                    for b in enabled
                },
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"\n原始初稿已存 {draft_path}（逐格判断 + 理由，复核不用重跑）")

    if not args.write:
        print("\n--dry-run：没有写文件。"
              "\n提醒：第二层是**设计建议**，标错了页面不会坏，只是推荐得不好；"
              "\n     这份数据同时被组件库筛选读（ComponentsLibraryPage.tsx 3977/4132），"
              "\n     所以落盘前请人过一遍上面这两张表。")
        return 0

    if len(kinds) != len(PAGE_KIND_FACTS):
        print(f"\n--kind 只跑了 {kinds}，不能落盘：写回会把没问的页型当成"
              f"“推导认为不该有”而删掉。要落盘请跑全 6 种。", file=sys.stderr)
        return 2

    labels = {str(b["type"]): sorted(derived[str(b["type"])]) for b in complete}
    empty = [t for t, ks in labels.items() if not ks]
    if empty:
        print(f"\n拒绝落盘：这些区块推导出来一个页型都不允许，等于把它们废掉——"
              f"先人工看过再说：{', '.join(empty[:12])}", file=sys.stderr)
        return 2
    written = rewrite_page_kinds(labels)
    print(f"\n已写回 {CATALOG.relative_to(ROOT.parent)}（{written} 个区块）")
    return 0


#: 块级键的缩进。目录里 propsSchema 内部也有 "type"，靠缩进区分。
_BLOCK_TYPE_LINE = '      "type": "'
_PAGE_KINDS_LINE = '      "pageKinds"'


def rewrite_page_kinds(labels: dict[str, list[str]]) -> int:
    """按**行**替换每个区块的 `pageKinds` 数组，不重新序列化整份 JSON。

    理由跟 label_block_generality.py 的 insert_generality 同一条：原文件把短的
    嵌套对象压在一行，`json.dumps(indent=2)` 回写会把它们全展开，几百个字段的
    改动淹在五千行重排里没人审得动。

    这里比那边麻烦一点——`pageKinds` 是多行数组，得找到配对的 `]`。缩进仍是
    判据（块级键 6 空格），所以不会误伤 propsSchema 里的同名键。
    """
    lines = CATALOG.read_text(encoding="utf-8").split("\n")
    out: list[str] = []
    cur: str | None = None
    hit = 0
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith(_BLOCK_TYPE_LINE):
            btype = line[len(_BLOCK_TYPE_LINE) :].split('"', 1)[0]
            cur = btype if btype in labels else None
        if cur and line.startswith(_PAGE_KINDS_LINE):
            j = i
            while "]" not in lines[j]:
                j += 1
            items = labels[cur]
            out.append(line)
            for n, k in enumerate(items):
                out.append(f'        "{k}"' + ("," if n < len(items) - 1 else ""))
            out.append(lines[j])
            hit += 1
            cur = None
            i = j + 1
            continue
        out.append(line)
        i += 1
    CATALOG.write_text("\n".join(out), encoding="utf-8")
    return hit


if __name__ == "__main__":
    raise SystemExit(main())
