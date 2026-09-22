"""错因不许被抹掉：429 就说 429，别说成「模型吐了坏 JSON」（2026-08-14）。

## 真机撞出来的形状

第 4 步失败，对外一句「LLM 没有返回可解析的 JSON」。紧跟着的后端日志是：

    [v5_llm_generate] structured channel failed: exhausted retries:
        llm error: 429: rate limited or out of quota

**真因是限流，报出来的是模型质量问题。** 这两件事要的修法正好相反——
一个要退避降并发，一个要改提示词。报错指错方向，比不报还费时间：
我自己第一反应就是去看 prompt。

病根是四个模块各写一份的 `_call`：`except Exception: return None`，
把带 status / transient 分级的 `LlmError` 压成一个无差别的 None。
**错因在离现场一行的地方被丢掉了。**

## 第二件事：重问额度被传输故障吃掉

调用方那个循环治的是"校验不过"——把校验器原话喂回去重问。传输挂了时
根本没拿到东西，没有可喂回去的内容；而且下层 call_llm_with_retry
（带 transient 分级 + hedging）**已经退避重试过了**。上层再转两圈，
是拿宝贵的重问额度去做下层刚做完且做得更好的事。

实测就是这个形状：11.6 秒跑完三次尝试——快得不像在等网络，因为它根本
不是在等，是在原地把同一个 429 撞三次。

## 开源：查过，不引（理由写在 services/spec_llm_call.py 头注）

instructor 自己有同一个毛病（issue #693），照抄会把 bug 一起抄进来。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.spec_llm_call import SpecLlmOutcome, call_spec_json  # noqa: E402


class Test传输故障不许被说成坏JSON:
    def test_429_的话术里必须带得出真因(self, monkeypatch):
        """判据不是"报了个错"，是**报出来的那句话指向正确的修法**。"""
        from sliderule_llm import client as llm_client

        def _boom(*_a, **_k):
            raise llm_client.LlmError(
                "429: rate limited or out of quota", status=429, transient=True
            )

        monkeypatch.setattr(llm_client, "call_llm_json", _boom, raising=False)
        out = call_spec_json([{"role": "user", "content": "x"}], None, stage="specfirst.structure")

        assert out.payload is None
        assert out.transport is True, "429 是传输层，不是模型吐了坏 JSON"
        assert "429" in out.failure, f"话术里丢了状态码：{out.failure}"
        assert "没有返回可解析的 JSON" not in out.failure, (
            f"429 被说成了坏 JSON —— 这正是本文件要挡的那句：{out.failure}"
        )

    def test_不可重试的错也要标出来(self, monkeypatch):
        """401 跟 429 都是传输层，但**指令相反**：一个是查 key，一个是等一等。
        所以话术里要分得出可重试 / 不可重试。"""
        from sliderule_llm import client as llm_client

        def _boom(*_a, **_k):
            raise llm_client.LlmError(
                "auth failed (401): check API key", status=401, transient=False
            )

        monkeypatch.setattr(llm_client, "call_llm_json", _boom, raising=False)
        out = call_spec_json([{"role": "user", "content": "x"}], None, stage="specfirst.spec")

        assert out.transport is True
        assert "401" in out.failure
        assert "不可重试" in out.failure, f"没标出这个错重试也没用：{out.failure}"


class Test真的坏JSON仍然照旧:
    def test_拿到了东西但不是_dict_才叫没解析出_JSON(self):
        """⚠ 反向判据。把 transport 一路设成 True 也能让上面那条变绿，
        而那会让**真正的坏 JSON 不再触发重问**——重问正是它唯一的解法。"""
        out = call_spec_json([], lambda _m: "这不是 dict", stage="specfirst.spec")
        assert out.payload is None
        assert out.transport is False, "坏 JSON 必须留在可重问那一档"
        assert out.failure == "LLM 没有返回可解析的 JSON"

    def test_注入的假LLM抛错按没产出处理(self):
        """用例注入的假 LLM 抛错，语义是"这次没给出东西"，不是网络挂了。
        保持既有行为：调用方照旧走重问那条路。"""
        def _raise(_m):
            raise RuntimeError("用例注入")

        out = call_spec_json([], _raise, stage="specfirst.spec")
        assert out.payload is None
        assert out.transport is False
        assert "注入" in out.failure

    def test_正常返回就是正常返回(self):
        out = call_spec_json([], lambda _m: {"a": 1}, stage="specfirst.spec")
        assert out.ok and out.payload == {"a": 1}
        assert out.failure is None and out.transport is False


class Test传输故障不再吃掉重问额度:
    """四步的重问循环都必须在 transport 上**当场停**。

    ⚠ 判据用真调用次数，不查源码里有没有 `break`：写法可以变（early return、
      哨兵、异常），而"撞了 429 还在原地重问"这件事一旦发生就一定被计数抓到。
    """

    @pytest.mark.parametrize(
        "mod,fn,args",
        [
            ("spec_tree", "generate_spec_tree", ("给宠物医院做个系统",)),
            ("html_structure", "derive_structure", ({"p1": "<main><table></table></main>"},)),
        ],
    )
    def test_撞上传输故障就停_不再转第二圈(self, monkeypatch, mod, fn, args):
        from sliderule_llm import client as llm_client

        calls = {"n": 0}

        def _boom(*_a, **_k):
            calls["n"] += 1
            raise llm_client.LlmError("429: rate limited", status=429, transient=True)

        monkeypatch.setattr(llm_client, "call_llm_json", _boom, raising=False)
        target = __import__(f"services.{mod}", fromlist=["*"])

        with pytest.raises(Exception) as err:
            getattr(target, fn)(*args)

        assert calls["n"] == 1, (
            f"{mod} 撞上 429 还在重问：调了 {calls['n']} 次。"
            "下层 call_llm_with_retry 已经退避重试过了，上层再转是纯浪费"
        )
        assert "429" in str(err.value), f"抛出去的错丢了真因：{err.value}"
