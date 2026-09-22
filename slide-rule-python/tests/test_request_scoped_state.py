"""生成链路的请求域状态不能是模块级全局 —— 串了会泄漏别人的内容。

## 这组测试为什么存在

2026-08-06 审查并行化改动（8f93d12）时，用并发探针实测出三处模块级全局在
多租户下互相串。并行化本身没错——它用 `copy_context()` 把 ContextVar 传进
worker，与 OpenTelemetry 的 `context.attach()` 同一套语义。错的是它下面压着
的这几个普通全局，`copy_context` 救不了。

实测到的后果，逐条：

  · _delta_sink       两个并发流式推演，后到的把先到的 sink 顶掉 ——
                      **用户 A 生成的内容实时出现在用户 B 的页面上**，
                      A 自己那边一片空白。跨用户内容泄漏。
  · _installed_skills A 装的技能没进 A 的生成，B 的技能进去了。
  · _last_call_error  三个并行 worker 抢同一个格子，报错张冠李戴
                      （datamodel 挂了却报 rbac 挂了）。

## 为什么其中一个必须存「可变容器」

`copy_context()` 复制的是 ContextVar 的**值**——worker 里 `var.set(x)` 不会
回传给父线程。这对 sink / skills 无所谓（父设、子读），但 _last_call_error
恰恰是 worker 写、主线程读，存值会让主线程永远读到空。

所以它存的是一个**可变 dict 的引用**：父子共享同一个 dict，worker 改得动、
主线程看得见；不同请求各拿各的 dict，天然隔离。这一招有两个成熟出处——
OpenTelemetry 的 Span（ContextVar 存 Span 引用，子任务改属性父任务读得到）
与 asgiref.local._CVar（ContextVar 存 _Storage，真数据在 _Storage.data 里）。
"""

import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import enrich_timing as ET
from services import v5_capability_executor as EXEC
from services import v5_llm_generate as G
from sliderule_llm import capabilities as CAPS


def _run_two_requests(body):
    """两个请求同时到达：都设完各自的状态，再各自去读。

    Barrier 保证"都设完"这个时序——这正是原 bug 的触发条件，
    不同步的话第二个请求可能在第一个读完之后才设，测不出来。
    """
    barrier = threading.Barrier(2)
    out = {}

    def one(name):
        # 每个请求跑在自己的 context 里——真实链路是 Starlette 的
        # run_in_threadpool，每次调用一个独立 context。
        ctx = copy_context()
        ctx.run(body, name, barrier, out)

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(one, ["A", "B"]))
    return out


def test_generate_delta_sink_does_not_leak_across_requests():
    """最严重的一条：A 的生成内容不能出现在 B 的流里。"""
    received = {"A": [], "B": []}

    def body(name, barrier, _out):
        G.set_generate_delta_sink(lambda chunk, n=name: received[n].append(chunk))
        barrier.wait()
        time.sleep(0.02)
        G._emit_delta(f"{name}-content")

    _run_two_requests(body)
    assert received["A"] == ["A-content"], f"A 的流拿到 {received['A']}"
    assert received["B"] == ["B-content"], f"B 的流拿到 {received['B']}"


def test_capability_delta_sink_does_not_leak_across_requests():
    """能力执行那条链路上的同一个坑（sliderule_llm.capabilities）。"""
    received = {"A": [], "B": []}

    def body(name, barrier, _out):
        CAPS.set_capability_delta_sink(lambda cap, chunk, n=name: received[n].append(chunk))
        barrier.wait()
        time.sleep(0.02)
        emit = CAPS._delta_emitter("cap-1")
        assert emit is not None
        emit(f"{name}-content")

    _run_two_requests(body)
    assert received["A"] == ["A-content"], f"A 的流拿到 {received['A']}"
    assert received["B"] == ["B-content"], f"B 的流拿到 {received['B']}"


def test_installed_skills_do_not_leak_across_requests():
    """A 装的技能必须进 A 的生成，不能被 B 顶掉。"""

    def body(name, barrier, out):
        G.set_installed_skills([{"name": f"skill-{name}", "description": "x", "channel": "aigc"}])
        barrier.wait()
        time.sleep(0.02)
        out[name] = [s.get("name") for s in (G._installed_skills_var.get() or [])]

    out = _run_two_requests(body)
    assert out["A"] == ["skill-A"], f"A 读到 {out['A']}"
    assert out["B"] == ["skill-B"], f"B 读到 {out['B']}"


def test_error_book_keeps_each_section_separate():
    """并行 worker 各记各的，不抢同一个格子。"""
    sections = ["datamodel", "rbac", "workflow"]
    barrier = threading.Barrier(len(sections))

    def worker(section):
        barrier.wait()
        G._record_call_error(f"{section} 挂了", section=section)
        time.sleep(0.01)
        return section

    ctx = copy_context()

    def run_all():
        G._error_book().clear()
        with ThreadPoolExecutor(max_workers=len(sections)) as pool:
            # 照抄 v5_parallel_generate._run_wave 的形状：**在父线程里**逐个
            # copy_context，再 submit(ctx.run, ...)。写成
            # `pool.map(lambda s: copy_context().run(...))` 是错的——那个
            # copy_context() 在工作线程里执行，拿到的是空上下文。
            futures = []
            for section in sections:
                wctx = copy_context()
                futures.append(pool.submit(wctx.run, worker, section))
            for f in futures:
                f.result()
        return G._read_call_error()

    merged = ctx.run(run_all)
    for section in sections:
        assert f"{section} 挂了" in merged, f"{section} 的错误丢了：{merged}"


def test_error_book_is_visible_from_the_parent_thread():
    """worker 写、父线程读——这是 ContextVar 存值会断、存容器才通的那一条。

    如果哪天有人把错误簿从"存 dict 引用"改成"存字符串值"，这条会红。
    """

    def in_worker():
        G._record_call_error("worker 里记的", section="datamodel")

    ctx = copy_context()

    def parent():
        G._error_book().clear()
        with ThreadPoolExecutor(max_workers=1) as pool:
            wctx = copy_context()   # 必须在父线程里复制，见上一条测试的说明
            pool.submit(wctx.run, in_worker).result()
        return G._read_call_error()

    assert "worker 里记的" in ctx.run(parent)


def test_diagnostic_does_not_leak_across_requests():
    """生成诊断（失败原因）也是请求域的。"""

    def body(name, barrier, out):
        G.set_generate_diagnostic({"outcome": "failed", "detail": f"{name} 的失败原因"})
        barrier.wait()
        time.sleep(0.02)
        out[name] = G.get_generate_diagnostic().get("detail")

    out = _run_two_requests(body)
    assert out["A"] == "A 的失败原因"
    assert out["B"] == "B 的失败原因"


# ─────────────────────────────────────────────────────────────────────────
# 2026-08-11 补：同一个病漏掉的两处
#
# 08-06 那轮修了 v5_llm_generate 与 capabilities 两个模块，**漏了
# enrich_timing._stage_sink**。而它的注释里正好写着「跟 capability delta sink
# 同一套约定」——那个约定两天后就被判定为并发 bug 改掉了，这一处没跟上，
# 于是同一个病又活了五天，直到线上 5 趟并发实测把它照出来：
#
#     第 4 趟的 SSE 流里收到 4 个不同会话的 pageId，以及 5 趟各自的
#     model.generate 耗时；第 1、2、3、5 趟的流里 stage 事件与心跳一条都没有。
#     用户侧的表现：5 个人同时用，4 个人的进度条完全不动。
#
# 教训跟今天其它几处一样：**修复只去了记得住的地方，没去这个模式住着的所有地方。**
# 所以下面那条"不许再有模块级全局"的名单这次连同一起扩了。
# ─────────────────────────────────────────────────────────────────────────


def test_stage_sink_does_not_leak_across_requests():
    """线上实测到的那条：A 的阶段事件不能出现在 B 的流里。

    这是本组里**唯一一条有线上现场佐证**的——其余几条是当时用探针造出来的。
    """
    received = {"A": [], "B": []}

    def body(name, barrier, _out):
        ET.set_stage_sink(lambda phase, stage, fields, n=name: received[n].append((phase, stage)))
        barrier.wait()
        time.sleep(0.02)
        ET._notify("start", f"{name}-stage", {})

    _run_two_requests(body)
    assert received["A"] == [("start", "A-stage")], f"A 的流拿到 {received['A']}"
    assert received["B"] == [("start", "B-stage")], f"B 的流拿到 {received['B']}"


def test_stage_sink_注销不许殃及别的请求():
    """驱动器在 finally 里 set_stage_sink(None)。模块级全局时代，**先跑完的那个
    请求会把还在跑的那个的 sink 一起清掉**——比"串号"更隐蔽，因为它表现为
    "跑到一半进度就没了"。"""
    got = []

    def body(name, barrier, _out):
        if name == "A":
            ET.set_stage_sink(lambda phase, stage, fields: got.append(stage))
            barrier.wait()
            time.sleep(0.05)          # A 还在跑
            ET._notify("start", "A-still-running", {})
        else:
            ET.set_stage_sink(lambda phase, stage, fields: None)
            barrier.wait()
            ET.set_stage_sink(None)   # B 先收工，注销自己的
    _run_two_requests(body)
    assert got == ["A-still-running"], f"A 的 sink 被 B 的注销殃及了：{got}"


def test_生成诊断不许串到别的请求():
    """顺着 _stage_sink 扫出来的同形状（v5_capability_executor）。

    它是"最近一次生成为什么失败"，只用于给用户解释"为什么 0/6"。串了的后果是
    **用户看到的失败原因指向别人的故障** —— 不影响 fail-closed 判定，但会把
    人的排查方向带偏，跟今天那个 finish_reason 缺席的坑是同一类伤害。
    """
    def body(name, barrier, out):
        EXEC._diagnostic().clear()
        EXEC._diagnostic().update({"code": "X", "detail": f"{name} 的失败原因"})
        barrier.wait()
        time.sleep(0.02)
        out[name] = EXEC._diagnostic().get("detail")

    out = _run_two_requests(body)
    assert out["A"] == "A 的失败原因"
    assert out["B"] == "B 的失败原因"


def test_no_module_level_mutable_globals_left():
    """守住这次的成果：这几个名字不能再作为模块属性存在。

    照着旧写法加回一个全局，串号就会静悄悄地复发——这条让它变成红灯。
    2026-08-11：名单扩到 enrich_timing 与 v5_capability_executor
    （漏掉这两处，正是上一轮"只修记得住的地方"的代价）。
    """
    for name in ("_delta_sink", "_installed_skills", "_last_call_error", "last_generate_diagnostic"):
        assert not hasattr(G, name), f"v5_llm_generate.{name} 又变回模块级全局了"
    assert not hasattr(CAPS, "_delta_sink"), "capabilities._delta_sink 又变回模块级全局了"
    assert not hasattr(ET, "_stage_sink"), "enrich_timing._stage_sink 又变回模块级全局了"
    assert not hasattr(EXEC, "_llm_generate_diagnostic"), (
        "v5_capability_executor._llm_generate_diagnostic 又变回模块级全局了"
    )
