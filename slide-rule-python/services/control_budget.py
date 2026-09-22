"""Versioned resource limits for one control run, distinct from context size.

The 2026-08-27 M1 cap was for pre-ignition conversation. The real 2026-09-12
project sample spent 10,505 provider tokens before its first patch; each request
resent about 3,000 input tokens. Internal project-v1 allows a bounded edit/check
and repair sequence, with a separate cumulative token and wall-time ceiling.
These initial limits are checked by the live combined-edit/single-turn smokes;
they do not promise that arbitrary projects fit. Legacy limits stay unchanged.

Like grok's prompt usage ledger and goal budget, cumulative spend is separate
from its context/compaction threshold. A restored run keeps its saved policy;
deploying a larger policy must not grant an old run another budget.

⚠ 2026-09-15 团长工作台 `sr-20260915153613-QBC1VPC8ZW`：读完脚手架下一发
  想了 120.9s 被单发读超时掐成 `llm_unavailable`；TicketStream 同日
  `cheapTokens` 累加撞 64000 被当成硬闸。两件事都不是「上下文窗满了」。
  工程档改走 project-v2：单发思考放宽、**窗口** 20 万、19.7 万压缩后再采样。
  project-v1 存档仍按原数字还原，不许因为部署了 v2 就领一份新预算。
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ControlBudget:
    profile: str
    max_rounds: int
    max_tokens: int
    max_wall_seconds: float
    #: 单**发** LLM 请求的读超时。跟上面三个不是一回事：那三个量的是一整个
    #: 回合（累计），这个量的是一次 HTTP 请求能等多久。
    #:
    #: ⚠ 2026-09-14 真机（artifacts/control-real-model/67d437a8）：读窗放宽之后
    #:   模型一轮把六个源文件全读完了，下一发请求带着 ~32K 字源码，推理模型
    #:   想了 45 秒还没回，被客户端掐成 `llm_unavailable`：
    #:
    #:       ReadTimeout after 45.2s (budget 45s)   源码改动：0 处
    #:
    #:   45 秒是 `control_client.py` 里 `min(cfg.timeout_ms or 60000, 45_000)`
    #:   的硬上限，对「一句话聊天」够用，对「读完整份源码再想怎么改」不够。
    #:   所以它跟着 profile 走：对话档还是 45 秒，工程档 v1 120 秒 / v2 600 秒。
    #:
    #: ⚠ **故意不进 `to_wire()`。** to_wire 是**校验**契约——`restore_budget`
    #:   拿 `set(snapshot) != set(policy.to_wire())` 卡存档。往里加一个字段，
    #:   所有**已经存在的 checkpoint** 会当场变成 `invalid_control_budget_policy`
    #:   → `control_reconciliation_required`，正在跑的 run 全部被判成需要人工
    #:   对账。而 restore_budget 返回的是登记过的规范对象本身，不是重建出来的，
    #:   所以不进 wire 也照样拿得到这个值。
    #:   判据：`test_control_llm_timeout_follows_budget.py::test_老存档不许因为多了这个字段而失效`。
    max_request_seconds: float = 45.0
    #: 上下文占用（不是累计花费）到这个数就压缩会话再采样。0 = 不压缩。
    #: 同样不进 to_wire，理由同上。
    compact_at_tokens: int = 0
    #: True：token_budget 闸盯的是**当前 messages 占用**，不是 cheapTokens 累加。
    #: v1 累加花费一超 64000 就停；v2 先压缩，压完还超窗口才停。
    context_token_budget: bool = False

    def to_wire(self) -> dict:
        return {"profile": self.profile, "maxRounds": self.max_rounds,
                "maxTokens": self.max_tokens, "maxWallSeconds": self.max_wall_seconds}

    def request_timeout_ms(self) -> int:
        return int(self.max_request_seconds * 1000)

    def should_compact(self, occupancy: int) -> bool:
        return self.compact_at_tokens > 0 and occupancy >= self.compact_at_tokens


# About 3k repeated input/request in the real fixture, plus growing tool history
# and source output. Sixteen rounds bound useful read/edit/check and one repair;
# token/time caps can stop earlier. Recalibrate and version future changes.
#: ⚠ 单发请求 120 秒的连带账，改这个数之前先算一遍：
#:   `call_control_llm` 单次调用最多重试 3 发，回合累计重试上限
#:   `MAX_RETRIES_PER_TURN = 10`（`sliderule_llm/retry_budget.py`），
#:   窗口 600 秒。120 × 10 = 1200 > 600，所以真抖起来是**那个 600 秒窗口**
#:   先兜住，不是重试次数。120 也仍然小于本档 180 秒的回合墙钟
#:   （判据 `test_单发超时必须装得进回合墙钟` 钉着这条）。
PROJECT_BUDGET_V1 = ControlBudget("project-v1", 16, 64_000, 180.0, 120.0)

#: 2026-09-15：思考要能超过两分钟，累计花费也不该在 6.4 万停死。
#: max_tokens 在这一档是**上下文窗口**（20 万），compact_at 是 19.7 万。
#: 单发 600 秒 < 墙钟 900 秒，差 ≥ 60（同一条量级自洽判据）。
#: 600 × 10 重试仍被 600 秒窗口兜住——一发想满 10 分钟就不再次重试。
PROJECT_BUDGET_V2 = ControlBudget(
    "project-v2", 16, 200_000, 900.0, 600.0,
    compact_at_tokens=197_000,
    context_token_budget=True,
)

#: 点火前对话档。control-v1 是 90/75；2026-09-15 新开会话写计划两发都
#: 想了 ~150s 才回，墙钟 90 把计划掐掉，工程档永远进不去。
#: control-v2：单发 180 / 墙钟 240。旧存档仍按当时那一档还原。
CONVERSATION_BUDGET_V1 = ControlBudget("control-v1", 8, 8_000, 90.0, 75.0)
CONVERSATION_BUDGET_V2 = ControlBudget("control-v2", 8, 8_000, 240.0, 180.0)

#: 2026-09-18：对话档也按要求放开轮次 / token / 墙钟。
#: 起因同一趟待办工程（sr-20260918125826）：点火前 8 轮 / 8000 token /
#: 240 秒仍会先把长思考掐死，工程档的放开根本轮不到。
#: 新开 control-v3，不改 v2 的数字——restore_budget 要求 wire 全等。
#: token 跟工程档同一口径：20 万是上下文窗口，不是 cheapTokens 累加硬闸。
#:
#: 2026-09-20：压缩点收到窗口的约 60%（对标工作台 1M / 60% 自动压缩、
#: Manus filesystem-as-context）。197k 太靠边，PPT 短回合永远走不到，
#: 旧 file_read / skill 正文就一直占着。v1/v2 存档数字一个不许动。
WINDOW_COMPACT_RATIO = 0.6
WINDOW_COMPACT_AT_TOKENS = int(200_000 * WINDOW_COMPACT_RATIO)

CONVERSATION_BUDGET = ControlBudget(
    "control-v3", 10_000, 200_000, 86_400.0, 600.0,
    compact_at_tokens=WINDOW_COMPACT_AT_TOKENS,
    context_token_budget=True,
)

#: ⚠ **名字（PROJECT_BUDGET）永远指向"新回合默认那一档"**，旧档按 _V1/_V2 留名。
#:   判据靠 monkeypatch `control.PROJECT_BUDGET` 换档来验各种边界，
#:   新起一个名字会把那个接缝弄断（2026-09-17 实测 13 条红）。
#:
#: 2026-09-17：**按要求取消轮次/时间上限**。起因是 gemini-3.7-flash 那趟
#: （sr-20260917201230-ZRVJA6M3DH）346 秒烧完 16 轮就被截断，连 project_verify
#: 都没跑到——它每轮先写一段"我的理解"（control_text 占全程 25%），
#: 絮叨本身就吃轮次。v2 的 16 轮是按 gpt-6-astra 那种不絮叨的模型标定的。
#:
#: ⚠ **为什么是新开一档而不是改 v2 的数字**：restore_budget 要求
#:   `snapshot == policy.to_wire()` 完全相等，就地改 v2 会让所有已存
#:   checkpoint 当场 invalid_control_budget_policy。v2 注释自己写着
#:   "Recalibrate and version future changes"，这就是那个 version。
#:
#: ⚠ **token 这一项无法真正取消**：本档 max_tokens 是**上下文窗口**（20 万），
#:   是模型的物理上限，不是我们设的闸；compact_at 19.7 万到了就压缩。
#:   实测那趟一轮只用 29,709，token 从来不是卡住它的那一项。
#:
#: ⚠ 单发是**卡死探测器**，不是回合时长。2026-09-18 按要求再放宽到 1 小时：
#:   读完整份源码再想，600 秒仍可能被当成挂死。不进 to_wire，老 checkpoint
#:   不会因此 invalid。量级自洽：3600 < 86400，差 ≥ 60。
PROJECT_BUDGET = ControlBudget(
    "project-v3", 10_000, 200_000, 86_400.0, 3600.0,
    compact_at_tokens=WINDOW_COMPACT_AT_TOKENS,
    context_token_budget=True,
)

_PINNED_POLICIES = {
    PROJECT_BUDGET_V1.profile: PROJECT_BUDGET_V1,
    PROJECT_BUDGET_V2.profile: PROJECT_BUDGET_V2,
    PROJECT_BUDGET.profile: PROJECT_BUDGET,
    CONVERSATION_BUDGET_V1.profile: CONVERSATION_BUDGET_V1,
    CONVERSATION_BUDGET_V2.profile: CONVERSATION_BUDGET_V2,
    CONVERSATION_BUDGET.profile: CONVERSATION_BUDGET,
}


def startup_budget_line() -> str:
    """进程亮牌：源码是 v3、活进程却还在花 v2，这一行对不上。

    ⚠ 2026-09-20 真机 sr-20260920140018-PPT：文件已是 control-v3/200000，
      七次 durable 仍写出 control-v2/8000。只看源码不够，启动日志必须能
      对上这一进程实际 import 到的档。
    """
    return (
        f"[startup] CONVERSATION_BUDGET={CONVERSATION_BUDGET.profile}/"
        f"{CONVERSATION_BUDGET.max_tokens} "
        f"context={int(CONVERSATION_BUDGET.context_token_budget)} "
        f"PROJECT_BUDGET={PROJECT_BUDGET.profile}/{PROJECT_BUDGET.max_tokens}"
    )


def restore_budget(snapshot, legacy: ControlBudget) -> ControlBudget:
    """Old checkpoints had only cheapTokens, and retain the old ceiling."""
    if snapshot is None:
        return legacy
    if not isinstance(snapshot, dict):
        raise ValueError("invalid_control_budget_policy")
    catalog = {legacy.profile: legacy, **_PINNED_POLICIES}
    policy = catalog.get(snapshot.get("profile"), legacy)
    if (set(snapshot) != set(policy.to_wire())
            or type(snapshot.get("maxRounds")) is not int
            or type(snapshot.get("maxTokens")) is not int
            or type(snapshot.get("maxWallSeconds")) not in (int, float)
            or snapshot != policy.to_wire()):
        raise ValueError("invalid_control_budget_policy")
    return policy
