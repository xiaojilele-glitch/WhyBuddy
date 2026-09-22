"""新旧两条链路对照：翻默认开关之前唯一的依据。

## 为什么要有这一轮

`SLIDERULE_SPEC_FIRST` 原本缺省 off，翻默认要有对照。先例摆在那儿：目录窄化
攒够 3 覆盖域 × 2 臂 × n=6（p=0.00004）才翻默认，agentic pick 十话题 4:0 才转正。
这条链一轮 8~9 分钟、烧十几次 LLM。

⚠ **2026-08-14 已由用户拍板翻成默认开，而对照只跑到 n=3。** 也就是说这个
脚本的活儿没干完：它当时给出的是「过闸 3/3 vs 2/3、页数恒 5 vs 4~6、字段
利用率 95% vs 71%」，够不上前两次翻默认的量级。要补的话直接 --n 加大接着跑，
两臂入口都还在。

## 两臂

    OLD  generate_five_system_model(goal)      一句话发明全部（架构图 ⛔1）
    NEW  run_spec_first(goal)                  spec → HTML → 结构 → 语义 → 汇合

两臂产出的都是完整六段，**过同一个 v5_model_gate**，所以可比。

⚠ 这一轮比的是**产出质量**，不是接线是否正确——接线那 28 条用例已经钉住了
（开关口径 / 失败留痕 / 探针 effective / 不引编排依赖）。所以这里直接调两个
入口，不绕 `_try_llm_generate_evidence`，省掉一层无关变量。

## 判据：只用已经硬起来的那几个

  · 结构闸 passed / findings 数        —— 二元机械，两臂同一个闸
  · 实体 / 字段 / 页面 / 角色 / 节点数  —— 数得出来
  · 每页绑定数（仅 NEW）               —— 老链路没有这个概念
  · **渲染出来的页面**                 —— 判据的最后一道，交给人看

⚠ 前四次对照都栽在「造一个数去替代看一眼」上（数字段 / 数语义标签 / 拿没加载
Tailwind 的截图当证据 / 角色可溯率）。所以这里的数只当线索，**结论由渲染结果
决定**——NEW 那臂的 HTML 会落盘，用 render_pages.cjs 出图。

⚠ 一轮不是结论。runner.py 的默认就是 --n 3，理由是方差极大：同一个提示词两轮
之间控件数能从 30 掉到 19。这里默认也是 3。
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import time

_HERE = pathlib.Path(__file__).resolve().parent
_ROOT = _HERE.parent.parent
sys.path.insert(0, str(_ROOT / "slide-rule-python"))
for _line in (_ROOT / ".env").read_text(encoding="utf-8").splitlines():
    _line = _line.strip()
    if _line and not _line.startswith("#") and "=" in _line:
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
os.environ["SLIDERULE_SESSION_LOCAL_IMPORT"] = "0"

OUT = _HERE / "runs" / "ab-spec-first"


def measure(model: dict | None, gate: dict | None) -> dict:
    if not model:
        return {"过闸": "—", "findings": "—", "实体": 0, "字段": 0,
                "页面": 0, "角色": 0, "节点": 0}
    dm = model.get("datamodel") or {}
    ents = dm.get("entities") or []
    pages = (model.get("page") or {}).get("pages") or []
    roles = (model.get("rbac") or {}).get("roles") or []
    wf = model.get("workflow") or {}
    nodes = wf.get("nodes") or []
    return {
        "过闸": "过" if (gate or {}).get("passed") else "拦",
        "findings": len((gate or {}).get("findings") or []),
        "实体": len(ents),
        "字段": sum(len(e.get("fields") or []) for e in ents),
        "页面": len(pages),
        "角色": len(roles),
        "节点": len(nodes),
    }


def run_old(goal: str) -> tuple[dict | None, dict | None, float]:
    from services.v5_llm_generate import generate_five_system_model
    from services.v5_model_gate import validate_five_system_model

    t0 = time.time()
    try:
        model = generate_five_system_model(goal)
    except Exception as exc:  # noqa: BLE001 — 一臂挂了不该带走另一臂
        print(f"    OLD 挂了：{str(exc)[:160]}", flush=True)
        return None, None, time.time() - t0
    gate = validate_five_system_model(model) if model else None
    return model, gate, time.time() - t0


def run_new(goal: str, out: pathlib.Path) -> tuple[dict | None, dict | None, float, dict]:
    from services.spec_first_pipeline import run_spec_first
    from services.v5_model_gate import validate_five_system_model

    t0 = time.time()
    try:
        res = run_spec_first(goal)
    except Exception as exc:  # noqa: BLE001
        print(f"    NEW 挂了：{str(exc)[:200]}", flush=True)
        return None, None, time.time() - t0, {}
    model = res["model"]
    gate = validate_five_system_model(model)
    # HTML 落盘 —— 结论最后由渲染结果决定，不由上面那几个数决定
    for pid, html in (res.get("pages") or {}).items():
        (out / f"NEW_{pid}.html").write_text(html, encoding="utf-8")
    extra = {
        "页面HTML": len(res.get("pages") or {}),
        "失败页": len(res.get("failedPages") or {}),
        "各步耗时": {k: round((v or {}).get("ms", 0) / 1000) for k, v in (res.get("stages") or {}).items()},
    }
    return model, gate, time.time() - t0, extra


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--goal", default=(
        "社区药房的处方调配与库存管理系统：接收电子处方、药师审方、按方调配、"
        "扣减批次库存并记录效期，缺药时生成补货建议"))
    ap.add_argument("--n", type=int, default=3, help="跑几轮取中位数（一轮不是结论）")
    ap.add_argument("--tag", default="")
    ap.add_argument("--only", choices=["old", "new"], default="")
    args = ap.parse_args()

    out = OUT / (args.tag or time.strftime("%m%d-%H%M"))
    out.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []

    for i in range(1, args.n + 1):
        print(f"\n{'='*66}\n第 {i}/{args.n} 轮\n{'='*66}", flush=True)
        row: dict = {"round": i}
        if args.only != "new":
            m, g, cost = run_old(args.goal)
            row["OLD"] = {**measure(m, g), "墙钟": round(cost)}
            print(f"  OLD {row['OLD']}", flush=True)
        if args.only != "old":
            m, g, cost, extra = run_new(args.goal, out)
            row["NEW"] = {**measure(m, g), "墙钟": round(cost), **extra}
            print(f"  NEW {row['NEW']}", flush=True)
        rows.append(row)
        (out / "ab.json").write_text(
            json.dumps({"goal": args.goal, "rounds": rows}, ensure_ascii=False, indent=2),
            encoding="utf-8")

    print(f"\n{'='*66}\n汇总（一轮不是结论，看中位数；最终判据是渲染出来的页面）\n{'='*66}")
    for key in ("过闸", "findings", "实体", "字段", "页面", "角色", "节点", "墙钟"):
        line = f"{key:9s}"
        for arm in ("OLD", "NEW"):
            vals = [r[arm][key] for r in rows if arm in r]
            line += f"  {arm}={vals}"
        print(line)
    print(f"\n产物：{out}")
    print("渲染看图：node experiments/visual-first/render_pages.cjs " + str(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
