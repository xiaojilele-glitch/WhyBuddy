"""②内容质量评测器：LLM judge 盲评产物内容（agentic pick 转正的最后一块）。

G2 终裁留下的口径：闭环/覆盖门两模式已打平（10/10），agentic 的
+90% 探索多样性值不值 2x 成本，取决于**产物内容**是否更好——计数
指标到头了，就评内容本身。

跑法（仓库根目录，需 .env 带 LLM key）：
  cd slide-rule-python && .venv/bin/python scripts/content_quality_eval.py \
      [--topics N] [--parallel 3]

方法（评测有效性三道防线）：
- 盲评：judge 只见「甲/乙」，不知道哪个是 agentic；
- 换位：每话题按 topic 哈希决定甲乙顺序（确定性、约各半），位置偏置
  在聚合里对冲；
- 双向复核：每话题评两次（原序 + 换序），两次都判同一真实模式赢才记
  strict win，否则记平——单次判决的抖动不作数。

四维（1-5）：针对性（贴话题还是通用模板味）、完整性（五系统覆盖）、
一致性（系统间互相咬合）、可操作性（能直接照着建）。
裁决规则（写死，跑完照读）：agentic strict wins > rules strict wins
→ 建议转正（默认开）；否则维持默认关。
结果落 data/content-quality-eval.{json,md}。
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from agentic_pick_eval import MODES, TOPICS, _spawn_case  # noqa: E402
from sliderule_llm.config import default_max_tokens  # noqa: E402

DIMENSIONS = ("针对性", "完整性", "一致性", "可操作性")


def _candidate_text(dump: dict, total_limit: int = 9000) -> str:
    parts: list[str] = []
    used = 0
    for a in dump.get("artifacts") or []:
        block = f"[{a.get('kind')}] {a.get('title') or ''}\n{a.get('summary') or ''}\n{a.get('content') or ''}".strip()
        if used + len(block) > total_limit:
            block = block[: max(0, total_limit - used)]
        parts.append(block)
        used += len(block)
        if used >= total_limit:
            break
    return "\n\n---\n\n".join(p for p in parts if p) or "（无健康产物）"


def _judge_once(topic: str, first: dict, second: dict) -> dict | None:
    """单次盲评：first→甲、second→乙。返回 {scores:{甲:{维度:分}},winner}。"""
    from sliderule_llm.client import call_llm_json

    dims = "、".join(DIMENSIONS)
    parsed, _res = call_llm_json(
        [
            {
                "role": "system",
                "content": (
                    "你是严格的产品评审。两份匿名候选（甲/乙）是同一业务需求"
                    "由两套推演引擎生成的应用产物摘录（五系统模型+报告）。"
                    f"逐维打分（{dims}，各 1-5 整数）并判哪份整体更好。"
                    "评内容质量本身：贴合该业务的具体判断 > 放之四海皆准的模板话。"
                    '只输出 JSON：{"scores":{"甲":{"针对性":n,"完整性":n,"一致性":n,"可操作性":n},'
                    '"乙":{...}},"winner":"甲"|"乙"|"平","reason":"一句话"}'
                ),
            },
            {
                "role": "user",
                "content": (
                    f"业务需求：{topic}\n\n=== 候选甲 ===\n{_candidate_text(first)}"
                    f"\n\n=== 候选乙 ===\n{_candidate_text(second)}"
                ),
            },
        ],
        temperature=0.1,
        max_tokens=default_max_tokens(),
        max_attempts=2,
        # 档位走 .env（见 config.py 那块墓碑）。评判官更不该自己定档——
        # 少想的裁判打出来的分不能用来判产出好坏。
    )
    scores = parsed.get("scores") or {}
    winner = str(parsed.get("winner") or "").strip()
    if winner not in ("甲", "乙", "平") or "甲" not in scores or "乙" not in scores:
        return None
    return {"scores": scores, "winner": winner, "reason": str(parsed.get("reason") or "")[:200]}


def _avg(scores: dict) -> float:
    vals = [float(scores.get(d) or 0) for d in DIMENSIONS]
    return round(sum(vals) / len(vals), 2) if vals else 0.0


def judge_topic(topic: str, dumps: dict[str, dict], arms: tuple[str, str] = MODES) -> dict:
    """双向复核：原序 + 换序各评一次，映射回真实臂名后取一致判决。
    arms 缺省是 (rules, agentic)；E17 A/B 传 (baseline, piped)。"""
    swap = (hash(topic) % 2) == 1  # 确定性换位：约一半话题后臂在甲位
    order1 = (arms[1], arms[0]) if swap else (arms[0], arms[1])
    votes: list[str] = []  # 每次评审映射回真实臂名（或 "平"）
    rounds: list[dict] = []
    per_mode_scores: dict[str, list[float]] = {m: [] for m in arms}
    for order in (order1, tuple(reversed(order1))):
        verdict = _judge_once(topic, dumps[order[0]], dumps[order[1]])
        if verdict is None:
            votes.append("无效")
            continue
        label_to_mode = {"甲": order[0], "乙": order[1]}
        votes.append(label_to_mode.get(verdict["winner"], "平"))
        for label, mode in label_to_mode.items():
            per_mode_scores[mode].append(_avg(verdict["scores"].get(label) or {}))
        rounds.append({"order": order, **verdict})
    strict = votes[0] if len(votes) == 2 and votes[0] == votes[1] and votes[0] in arms else "平"
    return {
        "topic": topic,
        "votes": votes,
        "strictWinner": strict,
        "avgScore": {
            m: round(sum(v) / len(v), 2) if v else None for m, v in per_mode_scores.items()
        },
        "rounds": rounds,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--topics", type=int, default=len(TOPICS))
    parser.add_argument("--max-loops", type=int, default=6)
    parser.add_argument("--max-turns", type=int, default=3)
    parser.add_argument("--parallel", type=int, default=3)
    args = parser.parse_args()

    topics = TOPICS[: args.topics]
    dump_dir = Path(tempfile.mkdtemp(prefix="content-quality-"))
    cases = [(t, m) for t in topics for m in MODES]
    dump_paths = {
        (t, m): str(dump_dir / f"{abs(hash((t, m))) % 999999}.json") for t, m in cases
    }

    # 阶段一：跑 2×N 场推演，攒产物内容（复用 F2/G2 的隔离子进程 harness）
    print(f"[phase1] {len(cases)} runs, parallel={args.parallel}", flush=True)
    t0 = time.time()
    rows: dict[str, dict[str, dict]] = {t: {} for t in topics}
    with ThreadPoolExecutor(max_workers=max(1, args.parallel)) as pool:
        futures = {
            pool.submit(
                _spawn_case, t, m, args.max_loops, args.max_turns, dump_paths[(t, m)]
            ): (t, m)
            for t, m in cases
        }
        done = 0
        for fut in as_completed(futures):
            t, m = futures[fut]
            rows[t][m] = fut.result()
            done += 1
            print(f"[{done}/{len(cases)}] {m:8s} {t[:24]} -> {rows[t][m]}", flush=True)

    # 阶段二：盲评（双向复核串行跑——judge 也走同一个网关，别挤爆）
    print(f"[phase2] judging {len(topics)} topics x2 rounds", flush=True)
    judged: list[dict] = []
    for t in topics:
        dumps = {}
        for m in MODES:
            p = Path(dump_paths[(t, m)])
            if p.exists():
                dumps[m] = json.loads(p.read_text(encoding="utf-8"))
        if len(dumps) != len(MODES):
            judged.append({"topic": t, "error": "missing dumps", "strictWinner": "无效"})
            continue
        result = judge_topic(t, dumps)
        judged.append(result)
        print(f"[judge] {t[:24]} -> {result['strictWinner']} {result['avgScore']}", flush=True)

    wins = {m: sum(1 for j in judged if j.get("strictWinner") == m) for m in MODES}
    ties = sum(1 for j in judged if j.get("strictWinner") == "平")
    verdict = (
        "agentic 转正（建议默认开）" if wins["agentic"] > wins["rules"]
        else "维持默认关（内容质量未胜出）"
    )
    payload = {
        "topics": len(topics),
        "strictWins": wins,
        "ties": ties,
        "verdict": verdict,
        "judged": judged,
        "runs": rows,
        "wallS": round(time.time() - t0),
    }
    out_json = ROOT / "data" / "content-quality-eval.json"
    out_json.parent.mkdir(exist_ok=True)
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# ② 内容质量评测（LLM judge 盲评 + 双向复核）",
        "",
        f"话题 {len(topics)} 个 × 双模式；strict win = 原序/换序两次盲评一致。",
        "",
        "| 话题 | strict 胜者 | rules 均分 | agentic 均分 | 两次判决 |",
        "|---|---|---|---|---|",
    ]
    for j in judged:
        avg = j.get("avgScore") or {}
        lines.append(
            f"| {j['topic'][:18]} | {j.get('strictWinner')} | {avg.get('rules', '—')} | "
            f"{avg.get('agentic', '—')} | {' / '.join(j.get('votes') or ['—'])} |"
        )
    lines += [
        "",
        f"## 终局：rules {wins['rules']} 胜 · agentic {wins['agentic']} 胜 · 平 {ties}",
        "",
        f"**裁决（规则写死在脚本头）：{verdict}**",
    ]
    out_md = ROOT / "data" / "content-quality-eval.md"
    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nJSON: {out_json}\nMD:   {out_md}\n{verdict}")


if __name__ == "__main__":
    main()
