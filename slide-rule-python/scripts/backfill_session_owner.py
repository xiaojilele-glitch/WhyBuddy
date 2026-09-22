"""给存量会话补 ownerId —— 默认 dry-run，看清楚了再 --apply。

## 为什么需要它

会话的归属字段是 2026-08-06 才加的（此前 sliderule_session 表只有
session_id/payload/rev/created_at/last_active，5 条路由一条都没做归属判定，
实测匿名可以列出、读取、删除任何人的会话）。

加字段之后，**新建的会话**自动带 ownerId；**存量会话**全是无主的。无主按
"保持可读"处理（与应用侧存量数据同一条规则，见 app_access 的会话小节），
也就是说存量那批仍然人人可见。这个脚本把能推断出主人的补上，把无主集合缩小。

## 推断依据：generated_app.session_id → owner_id

推演闭环时会把应用落库，`generated_app` 同时记着 `session_id` 和 `owner_id`。
所以"这个会话生成的应用归谁"就等于"这个会话归谁"——这是库里现成的、
不需要猜的事实。

推断不出来的（没生成过应用的会话）**不动**：宁可留着无主，也不要按时间/
顺序去猜一个主人——猜错的后果是把 A 的会话判给 B，比无主更糟。

## 用法

    cd slide-rule-python
    .venv/bin/python scripts/backfill_session_owner.py            # 看要改什么
    .venv/bin/python scripts/backfill_session_owner.py --apply    # 真写
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app  # noqa: F401,E402  —— 触发 .env 加载
from services.app_store import HttpSqlGateway, http_api_credentials  # noqa: E402

APPLY = "--apply" in sys.argv


def main() -> int:
    url, key = http_api_credentials()
    if not (url and key):
        print("没配 APP_STORE_HTTP_API_URL / _KEY，这个脚本只处理库后端。")
        return 1
    g = HttpSqlGateway(url, key)

    # 会话 → 它生成的应用的 owner。一个会话可能有多版应用，取最早那条有主的
    # （版本之间 owner 不会变；真变了也该以最初落库的那次为准）。
    rows = g.query(
        """
        select s.session_id,
               s.payload,
               (select a.owner_id from generated_app a
                 where a.session_id = s.session_id and a.owner_id is not null
                 order by a.created_at asc limit 1) as inferred_owner
          from sliderule_session s
        """,
        [],
    )

    todo: list[tuple[str, str]] = []
    already = 0
    no_clue = 0
    for r in rows:
        sid = r["session_id"]
        payload = r.get("payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except ValueError:
                payload = {}
        payload = payload if isinstance(payload, dict) else {}

        current = str(payload.get("ownerId") or "").strip()
        inferred = str(r.get("inferred_owner") or "").strip()
        if current:
            already += 1
            continue
        if not inferred:
            no_clue += 1
            continue
        todo.append((sid, inferred))

    print(f"会话总数        {len(rows)}")
    print(f"  已有归属      {already}")
    print(f"  能推断出主人  {len(todo)}")
    print(f"  推断不出      {no_clue}   ← 保持无主，不猜")
    print()

    if not todo:
        print("没有可补的。")
        return 0

    for sid, owner in todo:
        print(f"  {sid}  →  {owner}")
    print()

    if not APPLY:
        print("这是 dry-run。确认无误后加 --apply 真写。")
        return 0

    for sid, owner in todo:
        # payload 是唯一真相，列是投影——两处一起写，跟 save 路径保持一致。
        g.query(
            "update sliderule_session"
            " set payload = jsonb_set(payload, '{ownerId}', to_jsonb($2::text), true),"
            "     owner_id = $2"
            " where session_id = $1",
            [sid, owner],
        )
    print(f"已补 {len(todo)} 条。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
