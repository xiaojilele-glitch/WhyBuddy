"""落后者预算跟着**这一批自己的首页耗时**走，不再是一个固定绝对值（2026-08-15）。

## 真机形状：固定 120s 把 5 页里的 4 页误杀了

口腔连锁那轮，第 3 步声明 5 页、实交 1 页：

    181.7s  页面步开始
    357.9s  p2 到 (+176.2s)   ← 截止线上膛
    477.9s  整步结束           ← 357.9 + 120，算术分毫不差
    [spec_first] ⚠ 交付页数对不上 SPEC：声明 5 页、实交 1 页，缺 p1,p3,p4,p5

下游一路忠实地按 1 页往下走（shell pages=1 → structure pages=1 → bind
bound=1 → 落库 1 份），**用户拿到的是个单页应用**。

⚠ 注意这次**不是逻辑错**：上一版修的「首页落地后才上膛」完全正确地生效了。
  错的是 120 这个数——它低于这条链路的正常页间方差。

## 为什么固定值这条路走不通

120s 的来处是「干净那批页与页之间最大间隔 43s」。可那批的**首页只要 157.5s**，
而口腔连锁那批首页 176.2s、上游还在抖（同一批日志里有一次 331.1s 的空挂）。

页间方差是**跟着单页生成成本走的**，不是一个能跨环境复用的常数。模型换了、
话题长了、上游拥塞了，它就一起变。拿一个在 A 环境量出来的绝对值去卡 B 环境，
这次踩的就是这个。

所以改成拿**这一批自己的首页耗时**当尺子——它天然编码了当前模型、话题长度、
上游快慢的综合形状，不需要我们替每种组合各拍一个数。

    budget = min(max(下限, 首页耗时 × 倍率), 上限)     # 120s / ×1.5 / 600s

## 下限的作用：这次改动**不可能**引入新误杀

预算永远 ≥ 原来的 120s，所以相对旧行为它只会更宽松。这是这次改动风险很低的
根据，也是下面 `Test下限保证绝不比原来更严` 那组要钉死的。

## 上限的作用

首页自己可能病态地慢（331.1s 空挂 × 重试 3 次 ≈ 990s）。没有上限的话预算会被
带到 1485s，这条线就形同虚设了。
"""

import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import spec_page_html  # noqa: E402
from services.spec_page_html import _straggler_budget  # noqa: E402


class Test预算公式:
    """纯函数那半，用真机数字回算。"""

    def test_口腔连锁那批_预算翻到两倍以上(self):
        """★ 被误杀的那批：首页 176.2s → 264s，是原来 120s 的 2.2 倍。"""
        assert _straggler_budget(176.2) == pytest.approx(264.3, abs=0.5)

    def test_市政园林那批_原始用途完好(self):
        """⚠ 反向判据：放宽之后，当初**促成**这条线的那批还得被它救到。

        首页 175.6s → 预算 263s。p1 永远不来，最后一张成功页在 760.4s，
        于是 1023.8s 开火 ≈ 整步 533s——仍从 936s 里砍掉 400s。
        预算要是大到 667s 以上，这条线就白设了。
        """
        budget = _straggler_budget(175.6)
        assert budget < 667, (
            f"预算 {budget:.0f}s 已经盖过了真机那次 667s 的空转——这条线失去意义了"
        )

    def test_干净基线_永不触发(self):
        """首页 157.5s → 236s，而那批页间最大间隔只有 43s。"""
        assert _straggler_budget(157.5) > 43 * 3

    def test_首页越慢_预算越宽(self):
        """自适应的本体：单调递增。写死成常数的话这条立刻红。"""
        assert _straggler_budget(400) > _straggler_budget(200) > _straggler_budget(100)


class Test下限保证绝不比原来更严:
    """⚠ **这组是这次改动的安全根据**：预算永远 ≥ 旧的固定值，
    所以相对旧行为只可能更宽松，不可能引入新的误杀。
    """

    @pytest.mark.parametrize("first", [0.0, 1.0, 30.0, 79.9])
    def test_首页很快时落回下限(self, first):
        assert _straggler_budget(first) == 120.0

    def test_秒失败的首页不会把尺子量小(self):
        """首页要是**秒失败**（比如校验不过），尺子会量出个极小值——
        由下限兜住，落回原来的 120s。这是「首页取第一个完成的 future、
        成功失败都算」这个选择成立的前提。"""
        assert _straggler_budget(0.01) == 120.0


class Test上限:
    def test_病态首页不许把线撑到形同虚设(self):
        """331.1s 空挂 × 重试 3 次 ≈ 990s → 若不设上限就是 1485s。"""
        assert _straggler_budget(990.0) == 600.0

    def test_上限之下仍然自适应(self):
        assert _straggler_budget(300.0) == 450.0


class Test三个数都可以从环境改:
    def test_下限_倍率_上限(self, monkeypatch):
        monkeypatch.setenv("SLIDERULE_SPEC_PAGE_STRAGGLER_IDLE_SECONDS", "10")
        monkeypatch.setenv("SLIDERULE_SPEC_PAGE_STRAGGLER_MULTIPLIER", "3")
        monkeypatch.setenv("SLIDERULE_SPEC_PAGE_STRAGGLER_MAX_SECONDS", "100")
        assert _straggler_budget(1.0) == 10.0    # 下限
        assert _straggler_budget(20.0) == 60.0   # 倍率
        assert _straggler_budget(90.0) == 100.0  # 上限


# ---------------------------------------------------------------------------
# 接到真并发循环里，验的是**行为**不是公式
# ---------------------------------------------------------------------------

class _Resp:
    """⚠ 真实链路给的是带 .content 的结果对象，不是裸字符串。
    返回字符串会被 getattr(resp,"content","") 读成空，于是每页都「校验不过」，
    症状看起来像截止线把页都干掉了——这条坑上一批用例里踩过。"""

    def __init__(self, content: str) -> None:
        self.content = content


_GOOD_HTML = (
    "<!doctype html><html><head>"
    '<script src="https://cdn.tailwindcss.com"></script></head>'
    "<body>中文占位 张师傅 20XX-XX-XX</body></html>"
)


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


def _maker(delays: dict):
    def llm_call(messages, **kw):
        brief = messages[-1]["content"] if isinstance(messages, list) else str(messages)
        for pid, delay in delays.items():
            if f"页{pid[1:]}" in brief:
                time.sleep(delay)
        return _Resp(_GOOD_HTML)
    return llm_call


@pytest.fixture
def _tiny_floor(monkeypatch):
    """把下限压到 0.5s，好让「首页耗时 × 倍率」这一档在用例里真正当家。

    ⚠ 不压下限的话 120s 永远赢，整组用例会在**任何**实现下都变绿——
      包括写死常数的实现。压到 0.5 才让自适应那一档暴露出来。
    """
    monkeypatch.setenv("SLIDERULE_SPEC_PAGE_STRAGGLER_IDLE_SECONDS", "0.5")
    # 倍率取 2.0 而不是默认的 1.5，纯粹是给用例留时序余量（判据要的是
    # 「跟着首页走」这个行为，具体倍率由上面的纯函数用例钉住）。
    monkeypatch.setenv("SLIDERULE_SPEC_PAGE_STRAGGLER_MULTIPLIER", "2.0")


class Test真并发下的自适应:
    def test_首页慢_落后者跟着被多等一会儿(self, _tiny_floor):
        """★ **本文件最要紧的一条**——口腔连锁那批的缩微形状。

        p1 用 1.0s，p2 用 2.0s（页间间隔 1.0s）。
        · 自适应：首页 1.0s → 预算 max(0.5, 2.0) = 2.0s → 3.0s 才开火，p2 活
        · 固定 0.5s：1.5s 就开火，p2 当场被误杀 ← 退回旧实现这条必红
        """
        res = spec_page_html.generate_pages_parallel(
            _spec(2), llm_call=_maker({"p1": 1.0, "p2": 2.0}), max_workers=2
        )
        assert res["failed"] == {}, (
            f"落后者被误杀了 —— 预算没跟着首页走？{res['failed']}"
        )
        assert set(res["pages"]) == {"p1", "p2"}

    def test_预算仍然会开火_不是把线关掉了(self, _tiny_floor):
        """⚠ 反向那半：把 `_straggler_budget` 改成返回 inf 也能让上面那条变绿，
        而那等于把整条截止线删了——真机那次 667s 空转会原样回来。

        这里 p2 卡 30s，远超「首页 1.0s × 1.5」的预算，必须被放弃。
        """
        t0 = time.time()
        res = spec_page_html.generate_pages_parallel(
            _spec(2), llm_call=_maker({"p1": 1.0, "p2": 30}), max_workers=2
        )
        took = time.time() - t0

        assert "p2" in res["failed"], "真落后者还是得被放弃，否则这条线就废了"
        assert "静默" in res["failed"]["p2"]
        assert res["pages"] == {"p1": _GOOD_HTML}
        assert took < 10, f"整批 {took:.1f}s —— 截止线没开火"

    def test_失败原因里报的是算出来的预算(self, _tiny_floor):
        """⚠ 排障时最容易被误导的一点：日志里若印的是那个下限常数，
        看日志的人会拿一个**从没生效过的数**去推算术——而这次真机正是靠
        「357.9 + 120 = 477.9 分毫不差」定位的，那条线索不能断。

        首页 1.0s × 倍率 2.0 = 2.0s，报的必须是它，不是下限 0.5s。
        """
        res = spec_page_html.generate_pages_parallel(
            _spec(2), llm_call=_maker({"p1": 1.0, "p2": 30}), max_workers=2
        )
        assert "2.0s" in res["failed"]["p2"], (
            f"报的不是算出来的 2.0s 预算：{res['failed']['p2']}"
        )
