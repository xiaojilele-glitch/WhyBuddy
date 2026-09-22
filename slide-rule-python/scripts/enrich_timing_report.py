"""把 [enrich-timing] 日志行汇总成一张基线表。

埋点本身只负责"打出来"，这个脚本负责"读回去"——没有它，那些行只是又一批
日志噪音（生产日志里 90% 已经是 /health，见
docs/enrich-pipeline-parallelization-audit-2026-07-31.md「十、2」）。

用法：
    # 本地：dev-all 的日志
    .venv/bin/python scripts/enrich_timing_report.py dev-all.log

    # 生产：先从 Render 拉下来再喂进来
    .venv/bin/python scripts/enrich_timing_report.py render-python.log

    # 或者直接管道
    tail -f dev.log | .venv/bin/python scripts/enrich_timing_report.py -

输出按 stage 聚合（次数/总耗时/均值/最大/失败数），并单独列出可并行的那几段
——那正是并行化改造前后要对比的量。
"""

from __future__ import annotations

import sys
from collections import defaultdict

_PREFIX = "[enrich-timing]"

# 可并行的阶段（审查文档「八、7」）：改造前后主要看这几行的总耗时变化。
_PARALLELIZABLE = {
    "monitor.sheet": "① 参照板生图（每页一张，彼此独立）",
    "monitor.design": "③ 权威设备单档设计（desktop 或 phone）",
    "freeform.block": "② 区块生成（当前灰度下不触发）",
    "block.screenshot": "E2B 截图自检（此前只能夹逼估算 29~69s）",
}


def parse_line(line: str) -> dict | None:
    i = line.find(_PREFIX)
    if i < 0:
        return None
    fields = {}
    for tok in line[i + len(_PREFIX):].strip().split():
        k, _, v = tok.partition("=")
        if k:
            fields[k] = v
    if "stage" not in fields or "ms" not in fields:
        return None
    try:
        fields["ms"] = int(fields["ms"])
    except ValueError:
        return None
    return fields


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    src = sys.stdin if args[0] == "-" else open(args[0], encoding="utf-8", errors="replace")

    samples: dict[str, list[int]] = defaultdict(list)
    failures: dict[str, int] = defaultdict(int)
    skipped: dict[str, int] = defaultdict(int)  # got=0：跳过了（预算撞顶/能力不可用）
    with src:
        for line in src:
            f = parse_line(line)
            if not f:
                continue
            st = f["stage"]
            samples[st].append(f["ms"])
            if f.get("ok") == "0":
                failures[st] += 1
            if f.get("got") == "0":
                skipped[st] += 1

    if not samples:
        print("没有找到任何 [enrich-timing] 行。")
        print("检查：① 这一轮真的跑过推演吗 ② SLIDERULE_ENRICH_TIMING 是不是被设成 0 了")
        return 1

    print(f"{'stage':<22}{'次数':>5}{'总计s':>9}{'均值s':>8}{'最大s':>8}{'失败':>5}{'跳过':>5}")
    print("-" * 62)
    grand = 0
    for st in sorted(samples, key=lambda s: -sum(samples[s])):
        v = samples[st]
        total = sum(v)
        grand += total
        print(
            f"{st:<22}{len(v):>5}{total/1000:>9.1f}{total/len(v)/1000:>8.1f}"
            f"{max(v)/1000:>8.1f}{failures[st]:>5}{skipped[st]:>5}"
        )
    print("-" * 62)
    # 注意：各 stage 有嵌套（monitor.design 里套着 block.screenshot），所以
    # 这里是各段之和、不是墙钟时间。真墙钟看 *.total 那几行。
    print(f"{'各段之和（含嵌套重复计）':<22}{'':>5}{grand/1000:>9.1f}")

    totals = {s: sum(v) for s, v in samples.items() if s.endswith(".total")}
    if totals:
        print()
        print("墙钟（三段 enrich 各自的真实耗时）：")
        for s, ms in sorted(totals.items(), key=lambda kv: -kv[1]):
            print(f"  {s:<20}{ms/1000:>8.1f}s")
        print(f"  {'合计':<20}{sum(totals.values())/1000:>8.1f}s")

    par = {s: sum(v) for s, v in samples.items() if s in _PARALLELIZABLE}
    if par:
        print()
        print("可并行的部分（改造前后对比这里）：")
        for s, ms in sorted(par.items(), key=lambda kv: -kv[1]):
            print(f"  {s:<20}{ms/1000:>8.1f}s  ×{len(samples[s]):<3} {_PARALLELIZABLE[s]}")
        print(f"  {'小计':<20}{sum(par.values())/1000:>8.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
