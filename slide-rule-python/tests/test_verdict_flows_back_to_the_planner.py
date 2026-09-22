# -*- coding: utf-8 -*-
"""闭环没过这件事，必须让计划侧看得见（2026-09-04 社区养老真机）。

## 事故

sr-20260904181150「社区养老助餐配送/照护排班/家属评价」，closure 判出：

    CLOSURE_GOAL_RELEVANCE_FAILED
    产出与题目不符：目标的 24 个业务点只覆盖了 5 个（21% < 50%）。
    未见落实：构建覆盖社区居家养老全场景的服务闭环、老人全景档案、
    基础信息、饮食忌口、补贴资质。

理由精确到「缺哪几点」。而交回 host 时喂给模型的情报是：

    本跳实际跑了：闭环判定。当前产出：SPEC 有，页面 4 份。……下一步由你决定。

**一个字都没提它没过。** 模型照着手上的材料如实叙述成

    「闭环判定已完成。当前已具备 4 份页面、数据模型及权限工作流绑定。
      请问下一步您想…」

用户看到的是「完成」。接着它又点了一次 closure，原地重跑，同样的理由再来
一遍——日志里连着两条 `[factory-plan] tools=closure`，中间什么都没变。

这跟 factoryTodo 那条是同一个病：**机器已经算出来的事实，计划侧看不见**，
于是护栏形同虚设，链路空转。今天之前它一直藏在 0/6 后面——所有会话都在
证据那一关就死了，relevance 这道闸从来没机会开口。

## 判据形状

正向那条喂**真机那一发的原样 publishClosure**（21% 那句原文），不自己拼一个
「刚好能过」的 blocker。反向配对钉住三件事：没拦时不许无中生有说没过、
拦了但判定侧没落 topBlockers 时不许编一个理由、人话只能从
closure_block_reason.user_report 出（本仓为此吃过一次「指着用户补错东西」）。
"""

import pytest

from models.v5_state import V5SessionState
from services.rehearsal_control import _after_write_hint

# 真机 sr-20260904181150 那一发的原样载荷
REAL_RELEVANCE_REF = (
    "产出与题目不符：目标的 24 个业务点只覆盖了 5 个（21% < 50%）。"
    "未见落实：构建覆盖社区居家养老全场景的服务闭环、老人全景档案、"
    "基础信息、饮食忌口、补贴资质。"
)


def _state(*, closure) -> V5SessionState:
    st = V5SessionState(
        sessionId="sr-20260904181150-VTNWYGS3G9",
        goal={"text": "构建覆盖社区居家养老全场景的服务闭环", "status": "clear",
              "tools": ["closure"]},
        ownerId="u-1",
    )
    st.specFirstPages = {
        "spec": {"pages": [{"id": f"p{i}"} for i in range(1, 5)]},
        "pages": {f"p{i}": "<html></html>" for i in range(1, 5)},
    }
    st.publishClosure = closure
    return st


BLOCKED_REAL = {
    "blocked": True,
    "evidencePresentCount": 6,
    "skillCount": 6,
    "topBlockers": [
        {"code": "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED", "ref": ""},
        {"code": "CLOSURE_GOAL_RELEVANCE_FAILED", "ref": REAL_RELEVANCE_REF},
    ],
}


class Test没过要说没过:
    def test_真机那一发_情报里必须写着没过(self):
        """★ 事故本体：这条红 = 模型又会把 blocked 叙述成「已完成」。"""
        hint = _after_write_hint(_state(closure=BLOCKED_REAL))
        assert "没过" in hint, f"情报里没说闭环没过——模型只能叙述成「完成」。原文：{hint}"

    def test_理由要具体到缺了什么_不是一句被拦下了(self):
        """光说「没过」不够：模型得知道**缺哪几点**才可能去补。

        （§3 配对：「有这句话」≠「这句话有用」。）
        """
        hint = _after_write_hint(_state(closure=BLOCKED_REAL))
        assert "24" in hint and "业务点" in hint, (
            f"没把「24 个业务点只覆盖 5 个」带过去，模型不知道缺什么。原文：{hint}"
        )

    def test_要挡住原地重跑closure(self):
        """真机就是接着又点了一次 closure。情报里得写明重跑得不到新结论。"""
        hint = _after_write_hint(_state(closure=BLOCKED_REAL))
        assert "同样的结论" in hint or "同样的产出" in hint, (
            f"没说重跑无效——真机上它就是原地又跑了一遍 closure。原文：{hint}"
        )

    def test_给的是可选项不是命令(self):
        """本仓 09-04 刚把这套情报从祈使句改成情报式，别又改回去。"""
        hint = _after_write_hint(_state(closure=BLOCKED_REAL))
        assert "要么" in hint, "没给可选项"
        assert "必须调" not in hint and "不要调 pages" not in hint, (
            "又写成命令式了——那正是用户说「死流程」的那一版"
        )


class Test该闭嘴的时候闭嘴:
    def test_没被拦时不许无中生有说没过(self):
        hint = _after_write_hint(_state(closure={"blocked": False, "topBlockers": []}))
        assert "没过" not in hint, "闭环明明过了，情报里却说没过"
        assert "可以交付" in hint, "过了也该说一声，否则模型不知道能收尾"

    def test_压根没跑过闭环时一个字都不提(self):
        hint = _after_write_hint(_state(closure=None))
        assert "闭环判定" not in hint or "没过" not in hint
        assert "可以交付" not in hint, "闭环还没跑就说可以交付"

    def test_拦了却没落理由时不许编一个(self):
        """fail-closed 的另一面：拿不到原因就说拿不到（closure_block_reason 头注）。

        本仓吃过一次编理由的亏——屏幕上写「证据缺口拦截」，真实原因是产出
        跟题对不上，用户照着补了一天错东西。
        """
        hint = _after_write_hint(_state(closure={"blocked": True, "topBlockers": []}))
        assert "没过" in hint
        assert "没有记下拦截原因" in hint, f"编了个理由出来。原文：{hint}"


class Test人话只有一个出口:
    def test_理由是从user_report来的_不是在这儿另拼的(self):
        """§4 成对物：拦截理由的渲染只许有一处。这里换掉那一处，情报必须跟着变。"""
        import services.rehearsal_control as rc

        _orig = rc.closure_user_report
        rc.closure_user_report = lambda *_a, **_kw: "【替身理由】"
        try:
            hint = _after_write_hint(_state(closure=BLOCKED_REAL))
        finally:
            rc.closure_user_report = _orig
        assert "【替身理由】" in hint, (
            "情报里的理由不是 user_report 出的——有人在这儿另拼了一句，"
            "那正是「证据缺口拦截」那次事故的形状"
        )
        assert "24" not in hint, "既然换了出口，原理由不该还漏在别处"


class Test首轮待办也要回流:
    """★ 2026-09-05 真机第 4 轮（汉字消除小游戏 sr-20260904214530）抓到的。

    3 页画完、loop 预算耗尽停在 max_loops，而账上
    `factoryTodo = ['structure','bind']` 一直没清——数据模型没反推、权限没打孔。
    而交回 host 的最后一句是：

        「页面已经出来。要改哪一页，或者说继续精修、补齐缺口。」

    听起来像做完了。用户看到的是一个「完工」的口气配一份半成品。

    跟闭环裁决那条一模一样：**机器已经算出来的事实，叙述侧看不见**。
    待办本来就在 `_state_digest` 里给选材器看，唯独这条收尾情报没接——
    于是选材器知道、说话的那一版不知道。
    """

    def _state(self, todo):
        st = V5SessionState(
            sessionId="sr-20260904214530-VHN09C3T6Z",
            goal={"text": "做一个网页端的汉字连线消除小游戏", "status": "clear",
                  "tools": ["pages"]},
            ownerId="u-1",
        )
        st.specFirstPages = {"spec": {"pages": [{"id": f"p{i}"} for i in (1, 2, 3)]},
                             "pages": {f"p{i}": "<html/>" for i in (1, 2, 3)}}
        st.factoryTodo = todo
        return st

    def test_待办没清时情报里必须写着(self):
        hint = _after_write_hint(self._state(["structure", "bind"]))
        assert "还挂着" in hint, f"账上挂着两跳没做，情报里一个字没提。原文：{hint}"

    def test_说清是哪几跳_不是笼统一句还有活(self):
        """模型得知道缺的是**哪两跳**才可能去补。"""
        hint = _after_write_hint(self._state(["structure", "bind"]))
        assert "数据结构" in hint and "权限工作流" in hint, (
            f"没说清缺哪几跳。原文：{hint}"
        )

    def test_说清后果_否则模型会当成可选项(self):
        hint = _after_write_hint(self._state(["structure", "bind"]))
        assert "半成品" in hint or "闭环判定也会因此拦下" in hint

    def test_账清了就不提(self):
        """★ 反向配对：别在做完的轮次里制造焦虑。"""
        assert "还挂着" not in _after_write_hint(self._state([]))
        assert "还挂着" not in _after_write_hint(self._state(None))

    def test_生词不当成待办(self):
        """`factory_todo_open` 只认公开工具，脏数据不许变成"还有活没干"。"""
        assert "还挂着" not in _after_write_hint(self._state(["不存在的跳", ""]))

    def test_用的是同一个待办口径(self):
        """§4：选材器（_state_digest）和这条收尾情报必须同一个 factory_todo_open，
        不许各拼各的——两份口径分叉时，一边说有活一边说做完了。"""
        import ast
        import inspect

        from services import rehearsal_control as rc

        fn = None
        for node in ast.walk(ast.parse(inspect.getsource(rc))):
            if isinstance(node, ast.FunctionDef) and node.name == "_after_write_hint":
                fn = node
        assert fn is not None
        calls = {
            getattr(c.func, "id", getattr(c.func, "attr", None))
            for c in ast.walk(fn) if isinstance(c, ast.Call)
        }
        assert "factory_todo_open" in calls, (
            f"收尾情报没用 factory_todo_open 算待办（用到的是 {sorted(x for x in calls if x)}）"
        )
