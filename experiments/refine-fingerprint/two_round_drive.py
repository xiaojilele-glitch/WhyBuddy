# -*- coding: utf-8 -*-
"""两轮真机直驱，**把两版模型原样落盘**，供 analyze_ids.py 反复分析。

跟第一版的区别只有一个：dump 模型。分析和跑分开——跑一次 15 分钟、要钱，
分析要改十遍。第一版把两件事焊在一起，结果拿到结论想换个算法就得重跑。
"""
import json
import os
import sys
import time

_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO, "slide-rule-python"))

os.environ.setdefault("SLIDERULE_SPEC_FIRST", "1")
os.environ.setdefault("SLIDERULE_LLM_GENERATE_ENABLED", "1")

OUT = os.environ.get("REFINE_FP_OUT") or os.path.dirname(os.path.abspath(__file__))


def model_of(state):
    versions = list(getattr(state, "modelVersions", None) or [])
    if versions and isinstance(versions[-1], dict):
        m = versions[-1].get("model")
        if isinstance(m, dict) and m:
            return m
    return None


def dump_pages(state, tag):
    """把这一轮的整页 HTML 也落盘。

    ⚠ 2026-08-17 补。原来只存模型，于是「效果」只能靠 JSON 里的 id 对比来讲，
      **看不到用户真正看到的东西**——本仓纪律五点名的形态：判据落在中间表征上。
      要截图给人看的时候才发现产物根本没留下来，只能重跑一轮。

    页面在 state.specFirstPages（v5_state 里那段注释写了为什么必须落状态）。
    """
    sp = getattr(state, "specFirstPages", None) or {}
    pages = sp.get("pages") or {}
    if not pages:
        print(f"[dump] {tag}：state 里没有整页 HTML（specFirstPages 空）", flush=True)
        return
    d = os.path.join(OUT, f"pages_{tag}")
    os.makedirs(d, exist_ok=True)
    for pid, html in pages.items():
        with open(os.path.join(d, f"{pid}.html"), "w", encoding="utf-8") as f:
            f.write(html if isinstance(html, str) else str(html))
    json.dump(
        {"navItems": sp.get("navItems"), "boundPages": sp.get("boundPages"),
         "pageIds": list(pages)},
        open(os.path.join(d, "_meta.json"), "w"), ensure_ascii=False, indent=1,
    )
    print(f"[dump] {tag}：落盘 {len(pages)} 页 HTML → {d}", flush=True)


def main():
    from services import v5_full_driver as drv
    from models.v5_state import V5SessionState

    drv.persist_state = lambda *a, **k: None

    goal = sys.argv[1] if len(sys.argv) > 1 else "做一个社区养老服务管理平台"
    state = V5SessionState(
        sessionId=f"local-{int(time.time())}",
        goal={"text": goal, "status": "ready"},
    )

    # max_loops=2：只要拿到一份模型就够了。第一版用 6，驱动器在第二轮之后
    # 又自己转了两圈重新生成，白烧十几分钟 LLM，对本次分析毫无用处。
    t0 = time.time()
    print(f"=== 第一轮：{goal} ===", flush=True)
    state = drv.drive_full_v5_session(state, max_loops=2, user_instruction=goal)
    m1 = model_of(state)
    if not m1:
        print("第一轮没产出模型，停")
        return 1
    json.dump(m1, open(f"{OUT}/model_round1.json", "w"), ensure_ascii=False, indent=1)
    pages1 = [p.get("name") or p.get("id") for p in (m1.get("page") or {}).get("pages") or []]
    dump_pages(state, "round1")
    print(f"第一轮完成 {time.time()-t0:.0f}s，页面：{pages1}", flush=True)

    target = pages1[-1] if pages1 else "列表页"
    instruction = f"「{target}」这一页的列表是空的，加点模拟数据"

    t1 = time.time()
    print(f"\n=== 第二轮：{instruction} ===", flush=True)
    state = drv.drive_full_v5_session(state, max_loops=2, user_instruction=instruction)
    m2 = model_of(state)
    if not m2:
        print("第二轮没产出模型，停")
        return 1
    json.dump(m2, open(f"{OUT}/model_round2.json", "w"), ensure_ascii=False, indent=1)
    pages2 = [p.get("name") or p.get("id") for p in (m2.get("page") or {}).get("pages") or []]
    dump_pages(state, "round2")
    print(f"第二轮完成 {time.time()-t1:.0f}s，页面：{pages2}", flush=True)
    print(f"\n两版模型已落盘：{OUT}/model_round{{1,2}}.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
