# -*- coding: utf-8 -*-
"""窄化的依赖必须**声明在 requirements.txt 里**（2026-08-11）。

## 为什么值得单独一个文件钉它

`block_narrowing` 对 `rank_bm25` 是 fail-open 的——装不上就退回全量目录。
fail-open 本身是对的：少一个包不该让整条生成挂掉。

但它造成一个很难发现的失效形态：**功能整个没生效，而所有测试照样绿**。
因为其余用例只要 select_blocks 返回一个合法列表就满意，全量也是合法列表。

2026-08-11 实测踩到：`rank_bm25` 压根不在 requirements.txt 里，而 Dockerfile
只装那一个文件。按当时的状态部署上去，那份 0.67 → 3.25（p=0.00004）的效果
一点都不会有，线上也看不出任何异常。

所以这里钉两头：

  ① 装了没有   —— 直接 import。CI 与本地环境缺包时立刻红，而不是等到
                   某个断言"恰好"也能被全量满足。
  ② 声明了没有 —— 读 requirements.txt。装了但没声明同样会在下次建镜像时消失，
                   这正是本次事故的形状。

只测"能 import"不够，只测"有声明"也不够，两条缺一不可。
"""

import re
from pathlib import Path

REQUIREMENTS = Path(__file__).resolve().parent.parent / "requirements.txt"


def test_rank_bm25_装上了():
    # 刻意**不**用 pytest.importorskip：缺了就该红，不是跳过。
    # 跳过等于把"生产会静默失效"降级成一条绿色的 skip 提示。
    from rank_bm25 import BM25Okapi  # noqa: F401


def test_rank_bm25_声明在requirements里():
    """Dockerfile 只 COPY 并安装 requirements.txt —— 没声明就等于生产没有。"""
    text = REQUIREMENTS.read_text(encoding="utf-8")
    declared = [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    assert any(
        re.match(r"^rank[-_]bm25\b", line, re.IGNORECASE) for line in declared
    ), "rank-bm25 没在 requirements.txt 里声明——建镜像时会漏掉，窄化会静默退回全量"


def test_窄化在装齐依赖时真的窄了():
    """终判：不是问"有没有包"，是问"窄化到底生效没有"。

    这条同时兜住另一种失效——包装上了、声明也有，但窄化因为别的原因退回全量。
    """
    from services.block_narrowing import narrowing_limit, select_blocks
    from services.schema_legal import EXPERIENCE_BLOCKS

    enabled = [b for b in EXPERIENCE_BLOCKS if b.get("generationEnabled")]
    picked = select_blocks(
        enabled,
        "做一个告警值班与静默管理系统：按标签路由到值班组，配置静默时段和升级策略",
        limit=narrowing_limit(),
    )
    assert len(picked) < len(enabled), (
        f"窄化没生效：注入了 {len(picked)}/{len(enabled)} 个区块。"
        "依赖装齐、开关默认开的情况下这里必须变少。"
    )


def test_缺依赖时会喊一声_而不是闷头退回全量():
    """静默 fail-open 是这次事故的成因，所以降级路径必须留声音。"""
    import services.block_narrowing as N

    N._WARNED.clear()
    calls = []
    original = N._warn_once
    N._warn_once = lambda msg: (calls.append(msg), original(msg))[1]
    try:
        import builtins

        real_import = builtins.__import__

        def fake_import(name, *args, **kwargs):
            if name == "rank_bm25":
                raise ImportError("模拟依赖缺失")
            return real_import(name, *args, **kwargs)

        builtins.__import__ = fake_import
        try:
            from services.schema_legal import EXPERIENCE_BLOCKS

            enabled = [b for b in EXPERIENCE_BLOCKS if b.get("generationEnabled")]
            out = N.select_blocks(
                enabled, "做一个告警值班与静默管理系统，配置静默时段", limit=N.narrowing_limit()
            )
        finally:
            builtins.__import__ = real_import
    finally:
        N._warn_once = original
        N._WARNED.clear()

    assert len(out) == len(enabled), "缺依赖时应当退回全量（fail-open 不变）"
    assert calls, "退回全量了却一声不吭——这正是本次事故看不出来的原因"
    assert "rank_bm25" in calls[0] and "退回全量" in calls[0]
