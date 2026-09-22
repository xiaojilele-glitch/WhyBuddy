"""F2 agentic pick 对比评测：十话题 × 双模式（规则挑选 vs LLM 提案+门验收）。

跑法（仓库根目录，需 .env 带 LLM key）：
  cd slide-rule-python && .venv/bin/python scripts/agentic_pick_eval.py \
      [--topics N] [--parallel 5]

并发模型：每个 (话题, 模式) 用例一个独立子进程——模式开关
（SLIDERULE_AGENTIC_PICK）是进程级 env、会话存储是共享文件，进程内
并发必然串味/打架；子进程各带独立临时存储，父进程只做汇总。
并发度默认 5（LLM 网关承受力实测口径；开太高 429 限流反而变慢）。

对每个话题各跑两遍 drive_full_v5_session（同 max_loops），采集确定性指标：
  闭环证据 n/6、覆盖门、健康产物数/种类数、能力执行次数/去重数、
  耗时、agentic 决策台账条数。结果落 data/agentic-pick-eval.{json,md}
  ——用数据决定是否全面切换（北极星：AI 声称好不算数，脚本跑过才算数）。
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sliderule_llm.config import default_max_tokens  # noqa: E402

# 会话存储隔离（必须在导入 services 前设好——persistence 读 env 定位存储；
# 子进程模式下会被 _spawn_case 的独立路径覆盖）
_TMP = tempfile.mkdtemp(prefix="agentic-pick-eval-")
os.environ.setdefault("SLIDERULE_SESSIONS_FILE", str(Path(_TMP) / "sessions.json"))
os.environ.setdefault("SLIDERULE_LLM_GENERATE_ENABLED", "1")

TOPICS = [
    "社区宠物医院预约问诊系统",
    "连锁健身房私教课排期与核销平台",
    "阳台农夫 Pro——城市家庭种植智能顾问与植物医生",
    "二手乐器寄卖与鉴定平台",
    "小型律所案件流程与文书协作系统",
    "校园失物招领与积分激励平台",
    "民宿房态管理与动态定价助手",
    "跨境电商退货逆向物流跟踪系统",
    "社区团购团长供货对账平台",
    "剧本杀门店场次编排与拼车组局系统",
]

MODES = ("rules", "agentic")


def _metric_row(state, duration_s: float, closure: dict | None = None) -> dict:
    from services.v5_publish_closure_response import derive_publish_closure_response

    if closure is None:
        closure = derive_publish_closure_response(state) or {}
    # 闭环摘要口径：evidencePresentCount（此前误数 status=="ok"——摘要里
    # 根本没有该字段，量尺 bug 把闭环列钉死在 0，已修）
    evidence_n = int(closure.get("evidencePresentCount") or 0)
    stales = set(getattr(state, "staleArtifactIds", []) or [])
    healthy = [
        a for a in (getattr(state, "artifacts", []) or [])
        if (a.get("trustLevel") if isinstance(a, dict) else getattr(a, "trustLevel", None))
        in ("gated_pass", "audited")
        and (a.get("id") if isinstance(a, dict) else getattr(a, "id", None)) not in stales
    ]
    kinds = {
        (a.get("kind") if isinstance(a, dict) else getattr(a, "kind", None)) for a in healthy
    }
    runs = getattr(state, "capabilityRuns", []) or []
    cap_ids = [
        (r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", ""))
        for r in runs
    ]
    gate = getattr(state, "coverageGate", None)
    gate_passed = bool(gate.get("passed") if isinstance(gate, dict) else getattr(gate, "passed", False)) if gate else False
    agentic_decisions = sum(
        1
        for d in (getattr(state, "decisionLedger", []) or [])
        if "agentic-pick" in str(d.get("id") if isinstance(d, dict) else getattr(d, "id", ""))
    )
    return {
        "closureEvidence": evidence_n,
        "closureBlocked": bool(closure.get("blocked")),
        "coverageGatePassed": gate_passed,
        "healthyArtifacts": len(healthy),
        "artifactKinds": len(kinds - {None}),
        "capabilityRuns": len(cap_ids),
        "distinctCapabilities": len(set(cap_ids)),
        "staleArtifacts": len(stales),
        "awaitReason": str(getattr(state, "awaitReason", None)),
        "agenticDecisions": agentic_decisions,
        "durationS": round(duration_s, 1),
    }


def _open_questions(state) -> list[str]:
    """待答问题清单：openQuestions + open_question 缺口标题（去重限量）。"""
    qs: list[str] = []
    for q in (getattr(state, "openQuestions", []) or []):
        qs.append(str(q.get("text") if isinstance(q, dict) else q))
    for g in (getattr(state, "coverageGaps", []) or []):
        status = g.get("status") if isinstance(g, dict) else getattr(g, "status", None)
        kind = g.get("kind") if isinstance(g, dict) else getattr(g, "kind", None)
        if status == "open" and kind == "open_question":
            title = g.get("title") if isinstance(g, dict) else getattr(g, "title", "")
            if title:
                qs.append(str(title))
    seen: set[str] = set()
    out: list[str] = []
    for q in qs:
        q = q.strip()
        if q and q not in seen:
            seen.add(q)
            out.append(q)
    return out[:6]


def _simulated_owner_answer(topic: str, questions: list[str], closing: bool) -> str:
    """G2 模拟业主：LLM 扮演需求方逐条作答；失败回退 canned 答案。
    两版答案都刻意含 readiness 关键词（目标/范围/明确/补充——
    interactive_gates.user_clears_readiness 的解锁词表）；收口轮附带
    交付意图（激活规则版交付链，对两模式公平）。"""
    fallback = (
        f"补充明确：目标用户是「{topic}」的典型中小商家和个人用户，"
        "范围先做单店/单人版核心流程，预算有限，数据量不大，不接第三方支付。"
        + ("信息足够了，请综合结论并收口，出应用和交付报告。" if closing else "请继续深入推演。")
    )
    if not questions:
        return fallback
    try:
        from sliderule_llm.client import call_llm_json

        parsed, _res = call_llm_json(
            [
                {
                    "role": "system",
                    "content": (
                        "你扮演提出这个业务需求的业主。逐条、具体、果断地回答"
                        "推演引擎的问题（每条一两句，可自行虚构合理细节），"
                        "回答里自然带上目标用户、业务范围等明确信息。"
                        '只输出 JSON：{"answer":"合并成一段话的回答"}'
                    ),
                },
                {
                    "role": "user",
                    "content": f"业务：{topic}\n问题：\n"
                    + "\n".join(f"- {q}" for q in questions)
                    + ("\n（回答末尾请表达：信息够了，可以出应用和交付报告了）" if closing else ""),
                },
            ],
            temperature=0.4,
            max_tokens=default_max_tokens(),
            max_attempts=1,
            # 档位走 .env（见 config.py 那块墓碑）。评测尤其不该自己定档：
            # 模拟用户和被评测的产品链路必须在同一份配置下跑，否则测出来的数
            # 和线上不是一回事。
        )
        answer = str(parsed.get("answer") or "").strip()
        if len(answer) >= 14:
            return answer
    except Exception:
        pass
    return fallback


def _artifact_digest(state, per_limit: int = 900, max_items: int = 10) -> list[dict]:
    """产物内容摘录（②内容质量评测取材面）：健康产物的 kind/title/
    summary/content 截断版——judge 评的是内容本身，不是计数。"""
    stales = set(getattr(state, "staleArtifactIds", []) or [])
    out: list[dict] = []
    for a in (getattr(state, "artifacts", []) or []):
        d = a if isinstance(a, dict) else (a.model_dump() if hasattr(a, "model_dump") else {})
        if d.get("id") in stales or d.get("status") in ("stale", "superseded"):
            continue
        if d.get("trustLevel") not in ("gated_pass", "audited"):
            continue
        content = d.get("content") or ""
        if not isinstance(content, str):
            content = json.dumps(content, ensure_ascii=False)
        out.append(
            {
                "kind": str(d.get("kind") or ""),
                "title": str(d.get("title") or "")[:80],
                "summary": str(d.get("summary") or "")[:200],
                "content": content[:per_limit],
            }
        )
        if len(out) >= max_items:
            break
    return out


def run_one(
    topic: str, mode: str, max_loops: int, max_turns: int = 3,
    dump_artifacts: str | None = None,
) -> dict:
    """G2 多轮交互模拟：驱动 → 模拟业主答缺口（走产品 intake 同款
    解缺口/清停泊入口）→ 再驱动，直到闭环或轮次用尽。"""
    os.environ["SLIDERULE_AGENTIC_PICK"] = "on" if mode == "agentic" else "off"
    from models.v5_state import V5SessionState
    from services.slide_rule_interactive_gates import (
        apply_resolve_and_clear_readiness,
        apply_route_selection_resolution,
    )
    from services.v5_full_driver import drive_full_v5_session
    from services.v5_publish_closure_response import derive_publish_closure_response

    sid = f"eval-{mode}-{abs(hash(topic)) % 99999}"
    state = V5SessionState(
        sessionId=sid,
        goal={"text": topic, "status": "clear"},
        runtimePhase="idle",
    )
    t0 = time.time()
    text = topic
    turns = 0
    for turn in range(max_turns):
        turns += 1
        state = drive_full_v5_session(state, max_loops=max_loops, user_instruction=text)
        closure = derive_publish_closure_response(state) or {}
        if int(closure.get("evidencePresentCount") or 0) >= 6 and not closure.get("blocked"):
            break  # 模式自主收口成功，提前收工
        if turn == max_turns - 1:
            break
        closing = turn + 1 >= max_turns - 1  # 倒数第二轮的答案附带交付意图
        text = _simulated_owner_answer(topic, _open_questions(state), closing)
        # 产品 intake 同款入口：答案先解缺口/清停泊，再进下一轮驱动
        state = apply_resolve_and_clear_readiness(state, text)
        state = apply_route_selection_resolution(state, text)
    cap_ids = [
        (r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", ""))
        for r in (getattr(state, "capabilityRuns", []) or [])
    ]
    self_closed = any(
        "appbundle" in c.lower() or "runtimeclosure" in c.lower() for c in cap_ids
    )
    closure_summary = None
    if not self_closed:
        # 终局装配（两模式统一，对齐产品：装配由流程触发而非 pick）——
        # 闭环指标语义变为「本场推演攒下的证据够不够装配过门」
        try:
            from services.v5_capability_executor import execute_v5_capability
            from services.v5_publish_closure_response import _to_publish_closure_summary

            res = execute_v5_capability(
                "appbundle.runtimeclosure", state, [], "综合", "eval-assembly"
            )
            res_d = res if isinstance(res, dict) else (
                res.model_dump() if hasattr(res, "model_dump") else {}
            )
            closure_summary = (
                _to_publish_closure_summary(res_d.get("runtimeClosure") or {})
                or _to_publish_closure_summary(res_d)
            )
        except Exception as exc:
            print(f"[eval] terminal assembly failed: {str(exc)[:160]}", file=sys.stderr)
    row = _metric_row(state, time.time() - t0, closure=closure_summary)
    row["turns"] = turns
    row["selfClosed"] = self_closed
    if dump_artifacts:
        Path(dump_artifacts).write_text(
            json.dumps(
                {"topic": topic, "mode": mode, "artifacts": _artifact_digest(state)},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    return row


def _spawn_case(
    topic: str, mode: str, max_loops: int, max_turns: int,
    dump_artifacts: str | None = None,
    extra_env: dict | None = None,
) -> dict:
    """独立子进程跑单用例：模式开关/会话存储进程级隔离，互不串味。
    extra_env：额外进程级开关（E17 A/B 用它注入 SLIDERULE_EVIDENCE_CONTEXT）。"""
    env = {
        **os.environ,
        **(extra_env or {}),
        "SLIDERULE_AGENTIC_PICK": "on" if mode == "agentic" else "off",
        "SLIDERULE_SESSIONS_FILE": str(
            Path(tempfile.mkdtemp(prefix=f"ape-{mode}-")) / "sessions.json"
        ),
        "SLIDERULE_LLM_GENERATE_ENABLED": "1",
    }
    try:
        cmd = [sys.executable, __file__, "--one", f"{mode}::{topic}",
               "--max-loops", str(max_loops), "--max-turns", str(max_turns)]
        if dump_artifacts:
            cmd += ["--dump-artifacts", dump_artifacts]
        proc = subprocess.run(
            cmd,
            capture_output=True, text=True, env=env, cwd=str(ROOT),
            timeout=1200,
        )
        # 子进程 stdout 最后一行是结果 JSON（前面可能有生成日志噪音）
        for line in reversed((proc.stdout or "").strip().splitlines()):
            line = line.strip()
            if line.startswith("{"):
                return json.loads(line)
        return {"error": f"no result json (rc={proc.returncode}): {(proc.stderr or '')[-160:]}"}
    except subprocess.TimeoutExpired:
        return {"error": "case timeout (1200s)"}
    except Exception as exc:
        return {"error": str(exc)[:200]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--topics", type=int, default=len(TOPICS))
    parser.add_argument("--max-loops", type=int, default=6)
    parser.add_argument("--parallel", type=int, default=5)
    parser.add_argument("--max-turns", type=int, default=3)
    parser.add_argument("--one", type=str, default=None, help="内部用：mode::topic 单用例")
    parser.add_argument(
        "--dump-artifacts", type=str, default=None,
        help="内部用：产物内容摘录落这个路径（②内容质量评测取材）",
    )
    args = parser.parse_args()

    # 子进程入口：跑单用例，结果 JSON 打到 stdout 最后一行
    if args.one:
        mode, topic = args.one.split("::", 1)
        try:
            row = run_one(
                topic, mode, args.max_loops, max_turns=args.max_turns,
                dump_artifacts=args.dump_artifacts,
            )
        except Exception as exc:
            row = {"error": str(exc)[:200]}
        print(json.dumps(row, ensure_ascii=False), flush=True)
        return

    topics = TOPICS[: args.topics]
    cases = [(topic, mode) for topic in topics for mode in MODES]
    results: dict[str, dict[str, dict]] = {t: {} for t in topics}
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=max(1, args.parallel)) as pool:
        futures = {
            pool.submit(_spawn_case, topic, mode, args.max_loops, args.max_turns): (topic, mode)
            for topic, mode in cases
        }
        done = 0
        for fut in as_completed(futures):
            topic, mode = futures[fut]
            results[topic][mode] = fut.result()
            done += 1
            print(
                f"[{done}/{len(cases)}] {mode:8s} {topic[:24]} -> {results[topic][mode]}",
                flush=True,
            )
    print(f"total wall: {time.time() - t0:.0f}s", flush=True)

    out_json = ROOT / "data" / "agentic-pick-eval.json"
    out_json.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    # 汇总表（markdown）
    keys = [
        "closureEvidence", "coverageGatePassed", "healthyArtifacts", "artifactKinds",
        "capabilityRuns", "distinctCapabilities", "durationS", "turns",
    ]
    lines = ["# F2 agentic pick 对比评测", "", f"话题 {len(topics)} 个 × 双模式，max_loops={args.max_loops}", ""]
    lines.append("| 话题 | 模式 | 闭环证据 | 覆盖门 | 产物 | 种类 | 执行数 | 去重能力 | 耗时s | 轮数 |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|")
    agg = {m: {k: 0.0 for k in keys} | {"n": 0} for m in MODES}
    for topic, by_mode in results.items():
        for mode in MODES:
            row = by_mode.get(mode) or {}
            if "error" in row:
                lines.append(f"| {topic[:18]} | {mode} | 失败 | — | — | — | — | — | — |")
                continue
            lines.append(
                f"| {topic[:18]} | {mode} | {row['closureEvidence']}/6 | "
                f"{'过' if row['coverageGatePassed'] else '未过'} | {row['healthyArtifacts']} | "
                f"{row['artifactKinds']} | {row['capabilityRuns']} | "
                f"{row['distinctCapabilities']} | {row['durationS']} | {row.get('turns', 1)} |"
            )
            for k in keys:
                agg[mode][k] += float(row[k])
            agg[mode]["n"] += 1
    lines.append("")
    lines.append("## 均值")
    lines.append("| 模式 | 闭环证据 | 覆盖门通过率 | 产物 | 种类 | 执行数 | 去重能力 | 耗时s | 轮数 |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for mode in MODES:
        n = max(agg[mode]["n"], 1)
        lines.append(
            f"| {mode} | {agg[mode]['closureEvidence'] / n:.1f}/6 | "
            f"{agg[mode]['coverageGatePassed'] / n * 100:.0f}% | "
            f"{agg[mode]['healthyArtifacts'] / n:.1f} | {agg[mode]['artifactKinds'] / n:.1f} | "
            f"{agg[mode]['capabilityRuns'] / n:.1f} | {agg[mode]['distinctCapabilities'] / n:.1f} | "
            f"{agg[mode]['durationS'] / n:.0f} | {agg[mode]['turns'] / n:.1f} |"
        )
    out_md = ROOT / "data" / "agentic-pick-eval.md"
    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nJSON: {out_json}\nMD:   {out_md}")


if __name__ == "__main__":
    main()
