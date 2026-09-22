"""区块选材度量台：目录里 358 个区块，实际够得到的有多少？

    cd slide-rule-python
    set -a && . ../.env && set +a

    # 对照臂（关掉窄化）——2026-08-11 起窄化默认开，做对照必须显式关
    .venv/bin/python scripts/block_selection_metrics.py --narrowing off --runs 3

    # 处理臂（窄化）
    .venv/bin/python scripts/block_selection_metrics.py --narrowing on --runs 3


    # 不花钱：拿已经存下来的模型重算指标
    .venv/bin/python scripts/block_selection_metrics.py --from-models "/tmp/*_model.json"

## 为什么要这个东西

2026-08-10 实测钉死：区块选材的天花板是**位置**，不是措辞、不是内容匹配、
也不是描述缺失（三个解释逐一排除过，见 services/schema_legal.py 里
_promote_blocks_for_experiment 的头注）。原第 279 名的 OnCallScheduleCalendar
原样目录下三趟一次没被选，挪到第 15 位后三趟全选。

接下来要做目录窄化。**而窄化的效果不能只看『选中率』**——位置只决定谁
进得了候选，进了候选之后 preset 形状仍主导选材（同一批实验里，提到第 2 位的
AlertSilenceForm 三趟仍然输给 DataTable + RecordFormDialog）。只看选中率
会得出"窄化没用"的错误结论。

所以这里把两层**分开量**：

    可达覆盖率  = 对题/特定场景区块有多少落在可达区（前 W 名）  ← 窄化管这层
    选中率      = 其中真正被写进 page.blocks 的有多少            ← preset 管这层

## 诚实纪律（照 eval_five_system_generation.py 的老规矩）

  · 生成失败、过闸失败一律如实报，不折算不美化；
  · 「可达区 = 前 W 名」是**经验窗口**（实测选中项从未超过原名次 52，
    W 默认 50），不是代码里的硬边界——它是观测值，会随 prompt 变化而变，
    所以报告里始终把 W 和实际观测到的最远名次一起打出来；
  · 「对题区块」名单是人工标的（见 data/block_selection_cases.json），
    只用于算对题命中；跨用例可比的那一维走目录自带的 generality 字段。
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parent.parent))  # slide-rule-python/

CASES_FILE = _HERE.parent / "data" / "block_selection_cases.json"


# ── 目录视图 ────────────────────────────────────────────────────────────────


def catalog_view() -> Dict[str, Any]:
    """当前进程看到的目录：原始顺序 + generality。

    「原名次」始终按目录原始顺序算——窄化臂里若拿注入后的顺序当原名次，报告就
    再也看不出"这个件本来在多深"。
    """
    from services import schema_legal as L

    now = [str(b["type"]) for b in L.EXPERIENCE_BLOCKS if b.get("generationEnabled")]
    orig_blocks = [b for b in L._load_experience_blocks() if b.get("generationEnabled")]
    orig = [str(b["type"]) for b in orig_blocks]
    generality = {str(b["type"]): str(b.get("generality") or "unknown") for b in orig_blocks}
    return {"now": now, "orig": orig, "generality": generality}


def ordering_for_arm(arm: str, case: Dict[str, Any]) -> List[str]:
    """某个臂**实际注入 prompt 时**的目录顺序。

    复用 schema_legal._promote_blocks_for_experiment 本体（临时设 env 后调用），
    而不是在这里重写一遍换序逻辑——重写必然和生产实现漂移。

    为什么需要它：`--from-models` 一个进程里要同时分析两个臂的模型，而"可达区"
    是按**注入顺序**算的。第一版只按 --arm 算了一份顺序，于是处理臂的
    『对题件在可达区内』被拿对照臂的顺序去量，报出 0/16 —— 而它们明明在前 16 位。
    这种错会让整张表看着"实验没效果"。
    """
    from services import schema_legal as L

    # ── 2026-08-11：注入顺序跟着**真实开关**走，不跟 `--arm` 这个标签走 ──────
    #
    # 上面那段头注记的是"第一版自算顺序 → 报成 0/16"。今天又踩了一次，换了个入口：
    # `--arm control --narrowing on`。提示词是窄化过的（30 个），可达区却拿全量
    # 目录的前 50 名去量，于是 16 个对题件一个都不在窗口里——报出 0/16，而窄化
    # 其实把 14/16 都挑进来了。
    #
    # 根因是**两个轴被当成一个**：`--arm` 是实验臂标签，`--narrowing` 是生产开关，
    # 两者可以不一致；而窄化已经是生产默认开，所以**缺省调用（arm=control）永远
    # 会误报第 1 层**。
    #
    # 所以判据改成问生产本体"你现在到底窄化了没有"，标签只用来分组/命名。
    # 这跟头注那条纪律是同一条：可达区必须按**实际注入**的顺序算。
    from services.block_narrowing import narrowing_enabled

    if arm == "narrowed" or narrowing_enabled():
        # 窄化臂：注入顺序 = select_blocks 的返回顺序。复用生产本体，不在这里重算
        # ——第一版自算顺序导致覆盖率报成 0/16。
        from services.block_narrowing import (
            narrowing_limit,
            preset_block_names,
            select_blocks,
        )

        enabled = [b for b in L.EXPERIENCE_BLOCKS if b.get("generationEnabled")]
        picked = select_blocks(
            enabled,
            case["goal"],
            limit=narrowing_limit(),
            mandatory=preset_block_names(L.PAGE_KIND_PRESETS),
        )
        return [str(b["type"]) for b in picked]

    # 其余臂用原始目录顺序。（曾有两个实验臂建在 SLIDERULE_EXP_* 开关上，判定完成
    # 后开关与臂一并移除；结论见 docs/block-narrowing-eval.md 与 schema_legal.py
    # 里那两段留档注释。）
    return [
        str(b["type"]) for b in L._load_experience_blocks() if b.get("generationEnabled")
    ]


def _pos(seq: List[str], t: str) -> Optional[int]:
    return seq.index(t) + 1 if t in seq else None


# ── 单份模型 → 指标 ─────────────────────────────────────────────────────────


def blocks_of(model: Dict[str, Any]) -> List[str]:
    out: List[str] = []
    for pg in ((model.get("page") or {}).get("pages")) or []:
        out += [str(b.get("type")) for b in (pg.get("blocks") or [])]
    return out


def page_rows(model: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = []
    for pg in ((model.get("page") or {}).get("pages")) or []:
        rows.append(
            {
                "id": str(pg.get("id")),
                "kind": str(pg.get("kind")),
                "blocks": [str(b.get("type")) for b in (pg.get("blocks") or [])],
            }
        )
    return rows


#: 首轮过闸失败按**裁决原文**分族。
#
# 为什么不能只按 code 分：A 族（人员字段类型不符）和 B 族（workflowRef 指错
# 种类的 id）都报 PUBLISH_DANGLING_CROSSREF，同一个 code。2026-08-10 实测 7 趟
# 全部首轮未过，就是这两族各占一半、且**互不重叠**——只看 code 计数会把两个
# 完全不同的病混成一个数，改了一个也看不出效果。
_FINDING_FAMILIES: List[tuple] = [
    # assigneeFieldRef 'group_ref' must be a string field (got 'ref')
    ("fieldref_type", re.compile(r"must be a[n]?\s+\w+\s+field\s+\(got", re.I)),
    ("dangling_workflowref", re.compile(r"workflowRef\s+'[^']+'\s+not found", re.I)),
    ("dangling_permissionref", re.compile(r"permissionRef\s+'[^']+'\s+not found", re.I)),
    ("dangling_pageref", re.compile(r"pageRef\s+'[^']+'\s+not found", re.I)),
    ("takes_no_binding", re.compile(r"takes no binding", re.I)),
]


def classify_finding(f: Dict[str, Any]) -> str:
    msg = str(f.get("message") or f.get("detail") or "")
    for name, pat in _FINDING_FAMILIES:
        if pat.search(msg):
            return name
    return f"other:{f.get('code')}"


def gate_verdicts(model: Dict[str, Any], goal: str) -> Dict[str, Any]:
    """两档过闸判定。

    raw  = 直接拿 LLM 原样输出过闸（宽松默认参数）
    prod = 复刻生产链路的**确定性**前处理再按生产严格度过闸：
             确定性修复 → 设备归一 → require_landing_page_ref + require_preferred_device

    生产在 prod 失败后还有一次 gate-feedback 的 LLM 修补重生成；这里**不做**
    （那要多花一次调用，且不影响选材结论）。所以 prod 读作"首轮过闸率"，
    它是真实通过率的**下界**。
    """
    from services.v5_model_gate import validate_five_system_model

    out: Dict[str, Any] = {}
    try:
        raw = validate_five_system_model(model)
        out["raw_passed"] = bool(raw.get("passed"))
    except Exception as exc:  # noqa: BLE001
        out["raw_passed"] = None
        out["raw_error"] = str(exc)[:160]

    try:
        from services.device_policy import normalize_model_preferred_device
        from services.v5_model_repair import repair_five_system_model

        prepared = repair_five_system_model(model)["model"]
        prepared = normalize_model_preferred_device(goal, prepared)
        prod = validate_five_system_model(
            prepared, require_landing_page_ref=True, require_preferred_device=True
        )
        out["prod_first_pass_passed"] = bool(prod.get("passed"))
        codes: Dict[str, int] = {}
        fams: Dict[str, int] = {}
        msgs: List[str] = []
        all_findings = [f for f in (prod.get("findings") or []) if isinstance(f, dict)]
        # 分族/计数吃**全量**；只有留存的原文样本才截断。
        # 第一版把 [:40] 加在这个循环上，于是一趟真有 48 条的时候报出来正好是
        # "40 条"——一个看着像真实计数的整数。差点据此说"40 条级联"。
        out["prod_finding_total"] = len(all_findings)
        for f in all_findings:
            codes[str(f.get("code"))] = codes.get(str(f.get("code")), 0) + 1
            fam = classify_finding(f)
            fams[fam] = fams.get(fam, 0) + 1
            if len(msgs) < 40:  # 只截原文样本，不截计数
                msgs.append(f"[{fam}] {str(f.get('message') or f.get('detail') or '')[:150]}")
        out["prod_finding_codes"] = codes
        out["prod_finding_families"] = fams
        out["prod_finding_messages"] = msgs
    except Exception as exc:  # noqa: BLE001
        out["prod_first_pass_passed"] = None
        out["prod_error"] = str(exc)[:160]
    return out


def measure(
    model: Dict[str, Any],
    case: Dict[str, Any],
    cat: Dict[str, Any],
    window: int,
    now: Optional[List[str]] = None,
) -> Dict[str, Any]:
    orig, gen = cat["orig"], cat["generality"]
    # `now` = 这一趟**实际注入**的顺序。必须由调用方按臂传进来（见
    # ordering_for_arm 的头注）；缺省退回进程当前顺序只为兼容单臂调用。
    now = now if now is not None else cat["now"]
    on_topic = [t for t in case.get("onTopicBlocks") or [] if t in orig]
    point_named = [t for t in case.get("pointNamed") or [] if t in orig]

    used = blocks_of(model)
    used_set = sorted(set(used))
    used_orig_pos = [p for p in (_pos(orig, t) for t in used) if p]

    # 可达区（按**本次注入时的实际顺序** now 算——窄化/换序就是改它）
    def in_window(t: str) -> bool:
        p = _pos(now, t)
        return p is not None and p <= window

    return {
        "pages": len(page_rows(model)),
        "blocks_total": len(used),
        "distinct_types": len(used_set),
        "max_orig_pos_used": max(used_orig_pos) if used_orig_pos else None,
        "orig_pos_used": sorted(used_orig_pos),
        # ── 第 1 层：可达覆盖率（窄化要抬的就是这三个数）──
        "window": window,
        "on_topic_total": len(on_topic),
        "on_topic_in_window": sum(1 for t in on_topic if in_window(t)),
        "specific_in_window": sum(
            1 for t in now[:window] if gen.get(t) == "specific"
        ),
        # ── 第 2 层：选中率 ──
        "on_topic_selected": sorted(t for t in on_topic if t in used_set),
        "point_named_selected": sorted(t for t in point_named if t in used_set),
        "specific_selected": sorted(t for t in used_set if gen.get(t) == "specific"),
        "generic_selected": sorted(t for t in used_set if gen.get(t) == "generic"),
        "page_rows": page_rows(model),
    }


# ── 跑一趟真实生成 ──────────────────────────────────────────────────────────


def run_once(case: Dict[str, Any], cat: Dict[str, Any], window: int, save_dir: Optional[Path], arm: str, idx: int, now: Optional[List[str]] = None) -> Dict[str, Any]:
    from services.v5_capability_executor import _recognize_domain
    from services.v5_llm_generate import generate_five_system_model, get_generate_diagnostic

    goal = case["goal"]
    domain = _recognize_domain(goal)
    t0 = time.time()
    model = generate_five_system_model(goal)
    dt = time.time() - t0

    rec: Dict[str, Any] = {
        "arm": arm,
        "run": idx,
        "seconds": round(dt, 1),
        "recognized_domain": domain,
    }
    if not isinstance(model, dict):
        rec["generated"] = False
        rec["diagnostic"] = get_generate_diagnostic()
        return rec

    rec["generated"] = True
    rec.update(gate_verdicts(model, goal))
    rec.update(measure(model, case, cat, window, now=now))
    if save_dir:
        save_dir.mkdir(parents=True, exist_ok=True)
        p = save_dir / f"{case['id']}_{arm}_{idx}_model.json"
        p.write_text(json.dumps(model, ensure_ascii=False, indent=2), encoding="utf-8")
        rec["model_path"] = str(p)
    return rec


# ── 报告 ────────────────────────────────────────────────────────────────────


def _fmt_ratio(hits: List[int], total: Optional[int]) -> str:
    if not hits:
        return "-"
    body = ", ".join(str(h) for h in hits)
    return f"[{body}]" + (f" / {total}" if total is not None else "")


def report(records: List[Dict[str, Any]], case: Dict[str, Any], window: int) -> str:
    ok = [r for r in records if r.get("generated")]
    lines: List[str] = []
    lines.append(f"用例            : {case['id']}")
    lines.append(f"题目            : {case['goal'][:60]}…")
    lines.append(f"可达窗口 W      : 前 {window} 名（经验值，非硬边界）")
    try:
        from rank_bm25 import BM25Okapi

        from services import block_narrowing as N
        from services import schema_legal as _L

        _en = [b for b in _L.EXPERIENCE_BLOCKS if b.get("generationEnabled")]
        _bm = BM25Okapi([N._weighted_tokens(b, N._LEXICON["fieldWeights"]) for b in _en])
        _q = N.tokenize_query(N.expand_intent(case["goal"]))
        _conf = N.retrieval_confidence(_bm.get_scores(_q), len(_q))
        _thr = N.narrowing_confidence_threshold()
        # 必须把**开关状态**也打出来。只报置信度判定的话，对照臂（窄化关）也会
        # 显示"→ 窄化"，读报告的人会以为两臂一样——这类"报告本身骗人"本场已经
        # 踩过五次，不再多一次。
        _on = N.narrowing_enabled()
        if not _on:
            _verdict = "开关已关，本臂注全量"
        elif _conf >= _thr:
            _verdict = "窄化"
        else:
            _verdict = "★置信度不足，退回全量"
        lines.append(
            f"窄化开关        : {'开' if _on else '关'}\n"
            f"检索置信度      : {_conf:.3f} (阈值 {_thr:.3f} → {_verdict})"
        )
    except Exception as exc:  # noqa: BLE001 — 报告里的附加信息，算不出不影响主指标
        lines.append(f"检索置信度      : n/a ({str(exc)[:60]})")
    lines.append(f"趟数            : {len(records)}（成功生成 {len(ok)}）")
    if not ok:
        lines.append("\n全部生成失败，无指标可算。")
        for r in records:
            lines.append(f"  run {r.get('run')}: {r.get('diagnostic')}")
        return "\n".join(lines)

    by_arm: Dict[str, List[Dict[str, Any]]] = {}
    for r in ok:
        by_arm.setdefault(str(r["arm"]), []).append(r)

    for arm, rs in by_arm.items():
        lines.append("")
        lines.append("=" * 66)
        lines.append(f"{arm.upper()}  (n={len(rs)})")
        lines.append("-" * 66)
        lines.append("── 第 1 层 · 可达覆盖率（目录窄化要抬这个）──")
        lines.append(
            f"  对题件在可达区内   : {_fmt_ratio([r['on_topic_in_window'] for r in rs], rs[0]['on_topic_total'])}"
        )
        lines.append(
            f"  可达区里的特定场景件: {_fmt_ratio([r['specific_in_window'] for r in rs], None)}  (目录共 325 个 specific)"
        )
        lines.append("── 第 2 层 · 选中率（preset 形状主导这个）──")
        lines.append(
            f"  对题件被选中       : {_fmt_ratio([len(r['on_topic_selected']) for r in rs], rs[0]['on_topic_total'])}"
        )
        lines.append(
            f"  点名件被选中       : {_fmt_ratio([len(r['point_named_selected']) for r in rs], len(case.get('pointNamed') or []))}"
        )
        lines.append(
            f"  特定场景件被选中   : {_fmt_ratio([len(r['specific_selected']) for r in rs], None)}"
        )
        lines.append("── 形态 / 门禁 / 时延 ──")
        lines.append(f"  页面数             : {[r['pages'] for r in rs]}")
        lines.append(f"  区块数 / 去重类型  : {[r['blocks_total'] for r in rs]} / {[r['distinct_types'] for r in rs]}")
        lines.append(f"  用到的最远【原名次】: {[r['max_orig_pos_used'] for r in rs]}")
        lines.append(f"  过闸 raw           : {[r.get('raw_passed') for r in rs]}")
        lines.append(f"  过闸 prod 首轮     : {[r.get('prod_first_pass_passed') for r in rs]}")
        secs = [r["seconds"] for r in rs]
        if any(s > 0 for s in secs):
            lines.append(
                f"  生成秒数           : {secs}  (中位 {statistics.median(secs):.1f}s)"
            )
        else:
            lines.append("  生成秒数           : n/a（重算模式，未实跑）")

        freq: Dict[str, int] = {}
        for r in rs:
            for t in r["on_topic_selected"]:
                freq[t] = freq.get(t, 0) + 1
        if freq:
            lines.append("  对题件被选频次     :")
            for t, c in sorted(freq.items(), key=lambda kv: -kv[1]):
                lines.append(f"     {t:<26} {c}/{len(rs)}")
        else:
            lines.append("  对题件被选频次     : 全部 0")

        fam_runs: Dict[str, int] = {}
        fam_items: Dict[str, int] = {}
        for r in rs:
            for k, v in (r.get("prod_finding_families") or {}).items():
                fam_runs[k] = fam_runs.get(k, 0) + 1
                fam_items[k] = fam_items.get(k, 0) + v
        if fam_runs:
            lines.append("  首轮未过的裁决分族（趟数 / 条数）:")
            for k in sorted(fam_runs, key=lambda x: -fam_runs[x]):
                lines.append(
                    f"     {k:<26} {fam_runs[k]}/{len(rs)} 趟   共 {fam_items[k]} 条"
                )
        else:
            lines.append("  首轮未过的裁决分族  : 无（全部通过）")

    if len(by_arm) == 2 and "control" in by_arm:
        other = [a for a in by_arm if a != "control"][0]
        lines.append("")
        lines.append("=" * 66)
        lines.append(f"对照：control vs {other}")

        def avg(a, key, f=len):
            vals = [f(r[key]) if not isinstance(r[key], int) else r[key] for r in by_arm[a]]
            return sum(vals) / len(vals)

        for label, key in (
            ("可达区内对题件", "on_topic_in_window"),
            ("被选中对题件", "on_topic_selected"),
            ("被选中特定场景件", "specific_selected"),
        ):
            lines.append(
                f"  {label:<18}: control {avg('control', key):.2f}  →  {other} {avg(other, key):.2f}"
            )
    return "\n".join(lines)


# ── main ───────────────────────────────────────────────────────────────────


def load_case(case_id: Optional[str]) -> Dict[str, Any]:
    data = json.loads(CASES_FILE.read_text(encoding="utf-8"))
    cases = data["cases"]
    if case_id:
        for c in cases:
            if c["id"] == case_id:
                return c
        raise SystemExit(f"用例不存在: {case_id}（可选: {[c['id'] for c in cases]}）")
    return cases[0]


def main() -> int:
    ap = argparse.ArgumentParser(description="区块选材度量台")
    ap.add_argument("--case", default=None, help="用例 id（默认第一个）")
    ap.add_argument("--arm", default="control", choices=["control", "narrowed"])
    # ⚠️ 2026-08-11 起窄化**默认开**，所以"不设环境变量"不再等于对照臂。
    #    必须显式声明，否则跑出来的两臂其实是同一个。
    ap.add_argument(
        "--narrowing",
        default=None,
        choices=["on", "off"],
        help="显式指定窄化开关（默认沿用当前环境/产品默认值）。做对照实验必须显式给。",
    )
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--window", type=int, default=50, help="可达窗口 W，默认前 50 名")
    ap.add_argument("--save-dir", default=None, help="把每趟原始模型存起来")
    ap.add_argument("--json-out", default=None, help="指标写成 JSON")
    ap.add_argument(
        "--from-models",
        default=None,
        help="不调 LLM：对已存下的模型 JSON（glob）重算指标",
    )
    args = ap.parse_args()

    case = load_case(args.case)

    if args.narrowing is not None:
        os.environ["SLIDERULE_BLOCK_CATALOG_NARROWING"] = (
            "1" if args.narrowing == "on" else "0"
        )

    cat = catalog_view()
    records: List[Dict[str, Any]] = []

    if args.from_models:
        paths = sorted(glob.glob(args.from_models))
        if not paths:
            raise SystemExit(f"没匹配到模型文件: {args.from_models}")
        for i, p in enumerate(paths, 1):
            model = json.loads(Path(p).read_text(encoding="utf-8"))
            name = Path(p).name
            if name.startswith("nw_") or "narrow" in name:
                arm = "narrowed"
            else:
                arm = "control"
            rec = {"arm": arm, "run": i, "seconds": 0.0, "generated": True, "source": p}
            rec.update(gate_verdicts(model, case["goal"]))
            rec.update(measure(model, case, cat, args.window, now=ordering_for_arm(arm, case)))
            records.append(rec)
            print(f"[reanalyze] {Path(p).name} -> arm={arm}")
    else:
        os.environ.setdefault("SLIDERULE_LLM_GENERATE_ENABLED", "1")
        save_dir = Path(args.save_dir) if args.save_dir else None
        live_now = ordering_for_arm(args.arm, case)
        # 报告里说清这一趟的可达区是按哪份顺序算的。不打这一行，`--arm control
        # --narrowing on` 这种组合就会静默按窄化顺序量，而表头写着 CONTROL——
        # 读表的人无从分辨（今天先踩了反向那次：按标签量，报出 0/16）。
        from services.block_narrowing import narrowing_enabled as _nw

        print(
            f"[顺序] 可达区按 {'窄化后' if (args.arm == 'narrowed' or _nw()) else '全量目录'}"
            f"顺序算（{len(live_now)} 个），臂标签={args.arm}、窄化开关="
            f"{'开' if _nw() else '关'}",
            flush=True,
        )
        for i in range(1, args.runs + 1):
            print(f"[run {i}/{args.runs}] arm={args.arm} …", flush=True)
            records.append(
                run_once(case, cat, args.window, save_dir, args.arm, i, now=live_now)
            )

    text = report(records, case, args.window)
    print("\n" + text)

    if args.json_out:
        Path(args.json_out).write_text(
            json.dumps(
                {
                    "generatedAt": datetime.now(timezone.utc).isoformat(),
                    "case": case["id"],
                    "window": args.window,
                    "records": records,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"\nJSON: {args.json_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
