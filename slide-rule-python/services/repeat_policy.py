"""同一能力能连着跑几次——一处定义，两道门共用（2026-08-05）。

## 为什么要把这条策略单独拎出来

在这之前，"防原地打转"这件事有**两道门，两套算法，两个写死的 2**：

    services/v5_agentic_pick.py   最近 6 次 run 里跑过 2 次 → 提案里剔掉
    services/v5_full_driver.py    **整个会话**跑过 2 次   → 永久拉黑

后者没有窗口。`sum(1 for r in state.capabilityRuns if ...)` 数的是会话生命
周期总次数，也就是说一个能力这辈子跑满两次，之后再也选不出来。多轮对话里
用户补三次需求，第三轮开始 evidence.search 就死了——而那正是最该再检索一次
的时候。

而那个 2 的出处，代码自己写着：

    MAX_REPEAT_PER_CAP = 2  # small threshold for guard testability;
                            # per V5.2 policy default higher but slice uses 2

**为了测试方便定的**，写死在两处，没有配置项，然后就没人回来改。

## 窗口按 run 数还是按轮数

按 run 数。轮的批量大小是变的（1~5 个能力），按轮算窗口会随批量大小漂移；
run 是实际发生的事，数它更稳。默认 6 ≈ 两三轮。

## 这不是唯一的防线，也不该是

真正该拦住重复收口的是另外两条，它们都比"数次数"聪明：

  ① 状态摘要告诉模型「已经收口成功了，不用再选」（v5_agentic_pick._closure_line）
  ② 就算再收一次，本轮已生成的模型可以直接复用，几秒钟的事
     （v5_full_driver.reusable_model_for_turn）

2026-08-05 查出来这两条**在流式驱动里都没生效**——它们读的字段都只在循环
结束之后才赋值，循环里永远是空的。于是这道最粗的计数器成了唯一还在干活的，
显得又硬又不讲理。两条修好之后，这里的阈值才敢放宽。
"""

from __future__ import annotations

import os
from typing import Any, List

#: 往回看多少次 run。设 0 = 不限窗口（回到旧的"整个会话"语义）。
_WINDOW_ENV = "SLIDERULE_REPEAT_WINDOW"
_DEFAULT_WINDOW = 6

#: 窗口内同一能力最多跑几次。
_MAX_ENV = "SLIDERULE_MAX_REPEAT_PER_CAP"
_DEFAULT_MAX_REPEAT = 2


def _int_env(name: str, default: int, *, minimum: int) -> int:
    """读一个整数配置。读不出来/不合法就用默认值——配置错了不该把推演搞停。"""
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value >= minimum else default


def repeat_window() -> int:
    """往回看多少次 run；0 表示不限。"""
    return _int_env(_WINDOW_ENV, _DEFAULT_WINDOW, minimum=0)


def max_repeat_per_cap() -> int:
    """窗口内同一能力最多几次。至少 1——设 0 等于禁掉所有能力。"""
    return _int_env(_MAX_ENV, _DEFAULT_MAX_REPEAT, minimum=1)


def _run_ids(state: Any) -> List[str]:
    runs = getattr(state, "capabilityRuns", None) or []
    out: List[str] = []
    for r in runs:
        cid = r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", "")
        out.append(str(cid or ""))
    return out


def recent_run_count(state: Any, capability_id: str) -> int:
    """窗口内这个能力跑过几次。"""
    ids = _run_ids(state)
    window = repeat_window()
    if window > 0:
        ids = ids[-window:]
    return ids.count(str(capability_id or ""))


def is_repeat_exhausted(state: Any, capability_id: str) -> bool:
    """还能不能再选一次这个能力。

    两道门共用这一个判断，这样"提案时被剔掉"和"选中后被拦下"永远同进同退
    ——此前两边算法不同，出现过提案门放行、驱动门拦下的错位。
    """
    return recent_run_count(state, capability_id) >= max_repeat_per_cap()


#: 说得出理由能多要几次。硬顶 = 阈值 + 这个数。
#:
#: 为什么要有硬顶：下面那条"说得出理由就放行"本质上是让模型自己给自己开条子。
#: 模型几乎总能写出一段像样的理由，所以这道门拦不住铁了心要重复的——它只
#: 保证重复是**有据可查**的（理由进台账），并且**次数有限**。真正防打转的是
#: 硬顶，不是理由的质量。
_EXTRA_WITH_REASON = 1

#: 理由多长才算数。中文 12 字已经是一句完整的话；再短基本是"需要补充"这类
#: 空话。这不是在判断理由好不好——那办不到，也不该在这儿办。
_MIN_REASON_LEN = 12


def repeat_ceiling() -> int:
    """无论理由多充分，同一能力在窗口内的绝对上限。"""
    return max_repeat_per_cap() + _EXTRA_WITH_REASON


def is_over_ceiling(state: Any, capability_id: str) -> bool:
    return recent_run_count(state, capability_id) >= repeat_ceiling()


def reason_allows_repeat(state: Any, capability_id: str, reason: str) -> bool:
    """跑满了，但说得出"这次跟上次有什么不同" → 再放一次（不超硬顶）。

    ## 为什么要读这个理由

    状态摘要里写着「再选一次就必须说明这次跟上次做的有什么不同（补哪一块、
    为什么上次那次不够）」，提案格式里也一直有 `why` 字段——**模型一直在写，
    验收一直没看**。请人申辩然后捂着耳朵，是这套护栏最说不过去的一点。

    ## 为什么不判断理由"对不对"

    判不了。用关键词匹配去认"这是不是一个好理由"，只会教模型写特定的词。
    这里只做两件能做准的事：理由得是句人话（长度），以及**次数有硬顶**。
    放行的那次会记进台账，事后能查是谁凭什么放的。
    """
    if is_over_ceiling(state, capability_id):
        return False
    return len((reason or "").strip()) >= _MIN_REASON_LEN
