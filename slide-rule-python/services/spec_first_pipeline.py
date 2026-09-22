"""把 spec-first 七步接到推演主轴上。

## 这一步在干什么

七步（spec_tree → spec_page_html → page_shell → html_structure →
spec_semantics → model_assembly → html_bindings）此前是**七个可独立调用的
模块**，推演主轴（v5_capability_executor._try_llm_generate_evidence）仍走老路：
`generate_five_system_model(goal)` 从一句话里同时发明实体/字段/enum/页面/
权限/工作流/不变式（架构图 ⛔1）。本文件是把七步串成一条、接到那个入口上。

⚠ **不是给 GEN5 加参数，是它不在这条路上。** 新链路自己产出完整六段再过
`v5_model_gate`，所以 ⛔1 / ⛔3 那两条描述的是老链路——那条今天还在跑，
两条都还成立，只是不适用于这里。

## 开源怎么选的：查过五个，一个都不引

编排类候选逐个看过：**LangGraph / Burr / Prefect / Temporal / Dagster**，
容器里一个都没装。不引的理由不是"懒得装"，是它们解决的问题这里已经有更贴合的：

  它们给的                     仓里现成的
  ─────────────────────────    ────────────────────────────────────────
  图/状态机编排                 这条链是**线性的**，只有第 3 步一处扇出
  checkpoint / 断点续跑         run_registry：事件带单调 seq、按 SSE
                               Last-Event-ID 续播、孤儿 run 看门狗回收
  每步耗时与进度上报            enrich_timing.stage()：墙钟埋点 + sink 直接
                               喂给 SSE 慢阶段心跳
  超时/预算                     remaining_run_budget_seconds()
  重试                          call_llm_with_retry（带 transient 分级 +
                               gRPC hedging 治长尾，见第 3 步那次）

引 LangGraph 会多出**第二套编排模型**，而它的 checkpoint 跟现有事件日志各记
各的，续播语义要对齐两遍。这跟第 3 步那次拒绝 tenacity 是同一个判断：
**多一个依赖换一个更差的集成。**

真正该抄开源的地方在**各步内部**，而且已经抄了：第 3 步照 screenshot-to-code
的 create/text.py，第 5 步的权限合法性照 Apache Casbin 的 {subject, object, action}。
编排这一层没有可抄的。

## 开关：2026-08-14 起**默认开**，`SLIDERULE_SPEC_FIRST=0` 才关

原先缺省 off，照的是目录窄化（3 覆盖域 × 2 臂 × n=6，p=0.00004）和 agentic
pick（十话题 4:0）那两次"拿证据换默认开"的老规矩。

翻默认由用户拍板。手上的对照支持这个方向，但**要如实说清它有多薄**：
n=3 的一轮 A/B（experiments/visual-first/ab_spec_first.py），同一个话题——

    过闸      NEW 3/3          OLD 2/3
    findings  NEW 恒 0          OLD 有拦
    页面数    NEW 恒 5          OLD 4~6（同一句话，页数自己在飘）
    字段      NEW 声明 40 / 页面真用 38（95%）
              OLD 声明 51 / 页面真用 36（71%，15 个字段一次都没出现过）

⚠ 那条"OLD 字段多 30%"是**判据错**，不是结论：它数的是声明数，不是用到的数。
按用到的数 NEW 38 > OLD 36。这一轮里判据被返工过四次，记在这儿是为了下次
别再拿"造个数替代看一眼"当证据。

⚠ 一轮 n=3 够不上前两次翻默认的量级（那两次是 p 值和十话题）。所以这不是
"攒够了证据"，是**用户在知道证据有多薄的前提下决定的**。真正的兜底是失败
不静默：整条链挂了就抛，由 v5_capability_executor 显式回落老路并打日志——
"新链路跑通了"和"新链路挂了但老路兜住了"在日志里长得不一样。

⚠ 同时进 /ready 的 `specFirst` 探针。理由是 rank-bm25 那次的教训：
**会静默失效的功能，健康探针里必须有它的位置**——开关开着不算数，
七个模块都在才算 effective。
"""

from __future__ import annotations
from .archetype_legal import supported_devices as _supported_devices

import os
import sys
from contextvars import ContextVar
from typing import Any, Callable, Dict, Iterable, List, Optional

from . import env_flags as _env_flags
from .capability_plan import CapabilityPlan
from sliderule_llm.scoped import sink_scope

SPEC_FIRST_VERSION = "spec-first-pipeline-v1"


def _safe_print(msg: str) -> None:
    """Windows 控制台默认 GBK，⚠ 会 UnicodeEncodeError。

    2026-08-18 真机：断线体检那行 print 带 ⚠，except 里再 print 一遍 ⚠，
    第二次逃出 try，spec-first 被判失败、整条回落老链路。except 自己的
    日志必须永远打得出来。回落按当前 stdout 编码 replace，中文还能留下。
    """
    try:
        print(msg)
    except UnicodeEncodeError:
        encoding = getattr(sys.stdout, "encoding", None) or "ascii"
        print(msg.encode(encoding, errors="replace").decode(encoding, errors="replace"))

#: 每落地一页叫一次的出口：(page_id, html, done, total[, bound])。
#:
#: 第 5 个参数 bound（2026-08-14 晚加）：同一页会到达**不止一次**——
#: 第 3 步素颜页先到（bound=False），第 3.5 步外壳统一后重发一遍（仍 False，
#: 但菜单已经按 spec 锚定），第 6.5 步打完 data-* 孔再发（bound=True）。
#: 前端按 pageId 覆盖（useSlideRuleSession.onSpecPage 那句"同一页第二次
#: 到达——覆盖，不是追加"）。不重发的话，用户整个推演期盯着的都是
#: 各页各自发明菜单的中间态——「三个产品名、三个登录人」那个病灶
#: （page_shell.py 头注），修好了却只有落库那份能看见。
#:
#: ⚠ **ContextVar 而不是模块属性。** 这条是本仓 2026-08-06 踩出来的：
#: `last_generate_diagnostic` 当初就是模块属性，多租户下一个请求读到了另一个
#: 请求的结果。页面 HTML 串台比诊断串台严重得多——那是把 A 的界面推给 B。
#:
#: 为什么要有这个通道，而不是把 on_page 从主轴一路当参数传下来：
#: 中间隔着 v5_capability_executor._try_llm_generate_evidence，那是条**同步**
#: 函数、且被十几处调用。为一件"顺带推给前端看"的事去改所有调用方的签名不划算。
#: 同款判断见 set_capability_delta_sink / set_generate_delta_sink / set_stage_sink，
#: 驱动器那一层已经是这么接的三条流。
_page_sink_var: ContextVar[Optional[Callable[..., None]]] = ContextVar(
    "sliderule_spec_first_page_sink", default=None
)


def set_page_sink(sink: Optional[Callable[..., None]]) -> None:
    """装/卸页面出口。驱动器在流开始时装、finally 里卸。"""
    _page_sink_var.set(sink)


def page_sink_scope(sink):
    """装了自带卸的写法（抄 grok 的 SinkGuard，见 sliderule_llm/scoped.py）。

    调用方优先用这个，别用上面那个裸 setter——裸 setter 要人肉记得去别处
    补一行卸载，而且卸成 None 而不是还原成原来那个。
    """
    return sink_scope(_page_sink_var, sink)




_quality_sink_var: ContextVar[Optional[Callable[..., None]]] = ContextVar(
    "sliderule_spec_first_quality_sink", default=None
)


def quality_sink_scope(sink):
    """图判降级 / 孤岛 / 对比。只报不拦。抄 grok typed session events。"""
    return sink_scope(_quality_sink_var, sink)


#: 页面改名出口（2026-09-06）。第 4.5 步把草稿 id 改成模型铸的语义 id
#: （p1 → seat_selection），**这件事必须当场告诉前端**。
#:
#: ⚠ 为什么非要有这条实时通道，而不是让前端读落库的那张 `pageIdAliases`：
#:   那张表要等**整条管道跑完**才随交付物交出去，而页面是边跑边推的。
#:   真机 sr-20260906111901 实测：第 3 步、3.5 步各推一批 `p1..p6`，
#:   第 4.5 步改名，第 6.5 步再推同样这六页、但 id 已是语义名。前端按
#:   pageId 认卡（useSlideRuleSession.onSpecPage 里那句 findIndex），
#:   认不出这是同六页，于是走了**追加**那一支——画布 12 张卡对应 6 个页面，
#:   前 6 张素颜、未打孔、点不动，左栏「🖼 界面已出」跟着出 12 条。
#:   等落库那份别名表到货时，重复的卡早就建好了。
#:
#: 形状抄 grok-build `xai-codebase-graph/src/types/file_event.rs`：
#:   `Renamed { from: PathBuf, to: PathBuf }`
#: 改名在那儿是**一等事件**、自带两头；且 `requires_reparse()` 对它返回
#: `false // Only path update needed`——消费方只更新键，不重新解析内容。
#: 这正是这里要的语义：前端把那张卡的 pageId 换掉，HTML 一个字都不用动。
#:
#: 跟 _page_sink_var 同一个模子（ContextVar 不是模块属性，多租户串台的
#: 理由见那一条头注），装卸也在同一处。
_rename_sink_var: ContextVar[Optional[Callable[..., None]]] = ContextVar(
    "sliderule_spec_first_rename_sink", default=None
)


def rename_sink_scope(sink):
    """装了自带卸的写法（抄 grok 的 SinkGuard，见 sliderule_llm/scoped.py）。"""
    return sink_scope(_rename_sink_var, sink)


def _emit_page_renamed(canon: Any) -> int:
    """把第 4.5 步的改名推给前端。返回**真的推出去几条**（照 grok
    `dedup_duplicate_tool_results` 交回抑制条数那个习惯：这类"顺带推一把"
    的口子不返回点什么，判据就只能去猜）。

    ⚠ 空表不许发。没改过名的轮次是常态——`canonical_page_id_map` 一个都
      没改就返回空表，精修轮几乎总是这样。那种轮次里"改名"这件事根本没
      发生过，发一条空事件等于让前端去处理一件不存在的事。
    """
    if not isinstance(canon, dict) or not canon:
        return 0
    sink = _rename_sink_var.get()
    if sink is None:
        return 0
    sent = 0
    for _from, _to in canon.items():
        _f, _t = str(_from or ""), str(_to or "")
        # 改成自己不是改名（rekey 表里出现恒等项时不许惊动前端）。
        if not _f or not _t or _f == _t:
            continue
        try:
            sink(_f, _t)
            sent += 1
        except Exception as exc:  # noqa: BLE001 — 顺带推给前端看，不许赔掉已烧的页
            _safe_print(f"[spec_first_pipeline] 改名出口异常（fail-open）：{exc}")
    return sent


def _emit_quality_notice(
    kind: str,
    text: str,
    *,
    items: Optional[List[Any]] = None,
    pageId: Optional[str] = None,
) -> None:
    """交付质量提示。stderr 会滚走；sink 没装就只打日志。

    ⚠ `pageId` 是**结构化字段**，不许只烘在 `text` 里（2026-09-06 第二轮真机）。
      对比度那类通知原来只发 `text="页面 p1：对比度不足…"`，页面名埋在prose 里。
      结果流级去重拿不到"这条说的是哪一页"，六页的身份粗成同一个 `contrast`，
      内容又轮着变，于是**一条都没被压住**（18 条原样发出去）。
      同 session_events 头注那句「事件自描述，前端不查翻译表」——
      要被机器用的东西就得是字段。
    """
    note = {"kind": str(kind), "text": str(text)}
    if pageId:
        note["pageId"] = str(pageId)
    if items:
        note["items"] = list(items)
    bucket = _quality_notices_var.get()
    if bucket is not None:
        bucket.append(note)
    _safe_print(f"[spec_first_pipeline] ⚠ {text}")
    sink = _quality_sink_var.get()
    if sink is None:
        return
    try:
        sink(note)
    except Exception as exc:  # noqa: BLE001
        _safe_print(f"[spec_first_pipeline] 质量出口异常（fail-open）：{exc}")


_quality_notices_var: ContextVar[Optional[List[Dict[str, Any]]]] = ContextVar(
    "sliderule_spec_first_quality_notices", default=None
)


def _emit_assumptions(spec: Any) -> bool:
    """Return new SPEC decisions to the control questionnaire before production.

    This boundary must hold without an SSE sink or an active pause slot. The
    caller persists the complete SPEC; the next control turn collects answers.
    """
    return isinstance(spec, dict) and bool(spec.get("assumptions"))


#: 本轮跑出来的整页 HTML，供**调用方落库**用。
#:
#: 为什么要这么一个暂存而不是从返回值里拿：主轴那一处
#: （v5_capability_executor._try_llm_generate_evidence）只回 model，它自己
#: **拿不到 state**——state 在它的调用方手里。改签名要动十几处调用点，
#: 而这件事本身只是"顺路把产物交出去"。
#:
#: ⚠ 同样是 ContextVar 不是模块属性，理由跟上面那条 sink 一样：
#: 多租户下页面串台等于把 A 的界面存进 B 的会话。
_last_pages_var: ContextVar[Optional[Dict[str, Any]]] = ContextVar(
    "sliderule_spec_first_last_pages", default=None
)


def take_last_pages() -> Optional[Dict[str, Any]]:
    """取走本轮产物（取一次就清）。

    **取走**而不是"读一遍"：留在原地的话，下一轮如果新链路挂了回落老路，
    调用方会读到**上一轮的页面**当成这一轮的产出落库——那正是本仓反复
    数到的那个形状（东西看着在，其实是旧的）。
    """
    got = _last_pages_var.get()
    _last_pages_var.set(None)
    return got


def peek_last_pages() -> Optional[Dict[str, Any]]:
    """只读不清——给**同一轮里、take 之前**的顺路消费用。

    具体是 executor 往 App Store 落闭环记录那一处（应用中心的卡要带页面）：
    它跑在 run_spec_first 刚返回之后、_cache_spec_first_pages 的 take 之前。
    在那里 take 会把会话侧的落库饿死；再传一遍参数又是改十几处签名（见
    _last_pages_var 头注）。所以 peek。

    ⚠ 防串轮的责任仍然在 take 那一次：本函数**只允许**在同一请求域里、
    take 发生前调用。跨轮读到旧页面的风险由"take 清场 + run_spec_first
    只在整链跑成时写入"这两条原有纪律兜住，peek 不新增窗口。
    """
    return _last_pages_var.get()


#: 本轮**真的发出去过几个 `spec_page` 事件**。
#:
#: ## 事故（2026-09-06 真机，sr-20260906045441）
#:
#: 7 页画出来、落库 7 份，而客户端只收到 **3 个** `spec_page` 事件；换 LLM
#: 供应商之后更彻底：3 页落库、`spec_page` 事件 **0 个**。画布上是 83 秒
#: 纯空白，然后什么都没有——而这一步的代码注释写着它存在的全部理由：
#: 「一份能独立打开的 HTML 比最终模型早四五分钟。**攒齐再交等于白白转圈**。」
#:
#: 没有任何东西会因此变红：页面在盘上、闭环是绿的、事件丢了没人数。
#:
#: ## 抄的是 grok 的哪一处
#:
#: `xai-grok-sampling-types/src/conversation.rs:851-855` 把"应该发多少事件"
#: 做成了**持久化字段**而不是运行时断言：
#:
#:     /// Number of `AgentMessageChunk` (text-only) streaming events emitted
#:     /// during this response.
#:     /// When this is zero but the response contains text, the streaming events
#:     /// were lost (e.g. after an empty-response retry).
#:     /// The caller should then emit a fallback `AgentMessageChunk` so downstream
#:     /// consumers (e.g. the TUI) see the turn as complete.
#:     pub message_chunks_emitted: u64,
#:
#: 配套 `fallback_text()`（:966-979）：**有终态内容但增量事件数为 0 ⇒ 事件
#: 丢了 ⇒ 补发兜底**。这里照搬：计数随 `specFirstPages` 落库
#: （`specPageEventsEmitted`），落库时对不上就补发。
#:
#: ⚠ 同样是请求域：多租户下计数串台会让 A 的补发判定读到 B 的数。
#:
#: ## ⚠⚠ 存的是**可变对象**，不是 int（2026-09-06 真机当场抓到）
#:
#: 第一版是 `ContextVar[int]` + `set(get() + 1)`。真机实测：那一轮明明发出了
#: **15 个** `spec_page` 事件，落库里 `specPageEventsEmitted=0`、
#: `specPageEventsLost=true`。
#:
#: 因为写和读**不在同一个 Context 里**：
#:
#:     写：驱动器的泵（`_pump_llm_deltas`）—— 驱动器协程自己的 Context
#:     读：`v5_capability_executor._cache_spec_first_pages` —— 它跑在
#:         `asyncio.to_thread(...)` 里，那是 `copy_context()` 出来的**副本**
#:
#: `ContextVar.set()` 只改**当前** Context 的那一格，副本里看不见。于是
#: 「有内容但事件数为 0 ⇒ 事件丢了」这条判据的输入恒为 0 —— 护栏装对了位置，
#: **它依赖的输入在真机上根本不成立**。这正是本仓「一之二」那条，也是本轮
#: 心跳那个 bug 的同一形状，我在同一轮里又踩了一次。
#:
#: 后果不止是"少一个字段"：`_fallback_page_events` 读的是同一个数，所以它会去
#: **重发已经发过的页**。这一轮没重发纯属运气 —— `peek_last_pages()` 那时已经
#: 被 `take_last_pages()` 取空，兜底静静地跳过了。
#:
#: 改法：ContextVar 里放一个**可变计数器对象**，`reset` 装一个新的，之后所有
#: Context 副本共享同一个引用，谁改谁都看得见。对照 OpenTelemetry 的
#: span context——跨线程传的是同一个 span 对象，不是它的一份拷贝。
class _PageEventCounter:
    """本轮真的发出去过几个 `spec_page`。可变，跨 Context 副本共享。"""

    __slots__ = ("n",)

    def __init__(self) -> None:
        self.n = 0


_page_events_var: ContextVar[Optional["_PageEventCounter"]] = ContextVar(
    "sliderule_spec_first_page_events", default=None
)


def note_page_event_emitted(n: int = 1) -> None:
    """驱动器的泵每吐一个 `spec_page` 就记一笔。失败不许拖垮出页。"""
    try:
        counter = _page_events_var.get()
        if counter is None:
            # 本轮没人装计数器（脚本直调 / 老调用方）。这里**不许现装**：
            # 在 Context 副本里 set 的东西外面读不到，装了等于自欺。
            return
        counter.n += int(n)
    except Exception:  # noqa: BLE001
        return


def peek_page_events_emitted() -> Optional[int]:
    """本轮发出去过几个 `spec_page`。只读不清——落库那一处要拿它对账。

    ⚠ 返回 `None` 表示**本轮没装计数器，所以不知道**，与"知道是 0"不是一回事。
      把"不知道"折成 0 会让每条没走驱动器的路径都被判成"事件丢了"，
      而那条判据的全部价值就在于它平时不响。同 `CapabilityRunStatus` 里
      `unknown` 那一档的理由。
    """
    try:
        counter = _page_events_var.get()
        return None if counter is None else int(counter.n)
    except Exception:  # noqa: BLE001
        return None


def reset_page_events_emitted() -> None:
    """新一轮开始时装一个新计数器。

    **必须装**：不装的话对账读到 `None`（不知道），补发判定不会触发；
    装的是**新对象**而不是把旧的清零，免得上一轮的引用还被谁攥着。

    ⚠ 必须在**起线程之前**调（驱动器起流那一处就是）：`to_thread` 复制的是
      那一刻的 Context，装晚了线程里读到的还是 None。
    """
    try:
        _page_events_var.set(_PageEventCounter())
    except Exception:  # noqa: BLE001
        return


#: 单页打孔相位。对照 Kubernetes Pod.Status.phase /
#: Deployment.status.readyReplicas（kubernetes/api/core/v1）：
#: 副本数是聚合，**每单元自己的 phase 才是权威**——有 phase 就不要
#: 用「成功数 > 0 且不在失败名单」去反推。
PAGE_BIND_BOUND = "bound"
PAGE_BIND_FAILED = "failed"
PAGE_BIND_SKIPPED = "skipped"


def html_already_bound(html: str) -> bool:
    """这一页是不是已经打过 data-* 孔。

    ⚠ 2026-09-09 真机：首轮 pages 之后 bind 被标成 refine（已经有模型），
      `_skip_bind = reuse ∩ pages` 把**还没打孔的照搬页**全跳过。
      照搬 ≠ 打过孔。有 data-rows / data-record / data-field 才算打过。
    """
    raw = str(html or "")
    return "data-rows=" in raw or "data-record=" in raw or "data-field=" in raw


def pages_to_skip_bind(
    pages: Any,
    *,
    refine: bool,
    reuse_ids: Any,
) -> set:
    """局部打孔只许跳过**已经打过孔**的照搬页。"""
    if not refine:
        return set()
    wanted = {str(pid) for pid in (reuse_ids or ())}
    out = set()
    blob = pages if isinstance(pages, dict) else {}
    for pid in wanted:
        if pid in blob and html_already_bound(str(blob.get(pid) or "")):
            out.add(pid)
    return out


def page_bind_status(
    page_ids: Any,
    bind_ran: bool,
    bound_failed: Any,
) -> Dict[str, str]:
    """每页打孔相位。这是 pageBindStatus 落库的唯一算法。"""
    failed = bound_failed if isinstance(bound_failed, dict) else {}
    if not bind_ran:
        return {str(pid): PAGE_BIND_SKIPPED for pid in page_ids}
    return {
        str(pid): PAGE_BIND_FAILED if pid in failed else PAGE_BIND_BOUND
        for pid in page_ids
    }


def count_bound_pages(
    page_ids: Any,
    bind_ran: bool,
    bound_failed: Any,
) -> int:
    """打孔成功的页数。等于 pageBindStatus 里 bound 的个数。

    ⚠ 2026-08-18 CareBridge（sr-20260818225943-XP690MY4PG）：日志
    `bound=3 failed=1`，落库却写成
    ``len(pages) if bind_html and not bound_failed else 0``——
    字典非空即真，一页失败就把三页成功也记成 0。刷新后舞台四页全说
    「尚未接数据」，failedPages 里明明只挂着 p2。

    boundPages 是聚合（K8s readyReplicas），pageBindStatus 是每页 phase。
    0 = 没跑打孔或一页都没打上。不许再用「有失败就整记 0」。
    """
    return sum(
        1
        for status in page_bind_status(page_ids, bind_ran, bound_failed).values()
        if status == PAGE_BIND_BOUND
    )


_ENABLE_ENV = "SLIDERULE_SPEC_FIRST"
#: **默认开，显式关才关**（2026-08-14）。词表照仓里另外六处同款开关逐字一致
#: （enrich_timing / block_narrowing / intake_judge / v5_parallel_generate /
#: mailer / v5_full_driver 两处）——开关口径分叉的代价是"我明明关了它还在跑"。
#: 同 refine_short_circuit._OFF：词表只有一份，在 services/env_flags。
_OFF_VALUES = _env_flags.OFF

#: 七步各自的模块名。**探针与 import 共用这一份**，不手抄两遍——
#: 手抄两份必然漂移（本仓在「区块 uses 声明」「前端手抄区域词汇」上踩过两次）。
_STEP_MODULES = (
    "spec_tree",
    "spec_page_html",
    "page_shell",
    "html_structure",
    "spec_semantics",
    "model_assembly",
    "html_bindings",
)


class SpecFirstError(RuntimeError):
    """整条链失败就如实失败。

    **不回落老链路**：那样会让「新链路跑通了」和「新链路挂了但老链路兜住了」
    在外面长得一模一样，而那正是本仓今天数到第九次的失败形态
    （闸全绿但东西没了）。要回落由调用方显式决定，不在这里偷偷做。
    """


def spec_first_enabled() -> bool:
    """默认开。**没设过 = 开**，设成 0/false/no/off 才关。

    ⚠ 空串按"没设过"处理，跟 `.env` 里留一行 `SLIDERULE_SPEC_FIRST=` 是一回事。
    仓里六处同款开关都是这个口径，别在这儿自创一种。
    """
    return (os.environ.get(_ENABLE_ENV) or "").strip().lower() not in _OFF_VALUES


def spec_first_readiness() -> Dict[str, Any]:
    """给 /ready 用：它现在能不能干活。

    照 `_narrowing_readiness` 同一个思路——不暴露实现细节，只回答那一个问题。
    `effective` 的判据是**开关开着 ∧ 七个模块都导得进来**，缺一不可：
    只看开关会重演 rank-bm25 那次（开着但依赖没装，功能一声不吭地整个失效，
    而 health、日志、返回值没有任何一处看得出来）。
    """
    missing: List[str] = []
    for name in _STEP_MODULES:
        try:
            __import__(f"services.{name}")
        except Exception:  # noqa: BLE001 — 探针不许因为被探的东西坏了而炸
            missing.append(name)
    enabled = spec_first_enabled()
    return {
        "version": SPEC_FIRST_VERSION,
        "enabled": enabled,
        "modules": len(_STEP_MODULES) - len(missing),
        "missing": missing,
        "effective": bool(enabled and not missing),
    }


def _stage(name: str, **fields: Any):
    """埋点用仓里现成的那套，进度直接喂给 SSE 慢阶段心跳。"""
    from .enrich_timing import stage

    return stage(name, **fields)


def model_refine_digest(model: Optional[Dict[str, Any]]) -> str:
    """把上一版五系统模型摊成给 SPEC 步看的结构摘要（纯函数，零 LLM）。

    增量迭代时喂给 spec_tree 的 refine 段用。**是摘要不是全量 JSON**：
    SPEC 步只需要「有哪些实体/页面/角色/流程节点」来保持连续性，
    全量 JSON（几十 KB）里绝大部分是它不该管的细节（字段枚举、主题、
    绑定），塞进去只会稀释注意力——E29 老链路喂全量是因为老生成器
    直接产模型，这里产的是 SPEC，粒度对齐 SPEC。
    """
    if not isinstance(model, dict):
        return ""
    lines: List[str] = []
    entities = ((model.get("datamodel") or {}).get("entities") or [])[:20]
    if entities:
        ent_lines = []
        for e in entities:
            fields = ", ".join(
                str(f.get("name") or f.get("id") or "") for f in (e.get("fields") or [])[:12]
            )
            ent_lines.append(f"  - {e.get('name') or e.get('id')}（{fields}）")
        lines.append("实体：\n" + "\n".join(ent_lines))
    pages = ((model.get("page") or {}).get("pages") or [])[:12]
    if pages:
        lines.append("页面：" + "、".join(str(p.get("name") or p.get("id") or "") for p in pages))
    roles = (model.get("rbac") or {}).get("roles") or []
    if roles:
        lines.append("角色：" + "、".join(str(r) for r in roles[:10]))
    nodes = ((model.get("workflow") or {}).get("nodes") or [])[:12]
    if nodes:
        lines.append("流程节点：" + "、".join(str(n.get("name") or n.get("id") or "") for n in nodes))
    return "\n".join(lines)[:4000]


def model_id_lexicon(model: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """把上一版模型摊成「概念名 → id」词表，喂给第 4/5 步当"认出同一个就照抄"。

    ## 为什么需要它（2026-08-17 实测）

    精修第二轮，同一个「社区养老站长」拿到过三套 id：

        station_manager  →  role_station_manager  →  manager_role
        elder:read       →  care_order:read       →  elder_archive:read
        wo_created       →  wf_pending            →  node_pending

    **不是随机重铸，是近义漂移**：id 由概念名派生，派生规则稳定但用词不稳定。
    后果是跨轮引用全部悬空——逐段沿用四次尝试全被引用完整性闸拒绝，
    「逐段指纹 0/6」里有四段其实是这个造成的，不是内容真被重写
    （量法与数据见 experiments/refine-fingerprint/）。

    根因是 refine 上下文**只到达第 2 步**：

        grep -c refine services/html_structure.py services/spec_semantics.py
        # 都是 0

    而铸 id 的恰恰是第 4 步（实体/字段）和第 5 步（角色/流程节点）。
    第 6 步不用管——它的提示词已经写死"只能用下面这些 id，一个都不许新造"，
    词表从第 4/5 步来，上游稳了它自然稳。权限同理：形状是 `<实体id>:create`，
    跟着实体 id 走。

    ## 页面档（2026-08-17 晚补）：铸造点在第 2 步，冻结也得在第 2 步

    页面 id 跟上面三类不同：它在 **SPEC 起草（第 2 步）**就铸出来了。第 2 步
    虽然拿得到 refine 上下文，但对 id 只有一句软约束（"名字与 id 与上一版
    保持一致"）——求自觉。真机第二轮的下场：HTML 侧的键还是 `p1..p4`，
    模型侧页面 id 已整套重铸成 `elder_management` 等，交集为空
    （experiments/refine-fingerprint/ 截图对照时撞到的）。页面 id 一漂，
    两样东西直接失效：按需重画的照搬对不上号、图判作用域算出的"重画这一页"
    找不到对应产物。所以词表加 `pages` 档，喂给第 2 步当硬词表块——
    跟第 4/5 步同一个模子。

    ⚠ 2026-08-18 过夜：提示词冻结日志照常打「精修 id 冻结：页面 N」，
    模型照样把 p1 改成 p1_page / equipment_hall。求自觉求不动。结构拨回
    在 generate_spec_tree **之后**立刻跑（services/page_id_freeze.py），
    必须赶在 spec_pages_declared / 图判 / 照搬 / 画页之前——id 在那些
    步骤里已经当键用了，事后再拨等于没拨。

    ## 做法照 identifier freezing，不是新发明

    RecLLM 的 Reformer 用"标识符冻结"保证重训练前后 item id 不变；MCP 的
    LFID 提案（modelcontextprotocol#1626）把"语义信号"和"稳定 canonical_id"
    分开——**以人类可读名字为锚、id 照抄**。本仓自己也早有同款：
    `html_structure.build_prompt` 第 5 条写着「sourcePageId 照抄上面给你的
    页面 id，不要自己改名」，而实测**唯一 id 保住 5/5 的段恰好就是 page**。
    这条只是把已经跑通的做法推广到实体/角色/节点。

    ## 只给名字和 id，不给别的

    跟 model_refine_digest 一样是摘要不是全量：这里要解决的是"同一个概念
    换了名字"，字段枚举、绑定、主题都与它无关，塞进去只会稀释注意力。
    """
    if not isinstance(model, dict):
        return {}
    lex: Dict[str, Any] = {}

    entities = []
    for e in ((model.get("datamodel") or {}).get("entities") or [])[:20]:
        if not isinstance(e, dict) or not e.get("id"):
            continue
        entities.append({
            "id": e.get("id"),
            "name": e.get("name"),
            "fields": [
                {"id": f.get("id"), "name": f.get("name")}
                for f in (e.get("fields") or [])[:15]
                if isinstance(f, dict) and f.get("id")
            ],
        })
    if entities:
        lex["entities"] = entities

    roles = [
        {"id": r.get("id"), "name": r.get("name")}
        for r in ((model.get("rbac") or {}).get("roles") or [])[:12]
        if isinstance(r, dict) and r.get("id")
    ]
    if roles:
        lex["roles"] = roles

    nodes = [
        {"id": n.get("id"), "name": n.get("name")}
        for n in ((model.get("workflow") or {}).get("nodes") or [])[:15]
        if isinstance(n, dict) and n.get("id")
    ]
    if nodes:
        lex["workflowNodes"] = nodes

    pages = [
        {"id": p.get("id"), "name": p.get("name")}
        for p in ((model.get("page") or {}).get("pages") or [])[:12]
        if isinstance(p, dict) and p.get("id")
    ]
    if pages:
        lex["pages"] = pages

    return lex


#: 精修时**可以整段沿用上一版**的模型段。**顺序有意义**：按「对本轮产物的耦合度」
#: 从低到高排，过不了闸时从尾巴开始丢（见 apply_refine_segment_reuse）。
#:
#: ⚠ 为什么不含 datamodel / page：这两段跟第 3 步刚生成的 HTML 是绑定关系——
#:   页面里的 data-field 指向 datamodel 的字段 id，bind_pages 按 page.pages 打孔。
#:   沿用上一版 = 拿旧字段 id 去绑新 HTML，必然错位。它们该重新生成，
#:   保结构靠的是 SPEC 步的连续性约束（那条对页面/角色**是**管用的，
#:   实测菜单 4/4；管不住的是这里这几段）。
#:
#: ⚠ 为什么不含 appbundle（2026-08-17 写第一版时错放进来了，被闸当场咬出来）：
#:   它整段都是**指向本轮产物的引用**——pageBindings.pageRef ∈ page.pages、
#:   landingPageRef ∈ page.pages、roleRefs ∈ rbac.roles、dataModelRefs ∈ entities，
#:   外加一个 preferredDevice。它是连接表，不是自有内容，沿用上一版等于拿旧
#:   页面 id 当落地页。跟 page 是同一类错误，只是没那么显眼。
#:
#: ⚠ aigc 排在最后是因为它的 inputFields 指 datamodel 字段、roleRefs 指 rbac 角色，
#:   而 datamodel **永远重新生成**——字段 id 一飘它就悬空。留着它是因为
#:   capabilities 是用户真正在意的自有内容，丢了可惜；排最后是因为它最先该被丢。
#:   过夜食堂/咖啡馆：一个字段对不上就整段扔，闭环仍绿灯。对齐引用
#:   （align_reused_aigc）之后，悬空字段不再株连整段。
REFINE_REUSABLE_SEGMENTS = ("rbac", "workflow", "aigc")


def refine_reuse_enabled() -> bool:
    """`SLIDERULE_REFINE_REUSE_SEGMENTS=0` 关掉整个沿用。默认开。

    留开关是因为这是本轮唯一会**改变落库内容**的改动，线上出问题要能一键退回
    「全量重生成」的老行为，不用回滚部署。
    """
    from .env_flags import flag

    return flag("SLIDERULE_REFINE_REUSE_SEGMENTS", default=True)


def refine_reuse_1maximal_enabled() -> bool:
    """`SLIDERULE_REFINE_REUSE_1MAXIMAL=0` 退回「按顺序从尾巴丢」的老退让。默认开。

    ⚠ **跟下面那个合并开关分开，是故意的。** 两件事互相独立：
      · 1-maximal 退让：OFF 臂 5/5 证明它无害（那里全枚举也找不到能过的子集），
        ON 臂 3/3 证明它有用。**单独就是净收益。**
      · 权限合并：会改动沿用回来的 rbac 内容，风险面比前者大。
    合成一个开关的话，万一线上是合并出问题，退回时会把明明没问题的 1-maximal
    一起赔掉。留两根杆才退得准。

    这两个开关也是 A/B 对照臂的实现方式（experiments/refine-fingerprint/），
    跟 SLIDERULE_REFINE_ID_FREEZE 那次一样：**线上回退杆和对照臂两用**。
    """
    from .env_flags import flag

    return flag("SLIDERULE_REFINE_REUSE_1MAXIMAL", default=True)


def refine_rbac_merge_enabled() -> bool:
    """`SLIDERULE_REFINE_RBAC_MERGE=0` 关掉「沿用的 rbac 吃增量」。默认开。

    这是本轮**唯一会改动沿用回来的那一段内容**的地方——沿用 rbac 却往它的
    permissions 里加了东西。风险面比纯粹的"照搬/不照搬"大，所以单独留杆。
    """
    from .env_flags import flag

    return flag("SLIDERULE_REFINE_RBAC_MERGE", default=True)


def refine_ref_align_enabled() -> bool:
    """`SLIDERULE_REFINE_REF_ALIGN=0` 关掉「沿用段对齐悬空引用」。默认开。

    跟权限合并同一类：会改动沿用回来的内容（字段/流程引用），单独留杆。
    关掉退回「对不上就整段扔」的过夜行为。
    """
    from .env_flags import flag

    return flag("SLIDERULE_REFINE_REF_ALIGN", default=True)


def _permission_id(perm: Any) -> str:
    """一条权限的 id。**两种形态都要认**——字符串和 `{"id": ...}`。

    ⚠ 不是想多了：闸的 `_collect_permission_ids`（v5_model_gate:336）两种都收。
      这边只认字符串的话，字典形态的模型会走到"一条都没并进来"，而且不报错、
      判据也不红——沿用照旧退让到空，看起来"这个功能就是没生效"。
      本仓纪律四点名的形状：同一件事两处实现，改一半等于没改。
    """
    if isinstance(perm, str):
        return perm.strip()
    if isinstance(perm, dict):
        return str(perm.get("id") or perm.get("name") or "").strip()
    return ""


def merge_needed_permissions(old_rbac: Any, fresh_model: Any):
    """沿用旧 rbac 时，把**本轮页面真正引用、而旧 rbac 没有**的权限并进来。

    返回 `(合并后的 rbac, 并进来的权限 id 列表)`；没什么可并就原样返回。

    ## 为什么需要这个（2026-08-17 深夜，每臂 n=5 的多轮 A/B）

    沿用失败 8/9 是同一条：新生成的 page 引用了旧 rbac 没有的权限
    （`service_staff:export`、`elderly:delete`、`community_branch:read` …）。
    权限形如 `<实体id>:动作`，而 rbac 是**上一版的快照**——这一轮但凡新产生
    任何权限需求，快照就装不下。

    ⚠ **这不是 id 漂移，id 冻结救不了。** 冻结保的是"已有 id 别改名"，
      管不了"多出来一条"。沿用是整段照搬，整段照搬天然容纳不了增量。

    ## 为什么是"并页面需要的"，不是别的两种并法

    三种都拿真闸在真机数据（on-2/on-3/on-5）上试过，**全都能过闸**，所以闸
    判不出优劣，得按原则选：

      A 旧 ∪ 新全部    并进来的权限里有页面根本没引用的，没有依据，且累积更快
      B 只沿用 roles、权限用新的
                      **淘汰**：真机 on-2 的新权限丢了 `work_order:export`
                      和 `work_order:manage`，而用户那轮只说了"加点模拟数据"。
                      权限凭空消失正是最初被抱怨的形态。
      C 旧 ∪ 页面所需  ← 选它。修法跟病灶一样大，每条都有页面在引用它

    ⚠ **只加不删。** 想删旧权限的话，那是用户点名要改 rbac 的场景，而那时
      rbac 压根不进沿用候选（见 candidates 那句 `seg not in named`），
      根本走不到这里。

    ⚠ 合并结果**不免检**：它跟其余段一起组成候选，再整份过一遍同一个闸。
      这里不设任何特权通道——伪造绿灯是本仓的红线。
    """
    if not isinstance(old_rbac, dict):
        return old_rbac, []
    perms = old_rbac.get("permissions")
    if not isinstance(perms, list):
        return old_rbac, []

    have = {pid for pid in (_permission_id(p) for p in perms) if pid}
    needed: List[str] = []
    for page in (((fresh_model or {}).get("page") or {}).get("pages") or []):
        if not isinstance(page, dict):
            continue
        for ap in page.get("actionPermissions") or []:
            ref = str(ap).strip()
            if ref and ref not in have:
                have.add(ref)
                needed.append(ref)
    if not needed:
        return old_rbac, []

    import copy as _copy

    merged = _copy.deepcopy(old_rbac)
    # 跟已有元素的形态保持一致，别把 [{...}] 搞成 [{...}, "str"] 的混合列表。
    # 闸对混合列表是宽容的，但落库的东西会被下游各种消费，形态一致是便宜的保险。
    as_dict = bool(perms) and all(isinstance(p, dict) for p in perms)
    merged["permissions"] = list(merged.get("permissions") or []) + [
        ({"id": ref} if as_dict else ref) for ref in needed
    ]
    return merged, needed


def _datamodel_field_catalog(datamodel: Any) -> List[Dict[str, str]]:
    """上一版/本轮字段对照表：id 会漂，名字通常还在。"""
    rows: List[Dict[str, str]] = []
    if not isinstance(datamodel, dict):
        return rows
    for entity in datamodel.get("entities") or []:
        if not isinstance(entity, dict):
            continue
        eid = str(entity.get("id") or entity.get("name") or "").strip()
        ename = str(entity.get("name") or entity.get("id") or "").strip()
        if not eid:
            continue
        for field in entity.get("fields") or []:
            if not isinstance(field, dict):
                continue
            fid = str(field.get("id") or field.get("name") or "").strip()
            fname = str(field.get("name") or field.get("id") or "").strip()
            if not fid:
                continue
            rows.append({
                "ref": f"{eid}.{fid}",
                "eid": eid,
                "fid": fid,
                "ename": ename,
                "fname": fname,
            })
    return rows


def _resolve_stale_ref(ref: str, known: set, *, old_rows=None, new_rows=None) -> tuple:
    """把一条悬空引用拨到本轮还在的 id 上。歧义不猜，对不上就 (None, 'drop')。

    顺序照本仓 `_unique_near_match` + coversNodes 剪枝：精确 → 名字唯一 →
    近邻唯一 → 剪掉。json-schema-ref-parser 的 fixDanglingRefs 也是这套
    （悬空 $ref 唯一命中才改写，对不上不拆父对象）。
    """
    if not ref or ref in known:
        return ref, "keep"
    if old_rows and new_rows:
        old = next((r for r in old_rows if r["ref"] == ref), None)
        if old:
            by_name = [
                r for r in new_rows
                if r["ename"] == old["ename"] and r["fname"] == old["fname"]
            ]
            if len(by_name) == 1:
                return by_name[0]["ref"], "name"
            by_eid = [
                r for r in new_rows
                if r["eid"] == old["eid"] and r["fname"] == old["fname"]
            ]
            if len(by_eid) == 1:
                return by_eid[0]["ref"], "field-name"
    from .v5_model_repair import _unique_near_match

    near = _unique_near_match(ref, known)
    if near:
        return near, "near"
    return None, "drop"


def align_reused_aigc(old_aigc: Any, fresh_model: Any, baseline: Any = None):
    """沿用旧 aigc 时，把对不上本轮 datamodel / rbac 的字段、角色拨回去或剪掉。

    返回 `(对齐后的 aigc, 人话留痕)`。

    ## 过夜（2026-08-18）

    食堂 / 咖啡馆精修同一句话：

        丢掉 aigc，首次拒绝：aigc field 'resident.age' not found in datamodel fields

    能力还在，就一个字段 id 漂了。沿用是整段照搬，闸一看悬空就把**整段**
    退回新生成的那份——新的往往更薄。闭环 evidence=6 照样绿灯。
    闸全绿但东西没了。

    修法跟 `merge_needed_permissions`、`_prune_stale_covers_on_frozen_pages`
    同一条：保段，只动坏引用。字段引用逐个核，留下核得过的
    （block_assembler 第 179 行已经写过，这边是同一纪律补到沿用出口）。
    """
    if not isinstance(old_aigc, dict):
        return old_aigc, []
    from .v5_model_gate import _collect_datamodel_field_refs, _collect_role_ids

    dm = (fresh_model or {}).get("datamodel") if isinstance(fresh_model, dict) else {}
    if not isinstance(dm, dict):
        dm = {}
    field_refs = _collect_datamodel_field_refs(dm)
    # 近邻只在 entity.field 里找——裸实体 id 是 `resident` 这种超串，
    # 会把 resident.age 唯一「近邻」成 resident，看起来像修好了其实指错层。
    dotted = {r for r in field_refs if "." in r}
    rbac = (fresh_model or {}).get("rbac") if isinstance(fresh_model, dict) else {}
    role_ids = _collect_role_ids(rbac if isinstance(rbac, dict) else {})
    old_rows = _datamodel_field_catalog(
        (baseline or {}).get("datamodel") if isinstance(baseline, dict) else None
    )
    new_rows = _datamodel_field_catalog(
        (fresh_model or {}).get("datamodel") if isinstance(fresh_model, dict) else None
    )

    import copy as _copy

    aligned = _copy.deepcopy(old_aigc)
    notes: List[str] = []
    for cap in aligned.get("capabilities") or []:
        if not isinstance(cap, dict):
            continue
        cid = str(cap.get("id") or cap.get("name") or "?").strip()
        inputs = cap.get("inputFields")
        if isinstance(inputs, list):
            kept: List[str] = []
            for raw in inputs:
                ref = str(raw).strip()
                if not ref:
                    continue
                resolved, how = _resolve_stale_ref(
                    ref, dotted, old_rows=old_rows, new_rows=new_rows
                )
                if how == "keep":
                    kept.append(ref)
                elif resolved:
                    kept.append(resolved)
                    notes.append(f"{cid}:{ref}→{resolved}")
                else:
                    notes.append(f"{cid}:剪掉 {ref}")
            cap["inputFields"] = kept
        out_ref = str(cap.get("outputField") or "").strip()
        if out_ref:
            resolved, how = _resolve_stale_ref(
                out_ref, dotted, old_rows=old_rows, new_rows=new_rows
            )
            if how == "keep":
                pass
            elif resolved:
                cap["outputField"] = resolved
                notes.append(f"{cid}.out:{out_ref}→{resolved}")
            else:
                cap.pop("outputField", None)
                notes.append(f"{cid}.out:剪掉 {out_ref}")
        roles = cap.get("roleRefs")
        if isinstance(roles, list) and role_ids:
            kept_roles: List[str] = []
            for raw in roles:
                ref = str(raw).strip()
                if not ref:
                    continue
                resolved, how = _resolve_stale_ref(ref, role_ids)
                if how == "keep":
                    kept_roles.append(ref)
                elif resolved:
                    kept_roles.append(resolved)
                    notes.append(f"{cid}.role:{ref}→{resolved}")
                else:
                    notes.append(f"{cid}.role:剪掉 {ref}")
            cap["roleRefs"] = kept_roles
    return aligned, notes


def align_reused_workflow_bindings(candidate: Dict[str, Any]):
    """沿用旧 workflow 时，把本轮 appbundle.workflowRef 拨到还在的流程 id。

    过夜咖啡馆第一轮精修：aigc 字段悬空的同时，
    `appbundle workflowRef 'main_flow' not found in workflow`——新连接表
    指着新铸的流程号，旧流程整段被连坐丢掉。

    只改连接表（appbundle 本就不沿用），不动流程节点。歧义不猜。
    """
    if not isinstance(candidate, dict):
        return candidate, []
    from .v5_model_gate import _collect_workflow_ids

    known = _collect_workflow_ids(candidate.get("workflow") or {})
    bundle = candidate.get("appbundle")
    if not known or not isinstance(bundle, dict):
        return candidate, []
    notes: List[str] = []
    changed = False
    import copy as _copy

    new_bundle = _copy.deepcopy(bundle)
    for bd in new_bundle.get("pageBindings") or []:
        if not isinstance(bd, dict):
            continue
        wref = str(bd.get("workflowRef") or "").strip()
        if not wref or wref in known:
            continue
        resolved, how = _resolve_stale_ref(wref, known)
        if resolved and how != "keep":
            bd["workflowRef"] = resolved
            notes.append(f"workflowRef {wref}→{resolved}")
            changed = True
    if changed:
        candidate = dict(candidate)
        candidate["appbundle"] = new_bundle
    return candidate, notes


def apply_refine_segment_reuse(
    model: Dict[str, Any],
    baseline: Optional[Dict[str, Any]],
    scope: Optional[List[str]],
    *,
    gate_fn: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """精修时把**指令没点名的段**整段换回上一版。返回换好的 model（不改入参）。

    ## 为什么是"沿用"不是"打补丁"

    2026-08-16 先试的是 RFC 7386 Merge Patch（`services/merge_patch.py`，实现和
    12 条单测都对），真机跑完发现诊断日志一次都没出现——它接在
    `generate_five_system_model` 上，而真正在跑的是 spec-first。补丁语义跟
    「从 spec 树重新生成、出口永远是完整模型」这条链**架构上不兼容**，不是接线
    问题。改用同文件里已有的 `reuse_language` / `reuse_style_brief` 那套做法：
    不问模型要增量，直接在出口把不该动的段按住。思路同 Kubernetes server-side
    apply 的字段归属——谁拥有哪一段，重新生成就不许覆盖不属于它的部分。

    ## scope 的三种取值，语义不同

        None  模型没声明（老 spec / 非精修 / 它没答）→ 按"不知道"处理，一段都不沿用
        []    模型明确说"一段都没碰"                  → 四段全沿用
        [...] 点名的段重新生成，其余沿用

    None 和 [] **必须分开**：混成一个会让"模型没答"静默变成"全沿用"，
    那是拿沉默当授权——用户真要求改权限时权限会一声不吭地不生效。

    ## fail-open，而且是有意的

    换完要重过一遍闸（`gate_fn`）。过不了就**逐段往回退**，退到能过为止；一段都
    过不了就整份用重新生成的那份。沿用是质量增强（少改点东西），不是证据/闭环
    类的东西，把它写成 fail-closed 会让一次本来能跑完的推演直接崩掉。
    每次退让都打日志，别静默——按纪律七分类。

    ⚠ 重过闸不是可选项。reused 的 workflow 里 `assigneeRole` 指的是**上一版**的
      角色 id，而 rbac 若被点名重新生成，角色 id 可能整套换了——不重过闸就是
      拿"闸之前绿过"给换过内容的模型发绿灯，正是本仓说的伪造绿灯。

    ⚠ 退让必须**逐段**，不能全有或全无（2026-08-17 第一版就是全有全无，被自己的
      探针咬出来）：aigc 的 inputFields 指 datamodel 字段，而 datamodel 永远重新
      生成，字段 id 一飘 aigc 就悬空——全有全无的话，一个 aigc 悬空会把 rbac 和
      workflow 的沿用一起赔掉，而那两段本来是好的、也正是用户抱怨的那两段。

    ## 退让顺序：从"按顺序丢"改成 1-maximal（2026-08-17 晚，多轮真机）

    第二版按 REFINE_REUSABLE_SEGMENTS 从尾巴丢（`candidates.pop()`），于是**可达
    的沿用组合只有前缀**：

        {rbac, workflow, aigc} → {rbac, workflow} → {rbac} → {}

    多轮 A/B（`experiments/refine-fingerprint/runs`，冻结臂 3 轮）实测：**卡住的
    永远是 rbac**——新生成的 page 引用了旧 rbac 没有的权限（4/4 零例外，
    如 `service_staff:export`）。而 rbac 排在最前、最后才被丢，丢 aigc 丢 workflow
    根本治不了这个病，等轮到 rbac 时其余早已赔光 → 退让到空。

    离线 replay（`replay_reuse_search.py`，闸是纯函数可精确复算）证实：冻结臂
    3 轮里有 **2 轮** 存在 `{workflow, aigc}` 这个能过闸的组合，而前缀链够不到它。
    赔掉的 workflow 正是用户最初抱怨的那两段之一。

    ⚠ 注意因果方向：**是 id 冻结制造了"部分稳定"，才让前缀限制开始咬人**。
      冻结关掉的两轮里全枚举都找不到能过的子集（每个 id 都重铸），前缀限制
      一分钱没损失——所以这个改动在冻结之前做是没有收益的，先后顺序不能倒。

    改法照 **ddmax**（Kirschner/Gopinath/Zeller, ICSE 2020；debuggingbook 的 `dd`
    算法 `'+'` 模式）：ddmin 找最小的致败子集，ddmax 反过来找**最大的能通过的
    子集**，终止条件是 1-maximal——再加任何一个元素都会失败。这里元素是可沿用
    段、测试是闸。**借的是判据（1-maximal），不是它的分块二分循环**——那是给
    n 很大时省测试次数用的，这里 n=3，线性试加才是最优形状。

    代价不涨：先整体试一次（成功就 1 次过闸，跟原来一样快），失败再逐个试加
    n 次，上界仍是 n+1。

    ⚠ 贪心不保证全局最优（landing 在哪个 1-maximal 集合取决于试加顺序）。n=3
      时全枚举也只要 7 次，但那会把上界从 n+1 抬到 2ⁿ-1；实测两轮 ddmax 与全
      枚举一致，且 `replay_reuse_search.py` 会持续报告两者是否分叉——真分叉了
      再谈换算法，别现在就为假想的收益付代价。
    """
    import copy

    # ⚠ 三条"什么都不做"的出口**都要说话**（2026-08-17 补）。
    #
    # 第一版三条全是静默 return。而这个功能最可能的失效方式恰恰是"整个没生效"：
    # 模型不吐 refineScope → scope 恒为 None → 一段都不沿用 → **判据全绿、
    # 线上照旧全量重写、日志里一个字都没有**。那正是本仓数到第十次以上的形状。
    # 会静默失效的功能必须说得出话——同 rank-bm25 那次的教训。
    if not isinstance(model, dict):
        return model
    if not isinstance(baseline, dict):
        print("[spec_first_pipeline] 精修沿用跳过：没拿到上一版模型（reuse_model 为空）")
        return model
    if scope is None:
        print(
            "[spec_first_pipeline] ⚠ 精修沿用跳过：SPEC 没声明 refineScope，"
            "按「不知道」处理，一段都不沿用（模型没答？prompt 没要？）"
        )
        return model

    named = {str(s).strip() for s in scope if str(s).strip()}
    candidates = [
        seg
        for seg in REFINE_REUSABLE_SEGMENTS
        if seg not in named and isinstance(baseline.get(seg), (dict, list))
    ]
    if not candidates:
        return model

    one_maximal = refine_reuse_1maximal_enabled()
    rbac_merge = refine_rbac_merge_enabled()
    ref_align = refine_ref_align_enabled()
    # ⚠ **一行把开关的状态都说出来，每轮都说。**
    #   照 SLIDERULE_REFINE_ID_FREEZE 那次的教训：开关走 env 传子进程，传丢了
    #   不报错，只会让 A/B 的两臂**悄悄变成同一臂**——跑出"看起来 n=10 其实
    #   10 个都是同一边"的假数据，比样本少糟得多。
    #   写成一行固定格式，正反两向都能 grep：本臂特征串必须在、对臂的必须不在。
    print(
        f"[spec_first_pipeline] 沿用策略：1maximal={'on' if one_maximal else 'off'} "
        f"rbacmerge={'on' if rbac_merge else 'off'} "
        f"refalign={'on' if ref_align else 'off'}"
    )

    def build(segs):
        candidate = dict(model)
        for seg in segs:
            candidate[seg] = copy.deepcopy(baseline[seg])
        if rbac_merge and "rbac" in segs:
            # 沿用旧 rbac 的同时，把本轮页面真正需要的权限并进来。
            # 不并的话这一段 8/9 会被闸拒（见 merge_needed_permissions 头注）。
            candidate["rbac"], _ = merge_needed_permissions(candidate["rbac"], model)
        if ref_align and "aigc" in segs:
            # 过夜食堂/咖啡馆：一个字段对不上就把整段 aigc 扔了。
            candidate["aigc"], _ = align_reused_aigc(
                candidate["aigc"], candidate, baseline
            )
        if ref_align and "workflow" in segs:
            candidate, _ = align_reused_workflow_bindings(candidate)
        return candidate

    def merge_note(segs) -> str:
        """给日志用：这次沿用往 rbac 里并了哪几条权限。

        ⚠ **必须说出来。** "沿用 rbac"读起来是整段照搬，而这里其实动了它的
          permissions。不打日志的话就是"东西看着是旧的、其实改过"——本仓
          反复数到的那个形态，出问题时对不出账。
        """
        bits: List[str] = []
        if rbac_merge and "rbac" in segs:
            _, added = merge_needed_permissions(baseline.get("rbac"), model)
            if added:
                bits.append(f"并入本轮页面需要的权限：{'、'.join(added)}")
        if ref_align and "aigc" in segs:
            probe = dict(model)
            probe["aigc"] = copy.deepcopy(baseline.get("aigc"))
            if "rbac" in segs:
                probe["rbac"] = copy.deepcopy(baseline.get("rbac"))
            _, notes = align_reused_aigc(probe.get("aigc"), probe, baseline)
            if notes:
                bits.append(f"对齐 aigc：{'、'.join(notes[:8])}")
        if ref_align and "workflow" in segs:
            probe = dict(model)
            probe["workflow"] = copy.deepcopy(baseline.get("workflow"))
            _, notes = align_reused_workflow_bindings(probe)
            if notes:
                bits.append(f"对齐 workflowRef：{'、'.join(notes[:6])}")
        return f"（{'；'.join(bits)}）" if bits else ""

    if gate_fn is None:
        print(
            f"[spec_first_pipeline] 精修沿用上一版模型段：{'、'.join(candidates)}"
            f"{merge_note(candidates)}"
        )
        return build(candidates)

    class _GateBlewUp(Exception):
        """闸自己抛了。单独一个类型，好把它跟"闸判不通过"分开——前者要整份
        退回（纪律七 fail-open），后者是正常的退让信号。"""

    def try_gate(segs):
        """返回 (过了吗, 头三条 findings 的人话)。闸抛异常单独往上抛。"""
        try:
            verdict = gate_fn(build(segs))
        except Exception as exc:  # noqa: BLE001
            raise _GateBlewUp(f"{type(exc).__name__}: {str(exc)[:200]}") from exc
        if isinstance(verdict, dict) and verdict.get("passed"):
            return True, ""
        findings = (verdict or {}).get("findings") or []
        return False, "；".join(
            f"{f.get('path')}：{f.get('message')}" for f in findings[:3]
        )[:200]

    try:
        # 第一次：整体试。成功就 1 次过闸收工，跟改之前一样快——绝大多数
        # 情况（冻结生效且本轮没新增权限）走的就是这条。
        ok, detail = try_gate(candidates)
        if ok:
            print(
                f"[spec_first_pipeline] 精修沿用上一版模型段：{'、'.join(candidates)}"
                f"{merge_note(candidates)}"
            )
            return build(candidates)

        # 整体过不了 → 逐个试加，落在一个 1-maximal 集合上（见文档串里的 ddmax）。
        # ⚠ 关键差别：这里是**试加**不是**试减**。试减只能走前缀，而卡住的那段
        #   （实测永远是 rbac）恰恰排在最前面，试减永远轮不到丢它。
        first_reject = detail
        if one_maximal:
            keep: list[str] = []
            for seg in candidates:
                ok, _ = try_gate(keep + [seg])
                if ok:
                    keep.append(seg)
        else:
            # 老行为：按 REFINE_REUSABLE_SEGMENTS 的顺序从尾巴丢，可达组合只有前缀。
            # 留着是为了当对照臂 + 线上一键退回，**别把它当成"另一种同样好的写法"**
            # ——真机 ON 臂 3/3 证明它够不到 {workflow, aigc}（见 merge 头注）。
            keep = list(candidates)
            while keep:
                keep.pop()
                if not keep:
                    break
                ok, _ = try_gate(keep)
                if ok:
                    break
    except _GateBlewUp as exc:
        # 纪律七：沿用是增强类，**自己炸了不许拖垮主链路**。闸抛异常时整份
        # 退回重新生成的那份——它在 assemble 里已经过过闸，是已知可用的。
        # 抛出去的话，一个"少改点东西"的优化会让整轮推演崩掉。
        print(
            f"[spec_first_pipeline] ⚠ 精修沿用重过闸时闸自己抛了，"
            f"整份退回重新生成的那份：{exc}"
        )
        return model

    dropped = [s for s in candidates if s not in keep]
    if not keep:
        print(
            f"[spec_first_pipeline] ⚠ 精修沿用逐段退让到空，整份用重新生成的那份"
            f"（首次拒绝：{first_reject}）"
        )
        return model

    print(
        f"[spec_first_pipeline] 精修沿用上一版模型段：{'、'.join(keep)}{merge_note(keep)}"
        f"（丢掉 {'、'.join(dropped)}，首次拒绝：{first_reject}）"
    )
    return build(keep)


def _reemit_pages(
    sink: Optional[Callable[..., None]],
    pages: Dict[str, str],
    *,
    bound: bool,
    binding_status: Optional[Dict[str, str]] = None,
) -> None:
    """把统一/打孔后的整批页面再冲一遍 sink（前端按 pageId 覆盖）。

    异常吞掉：与 generate_pages_parallel 的 on_page 同一条纪律——
    UI 推送失败不许赔掉已经生成好的页面。"""
    if sink is None:
        return
    total = len(pages)
    for i, (pid, html) in enumerate(pages.items(), 1):
        try:
            page_bound = binding_status.get(pid) == PAGE_BIND_BOUND if binding_status is not None else bound
            sink(pid, html, i, total, page_bound)
        except Exception as exc:  # noqa: BLE001 — 顺路推送，不打死主链
            print(f"[spec_first_pipeline] 页面重发失败（不影响产出）：{str(exc)[:120]}")


def _assemble_gate_fn():
    """assemble 出口和 6.2 / page-only 短路必须共用这一把尺子。换参就是换闸。"""
    from .v5_model_gate import validate_five_system_model

    return lambda m: validate_five_system_model(
        m,
        require_landing_page_ref=True,
        require_preferred_device=True,
        require_page_kind_contract=False,
    )


def _apply_graph_scope(
    *,
    instruction: str,
    reuse_model: Dict[str, Any],
    reuse_pages: Optional[Dict[str, str]],
    spec_pages: List[Dict[str, Any]],
    text_scope: Optional[List[str]],
    llm_json_fn: Optional[Callable[..., Any]],
    drive_on: bool,
) -> Dict[str, Any]:
    """第 2.85 步：LLM 只判种子，闭包定重画范围。给 SPEC 之前的短路用。

    返回 {verdict, stage, took_over, scope, reuse_now}。炸了 fail-open，
    took_over=False，scope 保持调用方传入的 text_scope。
    """
    from .refine_page_scope import split_pages_for_refine as _split

    stage: Dict[str, Any] = {}
    out = {
        "verdict": None,
        "stage": stage,
        "took_over": False,
        "scope": text_scope,
        "reuse_now": {},
    }
    try:
        from .app_graph import build_app_graph
        from .refine_graph_scope import (
            decide_seed_nodes,
            graph_scope_verdict,
            shadow_compare_line,
        )

        graph = build_app_graph(reuse_model)
        seeds = decide_seed_nodes(instruction, graph, llm_json_fn=llm_json_fn)
        verdict = graph_scope_verdict(graph, seeds) if seeds else None
        _safe_print(shadow_compare_line(text_scope, verdict))
        out["verdict"] = verdict
        stage["seeds"] = ",".join((verdict or {}).get("seeds") or []) or "(无)"
        stage["graphPages"] = ",".join((verdict or {}).get("pages") or [])
        stage["graphSegments"] = ",".join((verdict or {}).get("segments") or [])
        if drive_on and verdict is not None and verdict.get("pages"):
            scope = list(verdict["pages"])
            out["scope"] = scope
            out["reuse_now"] = _split(spec_pages, reuse_pages, scope)
            out["took_over"] = True
            stage["decider"] = "graph"
            stage["reusedPages"] = len(out["reuse_now"])
            print(
                f"[spec_first_pipeline] 图判作用域接管重画范围："
                f"重画 {sorted(scope)}，照搬 {len(out['reuse_now'])} 页"
            )
        elif drive_on:
            stage["decider"] = "text"
            _emit_quality_notice(
                "graph_scope_fallback",
                "图判作用域缺席，重画范围回落文本判",
            )
        else:
            stage["decider"] = "shadow"
    except Exception as exc:  # noqa: BLE001 — 图判是增强类，绝不拖垮主链路
        _safe_print(f"[spec_first_pipeline] ⚠ 图判作用域失败（回落文本判）：{str(exc)[:200]}")
        stage["failed"] = str(exc)[:120]
        stage["decider"] = "text"
        _emit_quality_notice(
            "graph_scope_fallback",
            f"图判作用域失败，重画范围回落文本判：{str(exc)[:80]}",
        )
    return out


def _with_device(
    raw_sink: Optional[Callable[..., None]], device: str
) -> Optional[Callable[..., None]]:
    """给页面 sink 注入 device（2026-08-14 竖屏加）。

    设备在管道开头定一次，每个页面事件都该带着它——前端拿它选画布视口
    （桌面 1920×1080 / 手机 390×844 CSS 像素），不带的话竖屏页会被塞进横屏画布。
    老 sink（不收 device 的四参/五参）带不动就按原参重调——UI 推送的
    兼容问题不许赔掉已经烧过 LLM 的页面。
    """
    if raw_sink is None:
        return None

    def _sink(pid: str, html: str, done: int, total: int, *args: Any, **kw: Any) -> None:
        try:
            raw_sink(pid, html, done, total, *args, device=device, **kw)
        except TypeError:
            raw_sink(pid, html, done, total, *args, **kw)

    return _sink


def _stamp_preferred_device(model: Any, device: str) -> None:
    """把管道开头定下的 device 写进模型。assemble 默认 desktop，不盖回去
    就会出现「页是竖屏、落库是 PC」——舞台按模型兜底横屏。"""
    from .device_policy import DEVICE_AUTHORITY

    if not isinstance(model, dict):
        return
    bundle = model.get("appbundle")
    if not isinstance(bundle, dict):
        bundle = {}
        model["appbundle"] = bundle
    bundle["preferredDevice"] = device
    bundle["deviceAuthority"] = DEVICE_AUTHORITY


def run_spec_first(
    goal: str,
    *,
    evidence: str = "",
    refine: Optional[Dict[str, Any]] = None,
    llm_json_fn: Optional[Callable[..., Any]] = None,
    bind_html: bool = True,
    design_system: Optional[str] = None,
    design_override: Optional[Dict[str, Any]] = None,
    reuse_language: Optional[Dict[str, Any]] = None,
    reuse_style_brief: Optional[Dict[str, Any]] = None,
    reuse_model: Optional[Dict[str, Any]] = None,
    reuse_pages: Optional[Dict[str, str]] = None,
    reuse_spec: Optional[Dict[str, Any]] = None,
    preferred_device: Optional[str] = None,
    product_archetype: Optional[str] = None,
    tools: Optional[Iterable[str]] = None,
    workflow: Optional[str] = None,
    on_page: Optional[Callable[[str, str, int, int], None]] = None,
) -> Dict[str, Any]:
    """一句话 → 完整五系统模型 + 带 data-* 孔的多页 HTML。

    design_system（2026-08-15 晚加）：这个应用的**风格**描述（版式原型、密度、
    组件词汇、配色基调），一路透到第 3 步注进提示词。不传就用缺省那一句。
    ⚠ 它只管风格：结构契约（<aside>/<header>/面包屑/无脚本…）永远由代码
      拼在后面，注入方碰不到——见 spec_page_html.build_design_system_prompt_block。

    refine（2026-08-14 晚加）：增量迭代上下文
    `{"instruction": 本轮追加要求, "modelDigest": model_refine_digest(上一版)}`。
    只影响第 2 步的 SPEC 提示词（加既有结构 + 连续性约束），后续步骤
    照常从新 SPEC 往下走——页面/模型是重新生成的，但被要求保持稳定。

    reuse_model（2026-08-17 加）：**上一版的完整模型**，精修时未被指令点名的段
    从它整段复制（第 6.2 步）。跟 refine 的 modelDigest 是两回事，别合并：
    digest 是喂给 LLM 看的摘要（几百字、有意丢细节），这个是拿来**照搬**的
    原始数据，丢了细节就搬不回去。"点名了哪几段"由 SPEC 步的 refineScope 声明。
    ⚠ 只在 refine 在场时生效——非精修轮传了也不会沿用，那是新建应用，没有上一版。

    device（2026-08-14 竖屏加）：从 goal 里认（device_policy 同一份词表，
    「手机/移动端/App/小程序」→ phone），一处定、处处跟——页面提示词换
    移动设计系统，3.5 抠移动壳（顶栏+底部标签栏），页面事件与产物都带
    device 字段，前端据此选竖屏画布。
    2026-08-20：作曲家「应用 / Web」经 preferredDevice 覆盖词表——空态点了
    「应用」不必把「手机」写进句子。覆盖装在 drive-full(-stream) 上。
    ⚠ 2026-08-20 晚：只 set 模块全局不够。执行器 `run_spec_first(goal)` 没把
    开关传进来，汇合 `assemble` 又把 appbundle.preferredDevice 写死成
    desktop——页面可能按 phone 画，落库模型仍是 PC，舞台按模型兜底横屏。
    开关必须作为 preferred_device 传进这一处，并且用**同一个 device 变量**
    盖回模型，不能再 resolve 第二次。
    ⚠ 2026-08-20 更晚：device 传到第 3 步还不够。SPEC 和风格段此前不认设备，
    切页仍是「左侧大表 + 右侧表单」，风格段点名「主表几列 / 右侧详情栏」——
    壳是手机、内容是 PC。必须把同一个 device 传进 generate_spec_tree 和
    generate_style_brief / generate_design_language / render_design_language。
    2026-08-30 夜：tablet 同构——stamp 对了，契约/IA/风格段仍是
    `phone else desktop`，五页全是 w-64。同一个 device 变量必须原样传到
    那三处，不许在中途折成 desktop。
    ⚠ 2026-08-31：product_archetype 同构。范围卡选了 content_app，SPEC /
    风格段 / 画页契约 / unify_shell 漏传，页还是后台 aside。必须把同一个
    变量传到 generate_spec_tree、generate_style_brief /
    generate_design_language / render_design_language、
    generate_pages_parallel、unify_shell、bind_pages。空 / business_app 时下游
    is_content_app 为假，桌面路径一字不改。free_app 走开放壳 + 自由切页。

    返回 {"version", "model", "spec", "structure", "semantics", "pages",
          "navItems", "failedPages", "stages", "device"}。
    任何一步失败抛 SpecFirstError，**不回落占位、不回落老链路**。
    ⚠ 2026-08-18 过夜：JSON parse / 525 若在执行器宽 except 里打回 GEN5，
    首轮「页面：无」。那种错执行器整条再试一次，仍失败也不回落
    （见 spec_first_failure_blocks_gen5）。
    """
    from .device_policy import resolve_preferred_device
    from .design_language import (
        generate_design_language,
        merge_override,
        normalize_design_language,
        render_design_language,
    )
    from .design_language import (
        active_design_system,
        design_system_override,
        generate_style_brief,
        style_brief_ok,
        style_for_page,
    )
    from .html_bindings import bind_pages
    from .html_structure import derive_structure, to_datamodel  # noqa: F401
    from .model_assembly import assemble
    from .page_shell import (
        check_shell_consistency,
        repair_pages_after_bind,
        unify_shell,
    )
    from .workflow_select import select_workflow
    from .spec_page_html import generate_pages_parallel
    from .spec_semantics import derive_semantics, to_model_sections  # noqa: F401
    from .app_template import all_app_templates, match_app_template
    from .spec_tree import generate_spec_tree
    from .page_id_freeze import (
        canonical_page_id_map,
        freeze_pages_in_model,
        freeze_spec_pages,
        log_freeze,
        pages_match_model,
        refine_id_freeze_enabled,
        rekey_page_ids,
        rekey_page_map,
        rekey_page_refs,
        rewrite_html_page_ids,
    )
    from .run_cancel import raise_if_cancelled

    stages: Dict[str, Any] = {}
    _quality_token = _quality_notices_var.set([])
    #: 页面 id 别名表（旧 id → 新 id）。第 4.5 步改键时**当场**记下来，
    #: 交付时随页面载体一起落库，宿主点菜单解析不到时按它回退。
    #: 空表是常态（没改过名的轮次），不是缺失。
    _page_id_aliases: Dict[str, str] = {}
    # 显式开关压过话题词表：点了「应用」再写「做个库存系统」必须出竖屏。
    # 不传则走 resolve（模块 override > 句子里的设备词 > desktop）。
    if preferred_device in _supported_devices():
        device = preferred_device
    else:
        device = resolve_preferred_device(goal, None)
    # 日历从范围卡上的 原型×设备 + 规划器 tools 派生。话题词不在这里分流。
    # 不经过 select_workflow = 注册表又成没通电的插座。
    preset = select_workflow(
        name=workflow or "",
        archetype=product_archetype or "",
        device=device,
        refine=bool(refine),
        tools=tools,
    )
    # ⚠ 2026-09-04 真机（社区旧物置换站 sr-20260903220228）：
    #   `select_workflow` 见到**多件**且缺 spec 会「补根」——
    #     ['pages','structure','bind'] → preset.tools 里 spec 又回来了
    #     （单跳 ['structure'] / ['bind'] 不补，所以只在剩余链上现形）
    #   于是假设确认后的那一跳：
    #     [control] forced hop=pages hasSpec=1 hasPages=0
    #     capabilityPlan=product-rehearsal tools=spec,pages,structure,bind
    #     stage=specfirst.spec ms=18428 ok=1 pages=6 nodes=17   ← 重起草
    #     spec-first 页面落库：0 份 · 有 SPEC                    ← 一页没画
    #   首版 SPEC 是 5 页 16 节点，重起草出来 6 页 17 节点——**用户刚确认的
    #   那些假设是针对旧 SPEC 的，落到了一份新的上**；整轮预算烧在起草上，
    #   页面一页都没出。用户看到的就是「点了确认继续，还在起草规格」。
    #
    #   badec6f 已经修过一次同名的病，护栏加在驱动侧
    #   `v5_full_driver._factory_tools_from_state`（那里剔 spec 是对的，
    #   stamp 出来的 goal.tools 确实是 pages,structure,bind），但
    #   `run_spec_first` 转手又 `select_workflow(tools=tools)` 并拿
    #   **preset.tools** 当计划，把剔掉的 spec 原样加回来——§4 成对物
    #   只改了一半，不报错，只是一半不生效。
    #
    #   规则：调用方明确没点 spec、而且带了上一版 SPEC（reuse_spec）＝
    #   会话里已经有，不许补根重起草。spec 那一步按
    #   `plan.includes("specfirst.spec")` 判（:1531/1572），所以从 ids 里
    #   摘掉这一个就够；design 不动——pages 跳要靠它定风格，
    #   `assert_stages_match_tools` 对这一份是显式放行的。
    _plan_tools = tuple(preset.tools)
    _plan_ids = tuple(preset.stages)
    _requested = tuple(
        str(item).strip() for item in (tools or ()) if str(item or "").strip()
    )
    if _requested and "spec" not in _requested and "spec" in _plan_tools and reuse_spec:
        _plan_tools = tuple(name for name in _plan_tools if name != "spec")
        _plan_ids = tuple(sid for sid in _plan_ids if sid != "specfirst.spec")
        # ⚠ design 跟着走，除非这一跳要画页。
        #   `_do_design = (not _skip_after_assumptions) and plan.includes("specfirst.design")`
        #   （:1722）——而 `_skip_after_assumptions` 是在 **spec 那一步**里置位的。
        #   跳过 spec 就没人置位，design 于是跑了起来；对 structure/bind 这种
        #   不画页的跳，它是白跑，还会被 assert_stages_match_tools 判成
        #   extra（design 的豁免只给「有 pages 且没 spec」那一种，
        #   capability_plan:214）。2026-09-04 我这条修复的第一版就漏了它：
        #   test_dry_run_walks_structure_not_a_clip 变红，
        #   extra=['specfirst.design']——单跑那几个闸没盖住，全量才照出来。
        #   pages 跳必须留着：真机 stage=specfirst.design ms=54626 就是给它定风格的。
        if "pages" not in _requested:
            _plan_ids = tuple(sid for sid in _plan_ids if sid != "specfirst.design")
    plan = CapabilityPlan(
        name=preset.name,
        ids=_plan_ids,
        device=device,
        tools=_plan_tools,
    )
    stages["capabilityPlan"] = {
        "name": plan.name,
        "tools": list(plan.tools),
        "capabilities": list(plan.ids),
        "device": plan.device,
    }
    arch = str(product_archetype or "").strip()
    print(
        f"[spec_first_pipeline] preferredDevice={device} "
        f"productArchetype={arch or 'business_app'} capabilityPlan={plan.name} "
        f"tools={','.join(plan.tools)}"
    )
    sink = _with_device(on_page or _page_sink_var.get(), device)
    pages: Dict[str, str] = {}
    # 沿用上一跳页面再打孔（structure-bind）时 pages 步不会跑，
    # bind 收尾仍会调 `_fill_html`。没定义就是 UnboundLocalError，
    # 干跑整段走才踩到（O-7 对照 grok validate.rs）。活路径同一形状。
    def _fill_html(markup: str) -> str:
        return markup
    if (
        not plan.includes("specfirst.pages")
        and isinstance(reuse_pages, dict)
        and reuse_pages
    ):
        pages = {
            str(k): str(v)
            for k, v in reuse_pages.items()
            if str(v or "").strip()
        }
        print(f"[spec_first_pipeline] 沿用上一跳页面 {len(pages)} 份")
    failed: Dict[str, Any] = {}
    missing_pages: list = []
    shell: Dict[str, Any] = {}
    structure: Any = {}
    _theme_lang = None

    # ★ id 冻结（2026-08-17）：把上一版的「概念名 → id」词表算出来，第 4/5 步
    #   各拿一份。**只在精修轮**——新建应用没有上一版，给它一批无关 id 只会
    #   让它硬凑。算一次给两处用，不在两边各取一次数（两处取数迟早对不齐，
    #   本仓在别处栽过）。
    #   `SLIDERULE_REFINE_ID_FREEZE=0` 关掉：既是线上一键回退，也是**对照臂开关**
    #   ——量"是不是它起的作用"必须同模型同话题跑 A/B，换个模型比前后是把两个
    #   变量混在一起（本仓吃过"拿造出来的数替代看一眼"的亏）。
    _freeze_on = refine_id_freeze_enabled()
    _prev_ids = model_id_lexicon(reuse_model) if (refine and _freeze_on) else {}
    if _prev_ids:
        print(
            f"[spec_first_pipeline] 精修 id 冻结：实体 {len(_prev_ids.get('entities') or [])}、"
            f"角色 {len(_prev_ids.get('roles') or [])}、"
            f"流程节点 {len(_prev_ids.get('workflowNodes') or [])}、"
            f"页面 {len(_prev_ids.get('pages') or [])}"
        )
    elif refine and not _freeze_on:
        print("[spec_first_pipeline] id 冻结被开关关掉（SLIDERULE_REFINE_ID_FREEZE=0）")
    elif refine:
        # 静默失效的老形状：精修轮却没有词表（reuse_model 没传/上一版是空的）。
        # 不说话的话，线上表现是"id 照样每轮重铸"而日志一个字都没有。
        _safe_print("[spec_first_pipeline] ⚠ 精修轮但拿不到上一版 id 词表，id 冻结未生效")

    # ── 第 2.85 步提前：图判必须赶在 SPEC 之前（2026-08-18）────────
    #
    # 图只依赖 reuse_model，不依赖新 SPEC。洗衣房真机 graphSegments=page
    # 时仍先整本重写规格、再编权限、再 6.2 盖回——先做再盖。把图判提前，
    # page-only 才能在 generate_spec_tree 之前短路。对照日志、判官阶梯、
    # hops 标定一行不改，只是挪了插座。
    #
    # ⚠ 独立埋点仍叫 specfirst.graphscope：前端阶段词表和 hops 标定集
    #   都认这个名字，换名等于把标定集作废。
    from .refine_page_scope import split_pages_for_refine
    from .refine_short_circuit import (
        format_refine_reuse_note,
        hold_spec_from_reuse,
        is_page_only_verdict,
        merge_held_structure,
        overlay_page_only_model,
        page_names_from_spec_or_model,
        page_objs_from_model,
        page_only_shortcircuit_enabled,
    )

    _reuse_now: Dict[str, str] = {}
    _scope: Optional[List[str]] = None
    _graph_verdict: Optional[Dict[str, Any]] = None
    _graph_took_over = False
    _held_spec = False
    _held_semantics = False
    _held_assemble = False
    _held_structure = False
    _skip_after_assumptions = False
    _shadow_on = str(
        os.environ.get("SLIDERULE_GRAPH_SCOPE_SHADOW", "1")
    ).strip().lower() not in _env_flags.OFF
    _graph_drive_on = str(
        os.environ.get("SLIDERULE_GRAPH_SCOPE_DRIVE", "1")
    ).strip().lower() not in _env_flags.OFF
    if refine and reuse_model and _shadow_on and plan.includes("specfirst.graphscope"):
        raise_if_cancelled("第2.85步 图判作用域")
        with _stage("specfirst.graphscope") as gst:
            _graph = _apply_graph_scope(
                instruction=str((refine or {}).get("instruction") or ""),
                reuse_model=reuse_model,
                reuse_pages=reuse_pages,
                spec_pages=page_objs_from_model(reuse_model),
                text_scope=_scope,
                llm_json_fn=llm_json_fn,
                drive_on=_graph_drive_on,
            )
            gst.update(_graph["stage"])
            _graph_verdict = _graph["verdict"]
            if _graph["took_over"]:
                _scope = _graph["scope"]
                _reuse_now = _graph["reuse_now"]
                _graph_took_over = True
        stages["graphscope"] = dict(gst)

    # ── 第 2 步：起草 SPEC（page-only 改为打补丁，不整本重写）────────
    # （第 1 步「澄清 + 缺口 + 证据」用的是现有能力，由调用方把 evidence 传进来）
    spec: Optional[Dict[str, Any]] = None
    if (
        not plan.includes("specfirst.spec")
        and isinstance(reuse_spec, dict)
        and reuse_spec
    ):
        spec = reuse_spec
        print("[spec_first_pipeline] 沿用上一跳 SPEC")
    if (
        plan.includes("specfirst.spec")
        and refine
        and page_only_shortcircuit_enabled()
        and _graph_took_over
        and is_page_only_verdict(_graph_verdict)
    ):
        spec = hold_spec_from_reuse(
            reuse_model,
            instruction=str((refine or {}).get("instruction") or ""),
            scope_pages=_scope,
        )
        if spec is not None:
            _held_spec = True
            with _stage("specfirst.spec") as st:
                # ⚠ 这一支**故意不发假设**（伴随式澄清，2026-08-27）。别照着
                #   下面那支补上去：这里的 spec 是**从上一版沿用**来的，本轮
                #   没有任何模型替用户重新定过什么。沿用的那份里带着上一轮的
                #   assumptions，再发一遍就是每轮精修都弹同一张
                #   「我替你定了登录方式」——用户上一轮已经看过并且默认了。
                #   没有新决定 = 没有新假设。
                st["held"] = 1
                st["patched"] = 1
                st["pages"] = len(spec.get("pages") or [])
                st["nodes"] = len(spec.get("nodes") or [])
            stages["spec"] = dict(st)
            print(
                "[spec_first_pipeline] 精修短路：规格沿用上一版（打补丁，不整本重写），"
                f"refineScope=[]，作用域 {sorted(_scope or [])}"
            )
        else:
            _safe_print(
                "[spec_first_pipeline] ⚠ 规格沿用重建失败，回落整本起草"
            )

    if plan.includes("specfirst.spec") and not _held_spec:
        # 骨架先验（2026-08-27）：match_app_template 此前对工厂是死的。命中则
        # 把页清单 / 区块槽喂给 spec_tree，不是喂 GEN5。匹配失败或匹配器自己
        # 炸了都 fail-open——骨架是增强类结构建议，不是证据闸，不许拦推演。
        # 精修轮不套：上一版结构已经在 refine 段里，骨架再压上去会打架。
        skeleton = None
        if not refine:
            try:
                _hit = match_app_template(goal, all_app_templates())
                if isinstance(_hit, dict) and isinstance(_hit.get("template"), dict):
                    skeleton = _hit["template"]
                    _verdict = _hit.get("verdict") or {}
                    print(
                        f"[spec_first_pipeline] 骨架先验：{skeleton.get('id') or '?'} "
                        f"（score={_verdict.get('score')}）"
                    )
            except Exception as exc:
                _safe_print(
                    f"[spec_first_pipeline] 骨架匹配异常（fail-open，不拦推演）：{exc}"
                )
                skeleton = None
        with _stage("specfirst.spec") as st:
            # prev_pages：页面 id 冻结的词表（只在精修轮非空）。页面 id 在**这一步**
            # 铸出来，所以冻结必须在这里下——第 4/5 步那两针冻不到它。真机第二轮
            # 页面 id 整套重铸（p1..p4 → elder_management），按需重画的照搬和图判
            # 作用域的"重画这一页"就都对不上号了。见 model_id_lexicon 的页面档注释。
            spec_model = generate_spec_tree(
                goal, evidence=evidence, refine=refine,
                prev_pages=(_prev_ids.get("pages") or None),
                device=device,
                skeleton=skeleton,
                product_archetype=arch,
            )
            if skeleton:
                st["appTemplate"] = str(skeleton.get("id") or "")
            spec = spec_model.model_dump(mode="json") if hasattr(spec_model, "model_dump") else spec_model
            # Return the saved SPEC to the control questionnaire before any
            # design/page work starts, including synchronous driver calls.
            if _emit_assumptions(spec):
                _skip_after_assumptions = True
                rows = spec.get("assumptions") if isinstance(spec, dict) else None
                stages["assumptionsHeld"] = {
                    "count": len(list(rows or [])),
                }
                _safe_print(
                    "[spec_first_pipeline] 伴随式澄清：SPEC 已出，停住等人选完再继续"
                )
            # ★ 结构拨回（2026-08-18 过夜）：提示词冻结求不动。必须在
            #   spec_pages_declared 取值之前——图判、照搬、画页、风格复用
            #   全都拿那份清单当键。拨完再取，键才对得上上一版。
            if refine and _freeze_on and _prev_ids.get("pages"):
                _prev_page_objs = None
                if isinstance(reuse_model, dict):
                    _prev_page_objs = ((reuse_model.get("page") or {}).get("pages") or None)
                spec, _page_freeze = freeze_spec_pages(
                    spec, _prev_ids.get("pages"), _prev_page_objs
                )
                log_freeze(_page_freeze, where="第2步 SPEC")
                st["pageIdRemapped"] = len(_page_freeze.get("mapping") or {})
                if _page_freeze.get("restored"):
                    st["pageIdRestored"] = ",".join(_page_freeze["restored"])
            st["pages"] = len(spec.get("pages") or [])
            st["nodes"] = len(spec.get("nodes") or [])
        stages["spec"] = dict(st)

    if spec is None:
        raise SpecFirstError("第 2 步没有产出 SPEC。单跳 pages/structure/bind 需要上一跳的 SPEC。")
    # 图只碰 page 时，没声明 refineScope 也按「一段都没点名」——否则 6.2
    # 把 None 当成不知道，权限/流程仍先做再盖。
    if (
        refine
        and is_page_only_verdict(_graph_verdict)
        and _graph_took_over
        and spec.get("refineScope") is None
    ):
        spec["refineScope"] = []
    # SPEC 声明的页面清单——**交付对账的基准**。在这里取一次，下面第 3 步
    # 拿它跟实交页面比。⚠ 取 id 不取数量：只比数量的话，"少了 p5、多了 p9"
    # 会两两相消，数字对得上而内容错位——本仓在别处栽过这种"数对了东西不对"。
    spec_pages_declared_objs = [
        p for p in (spec.get("pages") or []) if isinstance(p, dict) and p.get("id")
    ]
    spec_pages_declared = [
        str(p.get("id") or "") for p in (spec.get("pages") or []) if isinstance(p, dict) and p.get("id")
    ]

    # ── 第 2.5 步：定这个应用的设计语言（风格那一半）────────────────
    #
    # 链路原来从"起草规格"直接跳到"逐页画界面"，中间没有"这个应用长什么样"
    # 的环节——于是不管什么业务出来都是同一个模子。
    #
    # ⚠ 人给了散文就**不调 LLM**：显式指定优先于生成，这跟 on_page 那条
    #   "显式实参优先于 sink"是同一条纪律。省一次调用是顺带的，主要是
    #   别让生成结果去覆盖人明确写下的东西。
    # ⚠ 契约不经过这一步。它只出风格，塞进 spec_page_html 的槽位，
    #   结构契约照旧由代码拼在后面——见 build_design_system_prompt_block。
    # ⚠ 复用优先于重新生成（2026-08-15 晚补）。真机量到过：同一个应用连着
    #   跑两次，配色一次 #1b3a57+#a1824a、一次 #1e3a8a+#b45309——气质同向，
    #   具体值全变。修补/迭代场景下用户会看见界面颜色莫名其妙换掉，而那是
    #   **一眼可见**的不稳定，比密度不够伤得多。
    #
    # ⚠ 2026-08-19：接过 ui-ux-pro-max CSV 查表（style_pack），真机团购
    #   工作台命中 Food Delivery 行——色板当整页墙纸，着陆页半边和桌面
    #   契约打架，画面并不比 LLM 自己写风格段好。用户裁决卸掉。别再把
    #   上游 CSV 倒进画页提示词。
    design_language: Optional[Dict[str, Any]] = None
    style_brief: Optional[Dict[str, Any]] = None
    # ⚠ 用户选的设计系统也要盖进回落分支（2026-08-24）。主路径是
    #   generate_style_brief（约束写在它的 system 段里），但风格段生成挂掉那次
    #   会走下面的 design_language——不在这里合一次，那一次就静默回到
    #   "自己定色"，用户选的皮当场失效且不报错。人显式给的 design_override
    #   仍然赢（后者盖前者），符合「人写的永远赢」。
    _ds = active_design_system()
    if _ds:
        design_override = {**design_system_override(_ds), **(design_override or {})}
    _do_design = (not _skip_after_assumptions) and plan.includes("specfirst.design")
    # spec 单跳被假设卡停住之后，下一跳 pages 展开不含 design。
    # 上一跳没定风格时这里补跑，否则页面走缺省皮。
    if (
        not _do_design
        and not _skip_after_assumptions
        and plan.includes("specfirst.pages")
        and not reuse_style_brief
        and not reuse_language
        and not (design_system or "").strip()
    ):
        _do_design = True
    # ⚠ 2026-09-04 真机（慢病随访 sr-20260904000148 + 共享工具房 sr-20260903234956）：
    #   **复用不许挂在 `_do_design` 后面**。第一版写成 `if not _do_design: pass`
    #   打头，于是「一跳一件」的精修（`capabilityPlan tools=pages`，展开里没有
    #   design）连复用分支都够不着：`reuse_style_brief` / `reuse_language` 明明
    #   传进来了，`style_brief` 和 `design_language` 却一路是 None，
    #   第 3.5 步 `resolve_theme_language(None, None, "")` 退回缺省蓝——
    #
    #       首轮 design=llm → shell themePrimary=#1a535c（医疗青绿）
    #       精修 单跳       → shell themePrimary=#2563eb（缺省蓝）
    #
    #   用户只说「把随访列表改成看板视图」，整个应用的配色被换掉，
    #   而且 unify_shell 拿新色重刷每一页 → 日志说「3/4 页原样沿用」，
    #   交付物却是 4 页全变。两个会话各复现一次。
    #   流水线自己那句「复用上一版风格段，不重新生成」在真机日志里
    #   **一次都没出现过**，正是它够不着的证据。
    #
    #   `_do_design` 管的是**要不要现生成**（那才费 LLM）；复用是零 LLM 的
    #   赋值，只要上游给了就该认。两件事分开。
    if (design_system or "").strip():
        pass  # 人直接给了散文，最高优先，连生成带复用一起跳过
    elif reuse_style_brief and style_brief_ok(
        reuse_style_brief, [str(p.get("id")) for p in spec_pages_declared_objs]
    ):
        style_brief = reuse_style_brief
        print("[spec_first_pipeline] 复用上一版风格段，不重新生成")
    elif reuse_language:
        design_language = merge_override(
            normalize_design_language(reuse_language), design_override
        )
        design_system = render_design_language(design_language, device=device, product_archetype=arch)
        # ⚠ 零 LLM、瞬时完成，**不进进度线**——照 specfirst.shell 那条：
        #   start/end 背靠背发出去只会在左侧闪一下。
        print("[spec_first_pipeline] 复用上一版设计语言，不重新生成")
    elif not _do_design:
        pass
    else:
        raise_if_cancelled("第2.5步 定设计语言")
        with _stage("specfirst.design") as st:
            # ★ 2026-08-16 用户裁决：风格段改由 LLM **现写**——
            #   「a 就算内容再多也是写死的」。确定性那套降为回落。
            style_brief = generate_style_brief(spec, device=device, product_archetype=arch)
            st["mode"] = "llm" if style_brief else "fallback"
            if style_brief is None:
                # ⚠ 回落不是可有可无：审美挂了不该打死整轮，而确定性那套
                #   永远出得来。这跟 spec_tree「失败不回落占位」不矛盾——
                #   那条护的是内容，这里回落的是审美。
                design_language = generate_design_language(
                    spec, override=design_override, device=device,
                    product_archetype=arch,
                )
                design_system = render_design_language(design_language, device=device, product_archetype=arch)
                st["density"] = design_language.get("density")
        stages["design"] = dict(st)

    # 逐页各拿各的那份；应用级基调对每页相同，所以页面才像同一个产品。
    if style_brief:
        design_system = {
            str(p.get("id")): style_for_page(style_brief, str(p.get("id")))
            for p in spec_pages_declared_objs
        }

    # 图判在 SPEC 之前用上一版页面清单 split 过一次。SPEC 页 id 拨回之后
    # 再对一次声明集——声明里没了的页不许照搬回来（split_pages_for_refine
    # 第三条）。图没接管时 _scope 仍是 None，split 会回空集，行为跟从前一样。
    if refine and reuse_pages and _scope is not None:
        _reuse_now = split_pages_for_refine(
            spec_pages_declared_objs, reuse_pages, _scope
        )

    # ── 第 2.8 步：判本轮要重画哪几页（只有精修轮有这一步）──────────
    #
    # ★ 按需重画（2026-08-17）：指令没点到的页面原样照搬上一版，一次 LLM 都
    #   不调。做法取自 Aider 的 ContextCoder，见 services/refine_page_scope.py。
    #
    # ⚠ **独立一步、独立埋点**，不并进第 3 步（2026-08-17 真机量完才挪出来的）：
    #   它自己是一次 LLM 调用。混在画页那一格里，"少画 3 页省了多少"和"多花
    #   一次判定花了多少"两个数会互相抵消——第一次量出来是「只画 1 页(42.6s)
    #   反而比画 4 页(27.6s)还慢」，而那里面一半是这次判定、一半是页面本来就
    #   并发画的。**两件事混在一个埋点里，量出来的墙钟说明不了任何事。**
    #
    # ⚠ fail-open 到**全量重画**：判作用域挂了最多是慢一点、回到今天的行为。
    #   绝不能 fail 成"一页都不改"——那会让用户说了话而应用一动不动。
    #
    # ⚠ 2026-08-18：图判已经接管时不再烧这一次 LLM。图是更高一级判官，
    #   文本判的答案本来也会被盖掉；先问再扔就是 pagescope 那 2 秒白烧。
    if refine and not reuse_pages:
        # ⚠ 静默失效的老形状：精修轮却没拿到上一版页面 → 照样全量重画，而
        #   日志里一个字都没有。2026-08-17 真机第一次跑就撞上（`set_refine_context`
        #   两个调用点只改了一个），靠"该有的日志一行都没出现"才发现。
        print(
            "[spec_first_pipeline] ⚠ 精修轮但没拿到上一版页面，按需重画未生效，"
            "本轮全量重画（reuse_pages 空）"
        )
    if refine and reuse_pages and not _graph_took_over and (not _skip_after_assumptions) and plan.includes("specfirst.pagescope"):
        raise_if_cancelled("第2.8步 判重画范围")
        with _stage("specfirst.pagescope") as sst:
            from .refine_page_scope import decide_pages_to_regenerate

            _scope = decide_pages_to_regenerate(
                str((refine or {}).get("instruction") or ""),
                spec_pages_declared_objs,
                llm_json_fn=llm_json_fn,
            )
            _reuse_now = split_pages_for_refine(
                spec_pages_declared_objs, reuse_pages, _scope
            )
            sst["scopePages"] = ",".join(_scope or []) or "(全量)"
            sst["reusedPages"] = len(_reuse_now)
        stages["pagescope"] = dict(sst)

    # 图判已挪到 SPEC 之前（同一埋点 specfirst.graphscope）。这里再跑一次
    # 会把种子 LLM 付两遍钱，对照日志打两行，标定集作废。

    # ── 第 3 步：每页 HTML（并发；单页失败不拖垮整批）────────────────
    if (not _skip_after_assumptions) and plan.includes("specfirst.pages"):
        raise_if_cancelled("第3步 逐页画界面")
    if (not _skip_after_assumptions) and plan.includes("specfirst.pages"):
        with _stage("specfirst.pages") as st:
            # on_page 透传：这一步是整条链上**第一个产出可以直接看的东西**的地方，
            # 一份能独立打开的 HTML 比最终模型早四五分钟。攒齐再交等于白白转圈。
            #
            # 显式实参优先于 sink：脚本/评测直接调这个函数时不该被"当前请求恰好
            # 装了个 sink"影响。生产路径（主轴）走 sink，因为中间那层是同步的。
            st["reusedPages"] = len(_reuse_now)
            # 库存图：screenshot-to-code / tteg 的口径——先画 placehold，落地后再
            # 按每张 img 的 alt 搜。一袋 URL 注进提示词会让模型把番茄贴进充电桩卡。
            _stock_cache: Dict[str, Optional[str]] = {}

            def _fill_html(markup: str) -> str:
                try:
                    from .stock_images import fill_stock_placeholders

                    return fill_stock_placeholders(
                        markup, spec=spec, goal=goal, cache=_stock_cache
                    )
                except Exception as exc:  # noqa: BLE001 — 搜图是增强，不许拖画页
                    _safe_print(
                        f"[spec_first_pipeline] ⚠ 库存图换图失败（不拦画页）：{str(exc)[:200]}"
                    )
                    return markup

            def _sink_stock(
                pid: str, markup: str, done: int, total: int, *args: Any, **kw: Any
            ) -> None:
                if pid not in _reuse_now:
                    markup = _fill_html(markup)
                if sink:
                    sink(pid, markup, done, total, *args, **kw)

            batch = generate_pages_parallel(
                spec, device=device, design_system=design_system,
                product=goal, on_page=_sink_stock if sink else None, reuse_pages=_reuse_now,
                # ★ "按需"的第二层：点到的那几页也尽量**只改那几行**，别整页重画。
                #   edit_base 只在精修轮给，且只含上一版真有的页；新页没有基线，
                #   自然走整页生成。
                edit_base=(reuse_pages or {}) if refine else {},
                edit_instruction=str((refine or {}).get("instruction") or "") if refine else "",
                product_archetype=arch,
            )
            pages = dict(batch.get("pages") or {})
            pages = {
                pid: html if pid in _reuse_now else _fill_html(html)
                for pid, html in pages.items()
            }
            failed = dict(batch.get("failed") or {})
            st["got"] = len(pages)
            st["failed"] = len(failed)
            # ★ 交付页数对账（2026-08-14）：**SPEC 说要几页，就得交几页**。
            #
            # 第 4 步的 check_page_coverage 守的是「喂几份 HTML → 出几个页面」，
            # 它比的是**这一步的输入**。而这一步自己少产一页时，第 4 步收到的
            # 就是少了的那份，喂 4 出 4——**判据全绿，缺口在它上游**。
            #
            # 真机撞到过（2026-08-14 市政园林那轮）：spec 5 页、第 3 步 failed=1，
            # 后面所有步骤按 4 页跑完，闭环 6/6、blocked=false，没有任何一处
            # 提过"少了一页"。缺的那页记在 failedPages 里，但没人拿它跟 spec 对账。
            #
            # ⚠ 只记不拦：单页失败本来就是 fail-open 设计（另外几页已经烧掉几分钟，
            #   不该被一页拖垮）。这里补的是**让它说得出话**，不是把它改成 fail-closed。
            st["declaredPages"] = len(spec_pages_declared)
            missing_pages = [pid for pid in spec_pages_declared if pid not in pages]
            if missing_pages:
                st["missingPages"] = ",".join(missing_pages)
                # ⚠ 2026-08-20 Foclip 真机：这里曾是裸 print。Windows 控制台 GBK
                #   编不出 ⚠（报错 position 13，正好是 `[spec_first] ⚠` 那个符），
                #   UnicodeEncodeError 逃出第 3 步，被当成 LLM_GENERATE_FAILED，
                #   规格和设计都写完了、六段模型整份丢掉，右栏空白、证据 0/6。
                #   缺页本身是只记不拦；日志把自己写成 fail-closed 才是事故。
                _safe_print(
                    f"[spec_first] ⚠ 交付页数对不上 SPEC：声明 {len(spec_pages_declared)} 页、"
                    f"实交 {len(pages)} 页，缺 {missing_pages}（失败原因见 failedPages）"
                )
        stages["pages"] = dict(st)
    if (not _skip_after_assumptions) and plan.includes("specfirst.pages") and not pages:
        raise SpecFirstError(f"第 3 步一页都没出来：{list(failed.values())[:2]}")

    # ── 第 3.5 步：外壳统一（零 LLM）────────────────────────────────
    if (not _skip_after_assumptions) and plan.includes("specfirst.shell"):
        raise_if_cancelled("第3.5步 外壳统一")
        with _stage("specfirst.shell") as st:
            shell = unify_shell(pages, spec, device=device, product_archetype=arch)
            pages = dict(shell.get("pages") or pages)
            st["pages"] = len(pages)
            # 判据接进生产（此前只在测试里跑）：统一完还剩几处不一致，如实记账。
            # 只记不拦——挡运行的闸在结构那边，这里的职责是让漂移**看得见**。
            # ★ 2026-08-20：壳统一之后立刻钉语义色。unify 只换 DOM 结构，
            #   不换颜色——顶栏黑、侧栏海军蓝、浅页深砖，unify 全绿。
            _theme_lang = None
            try:
                from .theme_tokens import apply_theme_to_pages, resolve_theme_language

                _theme_lang = resolve_theme_language(
                    design_language, style_brief, design_system
                )
                pages = apply_theme_to_pages(pages, _theme_lang)
                st["themePrimary"] = _theme_lang.get("primary")
            except Exception as exc:  # noqa: BLE001 — 钉色是增强，不许拖画页
                _safe_print(
                    f"[spec_first_pipeline] ⚠ 主题锁定失败（不拦画页）：{str(exc)[:200]}"
                )
                _theme_lang = None
            # ★ 2026-08-27：壳统一之后给正文打**块身份**（零 LLM，抄 grok-build
            #   managed_text 的 item 寻址）。打在这儿是为了让直播舞台从第 3.5 步
            #   起就能按块看；bind 之后还要再打一次（它整页重写会把标吃掉），
            #   两处都调同一个幂等函数——跟主题色钉两次同一个道理。
            # ⚠ fail-open（纪律七）：打标是增强，炸了照样交付页面。
            try:
                from .page_blocks import mark_pages_blocks, scan_blocks

                pages = mark_pages_blocks(pages)
                st["blocks"] = sum(len(scan_blocks(h)) for h in pages.values())
                _safe_print(f"[spec_first_pipeline] 块身份（壳后）：{st['blocks']} 块 / {len(pages)} 页")
            except Exception as exc:  # noqa: BLE001 — 打块标是增强，不许拦画页
                _safe_print(f"[spec_first_pipeline] ⚠ 块身份打标失败（不拦画页）：{str(exc)[:200]}")

            shell_problems = check_shell_consistency(pages, spec, device=device)
            st["problems"] = len(shell_problems)
            for p in shell_problems[:3]:
                print(f"[spec_first_pipeline] 外壳统一后仍不一致：{p['path']} — {p['message']}")
        stages["shell"] = dict(st)

        # 统一后的页面立刻重发一遍（bound 仍是 False，但菜单已按 spec 锚定）。
        # 不发的话，前端直播舞台从第 3 步起一直摆着「三个产品名、三套菜单」的
        # 素颜页，要等整轮跑完 finalState 到达才换——那是十几分钟的错误画面。
        _reemit_pages(sink, pages, bound=False)

    if (not _skip_after_assumptions) and plan.includes("specfirst.structure") and not pages:
        raise SpecFirstError("structure 需要上一跳的页面")
    if bind_html and (not _skip_after_assumptions) and plan.includes("specfirst.bind") and not pages:
        raise SpecFirstError("bind 需要上一跳的页面")

    # ── 第 4 步：HTML → 结构 ────────────────────────────────────────
    # 照搬页 HTML 没变，数据结构沿用上一版。只把重画页送去反推，再和
    # 沿用页拼回完整结构。整份四页再送一次是洗衣房那 11 秒白烧。
    if (not _skip_after_assumptions) and plan.includes("specfirst.structure"):
        raise_if_cancelled("第4步 反推结构")
        with _stage("specfirst.structure") as st:
            _redrawn_html = {
                pid: html for pid, html in pages.items() if pid not in _reuse_now
            }
            if (
                refine
                and page_only_shortcircuit_enabled()
                and _reuse_now
                and _redrawn_html
            ):
                structure_model = derive_structure(
                    _redrawn_html, goal=goal, llm_json_fn=llm_json_fn, prev_ids=_prev_ids
                )
                merged = merge_held_structure(
                    structure_model,
                    reuse_model,
                    _reuse_now.keys(),
                    required_page_ids=pages.keys(),
                )
                if merged is not None:
                    structure = merged
                    _held_structure = True
                    st["heldPages"] = len(_reuse_now)
                    st["derivedPages"] = len(_redrawn_html)
                else:
                    _safe_print(
                        "[spec_first_pipeline] ⚠ 未改页结构沿用拼不回，回落全量反推"
                    )
                    structure_model = derive_structure(
                        pages, goal=goal, llm_json_fn=llm_json_fn, prev_ids=_prev_ids
                    )
                    structure = (
                        structure_model.model_dump(mode="json")
                        if hasattr(structure_model, "model_dump")
                        else structure_model
                    )
            else:
                structure_model = derive_structure(
                    pages, goal=goal, llm_json_fn=llm_json_fn, prev_ids=_prev_ids
                )
                structure = (
                    structure_model.model_dump(mode="json")
                    if hasattr(structure_model, "model_dump")
                    else structure_model
                )
            if not isinstance(structure, dict):
                structure = (
                    structure.model_dump(mode="json")
                    if hasattr(structure, "model_dump")
                    else {}
                )
            st["entities"] = len(structure.get("entities") or [])
            st["pages"] = len(structure.get("pages") or [])
            # 第 4 步 LLM 仍可能把 page.id 改名。HTML 键已经是拨回后的 id，
            # 这里只重映射、不补页——结构页没有 purpose/audience，补进去
            # 过不了 DerivedPage。缺页由第 2 步补回后再画。
            if refine and _freeze_on and _prev_ids.get("pages"):
                structure, _struct_freeze = freeze_spec_pages(
                    structure, _prev_ids.get("pages"), restore=False
                )
                log_freeze(_struct_freeze, where="第4步 structure")
                st["pages"] = len(structure.get("pages") or [])
            # ── 第 4.5 步：页面包改键，对齐模型铸出来的页面 id（2026-08-24）──
            #
            # 上面那句注释说「HTML 键已经是拨回后的 id」——**那只在精修轮成立**
            # （第 2 步 freeze 把 SPEC 拨到了上一版模型的 id 上）。首轮没有上一版，
            # SPEC 铸的是 p1..p4，而模型的页面 id 取自这一步 LLM 起的语义名，
            # 两套 id 从此各说各话，且**全仓没有一处校验过它们相等**。
            # 后果（真机三轮实测）与做法，整段写在 page_id_freeze 那半个文件里。
            #
            # ⚠ 必须在第 6.5 步 bind **之前**：bind 的
            #   `this_page_bound = page_id in wf_bound_pages` join 的就是这两套 id，
            #   晚一步就仍旧恒 False。
            #
            # ⚠ 凡是**以页面 id 作键或存页面 id** 的东西都要一起改，漏一个就是
            #   半新半旧。所以下面把它们列在同一处、一次改完；改完还有
            #   `pages_match_model` 那条反向不变式兜底（见交付前那一段）——
            #   将来谁新增一个按页面 id 索引的载体、忘了加进来，那条会喊。
            _canon = canonical_page_id_map(structure)
            if _canon:
                pages = rekey_page_map(pages, _canon)
                failed = rekey_page_map(failed, _canon)
                _reuse_now = rekey_page_map(_reuse_now, _canon)
                # ⚠ 改键改不到已经烧进 HTML 的 data-page-id。别名表是第二
                #   通道；新生成这一份孔必须跟键同一套，否则别名被抹掉菜单
                #   又静默点不动。p1 不会误伤 p10（正则带引号）。
                pages = rewrite_html_page_ids(pages, _canon)
                failed = rewrite_html_page_ids(failed, _canon)
                _reuse_now = rewrite_html_page_ids(_reuse_now, _canon)
                spec = rekey_page_refs(spec, _canon)
                spec_pages_declared = rekey_page_ids(spec_pages_declared, _canon)
                spec_pages_declared_objs = rekey_page_refs(spec_pages_declared_objs, _canon)
                missing_pages = rekey_page_ids(missing_pages, _canon)
                shell = {**shell, "navItems": rekey_page_refs(shell.get("navItems") or [], _canon)}
                if isinstance(style_brief, dict) and isinstance(style_brief.get("pages"), dict):
                    style_brief = {
                        **style_brief,
                        "pages": rekey_page_map(style_brief["pages"], _canon),
                    }
                # ⚠ 2026-08-28：rekey 只换 dict 键，改不到已经烧进 HTML 的
                #   `data-page-id`。真机（sr-20260827191954 药房、
                #   sr-20260827201847 巡检）页键成了语义 id、孔还是 p1..p4，
                #   宿主 resolveActivePageId 静默回落——四个菜单项全点不动，
                #   且没有任何一处报错。
                #
                #   别名表（friendly_id History）救存量 / 直播。2026-09-09
                #   再废一次：新生成这一份必须同时改孔，别名被某一跳抹掉
                #   时菜单还能点。上面 rewrite_html_page_ids 就是改孔；
                #   别名照记，两手都做。
                _page_id_aliases = {**_page_id_aliases, **_canon}
                # ⚠ 落库那份救的是**刷新之后**的宿主；正在看直播的前端一个字
                #   都收不到——它按 pageId 认卡，第 6.5 步那批新 id 到达时会
                #   认成六个新页面，画布就成了 12 张卡对应 6 页
                #   （真机 sr-20260906111901）。所以改名要在**这一刻**同时
                #   推给流。两个消费者、同一件事实，写在一处别拆开。
                #
                # ⚠ 顺序不是靠这里"发得早"约定出来的，是靠**同一条队列**：
                #   驱动器把改名和页面塞进同一个 _page_q（见那边的头注），
                #   而第 6.5 步的重发还在后头，先后由队列本身保证。
                st["pageIdRenamesEmitted"] = _emit_page_renamed(_canon)
                st["pageIdCanonicalized"] = len(_canon)
                print(
                    "[spec_first_pipeline] 首轮页面包改键（草稿 id → 模型 id）："
                    + "、".join(f"{o}→{n}" for o, n in list(_canon.items())[:6])
                )
        stages["structure"] = dict(st)

    # ── 第 5 / 6 步：page-only 时权限流程直接沿用，不先做再盖 ───────
    model: Optional[Dict[str, Any]] = None
    semantics: Dict[str, Any] = {}
    _page_only = (
        refine
        and page_only_shortcircuit_enabled()
        and _graph_took_over
        and is_page_only_verdict(_graph_verdict)
    )
    if _page_only:
        overlay = overlay_page_only_model(reuse_model, structure)
        gate = _assemble_gate_fn()(overlay) if overlay else {"passed": False}
        if overlay and gate.get("passed"):
            model = overlay
            _held_semantics = True
            _held_assemble = True
            semantics = {"reused": True}
            with _stage("specfirst.semantics") as st:
                st["skipped"] = "page-only"
                st["reused"] = 1
            stages["semantics"] = dict(st)
            with _stage("specfirst.assemble") as st:
                st["skipped"] = "page-only"
                st["mechanical"] = 1
                st["ok"] = 1
            stages["assemble"] = dict(st)
        else:
            _safe_print(
                "[spec_first_pipeline] ⚠ page-only 沿用过不了闸，回落语义+汇合"
            )

    if model is None:
        # ── 第 5 步：(结构 + SPEC) → 权限 / 工作流 / 不变式 ───────────────
        # ⚠ 两个输入都要。三臂对照实测：只有 SPEC 会编出结构里没有的对象；
        #   只有结构会把多类使用者塌成一个角色。B 是唯一过闸的那一臂。
        if (not _skip_after_assumptions) and plan.includes("specfirst.semantics"):
            raise_if_cancelled("第5步 推导语义")
        if (not _skip_after_assumptions) and plan.includes("specfirst.semantics"):
            with _stage("specfirst.semantics") as st:
                semantics_model = derive_semantics(
                    structure, spec, llm_json_fn=llm_json_fn, prev_ids=_prev_ids
                )
                semantics = (
                    semantics_model.model_dump(mode="json")
                    if hasattr(semantics_model, "model_dump")
                    else semantics_model
                )
                st["roles"] = len(semantics.get("roles") or [])
                st["nodes"] = len(semantics.get("workflowNodes") or semantics.get("nodes") or [])
            stages["semantics"] = dict(st)

        # ── 第 6 步：汇合 → 完整六段 → 过结构闸 ─────────────────────────
        if (not _skip_after_assumptions) and plan.includes("specfirst.assemble"):
            raise_if_cancelled("第6步 汇合过闸")
        if (not _skip_after_assumptions) and plan.includes("specfirst.assemble"):
            with _stage("specfirst.assemble") as st:
                assembled = assemble(structure, semantics, spec, llm_json_fn=llm_json_fn)
                model = assembled.get("model") if isinstance(assembled, dict) else assembled
                if not isinstance(model, dict):
                    raise SpecFirstError("第 6 步没有产出模型")
                st["ok"] = 1
            stages["assemble"] = dict(st)

    _stamp_preferred_device(model, device)

    # ── 第 6.2 步：精修时，指令没点名的段沿用上一版 ─────────────────
    #
    # ⚠ 位置很要紧：必须在**这个** model 上做，不是在别处。2026-08-16 同一件事
    #   打偏过三次，全是改在没通电的那一步上（闭环重建、提示词收尾、老生成器）。
    #   这里是 assemble 的出口，也是下面 bind / 落库 / 精修回流拿到的同一份对象——
    #   接线由 tests/test_refine_segment_reuse.py 端到端钉住（跑真实控制流，非 mock）。
    #
    # 放在 bind 之前：bind_pages 要用 model 打孔，让它看到最终那份，别打完再换。
    # ⚠ 2026-09-04 真机（社区老年助餐点 sr-20260903232557）：这里要防 model 为 None。
    #   「一跳一件」的精修是 pages 单跳（`capabilityPlan tools=pages`），
    #   assemble 被 `plan.includes("specfirst.assemble")` 挡在门外**根本不跑**，
    #   于是 model 一路保持 :2103 的初值 None（返回处 `"model": model` 本来就
    #   允许单跳不产模型）。`apply_refine_segment_reuse(None, …)` 原样返回 None，
    #   下面那个 listcomp 的 `model.get(seg)` 当场炸：
    #
    #       spec_first_pipeline.py:2188 in <listcomp>
    #       AttributeError: 'NoneType' object has no attribute 'get'
    #
    #   后果不是报错而是**静默**：宽 except 把它吃成一句「spec-first 失败」，
    #   控制面接着打「refine failed, keeping previous model（本轮修改未生效）」。
    #   用户改一处、等几分钟、页面原样——真机上连着三次都是这样。
    #
    #   段沿用是**增强类**，它自己的文档串写着 fail-open（纪律七）：
    #   「把它写成 fail-closed 会让一次本来能跑完的推演直接崩掉」。本轮没有
    #   模型就没有段可沿用，跳过即可，不该把整条链带走。
    #   同文件里 `_stamp_preferred_device`（:1265）和
    #   `freeze_pages_in_model`（page_id_freeze:220）用的都是这个守卫，
    #   本处是唯一漏掉的一个。
    if refine and refine_reuse_enabled() and isinstance(model, dict):
        model = apply_refine_segment_reuse(
            model,
            reuse_model,
            (spec or {}).get("refineScope"),
            gate_fn=_assemble_gate_fn(),
        )
        stages["refineReuse"] = {
            "scopeDeclared": (spec or {}).get("refineScope") is not None,
            "reused": [
                seg
                for seg in REFINE_REUSABLE_SEGMENTS
                if isinstance(reuse_model, dict)
                and model.get(seg) is not None
                and model.get(seg) == (reuse_model or {}).get(seg)
            ],
        }

    # 汇合出口再拨一次：assemble / 段沿用都可能把 landingPageRef 写成
    # 本轮漂过的 id。第 2 步已经拨过 SPEC，这里守模型侧引用。
    if refine and _freeze_on and isinstance(reuse_model, dict):
        model, _model_freeze = freeze_pages_in_model(model, reuse_model)
        log_freeze(_model_freeze, where="第6步 assemble")

    # ── 第 6.3 步：断线体检（零 LLM，只报不拦）───────────────────────
    #
    # ⚠ 2026-08-19：体检必须在第 6.5 步打孔**之后**。打孔前按模型网报
    #   page:p3「一个实体都没绑」——那页指南只有 data-record，覆盖闸已经
    #   认孔。绑实体和覆盖闸不是同一件事。实现见 bind 之后那一段。

    # ── 第 6.5 步：给 HTML 打 data-* 孔 ─────────────────────────────
    # ⚠ 到这里实体与字段才定死校验过，孔才打得成。第 3 步打不了——
    #   那时 datamodel 还不存在，写 data-field 是引用没被发明的 id。
    bound_failed: Dict[str, Any] = {}
    if bind_html and (not _skip_after_assumptions) and plan.includes("specfirst.bind"):
        raise_if_cancelled("第6.5步 打绑定孔")
        with _stage("specfirst.bind") as st:
            before_bind = dict(pages)
            # ★ 局部打孔（2026-08-18）：照搬页的 HTML 就是上一版**打过孔的**
            #   交付页（reuse_pages 的来源），id 冻结 + 第 6.2 步段沿用保证它
            #   引用的字段/权限 id 这轮还在——输入没变就不重打，直接沿用上次
            #   产物。形状对齐 Turborepo cache-hit（指纹没变 → skip + replay）。
            #   bind 是全链最贵的一步（真机 46~72s），此前每轮对照搬页也全量
            #   重打（2026-08-18 宠物医院第三轮：4 页里 3 页原样照搬，bind
            #   照样打满 4 页、71.9s）。
            # ⚠ fail-open：开关关掉、非精修、照搬集为空，都回到全量打孔。
            # ⚠ 已知让步：第 3.5 步外壳统一可能把照搬页壳里的 data-* 抹掉
            #   （34 份里 12 份壳里有 data-*），全量重打会补回来，局部打孔
            #   不会。真机验证时要看照搬页渲染后的 DOM，不看源码（纪律五）。
            _partial_on = str(
                os.environ.get("SLIDERULE_REFINE_PARTIAL_BIND", "1")
            ).strip().lower() not in _env_flags.OFF
            _skip_bind = (
                pages_to_skip_bind(
                    pages, refine=True, reuse_ids=_reuse_now.keys()
                )
                if _partial_on
                else set()
            )
            to_bind = {pid: h for pid, h in pages.items() if pid not in _skip_bind}
            bound = bind_pages(to_bind, model, product_archetype=arch)
            if bound.get("pages"):
                # ⚠ 必须合并回全集：bound 只有重打的那几页，直接整份替换会把
                #   照搬页从交付里弄丢——那是"省了打孔、赔了页面"。
                pages = {**pages, **dict(bound["pages"])}
            bound_failed = dict(bound.get("failed") or {})
            st["bound"] = len(bound.get("pages") or {})
            st["failed"] = len(bound_failed)
            st["bindSkipped"] = len(_skip_bind)
            if _skip_bind:
                print(
                    f"[spec_first_pipeline] 局部打孔：{len(_skip_bind)} 页沿用上一轮"
                    f"打孔结果，只重打 {len(to_bind)} 页"
                )
            # ★ 把 bind 改坏的壳换回打孔前那份（2026-08-15）。
            #
            # 3.5 步已经把壳统一好了，bind 又给弄乱——八趟八次，最狠一次是
            # 同一个应用两个产品名两套菜单。打孔前那份是**已知正确**的，
            # 直接换回来，不用再问模型。
            # ⚠ 只还原**结构被改**的；bind 往壳里打的合法绑定孔要保留
            #   （实测 34 份里 12 份壳里有 data-*）。判定见 restore_shell_after_bind。
            # ⚠ 还要把内容区偏移重新对齐一遍：bind 重写整页时会把 <main> 上的
            #   ml-64 一起吃掉，而还原那一步只管 aside/header。真机（律所那趟）
            #   4 页里 2 页被吃，判据报了但没人修——见 repair_pages_after_bind。
            pages, restored, reconciled = repair_pages_after_bind(
                pages, before_bind, device=device
            )
            st["shellRestored"] = len(restored)
            st["mainReconciled"] = len(reconciled)
            if restored:
                print(f"[spec_first_pipeline] 打孔后外壳被改，已还原：{'、'.join(restored)}")
            if reconciled:
                print(f"[spec_first_pipeline] 打孔后内容区偏移已重新对齐：{'、'.join(reconciled)}")
            # bind 常整页重写，head 里的语义色会被吃掉。还原壳只管
            # aside/header，主题 CSS 要再钉一次，否则用户看到的成品页又漂。
            if _theme_lang is not None:
                try:
                    from .theme_tokens import apply_theme_to_pages

                    pages = apply_theme_to_pages(pages, _theme_lang)
                except Exception as exc:  # noqa: BLE001 — 钉色是增强
                    _safe_print(
                        f"[spec_first_pipeline] ⚠ 打孔后主题锁定失败（不拦）：{str(exc)[:200]}"
                    )
            # bind 整页重写会把 src 改回占位或默写番茄图，按 alt 再换一次。
            # 照搬页上一轮已经换过，跳过以免重复打 Openverse。
            pages = {
                pid: html if pid in _skip_bind else _fill_html(html)
                for pid, html in pages.items()
            }
            # ★ 块身份重打（2026-08-27）：bind 常整页重写，3.5 步打的
            #   data-block 会跟主题色一起被吃掉。函数幂等——标还在的页面
            #   一个字节都不动，名字也不会换人（换了等于用户选中的块换了人）。
            try:
                from .page_blocks import mark_pages_blocks, scan_blocks

                pages = mark_pages_blocks(pages)
                st["blocks"] = sum(len(scan_blocks(h)) for h in pages.values())
                _safe_print(
                    f"[spec_first_pipeline] 块身份（打孔后）：{st['blocks']} 块 / {len(pages)} 页"
                )
            except Exception as exc:  # noqa: BLE001 — 同上，fail-open
                _safe_print(f"[spec_first_pipeline] ⚠ 块身份重打失败（不拦）：{str(exc)[:200]}")

            # 还原之后再量一次：剩下的才是还原不了的（比如两页壳本来就不同源）。
            drift = check_shell_consistency(pages, spec, device=device)
            st["shellProblems"] = len(drift)
            for p in drift[:3]:
                print(f"[spec_first_pipeline] 打孔后外壳漂移：{p['path']} — {p['message']}")
        stages["bind"] = dict(st)

        # 打完孔的成品页重发（bound=True）：前端徽标从「尚未接数据」翻成
        # 「已接数据」，不用等交付那一刻的 finalState。
        _reemit_pages(sink, pages, bound=True, binding_status=page_bind_status(pages, True, bound_failed))

    # 断线体检：闸查悬空引用，体检查反面「东西在不在网里」。
    # 必须在打孔 + 外壳还原之后——量用户看见的孔，不量打孔前的模型网。
    # 精修轮新增/存量分开（SonarQube / betterer baseline-ratchet）。
    # 只报不拦（纪律七），体检自己炸了也 fail-open。
    try:
        from .app_graph import build_app_graph as _bag
        from .app_graph import find_orphans as _fo

        _cur_orphans = _fo(_bag(model), page_html=pages)
        _baseline_known = bool(refine) and isinstance(reuse_model, dict)
        _prev_html = reuse_pages if _baseline_known else None
        _prev_keys = (
            {o["key"] for o in _fo(_bag(reuse_model), page_html=_prev_html)}
            if _baseline_known
            else set()
        )
        _fresh = [o for o in _cur_orphans if o["key"] not in _prev_keys]
        _stale = [o for o in _cur_orphans if o["key"] in _prev_keys]
        stages["orphans"] = {
            "total": len(_cur_orphans), "new": len(_fresh), "stale": len(_stale),
            "baseline": _baseline_known,
        }
        if _fresh:
            _head = "、".join(f"{o['key']}（{o['reason']}）" for o in _fresh[:5])
            _label = "这次修改新产生" if _baseline_known else "交付的应用带着"
            _emit_quality_notice(
                "orphan",
                f"{_label} {len(_fresh)} 个孤岛：{_head}",
                items=_fresh[:8],
            )
        if _stale:
            _emit_quality_notice(
                "orphan_stale",
                f"存量孤岛 {len(_stale)} 个（上一版就有，非本次造成）",
                items=_stale[:8],
            )
    except Exception as exc:  # noqa: BLE001 — 体检是增强类，不许拦交付
        _safe_print(f"[spec_first_pipeline] ⚠ 断线体检自己失败了（不拦交付）：{str(exc)[:200]}")

    # 挂进 model：它是唯一被落库、也是精修时回流的那份。
    if isinstance(model, dict):
        if design_language:
            model["designLanguage"] = design_language
        if style_brief:
            model["styleBrief"] = style_brief

    # ── 交付前对账：页面包的键 == 模型的页面 id（2026-08-24）─────────
    #
    # 这条不变式是**下游一切按页面 id 取东西的前提**，而在这次修复之前全仓
    # 没有一处校验它，首轮也一直不成立。坏起来全是静默的：下一轮照搬集为空
    # （全量重写）、bind 的流程判定恒 False、按 landingPageRef 取页取不到——
    # 没有一处报错，判据全绿。
    #
    # 只报不拦（纪律七）：错位时端出去仍好过整轮作废——前者是"下一轮多花
    # 40 秒重画"，后者是"这一轮白跑"。但**必须吵**，否则下一个漏改载体的人
    # 还得靠三轮真机对照才查得出来。
    _pm_ok, _pm_only_pages, _pm_only_model = pages_match_model(pages, model)
    stages["pageIdMatch"] = {
        "ok": _pm_ok,
        "onlyPages": _pm_only_pages[:6],
        "onlyModel": _pm_only_model[:6],
    }
    if not _pm_ok:
        _safe_print(
            "[spec_first_pipeline] ⚠ 页面包的键与模型页面 id 对不上——"
            f"只有页面包有 {_pm_only_pages[:6]}，只有模型有 {_pm_only_model[:6]}。"
            "下一轮的照搬会落空（全量重写）、bind 的流程判定会恒 False。"
            "多半是新增了一个按页面 id 索引的载体、忘了跟第 4.5 步一起改键。"
        )

    _redrawn_ids = [pid for pid in pages if pid not in _reuse_now]
    _refine_reuse_note = format_refine_reuse_note(
        redrawn_ids=_redrawn_ids,
        reused_count=len(_reuse_now),
        held_spec=_held_spec,
        held_semantics=_held_semantics,
        held_structure=_held_structure,
        page_names=page_names_from_spec_or_model(spec, reuse_model),
    )
    if _refine_reuse_note:
        print(f"[spec_first_pipeline] 精修短路：{_refine_reuse_note}")

    result = {
        "version": SPEC_FIRST_VERSION,
        "model": model,
        "spec": spec,
        "refineReuseNote": _refine_reuse_note,
        # ⚠ designLanguage 同时**挂进 model**（见下面那行）而不是只放在这里：
        #   model 是唯一被落库的那份（app_store 的 model_json），也是精修时
        #   回流的那份（refine_ctx["model"]）。只放返回值里的话，谁都不会存它
        #   ——真机验过：唯一的调用方只取 result["model"]。
        "structure": structure,
        "semantics": semantics,
        "pages": pages,
        "navItems": shell.get("navItems") or [],
        "failedPages": {**failed, **bound_failed},
        # SPEC 声明了、最终没交出来的页。**空列表和缺这个键是两回事**：
        # 空 = 对过账、一页不缺；缺键 = 老产物，没对过账。所以恒给出来。
        "missingPages": missing_pages,
        "declaredPages": spec_pages_declared,
        # 页面 id 别名表（旧 → 新）。见第 4.5 步那段事故记录。
        "pageIdAliases": dict(_page_id_aliases),
        "designLanguage": design_language,
        "stages": stages,
        "device": device,
    }
    try:
        from .spec_page_html import guidelines_gate_notes as _ggn

        for _pid, _html in (pages or {}).items():
            for _note in _ggn(str(_html or ""), product_archetype=str(product_archetype or "")):
                if "对比" in _note:
                    _emit_quality_notice(
                        "contrast",
                        f"页面 {_pid}：{_note}",
                        # 页面名同时给成字段：流级去重要靠它认「这条说的是哪一页」。
                        pageId=str(_pid),
                    )
    except Exception:  # noqa: BLE001 — 对比是增强类
        pass
    _notices = list(_quality_notices_var.get() or [])
    stages["qualityNotices"] = _notices
    result["qualityNotices"] = _notices
    from .capability_plan import assert_stages_match_tools as _assert_stages

    _assert_stages(plan.tools, stages, refine=bool(refine))
    try:
        _quality_notices_var.reset(_quality_token)
    except Exception:
        _quality_notices_var.set(None)
    # 顺路把页面留给调用方落库（见 take_last_pages 的说明）。
    # ⚠ 只在**整条链跑成**之后写：中途抛 SpecFirstError 时这里根本不执行，
    #   于是暂存里不会留下半份产物冒充成品。
    # ⚠ 2026-09-07 真机 sr-20260907112112：本跳 tools=pages，specfirst.bind
    #   根本没进计划。落库却把 bind_html 开关（默认 True）当成「打孔跑过了」，
    #   6 页 pageBindStatus 全是 bound，HTML 里一个 data-rows 都没有。
    #   bind_html 是「这条管道允许打孔」，不是「这一跳真的打了」。
    bind_ran = "bind" in stages
    _last_pages_var.set({
        "version": SPEC_FIRST_VERSION,
        **({"assumptionsConfirmed": False} if _skip_after_assumptions else {}),
        "spec": dict(spec) if isinstance(spec, dict) else None,
        "pages": dict(pages),
        "navItems": list(result["navItems"]),
        "boundPages": count_bound_pages(pages, bind_ran, bound_failed),
        "pageBindStatus": page_bind_status(pages, bind_ran, bound_failed),
        "failedPages": dict(result["failedPages"]),
        # ★ 设计段随载体回流（2026-08-18）。此前只挂在 model 上，而精修回流的
        #   模型是 extract_model_from_closure 从闭环证据拼的**六段**——应用级
        #   附加键天生被剥掉，styleBrief 的沿用接线从出生起没通过电：真机三轮
        #   specfirst.design 全是 mode=llm 重新生成，「精修沿用上一版风格段」
        #   一次没打。载体走 state.specFirstPages（随会话持久化、随版本快照
        #   回退），合回模型的动作在 v5_full_driver.refine_model_of。
        "styleBrief": dict(style_brief) if isinstance(style_brief, dict) else None,
        "designLanguage": dict(design_language) if isinstance(design_language, dict) else None,
        # 交付对账结果一并落库：**刷新之后仍然说得出"这个应用少了一页"**。
        # 只留在日志里等于只有当场看着的人知道，第二天打开应用中心的人不知道。
        "missingPages": list(missing_pages),
        "declaredPages": list(spec_pages_declared),
        # 页面 id 别名表随页面载体落库——**必须走这条**，不能只放 result 里：
        # 宿主刷新之后唯一的来源就是 state.specFirstPages（跟 styleBrief 同一条
        # 教训，那次只挂在 model 上，精修回流被剥成六段，接线从出生起没通电）。
        "pageIdAliases": dict(_page_id_aliases),
        # 前端（直播舞台/应用中心）拿它选画布视口：desktop 横屏 / phone 竖屏
        "device": device,
        # 左栏收口句。执行器只取 result["model"]，这句话走页面载体，
        # 闭环白名单再投影一次（跟 refinePaintNote 同一条路）。
        "refineReuseNote": _refine_reuse_note,
        "qualityNotices": list(_notices),
        # 控制面收尾读这一跳真正跑过的 tools，不许靠「有没有旧页面」猜。
        "capabilityPlan": dict(stages.get("capabilityPlan") or {}),
    })
    return result
