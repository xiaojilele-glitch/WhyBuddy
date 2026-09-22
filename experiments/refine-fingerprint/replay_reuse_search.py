# -*- coding: utf-8 -*-
"""离线 replay：现在的「从尾巴丢」漏掉了多少本可沿用的段？

## 问题

`apply_refine_segment_reuse` 过不了闸时用 `candidates.pop()` 从尾部丢，于是
**可达的沿用组合只有前缀**：

    {rbac, workflow, aigc} → {rbac, workflow} → {rbac} → {}

真机 off-1 的日志显示卡住的是 rbac（新生成的 page 引用了旧 rbac 没有的权限），
而 rbac 排在最前面，只有全丢光才轮到它。理想解「丢 rbac、留 workflow+aigc」
**当前算法永远够不到**。

## 这在学界有名字：ddmax

Kirschner/Gopinath/Zeller（ICSE 2020）把 ddmin 反过来用：不是找最小的致败子集，
而是找**最大的能通过的子集**，终止条件是 **1-maximal**——再加任何一个元素都会
失败。debuggingbook 的 `dd` 算法用 `'+'` 模式（`dd.max_args()`）做这件事。

对应关系：元素 = 三个可沿用段，测试 = 引用完整性闸，目标 = 能过闸的最大子集。
现实现的前缀下降**不是 1-maximal**。

## 为什么能离线跑

闸 `validate_five_system_model` 是纯函数，只吃 model dict。而且**退让到空的那些
轮，落盘的 model_round2.json 恰好就是"未经沿用的新生成版"**（退到空时原样返回
model），所以失败案例的 replay 输入是完整的、精确的，不用重跑真机。

⚠ 反过来，沿用**成功**的轮次 replay 不了：它们落盘的是已经替换过段的最终版，
  拿不到"新生成的那份"。所以本脚本只对退让到空/部分退让的轮次给结论，
  其余标 skip —— 别把 replay 不了当成"没问题"。

## 用法

    slide-rule-python/.venv/bin/python \
        experiments/refine-fingerprint/replay_reuse_search.py experiments/refine-fingerprint/runs
"""
import copy
import itertools
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(os.path.dirname(_HERE))
sys.path.insert(0, os.path.join(_REPO, "slide-rule-python"))

from services.spec_first_pipeline import REFINE_REUSABLE_SEGMENTS  # noqa: E402
from services.v5_model_gate import validate_five_system_model  # noqa: E402


def gate(model):
    """跟 spec_first_pipeline:791 那次过闸**同参**。换参数就是换尺子。"""
    return validate_five_system_model(
        model,
        require_landing_page_ref=True,
        require_preferred_device=True,
        require_page_kind_contract=False,
    )


def passes(fresh, baseline, subset):
    cand = dict(fresh)
    for seg in subset:
        cand[seg] = copy.deepcopy(baseline[seg])
    try:
        v = gate(cand)
    except Exception as exc:  # noqa: BLE001
        return False, f"闸抛异常 {type(exc).__name__}"
    if isinstance(v, dict) and v.get("passed"):
        return True, ""
    f = (v or {}).get("findings") or []
    return False, "；".join(f"{x.get('path')}：{x.get('message')}" for x in f[:2])[:160]


def prefix_chain(segs):
    """现实现能走到的组合：从全集开始，每次丢最后一个。"""
    out = []
    cur = list(segs)
    while True:
        out.append(tuple(cur))
        if not cur:
            break
        cur = cur[:-1]
    return out


def ddmax(fresh, baseline, segs):
    """1-maximal 子集：从空集起逐个试加，加得进就留下。

    n=3 时代价 n 次过闸（现实现 n+1）。真正的 ddmax 还会做分块二分，
    那是为了 n 很大时省测试次数；这里 n=3，直接线性试加就是最优形状，
    照搬分块反而把代码搞复杂。**借的是判据（1-maximal），不是它的循环结构。**
    """
    keep = []
    for seg in segs:
        ok, _ = passes(fresh, baseline, keep + [seg])
        if ok:
            keep.append(seg)
    return tuple(keep)


def main():
    runs_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(_HERE, "runs")
    segs = list(REFINE_REUSABLE_SEGMENTS)
    print(f"可沿用段（按现有顺序）：{segs}")
    print(f"现实现可达的组合（前缀链）：{[list(p) for p in prefix_chain(segs)]}\n")

    total = replayable = improved = 0
    for name in sorted(os.listdir(runs_dir)):
        d = os.path.join(runs_dir, name)
        log = os.path.join(d, "run.log")
        f1, f2 = os.path.join(d, "model_round1.json"), os.path.join(d, "model_round2.json")
        if not (os.path.exists(f1) and os.path.exists(f2) and os.path.exists(log)):
            continue
        total += 1
        text = open(log, encoding="utf-8", errors="replace").read()

        # 只有退让到空的轮次，round2 才是"未经沿用的新生成版"
        if "精修沿用逐段退让到空" not in text:
            print(f"{name:<8} skip —— 没有退让到空，落盘的是替换后的最终版，replay 不了")
            continue
        replayable += 1

        baseline, fresh = json.load(open(f1)), json.load(open(f2))
        avail = [s for s in segs if isinstance(baseline.get(s), (dict, list))]

        # 现实现：前缀链，取第一个能过的
        cur = ()
        for p in prefix_chain(avail):
            ok, _ = passes(fresh, baseline, list(p))
            if ok:
                cur = p
                break

        best = ddmax(fresh, baseline, avail)

        # 全枚举，确认 ddmax 没漏（n=3，8 个子集，白菜价）
        exhaustive = ()
        for r in range(len(avail), -1, -1):
            found = False
            for combo in itertools.combinations(avail, r):
                ok, _ = passes(fresh, baseline, list(combo))
                if ok:
                    exhaustive = combo
                    found = True
                    break
            if found:
                break

        flag = ""
        if len(best) > len(cur):
            flag = "  ★ 现实现漏了"
            improved += 1
        print(
            f"{name:<8} 现实现 {list(cur) or '空'!s:<28} "
            f"ddmax {list(best) or '空'!s:<28} 全枚举最优 {list(exhaustive) or '空'!s:<28}{flag}"
        )
        if len(exhaustive) > len(best):
            print(f"{'':<8} ⚠ ddmax 比全枚举差（贪心顺序吃亏）：{list(best)} < {list(exhaustive)}")

    print(f"\n共 {total} 轮，可 replay {replayable} 轮，其中现实现漏掉可沿用段的 {improved} 轮")
    if replayable and not improved:
        print("→ 前缀下降在这批数据上没有漏。那这个改动**不值得做**，"
              "别为了理论上的 1-maximal 去动一条正在跑的链路。")
    elif improved:
        print("→ 有真实漏失。改成 1-maximal 的收益是可量的，"
              "且代价从 n+1 次过闸变成 n 次，不涨。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
