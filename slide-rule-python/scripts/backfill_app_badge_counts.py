"""给存量应用补 role_count / ai_count —— 默认 dry-run，看清楚了再 --apply。

## 为什么需要它

2026-08-22 之前，`generated_app` 的列表摘要只有 entity_count / page_count。
卡片上要显示"几个角色、几个 AI 能力"，前端只能对每张卡再打一次
`GET /apps/{id}` 把整包 model_json + pages_json 拉下来数一遍——首屏 30 张卡
就是 30 次请求、1.9 MB，全为了两个数字。

摘要补上这两列之后，**新存的**应用自动带；**存量的**全是 NULL。NULL 在卡片
上按"不知道"处理（不是"0 个"，理由见 app_store.derive_app_metadata 的
_count_or_none），所以存量卡片的这两个徽标是空的。这个脚本把它们数出来。

## 数法：复用 derive_app_metadata，不在 SQL 里另写一套

用 `jsonb_array_length(model_json->'rbac'->'roles')` 能省掉把 model_json
拉下来的流量，但那是把同一份语义写第二遍——"section 不是 object 就算数不出来"
"空数组是 0 不是 NULL"这些判断会在两处各活一份，改一处不改另一处必然静默
分叉（CLAUDE.md 第四条）。全库 model_json 加起来 323 kB（80 行），把它拉下来
用生产代码自己的函数数，比省这点流量值。

数不出来的（模型里没有 rbac / aigc 这一段、或者形状是坏的）**不动**，保持
NULL。宁可让徽标空着，也不要写一个 0 ——那是在断言"这个应用没有角色"。

## 用法

    cd slide-rule-python
    .venv/bin/python scripts/backfill_app_badge_counts.py            # 看要改什么
    .venv/bin/python scripts/backfill_app_badge_counts.py --apply    # 真写
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app  # noqa: F401,E402  —— 触发 .env 加载
from services.app_store import (  # noqa: E402
    HttpSqlGateway,
    derive_app_metadata,
    http_api_credentials,
)

APPLY = "--apply" in sys.argv

#: 一次拉多少行 model_json。80 行 323 kB 本可以一把拉完，分批只是为了别让
#: 这个脚本随着库变大某天突然拉几十 MB 进内存。
_BATCH = 50


def main() -> int:
    url, key = http_api_credentials()
    if not (url and key):
        print("没配 APP_STORE_HTTP_API_URL / _KEY，这个脚本只处理库后端。")
        return 1
    g = HttpSqlGateway(url, key)

    ids = [
        r["id"]
        for r in g.query(
            "select id from generated_app"
            " where role_count is null or ai_count is null"
            " order by created_at asc"
        )
    ]
    total = g.query("select count(*) as n from generated_app")[0]["n"]
    print(f"应用总数        {total}")
    print(f"  两列有缺      {len(ids)}")
    if not ids:
        print("没有可补的。")
        return 0

    todo: list[tuple[str, int, int]] = []
    unreadable = 0
    no_clue = 0
    for start in range(0, len(ids), _BATCH):
        chunk = ids[start : start + _BATCH]
        placeholders = ", ".join(f"${i + 1}" for i in range(len(chunk)))
        rows = g.query(
            f"select id, product_name, goal, model_json from generated_app"
            f" where id in ({placeholders})",
            list(chunk),
        )
        for r in rows:
            model = r.get("model_json")
            if isinstance(model, str):
                try:
                    model = json.loads(model)
                except ValueError:
                    model = None
            if not isinstance(model, dict):
                unreadable += 1
                continue
            try:
                meta = derive_app_metadata(model)
            except Exception as exc:  # noqa: BLE001 —— 一行坏了不该拖垮整趟
                print(f"  ! {r['id'][:8]} 数不出来: {str(exc)[:80]}")
                unreadable += 1
                continue
            role, ai = meta.get("role_count"), meta.get("ai_count")
            if role is None and ai is None:
                no_clue += 1
                continue
            label = (r.get("product_name") or r.get("goal") or "")[:28]
            todo.append((r["id"], role, ai))
            print(f"  {r['id'][:8]}  角色={role!s:<5} AI={ai!s:<5} {label}")

    print()
    print(f"  能数出来      {len(todo)}")
    print(f"  模型里没这段  {no_clue}   ← 保持 NULL，不写 0")
    print(f"  读不出来      {unreadable}")
    print()

    if not todo:
        print("没有可补的。")
        return 0

    if not APPLY:
        print("这是 dry-run。确认无误后加 --apply 真写。")
        return 0

    for app_id, role, ai in todo:
        g.query(
            "update generated_app set role_count = $2, ai_count = $3 where id = $1",
            [app_id, role, ai],
        )
    print(f"已补 {len(todo)} 条。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
