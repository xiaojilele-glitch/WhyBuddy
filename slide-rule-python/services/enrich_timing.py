"""体验层（ENRICH）各阶段的耗时埋点。

## 为什么要有这个模块

在这之前，enrich_identity_theme / enrich_freeform_blocks /
enrich_monitor_page_overviews 三段**只在失败或撞预算时才 print**，成功路径
完全静默。代价是：想知道"一轮推演的 7 分钟花在哪"，只能人肉在本地拿秒表量，
生产环境根本量不到——拉过一次 Render 生产日志核实，1000 行里 902 行是
`GET /health`，应用侧有效日志只有 4 行，各阶段耗时一个数都没有
（见 docs/enrich-pipeline-parallelization-audit-2026-07-31.md「十、2」）。

这直接卡住了并行化改造：没有埋点，就无法验收"并行之后到底快了多少"，
只能靠感觉。所以埋点要排在并行化之前做。

## 输出形态：单行 key=value，一条一个事件

    [enrich-timing] stage=monitor.sheet ms=84702 ok=1 page=p_home device=desktop

选这个形态而不是 JSON 或多行表格，理由是它同时满足三件事：
  · grep 得出来  —— `grep '\\[enrich-timing\\]'` 就是完整的基线数据集
  · 机器解析简单 —— 空格切分再按 `=` 切，不需要 JSON 解析器
  · 人眼扫得动   —— 混在 uvicorn 访问日志里也一眼能认出来

## ⚠ 读这几个字段之前先看这里：`attempts` 是**预算**，`used` 才是**次数**

    [enrich-timing] stage=model.generate ms=201096 ok=1 attempts=2 current=1 total=1 used=1
                                                       ↑ 允许最多重试到 2 次   ↑ 实际只用了 1 次

`attempts` 由调用方在**进入阶段之前**填，是"这一段最多允许试几次"的配置
（v5_llm_generate.py：`attempts = 1 if use_parallel else 2`），**跟这一趟发生了
什么无关**——不管成功还是失败，它恒等于那个配置值。真正"试了几次"记在 `used`
里，由重试循环在成功时写入（`_st["used"] = attempt + 1`）。

2026-08-11 有人（我）连着六趟把 `attempts=2` 读成了"每趟都重试了一次"，据此
推断"每次生成白花一倍时间"，还论证了"这不是网关抖动，因为抖动会有成功有失败"
——听着挺像回事，而**同一行里 `used=1` 一直写着答案**，七趟全是 1，即每趟都是
第一次就成功。结论完全相反，白查一轮。

所以两条约定：
  · **`used` 缺席不等于只试了一次**。它只在成功分支写入；整段失败时没有这个
    字段，那种情况看 `ok=0` 和上面的 `[v5_llm_generate] attempt i/n raised:` 行。
  · **想统计重试率，grep `used=`，不要 grep `attempts=`。** 后者数出来的是
    "有多少段配置了重试预算"，不是"有多少段真的重试了"。

## 纪律：埋点绝不能改变被测链路的行为

这是这个模块最重要的约束，两条：

① **异常必须原样抛出**。ENRICH 全程 fail-open，上游靠 `except
   FreeformGenerationError` 把失败的区块摘掉。计时器如果吞掉异常，
   等于把"这块生成失败了"变成"这块生成成功但内容是空"，比不埋点糟得多。
   所以 `finally` 里只记录，异常照常向上传。

② **记录自身出任何问题都必须静默**。一个测量工具把它measure 的流水线
   搞崩，是最没道理的失败方式。`_emit` 整个包在 try/except 里。

## 并发安全

只做"每个事件打一行"，不做任何累加，因此没有跨线程共享的可变状态——
这是刻意的：下一步就是把这条链路并行化（同上文档「八、7」），任何
"边跑边累加"的计数器到那时都会变成竞态（预算笼子已经踩过这个坑，
见 freeform_block.py 里 ref_used/shot_used 那段注释）。

单行输出用一次 print 完成，并发下最多是行与行之间交错，不会出现半行。
每条事件自带 page/block 字段，交错了也能归位。
"""

from __future__ import annotations

import os
import time
from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Any, Iterator
from . import env_flags as _env_flags

_LOG_PREFIX = "[enrich-timing]"

# 关掉埋点的逃生口。默认**开**——这个模块存在的全部理由就是成功路径原本
# 没有任何输出；默认关掉等于白写。噪音敏感的场景（比如批量跑夹具再生成）
# 可以设 0 关掉。
_ENABLED_ENV = "SLIDERULE_ENRICH_TIMING"
_RUN_BUDGET_ENV = "SLIDERULE_RUN_BUDGET_SECONDS"

#: 一趟推演的总时长预算。**只约束 fail-open 的视觉增强**（首页版式、取色、
#: 参照图），不会中断已经过结构闸的业务模型、权限和流程——预算耗尽的表现是
#: "没有版式设计"，不是"推演失败"。
#:
#: 2026-08-07 由 540 上调到 1080（用户裁决 "×2"）。
#:
#: 起因是一趟真实推演（连锁药房处方与库存协同，用户账号实跑）：
#:
#:     stage=model.generate  ms=532765   ← 8.9 分钟，一项吃掉 540 的 99%
#:     stage=monitor.design  ms=0  got=0  skippedReason=deadline
#:
#: 剩给视觉增强 7 秒，版式设计整段跳过，首页退回固定骨架。
#:
#: 要紧的是这个关系是**反向**的：话题越复杂 → 模型生成越久 → 越没预算做版式
#: → 首页反而越简陋。对照另一次实测（社区健身房）模型生成 145s，剩 190s；
#: 药房这种重话题 533s，剩 7s。越值得好好呈现的应用，呈现得越差。
#:
#: ⚠️ 这里**不是** Contract 的问题。Contract 只存在于并行生成那条路
#: （v5_parallel_generate），而并行默认是关的（SLIDERULE_PARALLEL_MODEL_GENERATION
#: 缺省 "off"，见那个文件里记录的实测：并行 569.6s/738.0s 全失败 vs 串行
#: 236.0s 成功）。本轮日志 `attempts=2` 即证明走的是串行分支
#: （`attempts = 1 if use_parallel else 2`）。533 秒就是"一次性生成完整五系统
#: 模型"本身的耗时。
#:
#: 调大预算是对症的止血，不是根治：真正的治法是把生成本身变快（分段流式落地、
#: 或让视觉增强脱离这条同步预算异步补）。在那之前，1080 让重话题也能走完版式
#: 那一段——按上面两次实测，533 + 280（版式门槛）= 813 < 1080，留了余量。
_DEFAULT_RUN_BUDGET_SECONDS = 1080
_run_deadline: ContextVar[float | None] = ContextVar("sliderule_run_deadline", default=None)


def run_budget_seconds() -> int:
    raw = (os.getenv(_RUN_BUDGET_ENV) or "").strip()
    try:
        value = int(raw) if raw else _DEFAULT_RUN_BUDGET_SECONDS
    except ValueError:
        value = _DEFAULT_RUN_BUDGET_SECONDS
    return value if value > 0 else _DEFAULT_RUN_BUDGET_SECONDS


def begin_run_budget(*, seconds: float | None = None) -> Token:
    budget = float(run_budget_seconds() if seconds is None else seconds)
    return _run_deadline.set(time.perf_counter() + max(0.0, budget))


def reset_run_budget(token: Token) -> None:
    _run_deadline.reset(token)


def remaining_run_budget_seconds() -> float | None:
    deadline = _run_deadline.get()
    if deadline is None:
        return None
    return max(0.0, deadline - time.perf_counter())


def timing_enabled() -> bool:
    raw = (os.getenv(_ENABLED_ENV) or "").strip().lower()
    if raw in _env_flags.OFF:
        return False
    return True


def _fmt_value(v: Any) -> str:
    """字段值扁平化成不含空格的 token——空格会破坏"空格切分"这个解析约定。"""
    s = "" if v is None else str(v)
    s = s.replace(" ", "_").replace("\n", "_").replace("\t", "_")
    return s or "-"


#: 可选的**实时**阶段观察者（2026-08-04）。
#:
#: 埋点原本只在阶段**结束**时 print 一行——做基线够用，但对着屏幕等的人拿不到
#: 任何东西。真机量到：体验层那三段（生参照图 104.9s + 读配色 19.1s + 设计版式
#: 59.5s）在 SSE 上是一个 165.8 秒的洞，比选材那六段加起来还长，而且正好落在
#: 用户最没耐心的位置——已经等了七八分钟、眼看要出结果了，突然黑三分钟。
#:
#: 所以补一条 sink：阶段**开始**时也叫一声，让驱动器能把它转成 SSE。
#:
#: ## 2026-08-11：从模块级全局改成 ContextVar —— 这是个实测到的串流 bug
#:
#: 原注释写的是「注册是模块级单例，跟 capability delta sink 同一套约定」。
#: **那个约定在两天后（08-06，ea169243e）就被判定为并发 bug 改掉了，这一处没跟上。**
#: 于是同一个病在这儿又活了五天。
#:
#: 线上 5 趟并发实测（同一道题）照出来的形状：
#:
#:     第 4 趟的 SSE 流里收到 4 个不同会话的 pageId
#:       community_overview(第4趟自己) / operations_monitor(第1趟)
#:       / operations_overview(第2、3趟) / home_monitor(第5趟)
#:     以及 5 个 model.generate 完成事件（109.6/137.3/173.6/160.6/191.1 秒）
#:       —— 一趟推演只生成一次模型，那是五趟各自的耗时全挤进了一条流
#:     对称地：第 1、2、3、5 趟的流里 stage 事件与心跳**一条都没有**
#:
#: 三层后果，按严重程度：
#:   ① 5 个人同时用，**4 个人的进度条完全不动**（心跳正是防"以为断线"的机制）
#:   ② 泄漏事件带的是**接收方的 runId**，按 runId 归因的分析在并发下全错
#:      —— 排查这个 bug 时我自己先被骗了一次，差点报出"第4趟重生成了5次"
#:   ③ pageId 是别人会话生成的页面名，多租户下是**跨用户信息泄漏**
#:
#: 改法与 ea169243e 完全一致：请求域 ContextVar。`copy_context()` 会把它带进
#: `asyncio.to_thread` 的 worker（与 OpenTelemetry 的 context.attach() 同一套语义），
#: 而普通模块级全局是 copy_context 救不了的——那正是上次的原话。
#:
#: ⚠ 纪律不变：sink 自身出任何问题都必须静默，绝不能把被测流水线搞崩。
_stage_sink_var: ContextVar[Any] = ContextVar("sliderule_stage_sink", default=None)
_active_stage_var: ContextVar[str] = ContextVar("sliderule_active_stage", default="")


def current_stage_name() -> str:
    """当前 `stage()` 块的名字。用量台账拿它当 capabilityId；没进块则空串。"""
    return _active_stage_var.get() or ""


def set_stage_sink(fn: Any) -> None:
    """注册/注销阶段观察者。fn(phase, name, fields) —— phase 是 "start"/"end"。

    请求域：本次流设的 sink 只有本次流看得见，并发的别的流互不影响。
    """
    _stage_sink_var.set(fn)


def stage_sink_scope(sink):
    """装了自带卸的写法（抄 grok 的 SinkGuard，见 sliderule_llm/scoped.py）。

    调用方优先用这个，别用上面那个裸 setter——裸 setter 要人肉记得去别处
    补一行卸载，而且卸成 None 而不是还原成原来那个。
    """
    from sliderule_llm.scoped import sink_scope

    return sink_scope(_stage_sink_var, sink)


def _notify(phase: str, name: str, fields: dict[str, Any]) -> None:
    fn = _stage_sink_var.get()
    if fn is None:
        return
    try:
        fn(phase, name, fields)
    except Exception:  # noqa: BLE001 — 观察者出问题不该影响被观察的链路
        pass


def _emit(stage_name: str, ms: int, ok: bool, fields: dict[str, Any]) -> None:
    """打一行。自身任何异常都吞掉——测量工具不该把被测流水线搞崩。"""
    try:
        if not timing_enabled():
            return
        parts = [f"{_LOG_PREFIX} stage={_fmt_value(stage_name)}", f"ms={ms}", f"ok={1 if ok else 0}"]
        for k, v in fields.items():
            if v is None:
                continue
            parts.append(f"{_fmt_value(k)}={_fmt_value(v)}")
        # 一次 print 打完整行：并发下只会整行之间交错，不会出现半行。
        print(" ".join(parts))
    except Exception:  # noqa: BLE001 — 埋点自身绝不能影响主链路
        pass


@contextmanager
def stage(name: str, **fields: Any) -> Iterator[dict[str, Any]]:
    """给一段耗时操作计时，退出时打一行。

    yield 出来的 dict 可以在块内继续塞字段——有些信息要跑完才知道
    （比如这次到底用没用参照图、命中了几个节点）：

        with stage("monitor.design", page=pid) as st:
            content = generate_freeform_block(...)
            st["nodes"] = count_nodes(content)

    异常照常向上抛（只是顺手记成 ok=0），fail-open 的语义由调用方保持不变。
    """
    started = time.perf_counter()
    extra: dict[str, Any] = {}
    ok = True
    stage_token = _active_stage_var.set(name)
    _notify("start", name, dict(fields))
    try:
        yield extra
    except BaseException:
        ok = False
        raise
    finally:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        merged = {**fields, **extra}
        _notify("end", name, {**merged, "ms": elapsed_ms, "ok": ok})
        _emit(name, elapsed_ms, ok, merged)
        _active_stage_var.reset(stage_token)
