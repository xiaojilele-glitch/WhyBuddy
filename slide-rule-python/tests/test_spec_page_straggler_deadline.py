"""落后者截止线：一张永远不来的页不许把整批钉死（2026-08-14）。

## 真机形状

市政园林那轮第 3 步 936.3 秒，`got=4 failed=1`。把时间轴摊开：

    490.7s  页面步开始
    666.3s  p2 到 (+175.6s)
    672.6s  p3 到 (+181.9s)
    725.5s  p4 到 (+234.8s)
    760.4s  p5 到 (+269.7s)   ← 最后一张成功的
    1427.0s 整步结束 (+936.3s)

**最后一张成功页在 270 秒，整步跑到 936 秒——667 秒（71%）全花在 p1 上。**
p1 的失败原因是 `cannot reach …: Server disconnected`（瞬时错误，重试 3 次
都没成）。4 页在第 270 秒就齐了，流水线却空转 11 分钟等一张不会来的页。

## 阈值 120s 是量出来的

干净并发 5 页实测 200.8s 全部到齐，页与页之间最大间隔 **43s**
（157.5 / 163.2 / 173.8 / 177.2 / 200.8）。120s 留了近三倍余量。

## 锚点：上次有进展，不是整批开始

锚在开始的话，页数一多必然误伤——6 页本来就比 3 页久，一个固定总时长要么
对小批太松要么对大批太严。锚在「上次有页落地」跟批量大小无关，
量的是**这批还在不在动**。

⚠ 标准库的 `as_completed(timeout=)` 做不到这件事：它的超时是从调用那一刻
  算起的固定值，不是尾随的。所以这里用 `wait(FIRST_COMPLETED)` 循环重算。

## 两个坑（都在实现时踩到，判据钉住）

  ① `with ThreadPoolExecutor(...)` 的 __exit__ 是 shutdown(wait=True)——
     用了 with，截止线只让日志早一点写，**墙钟一秒都省不下来**。
  ② `cancel_futures` 只能取消**还没开跑**的。已经在飞的 HTTP 请求停不掉
     （同 run_cancel 那条教训）。所以这条线的语义诚实地说是
     「**不再等它**」，不是「已经把它停了」。
"""

import os
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import spec_page_html  # noqa: E402


def _spec(n: int) -> dict:
    return {
        "appName": "测试",
        "nodes": [],
        "pages": [
            {"id": f"p{i}", "name": f"页{i}", "purpose": "干活", "audience": "谁",
             "coversNodes": []}
            for i in range(1, n + 1)
        ],
    }


@pytest.fixture(autouse=True)
def _fast_deadline(monkeypatch):
    """把 120s 缩成 0.6s——判据验的是**行为**，不是那个具体数字。"""
    monkeypatch.setenv("SLIDERULE_SPEC_PAGE_STRAGGLER_IDLE_SECONDS", "0.6")


class _Resp:
    """llm_call 的返回形状：真实链路给的是带 .content 的结果对象，不是裸字符串。
    ⚠ 这条我写用例时踩过——返回字符串会被 getattr(resp,"content","") 读成空，
      于是每页都"校验不过"，而症状看起来像截止线把所有页都干掉了。"""

    def __init__(self, content: str) -> None:
        self.content = content


_GOOD_HTML = (
    "<!doctype html><html><head>"
    '<script src="https://cdn.tailwindcss.com"></script></head>'
    "<body>中文占位 张师傅 20XX-XX-XX</body></html>"
)


def _maker(slow_pages: dict):
    """造一个假 llm_call：slow_pages 里的页卡住指定秒数，其余立刻返回。"""
    def llm_call(messages, **kw):
        brief = messages[-1]["content"] if isinstance(messages, list) else str(messages)
        for pid, delay in slow_pages.items():
            if f"页{pid[1:]}" in brief:
                time.sleep(delay)
        return _Resp(_GOOD_HTML)
    return llm_call


class Test落后者不再钉死整批:
    def test_卡住的一页被放弃_其余照常交付(self):
        """★ 真机那轮的形状：4 页齐了，第 5 页永远不来。"""
        t0 = time.time()
        res = spec_page_html.generate_pages_parallel(
            _spec(5), llm_call=_maker({"p5": 30}), max_workers=5
        )
        took = time.time() - t0

        assert set(res["pages"]) == {"p1", "p2", "p3", "p4"}, "快的四页必须照常交付"
        assert "p5" in res["failed"], "卡住那页要如实记账，不许静默消失"
        assert "静默" in res["failed"]["p5"], f"失败原因要说清是超时：{res['failed']['p5']}"
        assert took < 10, (
            f"整批耗时 {took:.1f}s —— 截止线没生效。"
            "最可能的原因是用了 `with ThreadPoolExecutor`（__exit__ 会 wait=True 等到底）"
        )

    def test_不产出占位_HTML(self):
        """与单页失败同一条纪律：一份看起来像那么回事的假页比没有更糟。"""
        res = spec_page_html.generate_pages_parallel(
            _spec(3), llm_call=_maker({"p3": 30}), max_workers=3
        )
        assert "p3" not in res["pages"], "超时的页不许被塞一份占位 HTML"


class Test第一页之前不上膛:
    """★ 这一条是**真机打脸补回来的**（2026-08-14 当天）。

    头一版从整批开跑就计时，于是 120s 预算在第一张页到达之前就开火：
    真机 `got=0 failed=5 missingPages=p1..p5`，整条新链路被自己的截止线
    打死、回落老链路。

    ⚠ 根因是我推阈值时用错了区间：120s 来自「页与页之间最大间隔 43s」，
      **而开跑到第一张页本来就要 150~175s**（单页基准 149.0s）。
      同一批数据里的两个区间量的是不同的东西，我拿其中一个去卡了另一个。

    ⚠ 原来那批用例全都用「毫秒级返回的假页」，第一页永远在预算内到达，
      所以**一条都没红**。这条用例专门把第一页拖到超过预算。
    """

    def test_第一页比预算慢也不许被截断(self):
        # 预算 0.6s（见 fixture），所有页都要 1.2s —— 全都比预算慢
        res = spec_page_html.generate_pages_parallel(
            _spec(3), llm_call=_maker({f"p{i}": 1.2 for i in range(1, 4)}), max_workers=3
        )
        assert res["failed"] == {}, (
            f"第一页还没到就被截断了 —— 截止线在首页之前就上膛了？{res['failed']}"
        )
        assert len(res["pages"]) == 3

    def test_一页都不来时仍由单页超时兜底_不在这里死等(self):
        """⚠ 反向那半：首页之前不设限，不等于"永远等下去"。

        这一段的兜底是每页自己的 LLM 超时与重试（call_llm_with_retry），
        不归这条线管。这里验的是**职责边界**：单页自己抛错时整批照常收尾。
        """
        def boom(messages, **kw):
            raise RuntimeError("用例注入：这一页自己挂了")

        res = spec_page_html.generate_pages_parallel(
            _spec(2), llm_call=boom, max_workers=2
        )
        assert res["pages"] == {}
        assert set(res["failed"]) == {"p1", "p2"}
        assert all("截止线" not in v and "静默" not in v for v in res["failed"].values()), (
            f"这是单页自己失败，不该被记成截止线超时：{res['failed']}"
        )


class Test截止线锚在进展上:
    def test_一直有进展就不该被截断(self):
        """⚠ 反向判据：把锚点写成「整批开始」也能让上面那条变绿，
        但会误伤**慢而稳**的批次——每页都比预算慢，可整批一直在动。

        这里 5 页**每页恒定 0.3s**、串行跑（max_workers=1），于是到达间隔恒为
        0.3s < 0.6s 预算，而总耗时 ~1.5s **远超**预算。一页都不该被放弃。

        ⚠ 头一版我把延迟写成 `0.4*i`，以为那是"恒定 0.4s 间隔"——其实是
          0.4/0.8/1.2/1.6 的**递增**间隔，第二个间隔就越线了。用例当场变红，
          而红的是我的数据不是实现。**造数据也会造错，这条注释留给下一个人。**
        """
        res = spec_page_html.generate_pages_parallel(
            _spec(5),
            llm_call=_maker({f"p{i}": 0.3 for i in range(1, 6)}),
            max_workers=1,  # 串行：到达间隔恒为 0.3s，一直在动
        )
        assert res["failed"] == {}, (
            f"一直有进展却被截断了 —— 锚点写成整批开始了？{res['failed']}"
        )
        assert len(res["pages"]) == 5


class Test没有落后者时行为不变:
    def test_全部正常时不受影响(self):
        res = spec_page_html.generate_pages_parallel(
            _spec(4), llm_call=_maker({}), max_workers=4
        )
        assert len(res["pages"]) == 4 and res["failed"] == {}

    def test_on_page_逐页回调仍然照常(self):
        """截止线不该动到「一页好了就交出去」这条——它是这一步存在感的来源。"""
        seen = []
        spec_page_html.generate_pages_parallel(
            _spec(3), llm_call=_maker({}), max_workers=3,
            on_page=lambda pid, html, done, total: seen.append((pid, done, total)),
        )
        assert len(seen) == 3
        assert [s[1] for s in seen] == [1, 2, 3], "done 计数要递增"
        assert all(s[2] == 3 for s in seen), "total 恒为 spec 的页数"


class Test语义诚实:
    def test_放弃等待不等于已经停了它(self):
        """⚠ 已经在飞的请求停不掉（cancel_futures 只能取消没开跑的）。

        这条钉住的是**别把「不再等它」说成「已经停了」**——线程会在后台
        自己跑完。判据：被放弃的那页，其工作线程最终仍会完成。
        同 run_cancel 那条教训，只是换了个地方。
        """
        finished = threading.Event()

        def llm_call(messages, **kw):
            brief = messages[-1]["content"] if isinstance(messages, list) else str(messages)
            if "页2" in brief:
                time.sleep(1.5)
                finished.set()
            return _Resp(_GOOD_HTML)

        res = spec_page_html.generate_pages_parallel(
            _spec(2), llm_call=llm_call, max_workers=2
        )
        assert "p2" in res["failed"], "p2 应当被放弃等待"
        assert finished.wait(timeout=5), (
            "被放弃的页，其线程理应仍在后台跑完——"
            "如果这里超时，说明真的停掉了，那这条注释和语义都该改"
        )
