# -*- coding: utf-8 -*-
"""闸自己的体检：一道**一直给同一个结论**的闸，等于没在量东西。

## 修的是什么（2026-09-05）

今天之前，15 个走到闭环的会话**全是 `证据 0/6 + blocked`，一个例外都没有**。
那个整齐度本身就是答案——一道永远开火的闸不是"严"，是坏了。但没有任何一处
在看这件事，于是它躲了几个月：

  · `0/6 blocked` 读起来像「闸正常工作，它拦住了东西」。**坏成不响容易被发现，
    坏成一直响反而安全**——一道会亮红灯的闸亮了红灯，没人去查。
  · 「一直被拦」同时符合另一个说得通的故事：「产品还不够好」。
    它藏在一个合理的解释后面。
  · 相关性闸更隐蔽：它的手写标定集正例是照着目标里的词写的
    （"就餐老人"对"登记就餐老人"），自洽的小世界里它永远对；喂真库
    152 个会话才掉到 63%。**自我印证的测试集，静态分析查不出来。**

这个模块补的就是那条元判据：**闸的输出本身也要被看着。**

## 抄 grok-build 的形状（不是抄"算个比率"）

`xai-grok-shell/src/session/goal_tracker.rs`：

    pub(crate) const GOAL_CLASSIFIER_STALL_THRESHOLD: u32 = 2;
    /// Consecutive identical gap fingerprints that trip the stall early-exit.
    /// Iterating further is futile, so the goal auto-pauses before exhausting the run cap.

    fn record_classifier_stall(&mut self, fingerprint: &str) -> bool {
        if o.last_gap_fingerprint.as_deref() == Some(fingerprint) {
            o.classifier_stall_count += 1;      // 同一份指纹才累加
        } else {
            o.last_gap_fingerprint = Some(fingerprint.to_string());
            o.classifier_stall_count = 1;       // 指纹变了就重置
        }
        o.classifier_stall_count >= threshold
    }

    fn record_evaluator_blocker(&mut self, blocker_key: &str) -> u32 { …同形状… }
    // 调用侧：`if streak >= 3 { auto_pause(reason + next_step) }`

**关键是"同一个指纹连续几次"，不是"拦了百分之几"。** 一道闸把 15 个不同的
应用按 15 个不同理由拦下来是健康的；把 15 个不同的应用按**同一个理由**拦下来
才是坏的。比率区分不了这两件事，指纹连击可以。

## 但"一边倒"这一头比率才看得见

指纹连击抓不到另一种退化：**一道永远放行的闸**。放行时每次的理由都不一样
（各是各的应用），指纹不会重复，连击永远不触发。这一头只能看窗口内的
一边倒程度。所以两条判据并存，各管一头：

    指纹连击   抓「一直给同一个结论」   ← 今天 0/6 那种
    窗口一边倒 抓「从来没有过另一种结论」 ← 一道形同虚设的闸

## 记录的形状照 run_degradation（K8s Condition）

`reason` 机器可读 CamelCase，`message` 给人看，两者不混用——跟那个模块同一条
约定，别再多出第三种口径。

## fail-open（§7）

体检是增强类：它自己出问题**绝不许**拖垮推演。所有入口吞异常，
落盘失败只打日志。它不参与任何 blocked/hash 判定。
"""

from __future__ import annotations

import json
import os
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Tuple

#: 同一个结论连续几次算「这道闸在重复自己」。
#: grok 的 stall 阈值是 2、blocker streak 是 3；这里取 3——2 太容易被
#: 「同一个会话连着跑两跳」这种正常情形撞上。
STREAK_THRESHOLD = 3

#: 一边倒的观察窗。窗口内**每一次**都是同一侧才算数。
#: 10 是拍的吗？不是：今天的真实样本是 15 个会话全 0/6，10 已经足够
#: 在那种形状出现时开口，又不至于三五次抖动就报。
WINDOW_SIZE = 10

_GATE_HEALTH_DIR_ENV = "SLIDERULE_GATE_HEALTH_DIR"


class _GateState:
    __slots__ = ("last_fingerprint", "streak", "window", "tripped", "contexts")

    def __init__(self) -> None:
        self.last_fingerprint: Optional[str] = None
        self.streak: int = 0
        self.window: Deque[Tuple[bool, str]] = deque(maxlen=WINDOW_SIZE)
        #: 最近这些结论各自来自哪一发（会话 id 之类）。**不进指纹**——
        #: 进了每次都不一样，连击永远不触发；但报出来时必须带上，
        #: 否则「这道闸在重复自己」这句话没法回查是哪几发。
        self.contexts: Deque[str] = deque(maxlen=WINDOW_SIZE)
        #: 已经报过的 reason，不重复刷屏（grok 那边也是 auto_pause 一次）
        self.tripped: set = set()


_LEDGER: Dict[str, _GateState] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _condition(gate: str, reason: str, message: str, **extra: Any) -> Dict[str, Any]:
    """K8s Condition 形状，同 run_degradation。"""
    out = {
        "type": "GateHealth",
        "status": "True",
        "gate": gate,
        "reason": reason,
        "message": message,
        "lastTransitionTime": _now(),
    }
    out.update(extra)
    return out


def record_verdict(
    gate: str, *, passed: bool, fingerprint: str, context: str = ""
) -> Optional[Dict[str, Any]]:
    """记一次闸的结论；**新**触发体检条件时返回一条记录，否则 None。

    `fingerprint` 要能区分「同一个理由」和「不同理由」——通常是 blocker code
    加上量化结果（`CLOSURE_GOAL_RELEVANCE_FAILED@0.21`），不要把会话 id 拌进去，
    那样每次都不一样，连击永远不触发。

    `context` 是「这一发是谁」（会话 id），**不进指纹只进记录**：
    报警说「连续 3 次同一个结论」时，得能回查是哪 3 发——否则拿到记录也
    没法往下查。台账是进程级的，本来就跨会话，更需要这个。
    """
    try:
        st = _LEDGER.setdefault(str(gate), _GateState())
        fp = f"{'pass' if passed else 'block'}:{fingerprint}"
        if st.last_fingerprint == fp:
            st.streak += 1
        else:
            st.last_fingerprint = fp
            st.streak = 1
        st.window.append((bool(passed), str(fingerprint)))
        if context:
            st.contexts.append(str(context))

        record: Optional[Dict[str, Any]] = None
        # ⚠ 连击只看**拦下**那一侧（2026-09-05 真机当场打脸）。
        #
        #   grok 那两个入口本来就只在拒绝时调用（`GoalEvaluatorDecision::Blocked`
        #   / `NotAchieved`），我图省事推广到两侧，接上产线第一发就误报：
        #     「factoryTodo 连续 3 次给出同一个结论（pass:clear）」
        #   ——首轮待办为空是**常态**，一道天天说"没欠账"的闸没有任何问题。
        #   放行侧的退化是另一种形状（"从来没拦过"），由下面的窗口一边倒管，
        #   那才是对的instrument。
        if (
            not passed
            and st.streak >= STREAK_THRESHOLD
            and "GateRepeatingItself" not in st.tripped
        ):
            st.tripped.add("GateRepeatingItself")
            record = _condition(
                gate,
                "GateRepeatingItself",
                f"「{gate}」连续 {st.streak} 次给出同一个结论（{fp}）——"
                f"一道一直给同一个结论的闸，等于没在量东西。先去看它的判据"
                f"是不是在自我印证，别急着改被它拦下的产物。",
                streak=st.streak,
                fingerprint=fp,
                samples=list(st.contexts)[-STREAK_THRESHOLD:],
            )
        elif len(st.window) >= WINDOW_SIZE:
            sides = {p for p, _ in st.window}
            if len(sides) == 1:
                one_sided = "GateAlwaysPassing" if passed else "GateAlwaysBlocking"
                if one_sided not in st.tripped:
                    st.tripped.add(one_sided)
                    word = "全部放行" if passed else "全部拦下"
                    record = _condition(
                        gate,
                        one_sided,
                        f"「{gate}」最近 {WINDOW_SIZE} 次{word}，一次例外都没有——"
                        f"{'它可能已经形同虚设' if passed else '它可能已经不是在量东西，而是在重复一个结论'}。",
                        window=WINDOW_SIZE,
                        samples=list(st.contexts),
                    )
        if record is not None:
            print(f"[gate-health] ★ {record['message']}")
            _append_record(record)
        return record
    except Exception as exc:  # noqa: BLE001 — 体检自己炸了不许拖垮推演
        print(f"[gate-health] 记录跳过：{str(exc)[:120]}")
        return None


#: 这个进程是什么时候开始记账的。**台账是进程内存**——uvicorn 一 reload、
#: 一重启，全部归零。没有这个字段，空清单读起来像「各道闸都没开过火，一切正常」，
#: 而实情往往是「这个进程刚起来，还没判过任何东西」。
#: 两件事在屏幕上长得一模一样，正是本仓最忌的那类。
_STARTED_AT = _now_iso = datetime.now(timezone.utc).isoformat()


def ledger_since() -> str:
    """台账从什么时候开始记的（进程启动时刻，ISO）。"""
    return _STARTED_AT


def snapshot() -> List[Dict[str, Any]]:
    """当前各道闸的开火情况。跑批收尾打一行用，也给判据看。"""
    out: List[Dict[str, Any]] = []
    for gate, st in sorted(_LEDGER.items()):
        seen = list(st.window)
        blocked = sum(1 for p, _ in seen if not p)
        out.append({
            "gate": gate,
            "seen": len(seen),
            "blocked": blocked,
            "passed": len(seen) - blocked,
            "streak": st.streak,
            "lastFingerprint": st.last_fingerprint or "",
            "samples": list(st.contexts),
            "tripped": sorted(st.tripped),
        })
    return out


def summary_line() -> str:
    """一行人话，跑批收尾打给日志。没记过任何东西就返回空串。"""
    rows = snapshot()
    if not rows:
        return ""
    parts = [
        f"{r['gate']} 拦{r['blocked']}/{r['seen']}"
        + (f"·连击{r['streak']}" if r["streak"] >= STREAK_THRESHOLD else "")
        + (f"·{'/'.join(r['tripped'])}" if r["tripped"] else "")
        for r in rows
    ]
    return "[gate-health] " + "  ".join(parts)


def _records_path() -> Optional[Path]:
    try:
        configured = os.getenv(_GATE_HEALTH_DIR_ENV, "").strip()
        root = Path(configured) if configured else (
            Path(__file__).resolve().parents[2] / "data"
        )
        return root / "gate-health.jsonl"
    except Exception:  # noqa: BLE001
        return None


def _append_record(record: Dict[str, Any]) -> None:
    """落一行 JSONL。**只在触发时写**，不是每次判定都写。

    ⚠ 落盘失败只打日志：这条记录丢了顶多是下次重新触发，
      拿它去打死推演不划算（§7 增强类 fail-open）。
    """
    path = _records_path()
    if path is None:
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as exc:  # noqa: BLE001
        print(f"[gate-health] 落盘跳过：{str(exc)[:120]}")


def _reset_for_tests() -> None:
    _LEDGER.clear()
