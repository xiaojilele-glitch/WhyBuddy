# -*- coding: utf-8 -*-
"""id 冻结 A/B 多轮编排：把 n=1 的"方向"跑成"幅度"。

## 为什么要这个脚本

2026-08-17 那次 A/B **每臂只有 n=1**。方向一致、幅度大（六类里五类从近乎全灭
到近乎全中），但单轮下不了统计结论——交接文档第六节自己也是这么写的。
尤其 `page.pages` 两臂 0/3 vs 3/3，而它**根本不在词表里**（`model_id_lexicon`
只收 entities / roles / workflowNodes），那 3/3 多半是运气。要把它跟真正被
干预的那几类分开，只能靠重复。

## 这个脚本比"手跑几遍 two_round_drive"多出来的三件事

1. **每轮自证开关生效**（最重要）。`SLIDERULE_REFINE_ID_FREEZE` 是用 env 读的，
   而实验进程是 subprocess——传丢了不会报错，只会让两臂**悄悄变成同一臂**，
   跑出一份"看起来有 n=6 其实是 6 个 ON"的假数据，比 n=1 更糟。
   所以每轮跑完必须在日志里找到本臂的特征行，找不到就判这轮作废：

       ON  → "精修 id 冻结：实体 N、角色 N、流程节点 N"
       OFF → "id 冻结被开关关掉（SLIDERULE_REFINE_ID_FREEZE=0）"

   这是纪律一（先确认哪条链真的在跑）的直接应用，只不过对象是 env 开关。

2. **fail-closed 的 LLM 校验**。README 已经警告过：不导 .env 会**静默**降级成
   "没配 LLM"、跑出一份 fallback 结果，看起来像成功。这里在开跑前就查一次，
   缺 key 直接拒绝启动——烧 40 分钟拿一堆 fallback 是这类实验最贵的失败。

3. **可续跑**。十几轮真机随时可能被打断（超时、限流、中转站抽风）。已经跑完
   并通过自证的轮次直接跳过，不重烧钱。

## 用法

    set -a && . .env && set +a
    slide-rule-python/.venv/bin/python experiments/refine-fingerprint/ab_multi_run.py --repeats 5

产物：`runs/<arm>-<i>/model_round{1,2}.json` + 同目录 `run.log`（原始日志留着，
后面查"闸为什么放行/拒绝"全靠它）。分析用 aggregate_ab.py。
"""
import argparse
import json
import os
import subprocess
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(os.path.dirname(_HERE))
_PY = os.path.join(_REPO, "slide-rule-python", ".venv", "bin", "python")
_DRIVE = os.path.join(_HERE, "two_round_drive.py")

DEFAULT_GOAL = "做一个社区养老服务管理平台"

# 每臂的特征行。改这两条前先确认 spec_first_pipeline.py 里的打印没变——
# 判据盯字面量最容易在源码改词后**静默失效**（本仓踩过：判据写
# "Produce the complete" 而实际收尾是 "Produce the five-system JSON now."，
# 断言直接打空）。所以这里配一条反向判据：ON 的日志里不许出现 OFF 的特征行。
#
# 每个臂 = 一组 env + 一条**只有这个臂才会出现**的日志特征行。
#
# ⚠ 2026-08-17 深夜加了第二组臂（v1/v2）。它们跟 on/off **不是同一个维度**：
#   on/off 变的是 id 冻结；v1/v2 里冻结**固定开**，变的是沿用策略。
#   所以别在同一批里混跑 on,off,v1,v2——那是两个自变量一起动，跑出来的差值
#   归不了因。要跑就 `--arms on,off` 或 `--arms v1,v2`。
ARMS = {
    # 第一组：id 冻结开 / 关
    "on": {
        "env": {"SLIDERULE_REFINE_ID_FREEZE": "1"},
        "mark": "精修 id 冻结：",
    },
    "off": {
        "env": {"SLIDERULE_REFINE_ID_FREEZE": "0"},
        "mark": "id 冻结被开关关掉",
    },
    # 第二组：冻结固定开，比"新沿用策略"和"老沿用策略"
    #   v2 = 1-maximal 退让 + rbac 吃增量（现在的默认）
    #   v1 = 按序从尾巴丢 + 不合并权限（2026-08-17 傍晚之前的行为）
    "v2": {
        "env": {
            "SLIDERULE_REFINE_ID_FREEZE": "1",
            "SLIDERULE_REFINE_REUSE_1MAXIMAL": "1",
            "SLIDERULE_REFINE_RBAC_MERGE": "1",
        },
        "mark": "1maximal=on rbacmerge=on",
    },
    "v1": {
        "env": {
            "SLIDERULE_REFINE_ID_FREEZE": "1",
            "SLIDERULE_REFINE_REUSE_1MAXIMAL": "0",
            "SLIDERULE_REFINE_RBAC_MERGE": "0",
        },
        "mark": "1maximal=off rbacmerge=off",
    },
}


def preflight_llm():
    """fail-closed：没配 LLM 就别开跑。"""
    key = os.environ.get("LLM_API_KEY") or ""
    base = os.environ.get("LLM_BASE_URL") or ""
    model = os.environ.get("LLM_MODEL") or ""
    gen = os.environ.get("SLIDERULE_LLM_GENERATE_ENABLED") or ""
    problems = []
    if len(key) < 20:
        problems.append(f"LLM_API_KEY 缺失或过短（len={len(key)}）")
    if not base:
        problems.append("LLM_BASE_URL 未设置")
    if not model:
        problems.append("LLM_MODEL 未设置")
    if gen not in ("1", "true", "True"):
        problems.append(f"SLIDERULE_LLM_GENERATE_ENABLED={gen!r}（需为 1）")
    if problems:
        print("[ab] 拒绝启动 —— LLM 未正确配置，跑下去只会得到 fallback 结果：")
        for p in problems:
            print(f"  · {p}")
        print("\n  修法： set -a && . .env && set +a")
        return False
    print(f"[ab] LLM 预检通过：model={model} base={base} keyLen={len(key)}")
    return True


def run_done(d):
    """这轮是否已经跑完且自证通过（可续跑用）。"""
    return all(
        os.path.exists(os.path.join(d, f"model_round{i}.json")) for i in (1, 2)
    ) and os.path.exists(os.path.join(d, "OK"))


def verify_arm(log_text, arm, all_arms):
    """开关真的生效了吗？正反两条都要过。

    ⚠ 反向那条要拿**本批实际在跑的其余臂**去比，不能写死"另一个臂"。
      第一版写死 on/off 互为对臂；加了 v1/v2 之后那种写法会拿错的串去比，
      而比错了**不会报错**——只会让自证形同虚设，正是它本来要防的那件事。
    """
    want = ARMS[arm]["mark"]
    if want not in log_text:
        return False, f"日志里没有本臂特征行 {want!r} —— 开关很可能没传进去"
    for other in all_arms:
        if other == arm:
            continue
        mark = ARMS[other]["mark"]
        if mark in log_text:
            return False, (
                f"日志里出现了**对臂 {other}** 的特征行 {mark!r} —— 两臂被跑成了同一臂"
            )
    return True, ""


def one_run(arm, idx, goal, runs_dir, timeout_s, all_arms):
    d = os.path.join(runs_dir, f"{arm}-{idx}")
    os.makedirs(d, exist_ok=True)
    if run_done(d):
        print(f"[ab] {arm}-{idx} 已完成，跳过")
        return "skip", 0.0

    env = dict(os.environ)
    env.update(ARMS[arm]["env"])
    env["REFINE_FP_OUT"] = d
    env["PYTHONUNBUFFERED"] = "1"

    t0 = time.time()
    knobs = " ".join(f"{k.replace('SLIDERULE_REFINE_', '')}={v}" for k, v in ARMS[arm]["env"].items())
    print(f"[ab] ▶ {arm}-{idx} 开跑（{knobs}）", flush=True)
    log_path = os.path.join(d, "run.log")
    with open(log_path, "w", encoding="utf-8") as lf:
        try:
            proc = subprocess.run(
                [_PY, _DRIVE, goal],
                cwd=_REPO,
                env=env,
                stdout=lf,
                stderr=subprocess.STDOUT,
                timeout=timeout_s,
            )
            rc = proc.returncode
        except subprocess.TimeoutExpired:
            rc = -9
            lf.write(f"\n[ab] 超时 {timeout_s}s，已杀\n")
    dt = time.time() - t0

    log_text = open(log_path, encoding="utf-8", errors="replace").read()
    if rc != 0:
        print(f"[ab] ✗ {arm}-{idx} 退出码 {rc}（{dt:.0f}s），作废。日志：{log_path}")
        return "fail", dt

    ok, why = verify_arm(log_text, arm, all_arms)
    if not ok:
        print(f"[ab] ✗ {arm}-{idx} 开关自证失败：{why}")
        return "unverified", dt

    if not all(os.path.exists(os.path.join(d, f"model_round{i}.json")) for i in (1, 2)):
        print(f"[ab] ✗ {arm}-{idx} 缺模型落盘，作废")
        return "fail", dt

    open(os.path.join(d, "OK"), "w").write(f"{arm} {dt:.0f}s\n")
    print(f"[ab] ✓ {arm}-{idx} 完成（{dt:.0f}s），开关自证通过")
    return "ok", dt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeats", type=int, default=5, help="每臂跑几轮")
    ap.add_argument("--goal", default=DEFAULT_GOAL)
    ap.add_argument("--runs-dir", default=os.path.join(_HERE, "runs"))
    ap.add_argument("--timeout", type=int, default=1500, help="单轮超时（秒）")
    ap.add_argument("--arms", default="on,off")
    args = ap.parse_args()

    if not preflight_llm():
        return 2

    os.makedirs(args.runs_dir, exist_ok=True)
    arms = [a.strip() for a in args.arms.split(",") if a.strip()]
    tally = {}
    t0 = time.time()

    # 交替跑，不是先跑完一臂再跑另一臂：中转站的状态、限流、模型侧的波动都随
    # 时间漂，按臂分块会把"时间"混进"处理"里——那正是这一整天反复栽的形态。
    for i in range(1, args.repeats + 1):
        for arm in arms:
            status, dt = one_run(arm, i, args.goal, args.runs_dir, args.timeout, arms)
            tally[status] = tally.get(status, 0) + 1

    print(f"\n[ab] 全部结束，用时 {(time.time()-t0)/60:.1f} 分钟")
    print(f"[ab] 统计：{json.dumps(tally, ensure_ascii=False)}")
    print(f"[ab] 分析： python3 {os.path.join(_HERE, 'aggregate_ab.py')} {args.runs_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
