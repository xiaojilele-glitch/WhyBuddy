"""布尔环境开关的唯一一份解析（2026-08-29 架构对账第二轮）。

## 为什么要收成一处

对账之前，同一份真假词表在仓里被**手抄了 28 份**，散在 16 个文件里：

    raw not in ("0", "false", "no", "off")      # 默认开的那种
    raw in ("1", "true", "yes", "on")           # 默认关的那种

`refine_short_circuit.env_flag_off_values()` 的注释写着「跟仓里其它开关同一份
词表」——**注释说了，但没有任何东西保证**，而且事实上没有一个开关在用它。
这跟 §13.2 ② 那条（执行器事件词表「注释说了，没人保证」）是同一口。

手抄 28 份的直接后果不是"以后可能漂"，是**已经漂了两处**，而且两处都朝着
危险的那个方向漂：

### ① `SLIDERULE_REFINE_MERGE_PATCH`：默认开，却拿"开"的词表解析

    raw = (os.environ.get(...) or "1").strip().lower()
    return raw in ("1", "true", "yes", "on")

它的 docstring 写着「默认开。留开关是因为它改的是生成契约本身，**线上出事要能
一条环境变量退回**」——也就是说这是一根应急闸。而拿"开"的词表配"默认开"，
拼错一个字母（`ture` / `enable` / `on1`）就落到 else，**功能静静地关掉**。
一根应急闸，误触的方向恰好是"把它自己扳掉"。

### ② `SLIDERULE_PARALLEL_MODEL_GENERATION`：默认关，却拿"关"的词表解析

    raw = str(os.getenv(..., "off")).strip().lower()
    return raw not in {"0", "false", "no", "off"}

那个函数的 docstring 用一整段解释并行**为什么现在必须关着**（缺串行兜底、
Contract 还没瘦身）。拼错一个字母就 **静静地打开**。

两处都不报错、不打日志。

## 纪律：认不出来的值 → 回落到**声明的默认**，并且要吵

抄 grok-build `xai-sqlite-journal`：

    EnvOverride::Invalid => { tracing::warn!(... "invalid GROK_SQLITE_JOURNAL_MODE
                             (accepted: wal, truncate); using detection") }
    // 原注释：A typo in the emergency kill-switch must be loud, not silently ignored.

以及它上面那条 —— 覆盖真的生效时也要留一行 info，理由写在原文里：
「Loud so field flips of the kill-switch are greppable in logs.」

出事的时候有人在改环境变量，那正是最不该靠"猜它有没有生效"的时刻。

⚠ 回落到默认（而不是回落到 False）是关键：`flag(x, default=True)` 遇到看不懂的
值必须还是 True。回落到 False 就等于把上面 ① 那个病做进了公共实现里。
"""

from __future__ import annotations

import os
from typing import Optional, Set

#: 真假词表——**全仓唯一一份**。判据见 tests/test_env_flags.py。
ON: frozenset = frozenset({"1", "true", "yes", "on"})
OFF: frozenset = frozenset({"0", "false", "no", "off"})

#: 已经喊过的 (开关名, 值)。热路径上每轮都读开关，不去重会把日志刷爆。
_SHOUTED: Set[tuple] = set()


def _shout(kind: str, name: str, raw: str, default: bool) -> None:
    key = (kind, name, raw)
    if key in _SHOUTED:
        return
    _SHOUTED.add(key)
    if kind == "invalid":
        print(
            f"[env_flags] ⚠ {name}={raw!r} 认不出来（只认 "
            f"{sorted(ON)} / {sorted(OFF)}），按默认值 {default} 处理。"
            f"——是不是拼错了？开关没生效。"
        )
    else:
        # 覆盖真的生效时留一行，出事时能 grep 到"当时到底开没开"。
        print(f"[env_flags] {name}={raw!r} 覆盖生效（默认 {default}）")


def parse(raw: object, *, default: bool, name: str = "") -> bool:
    """把一个**值**解析成布尔。空/None → default；认不出来 → default + 喊一声。

    给那些开关值不是直接从 os.environ 来的调用点用（配置字典、函数入参）。
    """
    text = str(raw if raw is not None else "").strip().lower()
    if not text:
        return default
    if text in ON:
        if not default:
            _shout("override", name or "<value>", text, default)
        return True
    if text in OFF:
        if default:
            _shout("override", name or "<value>", text, default)
        return False
    _shout("invalid", name or "<value>", text, default)
    return default


def flag(name: str, *, default: bool) -> bool:
    """读一个布尔环境开关。

    ⚠ `default` 是**声明**，不是猜测：认不出来的值回落到它，不是回落到 False。
    """
    return parse(os.environ.get(name), default=default, name=name)


def reset_shouted() -> None:
    """测试用：清掉"已经喊过"的记忆。"""
    _SHOUTED.clear()


def off_values() -> Set[str]:
    """测试与旧调用点用：跟仓里其它开关同一份词表——现在这句是真的了。"""
    return set(OFF)


def on_values() -> Set[str]:
    return set(ON)
