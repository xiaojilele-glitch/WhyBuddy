"""lastTurnId 必须跨 drive 单调递增（2026-08-10）。

## 它坏了会怎样 —— 两件都不响的事

`lastTurnId` 同时兼着两个职责：

  ① **持久化的单调版本**。`_advance_turn_version` 的文档写得很直白：驱动器
     不推进它，含 goal/conversation/runtimePhase 的落盘就会被同版本判定挡下，
     只剩 append-only 的 artifacts 进盘，"重启后会话失忆。实测踩过，勿删。"
  ② **模型复用的轮次作用域**。`reusable_model_for_turn` 用
     `modelVersions[-1].turnId == lastTurnId` 当键，刻意收窄到单轮，防的是
     "用户补充需求之后仍然拿到旧模型"。

## 实测坏在哪（线上会话 sr-20260810012732）

一趟 drive 跑完，`lastTurnId` 是 `turn-stream-3-drive-full`。而
`_advance_turn_version` 当时用的是**行尾锚定**的 `(\\d+)\\s*$` —— 这个串结尾
不是数字，匹配不上，`seq` 落回 1。于是：

    drive1 开头 turn-1 → 收尾 turn-stream-3-drive-full
    drive2 开头 turn-1 ← 又回到 1
    drive3 开头 turn-1

两个职责一起失效：版本永不前进；复用键两边恒等于 `turn-1`，下一条消息会
拿到上一轮的旧模型。

同一个仓库里 routes 的两个读者（`_turn_seq_for_drive_full`、PUT 的
`_turn_seq`）用的都是**不锚定**的 `re.search(r"(\\d+)")`，读同一个串得 3 ——
两个读者对同一个字符串的理解不一致，这才是根。

修法两处：读侧统一到不锚定取最大；写侧（流式驱动收尾）照 routes 的
`_advance_drive_full_turn_id` 那样按序号 +1，而不是写本趟的 loop 序号。
"""

from models.v5_state import V5SessionState
from services.v5_full_driver import _advance_turn_version


def _state(last: str | None) -> V5SessionState:
    st = V5SessionState(sessionId="s-1", goal={"text": "话题", "status": "clear"})
    if last is not None:
        st.lastTurnId = last
    return st


class Test读侧不锚定行尾:
    def test_普通形状(self):
        st = _state("turn-3")
        _advance_turn_version(st)
        assert st.lastTurnId == "turn-4"

    def test_结尾不是数字的形状也要读得出来(self):
        # 这两种是链路上真实流通的，旧的行尾锚定正则对它们一律返回 1
        for raw, want in (
            ("turn-stream-3-drive-full", "turn-4"),
            ("turn-4-drive-full", "turn-5"),
        ):
            st = _state(raw)
            _advance_turn_version(st)
            assert st.lastTurnId == want, f"{raw} → {st.lastTurnId}，期望 {want}"

    def test_空值从一开始(self):
        for raw in (None, ""):
            st = _state(raw)
            _advance_turn_version(st)
            assert st.lastTurnId == "turn-1"

    def test_多段编号取最大才保证单调(self):
        st = _state("turn-2-stream-9-drive-full")
        _advance_turn_version(st)
        assert st.lastTurnId == "turn-10"

    def test_没有任何数字时不炸(self):
        st = _state("turn-drive-full")
        _advance_turn_version(st)
        assert st.lastTurnId == "turn-1"


class Test跨drive单调:
    """把"开头步进 + 收尾落章"连起来跑，序号必须只增不减。"""

    @staticmethod
    def _closing(last: str) -> str:
        """复刻流式驱动收尾那一行（v5_full_driver 里 publish_closure 之后）。"""
        import re

        nums = [int(n) for n in re.findall(r"\d+", str(last or ""))]
        return f"turn-{(max(nums) + 1) if nums else 1}-drive-full"

    def test_连跑四趟序号只增不减(self):
        seq = []
        st = _state(None)
        for _ in range(4):
            _advance_turn_version(st)
            seq.append(st.lastTurnId)
            st.lastTurnId = self._closing(st.lastTurnId)
            seq.append(st.lastTurnId)
        nums = [int(s.split("-")[1]) for s in seq]
        assert nums == sorted(nums), seq
        assert len(set(nums)) == len(nums), f"出现重复序号：{seq}"
        assert seq[0] == "turn-1" and seq[1] == "turn-2-drive-full"

    def test_旧写法会原地踏步_这条钉住别退回去(self):
        """收尾若写本趟 loop 序号（旧行为），第二趟就不动了。"""
        st = _state(None)
        _advance_turn_version(st)
        first = st.lastTurnId
        st.lastTurnId = "turn-stream-3-drive-full"  # 旧写法：loop 序号，不单调
        _advance_turn_version(st)
        second = st.lastTurnId
        # 读侧修好之后，即使写侧退回旧写法也不会塌回 turn-1；
        # 但两趟会撞上同一个号——所以写侧那条也必须在。
        assert first == "turn-1" and second == "turn-4"
        st.lastTurnId = "turn-stream-3-drive-full"
        _advance_turn_version(st)
        assert st.lastTurnId == "turn-4", "写侧不改的话第三趟又是 turn-4，序号原地踏步"


class Test复用作用域:
    """单调之后，跨 drive 不再误复用；drive 内部照常复用。"""

    def test_跨drive不误复用上一轮的模型(self):
        from services.v5_full_driver import record_model_snapshot, reusable_model_for_turn

        st = _state(None)
        _advance_turn_version(st)  # drive1 开头
        model = {s: {"id": s} for s in ("datamodel", "rbac", "workflow", "page", "aigc", "appbundle")}
        record_model_snapshot(st, model, "话题")
        assert reusable_model_for_turn(st) == model  # drive1 内部：命中

        st.lastTurnId = Test跨drive单调._closing(st.lastTurnId)  # drive1 收尾
        _advance_turn_version(st)  # drive2 开头
        assert reusable_model_for_turn(st) is None, "用户下一条消息不该拿到上一轮的模型"
