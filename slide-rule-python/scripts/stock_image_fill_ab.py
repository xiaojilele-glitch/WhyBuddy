#!/usr/bin/env python
"""库存图换图的 A/B 标定台：同一批**真实页面**，只搜整句 vs 逐级退让。

## 这个脚本为什么要留在仓里

`stock_images.build_query_ladder` 的形状（截尾巴不截前缀、and 处切断、
说明性尾词删到只剩一个词就退回）**全是按真实数据标定出来的**，不是设计出来的。
本仓第六条纪律：标定过的参数改了要连标定一起重跑，别只改数字。

改阶梯之前先跑这个，改完再跑一遍，看两个数：
  · 换掉几张（覆盖率）
  · 每一条**退让成了什么词**（有没有把主体退没了）

第二个数比第一个重要。模块头记着 2026-08-20 那次事故：**错图比没图更糟**。
覆盖率涨了但退让词跑题，是净亏。

## 2026-08-25 的基线（生产库里占位图最多的 3 个应用，36 张占位图）

    只搜整句（改动前）:  换掉  0 / 36  (0%)   耗时  9.3s
    逐级退让（改动后）:  换掉 35 / 36  (97%)  耗时 23.2s

  中途踩过的两版，都是**覆盖率好看但退让词跑题**，留作反面样本：
    截前缀:  89%，但 fresh organic red apples basket -> fresh organic red
                    customer picking up groceries ... -> customer picking up
                    Admin avatar portrait             -> Admin
    加「首词+尾巴」一级: 97%，与不加**一张不差**，只是命中从第 5 级挪到第 7 级，
                    多花 2.4s —— 想法讲得通、数据不认，已删。

## 用法

    # 需要本地后端在跑（默认 :9700），会**只读**拉真实应用，不写库
    slide-rule-python/.venv/bin/python slide-rule-python/scripts/stock_image_fill_ab.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import services.stock_images as SI  # noqa: E402

BASE = os.getenv("SLIDERULE_API", "http://127.0.0.1:9700/api/sliderule")
TOP_N_APPS = int(os.getenv("STOCK_AB_APPS", "3"))

_IMG = re.compile(r"<img\b[^>]*>", re.I | re.S)


def _get(url: str):
    return json.loads(urllib.request.urlopen(url, timeout=90).read().decode())


def _src(tag: str) -> str:
    m = re.search(r"""src\s*=\s*("([^"]*)"|'([^']*)')""", tag, re.I)
    return (m.group(2) or m.group(3) or "") if m else ""


def _count_placeholders(html: str) -> int:
    return sum(1 for t in _IMG.findall(html) if "placehold.co" in _src(t).lower())


def main() -> int:
    # ⚠ apps 列表是"取 N 条再过滤"的语义，limit 要给大。
    apps = _get(f"{BASE}/apps?limit=80").get("apps") or []
    if not apps:
        print("拿不到应用——后端在跑吗？私有应用需要登录态。")
        return 1

    picked = []
    for a in apps:
        rec = _get(f"{BASE}/apps/{a['id']}")
        pages = (rec.get("pages_json") or {}).get("pages") or {}
        n = sum(
            _count_placeholders(h) for h in pages.values() if isinstance(h, str)
        )
        if n:
            picked.append((n, a["id"], rec.get("goal") or "", pages))
    picked.sort(reverse=True)
    picked = picked[:TOP_N_APPS]
    if not picked:
        print("这些应用里没有占位图，没得比。")
        return 1
    print(f"选了占位图最多的 {len(picked)} 个应用：")
    for n, aid, goal, _ in picked:
        print(f"  {aid[:12]} 占位 {n:>3} 张  {goal[:40]}")

    full_ladder = SI.build_query_ladder

    def head_only(alt, aspect=None):
        """改动前的行为：只搜整句。"""
        return full_ladder(alt, aspect)[:1]

    for label, ladder in (("只搜整句（改动前）", head_only), ("逐级退让（改动后）", full_ladder)):
        SI.build_query_ladder = ladder
        before = after = 0
        secs = 0.0
        for _n, _aid, goal, pages in picked:
            cache: dict = {}
            for _pid, html in pages.items():
                if not isinstance(html, str):
                    continue
                b = _count_placeholders(html)
                if not b:
                    continue
                t0 = time.time()
                out = SI.fill_stock_placeholders(
                    html, spec={}, goal=goal, cache=cache
                )
                secs += time.time() - t0
                before += b
                after += _count_placeholders(out)
        filled = before - after
        pct = (100 * filled / before) if before else 0
        print(
            f"{label}: 换掉 {filled}/{before} ({pct:.0f}%)，"
            f"剩 {after} 张占位，耗时 {secs:.1f}s"
        )
    SI.build_query_ladder = full_ladder
    print(
        "\n⚠ 数字之外**必须**看上面 [stock_images] fill 退让N级 那些行："
        "退让成了什么词。主体退没了就是净亏，覆盖率再高也不算改好。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
