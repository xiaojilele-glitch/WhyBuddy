"""版本回退：重建出来的闭环证据必须**真的落库**（2026-08-29）。

## 事故

回退之后系统对「当前是哪一版」有**两个互相矛盾的答案**：

    落库的 state.publishClosure           → mv-1（回退目标）
    derive_publish_closure_response(runs) → mv-2（刚被回退掉的那一版）

而 derive 那份才是权威（v5_publish_closure_response 模块头：fail-closed，
闭环判决只认它）。真机 sr-it-D-074734 把后果跑了出来：回退到 mv-1 之后紧接着
精修一次，产出的 mv-3 的 rbac 段与 **mv-2** 相同、与 mv-1 不同——
**回退被下一轮精修静默撤销了**，用户看到的是"我明明退回去了，怎么改出来还是
新那版的东西"。

## 病灶：id 撞了 → 守卫判「没进展」→ 整轮证据被丢掉

链条有四环，缺一环都看不出问题：

    路由固定传 loop=0
      → run/turn/artifact/reasoningEvent 的 id 与首轮那次闭环逐字相同
      → _is_same_turn_progress 数的是 **id 集合的大小**，一个都没变大
      → 同轮守卫「退回旧核」：capabilityRuns 连同这一轮的结果一起被丢掉
      → 只有豁免名单里的 publishClosure 活了下来 → 两个来源从此各说各话

⚠ 注意这里没有任何一处报错：回退返回 restored=true，闭环照样绿，
publishClosure 字段也确实是新的。只有权威那一份是旧的。

## 判据形状

光比"回退后 publishClosure 对不对"**抓不到它**——那个字段一直是对的。
判据必须落在**两个来源是否一致**上，以及它下游那个真正的后果
（下一轮精修拿到的基线模型）。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services import v5_full_driver as drv  # noqa: E402


def _ids_of(state):
    def _id(x):
        return x.get("id") if isinstance(x, dict) else getattr(x, "id", None)

    return {
        "runs": [_id(r) for r in (state.capabilityRuns or [])],
        "arts": [_id(a) for a in (state.artifacts or [])],
        "evs": [_id(e) for e in (state.reasoningEvents or [])],
    }


@pytest.fixture
def _rebuilt(monkeypatch):
    """只跑 id / 落库这一段，把 LLM 与闭环推导都换成确定性替身。"""
    monkeypatch.setattr(drv, "derive_publish_closure_response", lambda s: None)
    monkeypatch.setattr(drv, "persist_state", lambda s: None)
    monkeypatch.setattr(drv, "execute_v5_capability", lambda *a, **k: {"summary": "ok"})
    monkeypatch.setattr(drv, "_result_to_dict", lambda r: {"summary": "ok"})

    def _run(state, tag=None):
        """返回**这一轮新增的** id，不是累计的。

        ⚠ 第一版这里返回累计 id，两轮当然重叠——判据当场对着正确的代码报红。
          判据自己写错了也是红，得分清楚是哪一种（本仓第二条：变异咬得住 ≠
          判据是对的）。
        """
        before = _ids_of(state)
        drv._ensure_runtime_closure_evidence(
            state, "restore:mv-1", 0, evidence_tag=tag
        )
        after = _ids_of(state)
        return {k: [i for i in after[k] if i not in before[k]] for k in after}

    return _run


def _state():
    return V5SessionState(sessionId="e1", goal={"text": "跨境电商采购对账"}, artifacts=[])


class Test回退证据要有自己的命名空间:
    def test_两次重建不许撞id(self, _rebuilt):
        """⚠ 把 evidence_tag 那一支删掉，这条必红。

        撞了 = 集合不变大 = 守卫判「没进展」= 这一轮证据被整个丢掉。
        """
        st = _state()
        first = _rebuilt(st, None)          # 首轮闭环（主循环 loop=0）
        second = _rebuilt(st, "restore-mv-1-2")  # 回退那一轮
        for key, name in (("runs", "capabilityRuns"), ("arts", "artifacts"),
                          ("evs", "reasoningEvents")):
            # ⚠ 先钉住两边**都真的写了东西**。少了这两行，命名空间失效时
            #   第二轮的新增集是空的，"空集不重叠"让这条判据绿灯空过——
            #   本仓 13.4 记的正是这个形状（判据自己打空）。
            assert first[key], f"首轮没写 {name}，判据是空的"
            assert second[key], f"回退那轮没写 {name}，判据是空的"
            overlap = set(first[key]) & set(second[key])
            assert not overlap, (
                f"{name} 的 id 与首轮撞了：{sorted(overlap)}。"
                "撞 id 会让单调守卫判「没进展」，把这一轮证据连结果一起退回"
            )

    def test_id集合真的变大了(self, _rebuilt):
        """⚠ 直接钉守卫看的那个量——不是"看着不一样"，是"集合确实大了"。

        本仓踩过"判据看着在量东西、其实量了个空"，所以先钉住首轮真的写了东西。
        """
        st = _state()
        first = _rebuilt(st, None)
        assert first["runs"] and first["arts"] and first["evs"], "首轮什么都没写，判据是空的"
        second = _rebuilt(st, "restore-mv-1-2")
        for k, v in second.items():
            assert v, (
                f"{k} 这一轮一个新 id 都没添——_is_same_turn_progress 数的就是"
                "id 集合的大小，不变大就是「没进展」，整轮证据会被退回"
            )

    def test_不传tag时与从前逐字一致(self, _rebuilt):
        """⚠ 反向判据：主循环各轮的 loop 天然不同，不该被这次改动碰到。"""
        st = _state()
        ids = _rebuilt(st, None)
        assert "run-0-appbundle.runtimeClosure" in ids["runs"], ids["runs"]
        assert "art-0-appbundle.runtimeClosure" in ids["arts"], ids["arts"]


class Test回退路由真的给了命名空间:
    """⚠ 反向判据：函数支持了 ≠ 调用方传了（本仓第三条）。"""

    def test_路由把tag传下去了(self):
        import pathlib

        # ⚠ 2026-08-29：业务核从 routes 下沉到 services/model_version_restore。
        #   这条判据钉的是「调用方真的把 tag 传下去了」，跟它住哪儿无关——
        #   跟着搬即可，别把判据删掉。
        src = (pathlib.Path(__file__).resolve().parents[1]
               / "services/model_version_restore.py").read_text(encoding="utf-8")
        block = src[src.index("def restore_model_version_locked"):]
        code = "\n".join(
            line for line in block.splitlines() if not line.lstrip().startswith("#")
        )
        assert "evidence_tag=" in code, (
            "回退没给独立命名空间——重建的证据会被单调守卫当成「没进展」丢掉，"
            "闭环权威来源仍是被回退掉的那一版"
        )
        assert "version_id" in code[code.index("evidence_tag"): code.index("evidence_tag") + 200], (
            "tag 里不带版本号：连点 ◀▶ 会撞在一起"
        )
